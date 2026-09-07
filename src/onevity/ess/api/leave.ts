import { NextRequest, NextResponse } from "next/server";
import { requireEssActor } from "@/onevity/ess/lib/ess-guard";
import { listBalances, listRequests } from "@/onevity/leave/services/leave-service";

// GET /api/ess/leave?year=YYYY — saldo cuti + riwayat pengajuan + daftar
// jenis cuti aktif (untuk form) — semuanya milik karyawan yang login.
export async function GET(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId } = m;

    const sp = req.nextUrl.searchParams;
    const year = sp.get("year") ? Number(sp.get("year")) : new Date().getFullYear();
    const prevYear = year - 1;

    const [balances, requests, types] = await Promise.all([
      listBalances(db, { employeeId, year }),
      listRequests(db, { employeeId, status: "all", year }),
      db.leaveType.findMany({
        where: { active: true },
        select: {
          id: true, code: true, name: true, unit: true, paid: true, cashable: true,
          entitlement: true, maxPerRequest: true, waitingMonths: true, allowAdvance: true,
          allowHalfDay: true, needDocs: true,
        },
        orderBy: { code: "asc" },
      }),
    ]);

    // saldo tahun lalu (untuk chip carry-over pada jenis tahunan)
    const prevBalances = await listBalances(db, { employeeId, year: prevYear });

    return NextResponse.json({
      year,
      balances,
      prevBalances,
      requests,
      types,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
