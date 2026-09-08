// GET /api/onevity/ess/payslips — daftar slip gaji saya (run Confirmed/Paid,
// terbaru dulu) — kontrak T8-ESS-FRONTEND.
import { NextResponse } from "next/server";
import { requireEss } from "@/onevity/ess/api/ess-auth";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

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
    const tc = tenantCryptoForDb(db);
    return NextResponse.json({
      slips: lines.map((l) => ({
        lineId: l.id,
        periodName: l.run.period.name,
        status: l.run.status,
        gross: tc.decryptMoney(l.bruto),
        net: tc.decryptMoney(l.net),
        paidAt: l.run.paidAt,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
