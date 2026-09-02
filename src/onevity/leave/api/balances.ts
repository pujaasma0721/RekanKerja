import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { listBalances, generateLeaveInfo, adjustBalance } from "@/onevity/leave/services/leave-service";

// GET /api/onevity/leave/balances?employeeId=&leaveTypeId=&year=&leaveTypeCode=
// — saldo per karyawan (padanan Employee Leave Information: kolom a–g + saldo).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const rows = await listBalances(db, {
      employeeId: sp.get("employeeId") ?? undefined,
      leaveTypeId: sp.get("leaveTypeId") ?? undefined,
      year: sp.get("year") ? Number(sp.get("year")) : undefined,
      leaveTypeCode: sp.get("leaveTypeCode") ?? undefined,
    });
    const summary = {
      rows: rows.length,
      employees: new Set(rows.map((r) => r.employeeId)).size,
      totalRemaining: Math.round(rows.reduce((s, r) => s + r.remaining, 0) * 100) / 100,
      totalTaken: Math.round(rows.reduce((s, r) => s + r.taken, 0) * 100) / 100,
      negative: rows.filter((r) => r.remaining < 0).length,
    };
    return NextResponse.json({ balances: rows, summary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — Generate Leave Information (padanan GenerateLeaveInfoProcess.jsp)
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    const year = parseInt(b.year, 10);
    if (!year || year < 2000 || year > 2100) return NextResponse.json({ error: "Tahun tidak valid" }, { status: 400 });
    const res = await generateLeaveInfo(db, {
      year,
      leaveTypeId: b.leaveTypeId || undefined,
      employeeIds: Array.isArray(b.employeeIds) && b.employeeIds.length > 0 ? b.employeeIds : undefined,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — penyesuaian saldo (padanan Leave Adjustment / Generate Leave Adjustment)
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    const delta = Number(b.delta);
    if (!b.employeeId || !b.leaveTypeId || !b.year || !delta) {
      return NextResponse.json({ error: "employeeId, leaveTypeId, year & delta wajib" }, { status: 400 });
    }
    const res = await adjustBalance(db, {
      employeeId: String(b.employeeId),
      leaveTypeId: String(b.leaveTypeId),
      year: parseInt(b.year, 10),
      delta,
      reason: String(b.reason ?? ""),
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
