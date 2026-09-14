import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { moneyViewForReq } from "@/onevity/shared/lib/money-view-req";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { PTKP_ANNUAL } from "@/onevity/payroll/services/payroll-engine";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import {
  applyWageTemplateChange,
  correctAssignmentRow,
  correctTemplateHistoryRow,
} from "@/onevity/human-resource/services/assignment";
import {
  applyPtkpAutoToAll,
  derivePtkpFromFamily,
} from "@/onevity/payroll/services/ptkp-auto";

// GET /api/onevity/payroll-profiles?q= — daftar karyawan aktif + profil payroll + assignment aktif
// Task 49: tiap baris membawa ptkpSource + ptkpSuggestion (derivasi data keluarga).
// Task 64d — GET ?history=1&employeeId= : riwayat GAJI per periode (versi
// EmployeeAssignment ber-tanggal) + riwayat TEMPLATE UPAH per periode
// (EmployeeWageTemplateHistory) untuk satu karyawan — ditampilkan modul
// Payroll (Profil Payroll → tombol Riwayat). Uang digate MoneyView; alasan
// & dokumen sumber tampil apa adanya.
async function historyHandler(req: NextRequest, db: NonNullable<Awaited<ReturnType<typeof requireTenant>>>) {
  const employeeId = req.nextUrl.searchParams.get("employeeId");
  if (!employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });
  const mv = await moneyViewForReq(req, db);
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employeeNo: true, fullName: true },
  });
  if (!emp) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
  const [assignments, templateHist] = await Promise.all([
    db.employeeAssignment.findMany({
      where: { employeeId },
      orderBy: { validFrom: "asc" },
      include: {
        orgUnit: { select: { name: true } },
        position: { select: { title: true } },
        grade: { select: { name: true } },
        companyOffice: { select: { code: true, name: true } },
      },
    }),
    db.employeeWageTemplateHistory.findMany({
      where: { employeeId },
      orderBy: { validFrom: "asc" },
      include: { wageTemplate: { select: { code: true, name: true } } },
    }),
  ]);
  return NextResponse.json({
    employee: { id: emp.id, employeeNo: emp.employeeNo, fullName: emp.fullName },
    salary: assignments.map((a) => ({
      id: a.id,
      validFrom: a.validFrom,
      validTo: a.validTo,
      baseSalary: mv.dec0(a.baseSalary),
      reason: a.changeReason,
      sourceDocNo: a.sourceDocNo,
      notes: a.notes,
      positionName: a.position?.title ?? null,
      orgUnitName: a.orgUnit?.name ?? null,
      gradeName: a.grade?.name ?? null,
      officeCode: a.companyOffice?.code ?? null,
    })),
    templates: templateHist.map((h) => ({
      id: h.id,
      validFrom: h.validFrom,
      validTo: h.validTo,
      templateId: h.wageTemplateId,
      templateCode: h.wageTemplate?.code ?? null,
      templateName: h.wageTemplate?.name ?? null,
      reason: h.changeReason,
      sourceDocNo: h.sourceDocNo,
      notes: h.notes,
    })),
  });
}

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    if (req.nextUrl.searchParams.get("history") === "1") return await historyHandler(req, db);

    const q = req.nextUrl.searchParams.get("q")?.trim();
    // 45-b: resolve gerbang vault SEKALI di luar .map (getMoneyView async).
    const moneyViewG = await moneyViewForReq(req, db);
    // Task 64h — template VALID HARI INI per karyawan (baris riwayat terakhir
    // dgn validFrom ≤ hari ini) — sumber kebenaran utk tampilan read-only di
    // dialog edit profil (bukan pointer mentah profil yang bisa telat).
    const nowDay = new Date(); nowDay.setHours(23, 59, 59, 999);
    const histAll = await db.employeeWageTemplateHistory.findMany({
      where: { employeeId: { in: await db.employee.findMany({ where: { status: "Active", ...(q ? { OR: [{ fullName: { contains: q } }, { employeeNo: { contains: q } }] } : {}) }, select: { id: true } }).then((l) => l.map((x) => x.id)) }, validFrom: { lte: nowDay } },
      orderBy: { validFrom: "asc" },
      include: { wageTemplate: { select: { name: true } } },
    });
    const effTpl = new Map<string, { id: string | null; name: string | null }>();
    for (const h of histAll) effTpl.set(h.employeeId, { id: h.wageTemplateId, name: h.wageTemplate?.name ?? null });
    const employees = await db.employee.findMany({
      where: {
        status: "Active",
        ...(q ? { OR: [{ fullName: { contains: q } }, { employeeNo: { contains: q } }] } : {}),
      },
      include: {
        payrollProfile: { include: { wageTemplate: true } },
        family: { select: { relation: true, isDependent: true } },
        assignments: {
          where: { validTo: null },
          include: { orgUnit: true, position: true, grade: true },
          take: 1,
        },
      },
      orderBy: { employeeNo: "asc" },
    });
    const rows = employees.map((e) => {
      const a = e.assignments[0];
      const p = e.payrollProfile;
      // 28-c: konteks dekripsi per-tenant di batas serializer.
      // 45-b: baseSalary via gerbang vault (masked → null; legacy/open = angka).
      // npwp/rekening = PII — tetap jalur env (vault hanya menyembunyikan uang).
      const tc = tenantCryptoForDb(db);
      const mv = moneyViewG;
      // 49: saran PTKP dari data keluarga — hanya angka/status (tanpa PII keluarga).
      const ptkpSuggestion = derivePtkpFromFamily(e.family, e.maritalStatus);
      return {
        employeeId: e.id,
        employeeNo: e.employeeNo,
        fullName: e.fullName,
        orgUnitName: a?.orgUnit?.name ?? null,
        positionName: a?.position?.title ?? null,
        gradeName: a?.grade?.name ?? null,
        // 28-c: baseSalary + npwp/rekening terenkripsi — dekripsi di batas serializer.
        // 56: dec0 — vault tertutup → 0 (bukan null/"—"; nilai asli muncul
        // otomatis setelah unlock via event onevity:vault-changed).
        baseSalary: a ? mv.dec0(a.baseSalary) : 0,
        // Task 64h — template efektif hari ini (dari riwayat) + penanda read-only.
        effectiveTemplate: effTpl.get(e.id) ?? { id: p?.wageTemplateId ?? null, name: p?.wageTemplate?.name ?? null },
        profile: p
          ? {
              id: p.id,
              npwp: tc.decryptText(p.npwp) ?? tc.decryptText(e.taxId),
              hasNpwp: p.hasNpwp,
              processMethod: p.processMethod,
              paymentFrequency: p.paymentFrequency,
              wageTemplateId: p.wageTemplateId,
              wageTemplateName: p.wageTemplate?.name ?? null,
              taxStatus: p.taxStatus,
              ptkpValue: PTKP_ANNUAL[p.taxStatus] ?? PTKP_ANNUAL.TK0,
              dependents: p.dependents,
              ptkpSource: p.ptkpSource ?? "manual",
              bankName: p.bankName ?? e.bankName ?? null,
              bankAccount: tc.decryptText(p.bankAccount) ?? tc.decryptText(e.bankAccount),
            }
          : null,
        ptkpSuggestion,
      };
    });
    return NextResponse.json({ employees: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/payroll-profiles — upsert profil karyawan
// T1-SECURITY: guard hak AKSI menu payroll:profiles (Ubah).
// Task 49: body.ptkpSource "auto" → taxStatus/dependents diturunkan dari data
// keluarga (payload taxStatus diabaikan); "manual"/tidak dikirim + taxStatus
// eksplisit → manual (override admin menang, sumber dialihkan otomatis).
// Task 50: profil yang SUDAH "auto" = SNAPSHOT hasil refresh tahunan —
// taxStatus DIPERTAHANKAN saat PATCH (perubahan keluarga berlaku 1 Jan
// tahun berikutnya, bukan saat dialog disimpan). Derivasi keluarga hanya
// dilakukan untuk pengisian awal: profil baru atau aktivasi manual→auto.
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:profiles", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });
    // Task 64h — pergantian template TIDAK lewat dialog profil: template yang
    // dipakai payroll = versi valid hari ini dari RIWAYAT (hanya berubah via
    // Personnel Action atau koreksi baris riwayat). PATCH yang mengirim
    // wageTemplateId berbeda dari versi efektif → ditolak dengan pesan jelas.
    if (b.wageTemplateId !== undefined) {
      const nowDay = new Date(); nowDay.setHours(23, 59, 59, 999);
      const cur = await db.employeeWageTemplateHistory.findFirst({
        where: { employeeId: b.employeeId, validFrom: { lte: nowDay } },
        orderBy: { validFrom: "desc" },
      });
      const sent = b.wageTemplateId === "" ? null : String(b.wageTemplateId);
      if ((cur?.wageTemplateId ?? null) !== sent) {
        return NextResponse.json({ error: "Template upah mengikuti riwayat yang berlaku hari ini — ubah via Personnel Action (kenaikan jabatan) atau koreksi baris di Riwayat" }, { status: 400 });
      }
    }

    const validStatus = Object.keys(PTKP_ANNUAL);
    const taxStatus = b.taxStatus ?? undefined;
    if (taxStatus && !validStatus.includes(taxStatus)) {
      return NextResponse.json({ error: `Status PTKP tidak valid (${validStatus.join(", ")})` }, { status: 400 });
    }
    if (b.ptkpSource != null && b.ptkpSource !== "auto" && b.ptkpSource !== "manual") {
      return NextResponse.json({ error: "ptkpSource harus 'auto' atau 'manual'" }, { status: 400 });
    }

    // Task 49: sumber PTKP eksplisit "auto" → derivasi dari data keluarga.
    const wantAuto = b.ptkpSource === "auto";
    // Override manual implisit: taxStatus dikirim TANPA ptkpSource "auto"
    // eksplisit → admin menetapkan sendiri → sumber manual.
    const ptkpSource =
      b.ptkpSource != null ? b.ptkpSource : taxStatus ? "manual" : undefined;

    const existing = await db.employeePayrollProfile.findUnique({ where: { employeeId: b.employeeId } });

    // Task 50: pengisian awal hanya bila profil BARU atau aktivasi manual→auto.
    // Profil yang sudah "auto" → snapshot refresh tahunan, dipertahankan.
    const initialAutoFill = wantAuto && existing?.ptkpSource !== "auto";

    let derived: { taxStatus: string; dependents: number } | null = null;
    if (initialAutoFill) {
      const emp = await db.employee.findUnique({
        where: { id: b.employeeId },
        select: { maritalStatus: true, family: { select: { relation: true, isDependent: true } } },
      });
      if (!emp) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
      const suggestion = derivePtkpFromFamily(emp.family, emp.maritalStatus);
      derived = { taxStatus: suggestion.taxStatus, dependents: suggestion.dependents };
    }

    // 28-c: npwp/rekening dienkripsi saat disimpan (enc:v1:t:…).
    const tcW = tenantCryptoForDb(db);
    const data = {
      npwp: b.npwp != null ? tcW.encryptText(String(b.npwp)) : undefined,
      hasNpwp: b.hasNpwp,
      processMethod: b.processMethod,
      paymentFrequency: b.paymentFrequency,
      wageTemplateId: b.wageTemplateId === "" ? null : b.wageTemplateId,
      // Task 49/50: pengisian awal auto → derivasi keluarga; profil yang
      // sudah auto → snapshot dipertahankan (perubahan keluarga berlaku
      // 1 Jan tahun berikutnya); manual → payload admin.
      taxStatus: initialAutoFill
        ? derived!.taxStatus
        : wantAuto
          ? existing!.taxStatus
          : taxStatus,
      dependents: initialAutoFill
        ? derived!.dependents
        : wantAuto
          ? existing!.dependents
          : b.dependents != null
            ? Math.max(0, Math.min(3, Number(b.dependents)))
            : undefined,
      ptkpSource,
      bankName: b.bankName,
      bankAccount: b.bankAccount != null ? tcW.encryptText(String(b.bankAccount)) : undefined,
    };

    const profile = existing
      ? await db.employeePayrollProfile.update({ where: { employeeId: b.employeeId }, data, include: { wageTemplate: true } })
      : await db.employeePayrollProfile.create({ data: { ...data, employeeId: b.employeeId }, include: { wageTemplate: true } });

    // Task 64 — pergantian template = riwayat effective-dated (kenaikan jabatan
    // mid-year tidak merusak run bulan sebelumnya). Efektif: hari ini; backdate
    // via Personnel Action. Profil BARU: baris riwayat pertama menutup celah
    // riwayat (validFrom = joinDate). Ganti template + perubahan lain (npwp,
    // rekening, PTKP) tetap di-update langsung — hanya template ber-versioning.
    if (b.wageTemplateId !== undefined) {
      if (existing) {
        await applyWageTemplateChange(db, b.employeeId, data.wageTemplateId ?? null, {
          effectiveDate: new Date(),
          reason: "ManualEdit",
          notes: "Diubah via Profil Payroll",
        });
      } else {
        const emp = await db.employee.findUnique({ where: { id: b.employeeId }, select: { joinDate: true } });
        await db.employeeWageTemplateHistory.create({
          data: {
            employeeId: b.employeeId,
            wageTemplateId: data.wageTemplateId ?? null,
            validFrom: emp?.joinDate ?? new Date(),
            changeReason: "Initial",
            notes: "Profil payroll dibuat",
        },
        });
      }
    }

    // Task 49/50: jejak audit — sumber PTKP + snapshot vs pengisian awal.
    const nextYear = new Date().getFullYear() + 1;
    const ptkpNote =
      profile.ptkpSource === "auto"
        ? initialAutoFill
          ? `PTKP ${profile.taxStatus} (pengisian awal otomatis dari data keluarga)`
          : `PTKP ${profile.taxStatus} (snapshot refresh tahunan — perubahan keluarga berlaku 1 Jan ${nextYear})`
        : `PTKP ${profile.taxStatus} (manual)`;
    await db.activityLog.create({
      data: { action: "Updated", entity: "EmployeePayrollProfile", entityId: profile.id, employeeId: b.employeeId, detail: `Data payroll karyawan diperbarui (${ptkpNote}, ${profile.processMethod})` },
    });
    // 28-c: response profil di-dekripsi (bentuk lama utk UI).
    return NextResponse.json({ profile: { ...profile, npwp: tcW.decryptText(profile.npwp), bankAccount: tcW.decryptText(profile.bankAccount) } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PUT /api/onevity/payroll-profiles — KOREKSI LANGSUNG SATU BARIS RIWAYAT
// (salah ketik nilai/tanggal pada versi tanpa movement proses — bukan pengganti
// Personnel Action untuk kenaikan/promosi). Guard rantai versi di service layer;
// setiap koreksi meninggalkan ActivityLog (audit).
// Body: { kind: "salary", rowId, baseSalary?, validFrom?, validTo?, notes? }
//     | { kind: "template", rowId, wageTemplateId?, validFrom?, validTo?, notes? }
export async function PUT(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:profiles", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!b.rowId || (b.kind !== "salary" && b.kind !== "template")) {
      return NextResponse.json({ error: "kind ('salary'|'template') dan rowId wajib" }, { status: 400 });
    }
    const parseDate = (v: unknown): Date | undefined =>
      v == null || v === "" ? undefined : new Date(String(v));
    const tcr = tenantCryptoForDb(db);
    // Guard vault: koreksi nilai gaji hanya saat Money Vault terbuka —
    // mencegah admin menimpa nilai asli dengan 0 (tampilan masked).
    if (b.kind === "salary" && b.baseSalary !== undefined) {
      const mv = await moneyViewForReq(req, db);
      if (!mv.canSee) return NextResponse.json({ error: "Buka Money Vault untuk mengoreksi nilai gaji" }, { status: 403 });
      const n = Number(b.baseSalary);
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: "Nilai gaji tidak valid" }, { status: 400 });
    }
    let r: { ok: true } | { ok: false; error: string };
    if (b.kind === "salary") {
      r = await correctAssignmentRow(db, String(b.rowId), {
        ...(b.baseSalary !== undefined ? { baseSalary: Number(b.baseSalary) } : {}),
        ...(b.validFrom !== undefined ? { validFrom: parseDate(b.validFrom)! } : {}),
        ...(b.validTo !== undefined ? { validTo: b.validTo === null ? null : parseDate(b.validTo)! } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
      }, tcr);
    } else {
      r = await correctTemplateHistoryRow(db, String(b.rowId), {
        ...(b.wageTemplateId !== undefined ? { wageTemplateId: b.wageTemplateId === "" ? null : String(b.wageTemplateId) } : {}),
        ...(b.validFrom !== undefined ? { validFrom: parseDate(b.validFrom)! } : {}),
        ...(b.validTo !== undefined ? { validTo: b.validTo === null ? null : parseDate(b.validTo)! } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
      });
    }
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    await db.activityLog.create({
      data: {
        action: "Updated",
        entity: b.kind === "salary" ? "EmployeeAssignment" : "EmployeeWageTemplateHistory",
        entityId: String(b.rowId),
        detail: `Koreksi manual baris riwayat ${b.kind === "salary" ? "gaji pokok" : "template upah"} (tanpa movement)`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/payroll-profiles — { action: "sync-ptkp", dryRun?: boolean }
// Task 49: sinkronisasi massal PTKP dari data keluarga. dryRun=true → pratinjau
// rencana perubahan TANPA menulis (UI menampilkan daftar sebelum konfirmasi).
// Profil K/I DIBIARKAN manual (penghasilan pasangan digabung = pilihan admin,
// tidak dapat diturunkan dari data keluarga).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "payroll:profiles", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json().catch(() => ({}) as Record<string, unknown>);
    if (b.action !== "sync-ptkp") {
      return NextResponse.json({ error: "action harus 'sync-ptkp'" }, { status: 400 });
    }
    const dryRun = b.dryRun === true;
    const r = await applyPtkpAutoToAll(db, dryRun);
    return NextResponse.json({
      ok: true,
      dryRun,
      ...r,
      detail: dryRun
        ? `Pratinjau: ${r.changed} dari ${r.employees} karyawan akan berubah status PTKP`
        : `PTKP disinkronkan dari data keluarga — ${r.changed} dari ${r.employees} karyawan berubah`,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
