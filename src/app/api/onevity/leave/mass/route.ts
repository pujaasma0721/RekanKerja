import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { listMassLeaves, createMassLeave } from "@/lib/onevity/leave-service";

// GET /api/onevity/leave/mass — daftar cuti massal (SKB cuti bersama)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const rows = await listMassLeaves(db);
    return NextResponse.json({ massLeaves: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat cuti massal → generate baris permintaan per karyawan (status MassLeave)
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
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
