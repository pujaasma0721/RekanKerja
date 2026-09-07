import { NextRequest, NextResponse } from "next/server";
import { requireEssActor, countPendingApprovals } from "@/onevity/ess/lib/ess-guard";

// GET /api/ess/session — identitas karyawan self + kemampuan app admin +
// jumlah persetujuan menunggu (badge). Dipakai shell ESS & keputusan landing.
export async function GET(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId, canAdminApp, actor } = m;

    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true, employeeNo: true, fullName: true, photoUrl: true, status: true,
        joinDate: true, email: true, phone: true,
        assignments: {
          where: { validTo: null },
          orderBy: { validFrom: "desc" },
          take: 1,
          select: {
            employmentStatus: true,
            position: { select: { title: true } },
            orgUnit: { select: { name: true } },
            manager: { select: { fullName: true } },
          },
        },
      },
    });
    if (!emp) return NextResponse.json({ error: "Data karyawan tidak ditemukan" }, { status: 404 });

    const cur = emp.assignments[0] ?? null;
    const pendingApprovals = await countPendingApprovals(db, employeeId);

    return NextResponse.json({
      employee: {
        id: emp.id,
        employeeNo: emp.employeeNo,
        fullName: emp.fullName,
        photoUrl: emp.photoUrl,
        status: emp.status,
        joinDate: emp.joinDate,
        email: emp.email,
        phone: emp.phone,
        position: cur?.position?.title ?? null,
        orgUnit: cur?.orgUnit?.name ?? null,
        managerName: cur?.manager?.fullName ?? null,
        employmentStatus: cur?.employmentStatus ?? null,
      },
      user: { name: actor.name, email: actor.email, role: actor.role },
      canAdminApp,
      pendingApprovals,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
