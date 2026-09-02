import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { applyAssignmentChange, CHANGE_REASON_LABEL } from "@/onevity/human-resource/services/assignment";

// GET /api/onevity/employee-detail?id=
// Response: employee (data personal + pekerjaan saat ini hasil flatten assignment aktif)
//           + assignments[] = riwayat penempatan lengkap (terbaru → terlama)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

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
    // manager aktif + posisinya (nested: manager → assignment aktifnya)
    let manager: { id: string; fullName: string; employeeNo: string; position: { title: string | null } | null } | null = null;
    if (cur?.managerId) {
      const mgr = await db.employee.findUnique({
        where: { id: cur.managerId },
        include: { assignments: { where: { validTo: null }, take: 1, select: { position: { select: { title: true } } } } },
      });
      if (mgr) manager = { id: mgr.id, fullName: mgr.fullName, employeeNo: mgr.employeeNo, position: { title: mgr.assignments[0]?.position?.title ?? null } };
    }

    // bawahan langsung: karyawan yang assignment aktifnya mengarah ke id ini
    const directReportsRaw = await db.employee.findMany({
      where: { status: "Active", assignments: { some: { validTo: null, managerId: id } } },
      include: { assignments: { where: { validTo: null }, take: 1, include: { position: { select: { title: true } } } } },
      orderBy: { employeeNo: "asc" },
    });

    const { assignments: _curAssignments, ...personal } = employee;
    const flat = {
      ...personal,
      orgUnitId: cur?.orgUnitId ?? null,
      positionId: cur?.positionId ?? null,
      gradeId: cur?.gradeId ?? null,
      managerId: cur?.managerId ?? null,
      employmentStatus: cur?.employmentStatus ?? "—",
      workShift: cur?.workShift ?? "—",
      baseSalary: cur?.baseSalary ?? 0,
      orgUnit: cur?.orgUnit ?? null,
      position: cur?.position ?? null,
      grade: cur?.grade ?? null,
      manager,
      directReports: directReportsRaw.map((r) => ({
        id: r.id, fullName: r.fullName, employeeNo: r.employeeNo,
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
        baseSalary: a.baseSalary,
        orgUnit: a.orgUnit ? { name: a.orgUnit.name, code: a.orgUnit.code } : null,
        position: a.position ? { title: a.position.title, code: a.position.code } : null,
        grade: a.grade ? { code: a.grade.code, name: a.grade.name } : null,
        managerName: a.manager?.fullName ?? null,
      })),
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
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const b = await req.json();

    const data: Record<string, unknown> = {};
    for (const f of PERSONAL_FIELDS) if (b[f] !== undefined) data[f] = b[f];
    if (b.birthDate !== undefined) data.birthDate = b.birthDate ? new Date(b.birthDate) : null;
    if (b.joinDate !== undefined) data.joinDate = b.joinDate ? new Date(b.joinDate) : undefined;
    if (b.endDate !== undefined) data.endDate = b.endDate ? new Date(b.endDate) : null;

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
