import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { requireScoped, isEmployeeInScope, resolveAccessScope } from "@/rekankerja/shared/services/access-scope";
import { applyAssignmentChange, correctJobRow, CHANGE_REASON_LABEL, decryptBaseSalary } from "@/rekankerja/human-resource/services/assignment";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { computePkwtInfo } from "@/rekankerja/human-resource/services/pkwt";
import { maskEmployeePii, type PiiScope } from "@/rekankerja/human-resource/api/employees";

// GET /api/rekankerja/employee-detail?id=
// Response: employee (data personal + pekerjaan saat ini hasil flatten assignment aktif)
//           + assignments[] = riwayat penempatan lengkap (terbaru → terlama)
// Skema akses data (Task 30): detail hanya dapat diakses bila karyawan
// masuk cakupan akses efektif pengguna (super admin / atasan / rule).
export async function GET(req: NextRequest) {
  try {
    const s = await requireScoped(req);
    if (!s.ok) return NextResponse.json({ error: s.error }, { status: s.status });
    const db = s.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    const currentSelect = {
      where: { validTo: null },
      orderBy: { validFrom: "desc" as const },
      take: 1,
      include: {
        position: { select: { title: true, code: true, level: true } },
        orgUnit: { select: { name: true, code: true } },
        grade: { select: { code: true, name: true, minSalary: true, maxSalary: true } },
        manager: { select: { id: true, fullName: true, employeeNo: true } },
        companyOffice: { select: { code: true, name: true, city: true } },
        workLocation: { select: { code: true, name: true, city: true } },
      },
    };

    const employee = await db.employee.findUnique({
      where: { id },
      include: {
        company: { select: { name: true, code: true } },
        // fallback kantor/lokasi bila tak ada assignment aktif (denorm Employee)
        companyOffice: { select: { code: true, name: true, city: true } },
        workLocation: { select: { code: true, name: true, city: true } },
        family: { orderBy: { birthDate: "asc" } },
        education: { orderBy: { endYear: "desc" } },
        experiences: { orderBy: { endDate: "desc" } },
        disciplinary: { orderBy: { issuedAt: "desc" } },
        actions: {
          orderBy: { createdAt: "desc" },
          select: { id: true, docNo: true, type: true, status: true, effectiveDate: true },
        },
        // assignment aktif (dengan relasi lengkap untuk header/halaman)
        assignments: currentSelect,
      },
    });
    if (!employee) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });

    // cek cakupan skema akses data — 403 bila di luar jangkauan pengguna
    const inScope = await isEmployeeInScope(db, s.scope, employee.id);
    if (!inScope) {
      return NextResponse.json(
        { error: "Akses ditolak: karyawan ini di luar skema akses data Anda. Hubungi admin workspace bila seharusnya dapat diakses." },
        { status: 403 },
      );
    }

    // Task 52-e — audit trail AKSES BACA profil (UU PDP 27/2022 Art.17-19;
    // temuan audit 51: hanya mutasi & ekspor yang tercatat). Setiap pembukaan
    // detail dicatat (action "Viewed") — best-effort, gagal log tidak boleh
    // menggagalkan pembacaan. Anti-spam ringan: duplikat oleh PENGCACAT SAMA
    // dalam 5 menit dilewati (refresh UI), akses menit ke berikutnya tetap
    // tercatat.
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
      const viewerId = s.actor.appUserId;
      const dup = await db.activityLog.findFirst({
        where: {
          action: "Viewed", entity: "Employee", entityId: employee.id,
          appUserId: viewerId, createdAt: { gte: fiveMinAgo },
        },
        select: { id: true },
      });
      if (!dup) {
        const piiScopePre: PiiScope = s.scope.all
          ? "full"
          : employee.id === s.scope.selfEmployeeId ? "self" : "limited";
        await db.activityLog.create({
          data: {
            action: "Viewed", entity: "Employee", entityId: employee.id,
            appUserId: viewerId ?? undefined,
            employeeId: employee.id,
            detail: `Melihat detail karyawan ${employee.fullName} (${employee.employeeNo}) — cakupan PII: ${piiScopePre === "full" ? "penuh" : piiScopePre}`,
          },
        });
      }
    } catch {
      // jejak baca bersifat best-effort — jangan blok payload
    }

    // M-9 (audit 42 / desain 42-e): cakupan PII detail — FULL utk scope ALL
    // (super admin / rule akses penuh) dan utk profil SENDIRI (self — hak
    // melihat data sendiri); pemanggil scoped lainnya yang LOLOS guard di atas
    // (atasan langsung / rule parametrik — koordinator limited yang memang
    // dapat mengakses detail bawahannya) → LIMITED: PII sensitif di-mask
    // (pola sama dgn list /employees — maskEmployeePii + seksi personal
    // lanjutan dikosongkan; field operasional/penempatan tetap utk kebutuhan
    // keputusan approval: nama, no, unit, posisi, joinDate).
    const piiScope: PiiScope = s.scope.all
      ? "full"
      : employee.id === s.scope.selfEmployeeId
        ? "self"
        : "limited";

    // riwayat lengkap (semua periode, terbaru dulu)
    const assignments = await db.employeeAssignment.findMany({
      where: { employeeId: id },
      orderBy: [{ validFrom: "desc" }],
      include: {
        position: { select: { title: true, code: true } },
        orgUnit: { select: { name: true, code: true } },
        grade: { select: { code: true, name: true } },
        manager: { select: { fullName: true } },
        companyOffice: { select: { code: true, name: true, city: true } },
        workLocation: { select: { code: true, name: true, city: true } },
      },
    });

    const cur = employee.assignments[0] ?? null;
    // 28-c: konteks dekripsi per-tenant utk identitas + gaji di batas serializer.
    const tcD = tenantCryptoForDb(db);
    // 45-b: gerbang vault uang (requireScoped → resolve via sesi; aktor kosong
    // saat race revokasi → fail-closed masked bila vault terkonfigurasi).
    const mv = await moneyViewForReq(req, db);
    // manager aktif + posisinya (nested: manager → assignment aktifnya)
    let manager: { id: string; fullName: string; employeeNo: string; photoUrl: string | null; position: { title: string | null } | null } | null = null;
    if (cur?.managerId) {
      const mgr = await db.employee.findUnique({
        where: { id: cur.managerId },
        include: { assignments: { where: { validTo: null }, take: 1, select: { position: { select: { title: true } } } } },
      });
      if (mgr) manager = { id: mgr.id, fullName: mgr.fullName, employeeNo: mgr.employeeNo, photoUrl: mgr.photoUrl, position: { title: mgr.assignments[0]?.position?.title ?? null } };
    }

    // bawahan langsung: karyawan yang assignment aktifnya mengarah ke id ini
    const directReportsRaw = await db.employee.findMany({
      where: { status: "Active", assignments: { some: { validTo: null, managerId: id } } },
      include: { assignments: { where: { validTo: null }, take: 1, include: { position: { select: { title: true } } } } },
      orderBy: { employeeNo: "asc" },
    });

    const { assignments: _curAssignments, ...personal } = employee;
    // 28-c: NIK/NPWP/rekening terenkripsi di DB — dekripsi utk tampilan detail
    // (profil HR; decryptText meloloskan plaintext legacy).
    // Task 52-d: no. BPJS ikut terenkripsi.
    personal.nationalId = tcD.decryptText(personal.nationalId);
    personal.taxId = tcD.decryptText(personal.taxId);
    personal.bankAccount = tcD.decryptText(personal.bankAccount);
    personal.bpjsHealth = tcD.decryptText(personal.bpjsHealth);
    personal.bpjsEmpSkill = tcD.decryptText(personal.bpjsEmpSkill);
    // M-9 / 42-e: pemanggil LIMITED → PII sensitif di-mask (pola sama dgn
    // list /employees) + seksi personal lanjutan dikosongkan: keluarga = PII
    // pihak ketiga/dependen (nama + tanggal lahir); pendidikan/pengalaman/
    // disiplin = data personal lanjutan & dokumen kepegawaian — bukan
    // kebutuhan koordinator. actions (dok PA: no/tipe/status/tgl efektif),
    // directReports, manager, pkwt & riwayat penempatan tetap (operasional);
    // baseSalary di-null per baris (kompensasi — selaras gating export).
    if (piiScope === "limited") {
      maskEmployeePii(personal as unknown as Record<string, unknown>, tcD);
      personal.family = [];
      personal.education = [];
      personal.experiences = [];
      personal.disciplinary = [];
    }
    // 26-b P0 — guard PKWT PP 35/2021 (total durasi kontrak > 5 tahun → wajib
    // konversi ke PKS) + sisa masa kontrak; dihitung server agar UI profil &
    // banner memakai logika satu sumber.
    const pkwt = computePkwtInfo({
      status: employee.status,
      employmentStatus: cur?.employmentStatus ?? null,
      joinDate: employee.joinDate,
      contractStart: employee.contractStart,
      contractEnd: employee.contractEnd,
      renewalCount: employee.renewalCount,
    });
    const flat = {
      ...personal,
      orgUnitId: cur?.orgUnitId ?? null,
      positionId: cur?.positionId ?? null,
      gradeId: cur?.gradeId ?? null,
      managerId: cur?.managerId ?? null,
      employmentStatus: cur?.employmentStatus ?? "—",
      workShift: cur?.workShift ?? "—",
      // M-9 / 42-e: gaji pokok hanya utk full/self — limited → null.
      // 45-b: gerbang vault (requireScoped → resolve via sesi) — masked → null.
      baseSalary: cur ? (piiScope === "limited" || !mv.canSee ? null : decryptBaseSalary(tcD, cur.baseSalary)) : 0,
      orgUnit: cur?.orgUnit ?? null,
      position: cur?.position ?? null,
      grade: cur?.grade ?? null,
      // kantor & lokasi kerja: dari assignment aktif, fallback denorm Employee
      companyOffice: cur?.companyOffice ?? employee.companyOffice ?? null,
      workLocation: cur?.workLocation ?? employee.workLocation ?? null,
      manager,
      directReports: directReportsRaw.map((r) => ({
        id: r.id, fullName: r.fullName, employeeNo: r.employeeNo, photoUrl: r.photoUrl, status: r.status,
        position: r.assignments[0]?.position ?? null,
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        // Task 69 — id versi untuk koreksi baris per langkah riwayat (PUT).
        rowId: a.id,
        validFrom: a.validFrom,
        validTo: a.validTo,
        changeReason: a.changeReason,
        changeReasonLabel: CHANGE_REASON_LABEL[a.changeReason] ?? a.changeReason,
        sourceDocNo: a.sourceDocNo,
        notes: a.notes,
        employmentStatus: a.employmentStatus,
        workShift: a.workShift,
        // Task 69 — id penempatan per versi utk prefill dialog koreksi.
        orgUnitId: a.orgUnitId,
        positionId: a.positionId,
        gradeId: a.gradeId,
        managerId: a.managerId,
        // M-9 / 42-e: riwayat gaji hanya utk full/self — limited → null.
        // 45-b: gerbang vault — masked → null.
        baseSalary: (piiScope === "limited" || !mv.canSee) ? null : decryptBaseSalary(tcD, a.baseSalary),
        orgUnit: a.orgUnit ? { name: a.orgUnit.name, code: a.orgUnit.code } : null,
        position: a.position ? { title: a.position.title, code: a.position.code } : null,
        grade: a.grade ? { code: a.grade.code, name: a.grade.name } : null,
        companyOffice: a.companyOffice ? { code: a.companyOffice.code, name: a.companyOffice.name, city: a.companyOffice.city } : null,
        workLocation: a.workLocation ? { code: a.workLocation.code, name: a.workLocation.name, city: a.workLocation.city } : null,
        managerName: a.manager?.fullName ?? null,
      })),
      pkwt,
    };

    // M-9 / 42-e: flag cakupan PII (full|self|limited) di payload root —
    // properti baru opsional; frontend lama mengabaikannya (kompatibel).
    return NextResponse.json({ employee: flat, piiScope });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

