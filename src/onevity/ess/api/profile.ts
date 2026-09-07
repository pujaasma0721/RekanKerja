import { NextRequest, NextResponse } from "next/server";
import { requireEssActor } from "@/onevity/ess/lib/ess-guard";
import { CHANGE_REASON_LABEL } from "@/onevity/human-resource/services/assignment";

// GET /api/ess/profile — profil lengkap sendiri (data pribadi + pekerjaan
// saat ini + keluarga + pendidikan + riwayat penempatan). Selalu self —
// id diambil dari sesi, bukan dari query (anti IDOR).
export async function GET(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId } = m;

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      include: {
        company: { select: { name: true, code: true } },
        family: { orderBy: { birthDate: "asc" } },
        education: { orderBy: { endYear: "desc" } },
        assignments: {
          where: { validTo: null },
          orderBy: { validFrom: "desc" },
          take: 1,
          include: {
            position: { select: { title: true, code: true, level: true } },
            orgUnit: { select: { name: true, code: true } },
            grade: { select: { code: true, name: true } },
            manager: { select: { id: true, fullName: true, employeeNo: true, photoUrl: true } },
          },
        },
      },
    });
    if (!employee) return NextResponse.json({ error: "Data karyawan tidak ditemukan" }, { status: 404 });

    const cur = employee.assignments[0] ?? null;
    let manager: { id: string; fullName: string; employeeNo: string; photoUrl: string | null; position: string | null } | null = null;
    if (cur?.managerId) {
      const mgr = await db.employee.findUnique({
        where: { id: cur.managerId },
        include: { assignments: { where: { validTo: null }, take: 1, select: { position: { select: { title: true } } } } },
      });
      if (mgr) {
        manager = {
          id: mgr.id, fullName: mgr.fullName, employeeNo: mgr.employeeNo, photoUrl: mgr.photoUrl,
          position: mgr.assignments[0]?.position?.title ?? null,
        };
      }
    }

    const history = await db.employeeAssignment.findMany({
      where: { employeeId },
      orderBy: { validFrom: "desc" },
      include: {
        position: { select: { title: true } },
        orgUnit: { select: { name: true } },
        grade: { select: { code: true, name: true } },
        manager: { select: { fullName: true } },
      },
    });

    const { assignments: _cur, ...personal } = employee;
    const flat = {
      ...personal,
      employmentStatus: cur?.employmentStatus ?? null,
      workShift: cur?.workShift ?? null,
      baseSalary: cur?.baseSalary ?? 0,
      orgUnit: cur?.orgUnit ?? null,
      position: cur?.position ?? null,
      grade: cur?.grade ?? null,
      manager,
      assignments: history.map((a) => ({
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
        orgUnit: a.orgUnit?.name ?? null,
        position: a.position?.title ?? null,
        grade: a.grade ? `${a.grade.code} — ${a.grade.name}` : null,
        managerName: a.manager?.fullName ?? null,
      })),
    };

    return NextResponse.json({ employee: flat });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
