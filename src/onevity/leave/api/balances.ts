import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { listBalances, generateLeaveInfo, adjustBalance } from "@/onevity/leave/services/leave-service";

// GET /api/onevity/leave/balances?employeeId=&leaveTypeId=&year=&leaveTypeCode=
//           &limit=&offset= — saldo per karyawan (padanan Employee Leave
// Information: kolom a–g + saldo).
// M-16 (audit 42): list dibatasi server-side — dulu payload unbounded
// (terukur 319 KB, tumbuh linear karyawan × jenis cuti). Default limit 1000
// baris (terukur nyata: MII 42 karyawan × 12 jenis = 504 baris — default 500
// akan memotong data tenant eksis secara diam-diam) + offset opsional utk
// paging; bentuk respons balances[] + summary DIPERTAHANKAN (UI
// leave-balances.tsx memfilter di sisi klien). Metadata paging ditambahkan
// DI DALAM summary (total/limit/offset/capped — additive, tidak memecah
// konsumen lama) supaya pemanggil API baru bisa mem-page eksplisit bila
// total melampaui cap.
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

    // M-16 — cap + offset (diam-diam bagi UI lama; metadata di summary).
    // Default 1000 = maks — parameter limit hanya utk memPERKECIL halaman.
    const limitParam = Number(sp.get("limit") ?? 1000);
    const offsetParam = Number(sp.get("offset") ?? 0);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 1000) : 1000;
    const offset = Number.isFinite(offsetParam) ? Math.max(Math.trunc(offsetParam), 0) : 0;
    const total = rows.length;
    const paged = offset === 0 && total <= limit ? rows : rows.slice(offset, offset + limit);

    const summary = {
      rows: paged.length,
      employees: new Set(paged.map((r) => r.employeeId)).size,
      totalRemaining: Math.round(paged.reduce((s, r) => s + r.remaining, 0) * 100) / 100,
      totalTaken: Math.round(paged.reduce((s, r) => s + r.taken, 0) * 100) / 100,
      negative: paged.filter((r) => r.remaining < 0).length,
      total,
      limit,
      offset,
      capped: offset + paged.length < total,
    };
    return NextResponse.json({ balances: paged, summary });
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
