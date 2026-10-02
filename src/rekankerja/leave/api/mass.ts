import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { listMassLeaves, createMassLeave } from "@/rekankerja/leave/services/leave-service";

// GET /api/rekankerja/leave/mass — daftar cuti massal (SKB cuti bersama)
// Task 99: guard menu-view — view Cuti Massal.
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["leave:leave-mass"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const rows = await listMassLeaves(db);
    return NextResponse.json({ massLeaves: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat cuti massal → generate baris permintaan per karyawan (status MassLeave)
export async function POST(req: NextRequest) {
  try {
    // Task 79 — guard hak AKSI menu leave:leave-mass (Baru) — dulu hanya role-check.
    const m = await requireMenuAction(req, "leave:leave-mass", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!b.leaveTypeId || !b.dateFrom || !b.dateTo) {
      return NextResponse.json({ error: "leaveTypeId, dateFrom & dateTo wajib" }, { status: 400 });
    }
    const res = await createMassLeave(db, {
      leaveTypeId: String(b.leaveTypeId),
      letterNo: b.letterNo ? String(b.letterNo) : undefined,
      dateFrom: String(b.dateFrom),
      dateTo: String(b.dateTo),
      amount: b.amount ? Number(b.amount) : undefined,
      orgUnitName: b.orgUnitName ? String(b.orgUnitName) : undefined,
      excludeNonWorking: b.excludeNonWorking !== false,
      excludeConflicted: b.excludeConflicted !== false,
      note: b.note ? String(b.note) : undefined,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
