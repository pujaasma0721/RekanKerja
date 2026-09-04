import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { submitOvertimeOrder, decideOvertimeOrder } from "@/onevity/time-attendance/services/attendance-service";
import { overtimePayFor } from "@/onevity/time-attendance/services/attendance-service";

// GET /api/onevity/attendance/overtime?status= — daftar perintah lembur + statistik
// (padanan EmpOvertimeWrit.jsp + approval).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const status = req.nextUrl.searchParams.get("status");
    const orders = await db.overtimeOrder.findMany({
      where: status && status !== "all" ? { status } : {},
      include: {
        employee: {
          select: {
            employeeNo: true, fullName: true,
            assignments: { where: { validTo: null }, select: { baseSalary: true, orgUnit: { select: { name: true } } }, take: 1 },
          },
        },
      },
      orderBy: [{ overtimeDate: "desc" }, { orderNo: "desc" }],
    });

    const all = orders.map((o) => {
      const baseSalary = o.employee.assignments[0]?.baseSalary ?? 0;
      // fix M-7: order yang sudah disetujui tanpa bukti clock → jam efektif = verified/actual
      // (bukan plan) — konsisten dengan rekap uang; Pending menampilkan rencana (plan).
      const minutes = o.status === "Pending"
        ? o.planMinutes
        : o.verifiedMinutes > 0 ? o.verifiedMinutes : o.actualMinutes;
      const estPay = ["Approved", "Paid"].includes(o.status) ? overtimePayFor(baseSalary, minutes, o.dayCategory) : 0;
      return {
        ...o,
        baseSalary,
        orgUnitName: o.employee.assignments[0]?.orgUnit?.name ?? null,
        estPay,
        effectiveMinutes: minutes,
      };
    });

    const stats = {
      total: all.length,
      pending: all.filter((o) => o.status === "Pending").length,
      approved: all.filter((o) => o.status === "Approved").length,
      paid: all.filter((o) => o.status === "Paid").length,
      rejected: all.filter((o) => o.status === "Rejected").length,
      paidMinutes: all.filter((o) => o.status === "Paid").reduce((s, o) => s + o.verifiedMinutes, 0),
      approvedPay: all.filter((o) => o.status === "Approved").reduce((s, o) => s + o.estPay, 0),
    };
    return NextResponse.json({ orders: all, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan perintah lembur (Plan). Guard VIEWER + aktor sesi.
// Task 32-d: guard hak AKSI menu — create pada attendance:overtime (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:overtime", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    const res = await submitOvertimeOrder(m.db, {
      employeeId: String(b.employeeId ?? ""),
      overtimeDate: String(b.overtimeDate ?? ""),
      timeFrom: String(b.timeFrom ?? ""),
      timeTo: String(b.timeTo ?? ""),
      planMinutes: b.planMinutes ? Number(b.planMinutes) : undefined,
      letterNo: b.letterNo ?? null,
      reason: b.reason ?? null,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — approve | reject | verify | cancel. Guard VIEWER + aktor sesi;
// approve tanggal masa depan ditolak 400 (fix M-7).
// Task 32-d: guard hak AKSI menu — op:approve pada attendance:overtime (per pengguna).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:overtime", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.id || !b.action) return NextResponse.json({ error: "id & action wajib" }, { status: 400 });
    const res = await decideOvertimeOrder(m.db, b.id, b.action, {
      approver: b.approver ?? m.actor.name,
      note: b.note,
      verifiedMinutes: b.verifiedMinutes ? Number(b.verifiedMinutes) : undefined,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
