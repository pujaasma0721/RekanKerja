import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { submitWorkoff, decideWorkoff } from "@/onevity/time-attendance/services/attendance-service";

// GET /api/onevity/attendance/workoffs?status= — izin tidak masuk + statistik
// (padanan EmployeeWorkOff.jsp + approval).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const status = req.nextUrl.searchParams.get("status");
    const [permits, dayTypes] = await Promise.all([
      db.workOffPermission.findMany({
        where: status && status !== "all" ? { status } : {},
        include: {
          employee: { select: { employeeNo: true, fullName: true, assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } } },
          dayType: { select: { code: true, name: true } },
        },
        orderBy: [{ dateFrom: "desc" }, { docNo: "desc" }],
      }),
      db.workDayType.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    ]);

    const flat = permits.map((p) => ({
      ...p,
      orgUnitName: p.employee.assignments[0]?.orgUnit?.name ?? null,
    }));
    const days = (from: Date, to: Date) => Math.round((dayStartOf(to) - dayStartOf(from)) / 86_400_000) + 1;
    const stats = {
      total: flat.length,
      pending: flat.filter((p) => p.status === "Pending").length,
      approved: flat.filter((p) => p.status === "Approved").length,
      paid: flat.filter((p) => p.status === "Approved" && p.paid).length,
      unpaid: flat.filter((p) => p.status === "Approved" && !p.paid).length,
      deductLeave: flat.filter((p) => p.status === "Approved" && p.deductLeave).length,
      totalDays: flat.filter((p) => p.status === "Approved").reduce((s, p) => s + days(p.dateFrom, p.dateTo), 0),
    };
    return NextResponse.json({ permits: flat, dayTypes, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

function dayStartOf(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

// POST — ajukan izin (padanan Employee Work Off Permission). Guard VIEWER + aktor sesi.
// Task 32-d: guard hak AKSI menu — create pada attendance:workoff (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:workoff", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    const res = await submitWorkoff(m.db, {
      employeeId: String(b.employeeId ?? ""),
      dateFrom: String(b.dateFrom ?? ""),
      dateTo: b.dateTo ? String(b.dateTo) : undefined,
      allDay: b.allDay === undefined ? true : Boolean(b.allDay),
      timeFrom: b.timeFrom ?? null,
      timeTo: b.timeTo ?? null,
      paid: b.paid === undefined ? true : Boolean(b.paid),
      deductLeave: b.deductLeave === undefined ? true : Boolean(b.deductLeave),
      reason: b.reason ?? null,
      documentNote: b.documentNote ?? null,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — approve | reject | cancel. Guard VIEWER + aktor sesi (approver = nama aktor sesi).
// Task 32-d: guard hak AKSI menu — op:approve pada attendance:workoff (per pengguna).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:workoff", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.id || !b.action) return NextResponse.json({ error: "id & action wajib" }, { status: 400 });
    const res = await decideWorkoff(m.db, b.id, b.action, { approver: b.approver ?? m.actor.name, note: b.note });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
