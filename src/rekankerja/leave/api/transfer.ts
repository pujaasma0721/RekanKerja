import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { transferEncashment } from "@/rekankerja/leave/services/leave-service";

// POST /api/rekankerja/leave/transfer — encashment Approved → komponen UCT payroll
// (padanan EmpLeaveCashable.jsp: period + process type + wage code + transfer).
// Task 99: guard hak AKSI menu (dulu requireMutator role-based) — tombol
// transfer hidup di view Uang Pengganti Cuti → create pada leave:leave-encashment.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "leave:leave-encashment", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!b.periodId) return NextResponse.json({ error: "periodId wajib" }, { status: 400 });
    const res = await transferEncashment(db, {
      periodId: String(b.periodId),
      processTypeCode: b.processTypeCode ? String(b.processTypeCode) : undefined,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
