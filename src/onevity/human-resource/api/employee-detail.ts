import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { requireScoped, isEmployeeInScope, resolveAccessScope } from "@/onevity/shared/services/access-scope";
import { applyAssignmentChange, CHANGE_REASON_LABEL, decryptBaseSalary } from "@/onevity/human-resource/services/assignment";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import { computePkwtInfo } from "@/onevity/human-resource/services/pkwt";

// GET /api/onevity/employee-detail?id=
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
      },
    };

    const employee = await db.employee.findUnique({
      where: { id },
      include: {
        company: { select: { name: true, code: true } },
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

    // riwayat lengkap (semua periode, terbaru dulu)
    const assignments = await db.employeeAssignment.findMany({
      where: { employeeId: id },
      orderBy: [{ validFrom: "desc" }],
      include: {
        position: { select: { title: true, code: true } },
        orgUnit: { select: { name: true, code: true } },
        grade: { select: { code: true, name: true } },
        manager: { select: { fullName: true } },
      },
    });

    const cur = employee.assignments[0] ?? null;
    // 28-c: konteks dekripsi per-tenant utk identitas + gaji di batas serializer.
    const tcD = tenantCryptoForDb(db);
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
    personal.nationalId = tcD.decryptText(personal.nationalId);
    personal.taxId = tcD.decryptText(personal.taxId);
    personal.bankAccount = tcD.decryptText(personal.bankAccount);
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
      baseSalary: cur ? decryptBaseSalary(tcD, cur.baseSalary) : 0,
      orgUnit: cur?.orgUnit ?? null,
      position: cur?.position ?? null,
      grade: cur?.grade ?? null,
      manager,
      directReports: directReportsRaw.map((r) => ({
        id: r.id, fullName: r.fullName, employeeNo: r.employeeNo, photoUrl: r.photoUrl, status: r.status,
        position: r.assignments[0]?.position ?? null,
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        validFrom: a.validFrom,
        validTo: a.validTo,
        changeReason: a.changeReason,
        changeReasonLabel: CHANGE_REASON_LABEL[a.changeReason] ?? a.changeReason,
        sourceDocNo: a.sourceDocNo,
        notes: a.notes,
        employmentStatus: a.employmentStatus,
        workShift: a.workShift,
        baseSalary: decryptBaseSalary(tcD, a.baseSalary),
        orgUnit: a.orgUnit ? { name: a.orgUnit.name, code: a.orgUnit.code } : null,
        position: a.position ? { title: a.position.title, code: a.position.code } : null,
        grade: a.grade ? { code: a.grade.code, name: a.grade.name } : null,
        managerName: a.manager?.fullName ?? null,
      })),
      pkwt,
    };

    return NextResponse.json({ employee: flat });
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

// PATCH /api/onevity/employee-detail?id=
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

    const data: Record<string, unknown> = {};
    for (const f of PERSONAL_FIELDS) if (b[f] !== undefined) data[f] = b[f];
    if (b.birthDate !== undefined) data.birthDate = b.birthDate ? new Date(b.birthDate) : null;
    if (b.joinDate !== undefined) data.joinDate = b.joinDate ? new Date(b.joinDate) : undefined;
    if (b.endDate !== undefined) data.endDate = b.endDate ? new Date(b.endDate) : null;

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
    const hasJobChange = JOB_FIELDS.some((f) => b[f] !== undefined) || b.baseSalary !== undefined;
    let historyNote = "";
    if (hasJobChange) {
      const overrides: Record<string, unknown> = {};
      for (const f of JOB_FIELDS) if (b[f] !== undefined) overrides[f] = b[f] || null;
      if (b.baseSalary !== undefined) overrides.baseSalary = Number(b.baseSalary);
      const res = await applyAssignmentChange(db, id, overrides, {
        reason: "ManualEdit",
        effectiveDate: new Date(),
        notes: "Perubahan data pekerjaan dari halaman profil",
      });
      historyNote = res.changed ? " — perubahan pekerjaan tercatat di riwayat" : "";
    }

    await db.activityLog.create({
      data: { action: "Updated", entity: "Employee", entityId: id, employeeId: id, detail: `Data ${employee.fullName} diperbarui${historyNote}` },
    });
    return NextResponse.json({ employee });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
