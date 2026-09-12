// GET /api/onevity/ess/claims — klaim medis + travel milik saya
// (kontrak T8-ESS-FRONTEND). advance travel = total uang muka request
// terkait (status tidak Void), klaim mandiri = 0.
import { NextResponse } from "next/server";
import { requireEss } from "@/onevity/ess/api/ess-auth";
import { getMoneyView } from "@/onevity/shared/lib/money-view";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, platformUserId, platformRole } = m.actor;

  try {
    const [medicals, travels] = await Promise.all([
      db.medicalClaim.findMany({
        where: { employeeId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          docNo: true, totalBill: true, totalApproved: true, state: true, createdAt: true,
          type: { select: { name: true } },
        },
      }),
      db.travelClaim.findMany({
        where: { employeeId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          docNo: true, purpose: true, status: true, totalSettlement: true,
          request: { select: { advances: { select: { amount: true, status: true } } } },
        },
      }),
    ]);

    // 44-d (M-8): nilai uang klaim/advance travel TERENKRIPSI — dekripsi di
    // batas serializer (advance WAJIB per-baris dulu: reduce atas string akan
    // concat, bukan jumlah). Walker decryptJson juga menutupi field medis.
    // 45-b: gerbang vault uang — aktor ESS (platformUserId+platformRole);
    // masked → uang → null/0 (advance/settlement stats → dec0 → 0).
    const mv = await getMoneyView(db, { userId: platformUserId, membershipRole: platformRole });
    return NextResponse.json(
      mv.json({
        medical: medicals.map((c) => ({
          docNo: c.docNo,
          typeName: c.type.name,
          bill: c.totalBill,
          approved: c.totalApproved,
          status: c.state,
          submittedAt: c.createdAt,
        })),
        travel: travels.map((c) => ({
          docNo: c.docNo,
          purpose: c.purpose,
          status: c.status,
          advance: (c.request?.advances ?? [])
            .filter((a) => a.status !== "Void")
            .reduce((s, a) => s + mv.dec0(a.amount), 0),
          settlement: mv.dec0(c.totalSettlement),
        })),
      }),
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
