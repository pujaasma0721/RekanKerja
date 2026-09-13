import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { moneyViewForReq } from "@/onevity/shared/lib/money-view-req";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { PTKP_ANNUAL } from "@/onevity/payroll/services/payroll-engine";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import {
  applyPtkpAutoToAll,
  derivePtkpFromFamily,
} from "@/onevity/payroll/services/ptkp-auto";

// GET /api/onevity/payroll-profiles?q= — daftar karyawan aktif + profil payroll + assignment aktif
// Task 49: tiap baris membawa ptkpSource + ptkpSuggestion (derivasi data keluarga).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const q = req.nextUrl.searchParams.get("q")?.trim();
    // 45-b: resolve gerbang vault SEKALI di luar .map (getMoneyView async).
    const moneyViewG = await moneyViewForReq(req, db);
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
