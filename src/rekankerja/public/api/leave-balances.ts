// GET /api/public/leave-balances?employeeId=&year= — saldo cuti ringkas.
// Scope: leave. Kolom a–g diringkas ke entitlement/used/remaining.
import { NextRequest, NextResponse } from "next/server";
import { requirePublicApi, publicOk, publicError, auditPublicApi } from "@/rekankerja/public/api/guard";
import { listBalances } from "@/rekankerja/leave/services/leave-service";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await requirePublicApi(req, "leave");
  if (!g.ok) return g.response;
  const auth = g.auth; // { db, tenant, key }
  const db = auth.db;

  try {
    const sp = req.nextUrl.searchParams;
    const employeeId = sp.get("employeeId") ?? undefined;
    const year = sp.get("year") ? Number(sp.get("year")) : undefined;
    if (sp.get("employeeId") && !employeeId) {
      return publicError(400, "employeeId tidak valid");
    }

    const rows = await listBalances(db, { employeeId, year });
    const balances = rows.map((r) => ({
      employeeId: r.employeeId,
      employeeNo: r.employeeNo,
      fullName: r.fullName,
      leaveTypeId: r.leaveTypeId,
      leaveType: r.leaveTypeName,
      unit: r.unit,
      year: r.year,
      period: r.periodLabel,
      entitlement: r.entitlement,
      carriedOver: r.carriedOver,
      earned: r.earned,
      adjustment: r.adjustment,
      forfeited: r.forfeited,
      cashed: r.cashed,
      taken: r.taken,
      applied: r.applied,
      remaining: r.remaining,
    }));

    auditPublicApi(db, auth, {
      method: "GET", path: "/api/public/leave-balances", status: 200, scope: "leave",
      detail: `${balances.length} baris saldo${employeeId ? ` (karyawan ${employeeId})` : ""}`,
    });
    return publicOk({ balances, total: balances.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    auditPublicApi(db, auth, { method: "GET", path: "/api/public/leave-balances", status: 500, scope: "leave", detail: msg });
    return publicError(500, msg);
  }
}