const PERSONAL_FIELDS = [
  "fullName", "gender", "birthPlace", "nationalId", "taxId", "bpjsHealth", "bpjsEmpSkill",
  "maritalStatus", "religion", "bloodType", "email", "phone", "address", "city",
  "bankName", "bankAccount",
] as const;
const JOB_FIELDS = ["orgUnitId", "positionId", "gradeId", "managerId", "employmentStatus", "workShift"] as const;

// PATCH /api/rekankerja/employee-detail?id=
// Perubahan data personal → update Employee.
// Perubahan data pekerjaan → assignment aktif ditutup + assignment baru dibuat (tercatat di riwayat).
// Task 32-d: guard hak AKSI menu — update pada menu hr:directory (per pengguna).
// T1-SECURITY: PATCH kini juga CEK SCOPE DATA (dulu hanya GET) — karyawan di
// luar cakupan akses efektif pengguna → 403 (pola sama dgn GET di atas).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    // cek keberadaan + cakupan skema akses data SEBELUM menulis apa pun
    const exists = await db.employee.findUnique({
      where: { id },
      select: { id: true, contractStart: true, contractEnd: true },
    });
    if (!exists) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
    const scope = await resolveAccessScope(db, {
      appUserId: m.actor.appUserId,
      employeeId: m.actor.employeeId,
      appUserRole: m.actor.appUserRole,
      platformRole: m.actor.role,
    });
    const inScope = await isEmployeeInScope(db, scope, id);
    if (!inScope) {
      return NextResponse.json(
        { error: "Akses ditolak: karyawan ini di luar skema akses data Anda. Hubungi admin workspace bila seharusnya dapat diakses." },
        { status: 403 },
      );
    }

    const b = await req.json();

    // Fix audit 40 M-13 — jalur terminasi senyap: PATCH endDate bebas dulu +
    // scheduler memutus status karyawan tanpa PA → "Resigned" tanpa
    // offboarding / settlement / penutupan assignment (bypass seluruh proses
    // pengakhiran). SET nilai endDate kini DITOLAK — pengakhiran kepegawaian
    // wajib melalui Personnel Action (Termination/Resignation/Retirement) yang
    // mengelola assignment, offboarding & settlement secara utuh.
    // MENGKOSONGKAN endDate tetap DIIZINKAN (b.endDate null/"") — koreksi typo
    // data lama; pengosongan tidak mengubah status karyawan.
    if (b.endDate !== undefined && b.endDate !== null && String(b.endDate).trim() !== "") {
      return NextResponse.json(
        {
          error:
            "Pengakhiran kepegawaian harus melalui Personnel Action (Termination/Resignation/Retirement) — perubahan endDate langsung dinonaktifkan (fix audit 40 M-13)",
        },
        { status: 400 },
      );
    }

    // fix audit 42 K-3 (KRITIS): write-path PATCH kini ikut skema 28-c —
    // NIK/NPWP/no. rekening DIENKRIPSI sebelum persist (dulu tersimpan
    // plaintext sementara read-path GET men-dekripsi — data PII bocor di DB).
    // Pola: payroll-profiles.ts PATCH (encryptText; null → null, "" → "",
    // plaintext legacy di-re-encrypt saat tulis berikutnya).
    // NOTE: jalur tulis lain (wizard POST /employees + import Excel) sudah
    // terenkripsi via createEmployeeWithAssignment (employees.ts).
    const tcW = tenantCryptoForDb(db);
    // Task 52-d — no. BPJS masuk set enkripsi (migrate-encrypt-pii).
    const ENCRYPTED_PERSONAL: ReadonlySet<string> = new Set(["nationalId", "taxId", "bankAccount", "bpjsHealth", "bpjsEmpSkill"]);
    const data: Record<string, unknown> = {};
    for (const f of PERSONAL_FIELDS) {
      if (b[f] === undefined) continue;
      data[f] = ENCRYPTED_PERSONAL.has(f) ? tcW.encryptText(b[f] as string | null) : b[f];
    }
    if (b.birthDate !== undefined) data.birthDate = b.birthDate ? new Date(b.birthDate) : null;
    if (b.joinDate !== undefined) data.joinDate = b.joinDate ? new Date(b.joinDate) : undefined;
    // Fix audit 40 M-13 — hanya jalur pengosongan (null/"") yang lolos guard di atas.
    if (b.endDate !== undefined) data.endDate = null;

    // 26-b P0 — PKWT PP 35/2021: tanggal kontrak & jumlah perpanjangan.
    // Konsistensi: konversi ke Permanent → jejak PKWT dikosongkan (PKS tak
    // berbatas); akhir kontrak wajib setelah tanggal mulai (gabungan nilai
    // baru + nilai tersimpan bila hanya salah satu yang dikirim).
    if (b.contractStart !== undefined) data.contractStart = b.contractStart ? new Date(b.contractStart) : null;
    if (b.contractEnd !== undefined) data.contractEnd = b.contractEnd ? new Date(b.contractEnd) : null;
    if (b.renewalCount !== undefined) data.renewalCount = Math.max(0, Number(b.renewalCount) || 0);
    if (b.employmentStatus === "Permanent") {
      data.contractStart = null;
      data.contractEnd = null;
      data.renewalCount = 0;
    }
    const finalStart = data.contractStart !== undefined ? (data.contractStart as Date | null) : exists.contractStart;
    const finalEnd = data.contractEnd !== undefined ? (data.contractEnd as Date | null) : exists.contractEnd;
    if (finalStart && finalEnd && finalEnd.getTime() <= finalStart.getTime()) {
      return NextResponse.json(
        { error: "Tanggal berakhir kontrak harus setelah tanggal mulai kontrak" },
        { status: 400 },
      );
    }

    const employee = await db.employee.update({ where: { id }, data });

    // perubahan data pekerjaan → catat sebagai riwayat baru
    // Task 69: dialog "Ubah Penempatan" kirim effectiveDate (boleh backdated —
    // applyAssignmentChange menyisip versi tengah rantai dengan aman) + catatan.
    const hasJobChange = JOB_FIELDS.some((f) => b[f] !== undefined) || b.baseSalary !== undefined;
    let historyNote = "";
    if (hasJobChange) {
      const eff = b.effectiveDate ? new Date(String(b.effectiveDate)) : new Date();
      if (Number.isNaN(eff.getTime())) return NextResponse.json({ error: "Tanggal efektif tidak valid" }, { status: 400 });
      const overrides: Record<string, unknown> = {};
      for (const f of JOB_FIELDS) if (b[f] !== undefined) overrides[f] = b[f] || null;
      if (b.baseSalary !== undefined) overrides.baseSalary = Number(b.baseSalary);
      const res = await applyAssignmentChange(db, id, overrides, {
        reason: "ManualEdit",
        effectiveDate: eff,
        notes: typeof b.changeNote === "string" && b.changeNote.trim()
          ? b.changeNote.trim()
          : "Perubahan data pekerjaan dari halaman profil",
      });
      historyNote = res.changed ? " — perubahan pekerjaan tercatat di riwayat" : "";
    }

    await db.activityLog.create({
      data: { action: "Updated", entity: "Employee", entityId: id, employeeId: id, detail: `Data ${employee.fullName} diperbarui${historyNote}` },
    });
    // fix K-3: response memakai bentuk read-path (GET) — NIK/NPWP/rekening
    // di-dekripsi (decryptText meloloskan plaintext legacy), bukan ciphertext.
    return NextResponse.json({
      employee: {
        ...employee,
        nationalId: tcW.decryptText(employee.nationalId),
        taxId: tcW.decryptText(employee.taxId),
        bankAccount: tcW.decryptText(employee.bankAccount),
        bpjsHealth: tcW.decryptText(employee.bpjsHealth),
        bpjsEmpSkill: tcW.decryptText(employee.bpjsEmpSkill),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PUT /api/rekankerja/employee-detail — KOREKSI LANGSUNG SATU BARIS RIWAYAT
// PENEMPATAN (Task 69). Untuk salah input human error pada versi tanpa movement
// proses di belakangnya — BUKAN pengganti Personnel Action (promosi/transfer
// resmi tetap lewat PA; kenaikan gaji lewat Profil Payroll / PA SalaryAdjustment).
// Guard rantai versi di service layer; setiap koreksi meninggalkan ActivityLog.
// Body: { rowId, orgUnitId?, positionId?, gradeId?, managerId?, employmentStatus?,
//         workShift?, validFrom?, validTo?, notes? }
export async function PUT(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!b.rowId) return NextResponse.json({ error: "rowId wajib" }, { status: 400 });
    const parseDate = (v: unknown): Date | undefined =>
      v == null || v === "" ? undefined : new Date(String(v));
    const r = await correctJobRow(db, String(b.rowId), {
      ...(b.orgUnitId !== undefined ? { orgUnitId: b.orgUnitId === "" ? null : String(b.orgUnitId) } : {}),
      ...(b.positionId !== undefined ? { positionId: b.positionId === "" ? null : String(b.positionId) } : {}),
      ...(b.gradeId !== undefined ? { gradeId: b.gradeId === "" ? null : String(b.gradeId) } : {}),
      ...(b.managerId !== undefined ? { managerId: b.managerId === "" ? null : String(b.managerId) } : {}),
      ...(b.employmentStatus !== undefined ? { employmentStatus: String(b.employmentStatus) } : {}),
      ...(b.workShift !== undefined ? { workShift: String(b.workShift) } : {}),
      ...(b.validFrom !== undefined ? { validFrom: parseDate(b.validFrom)! } : {}),
      ...(b.validTo !== undefined ? { validTo: b.validTo === null ? null : parseDate(b.validTo)! } : {}),
      ...(b.notes !== undefined ? { notes: b.notes } : {}),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "EmployeeAssignment", entityId: String(b.rowId),
        detail: "Koreksi manual baris riwayat penempatan (tanpa movement)",
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
