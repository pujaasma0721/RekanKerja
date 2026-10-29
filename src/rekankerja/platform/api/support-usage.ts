// RekanKerja — Online Support P5: rincian pemakaian layanan support. ========
// =====================================================================
// GET /api/rekankerja/platform/admin/support-usage?tenantId=…
//   Log giliran agent per tenant (200 terakhir, bulan berjalan) + ringkasan —
//   dasar audit kuota & penagihan. Guard: requirePlatformAdmin.
import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { requirePlatformAdmin } from "@/rekankerja/platform/api/platform-admin-auth";
import { monthStartUtc, supportUsageOfMonth } from "@/rekankerja/support/services/support-entitlement";

export async function GET(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;

    const tenantId = req.nextUrl.searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "tenantId wajib diisi" }, { status: 400 });
    const tenant = await platformDb.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
    if (!tenant) return NextResponse.json({ error: "Tenant tidak ditemukan" }, { status: 404 });

    const monthStart = monthStartUtc();
    const [logs, summary] = await Promise.all([
      platformDb.supportUsageLog.findMany({
        where: { tenantId, createdAt: { gte: monthStart } },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, ticketNo: true, llmSteps: true, tokensIn: true, tokensOut: true, provider: true, createdAt: true },
      }),
      supportUsageOfMonth(tenantId),
    ]);
    return NextResponse.json({ tenant: { id: tenantId, name: tenant.name, slug: tenant.slug }, month: monthStart.toISOString().slice(0, 7), summary, logs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
