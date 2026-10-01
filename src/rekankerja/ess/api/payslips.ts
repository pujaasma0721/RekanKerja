// GET /api/rekankerja/ess/payslips — daftar slip gaji saya (run Confirmed/Paid,
// terbaru dulu) — kontrak T8-ESS-FRONTEND.
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, platformUserId, platformRole } = m.actor;

  try {
    const lines = await db.payrollRunLine.findMany({
      where: { employeeId, run: { status: { in: ["Confirmed", "Paid"] } } },
      orderBy: { run: { period: { endDate: "desc" } } },
      select: {
        id: true, bruto: true, net: true,
        run: {
          select: { status: true, paidAt: true, period: { select: { name: true } } },
        },
      },
    });

    // 28-c: bruto/net terenkripsi di DB — dekripsi di batas serializer.
    // 45-b: gerbang vault uang (aktor ESS) — masked → null (frontend "—").
    const mv = await getMoneyView(db, { userId: platformUserId, membershipRole: platformRole });
    return NextResponse.json({
      slips: lines.map((l) => ({
        lineId: l.id,
        periodName: l.run.period.name,
        status: l.run.status,
        gross: mv.dec(l.bruto),
        net: mv.dec(l.net),
        paidAt: l.run.paidAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
