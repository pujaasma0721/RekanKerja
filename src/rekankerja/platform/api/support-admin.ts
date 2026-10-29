// RekanKerja — Online Support P5: admin layanan support (pemilik aplikasi). ==
// =====================================================================
// GET /api/rekankerja/platform/admin/support
//   Ringkasan konsol: semua tenant + status aktivasi layanan support +
//   pemakaian bulan berjalan + konfigurasi provider support + total biaya
//   estimasi. (Guard: requirePlatformAdmin — pemilik aplikasi saja.)
// PUT /api/rekankerja/platform/admin/support { tenantId, status,
//   monthlyTurnQuota?, notes? }
//   Aktifkan/ubah layanan support untuk satu tenant — SATU-SATUNYA jalur
//   perubahan entitlement di seluruh sistem (tidak ada API tenant utk ini).
import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { requirePlatformAdmin } from "@/rekankerja/platform/api/platform-admin-auth";
import {
  SUPPORT_ENTITLEMENT_STATUSES, supportEntitlementOf, supportUsageOfMonth,
  monthStartUtc, invalidateEntitlementCache,
} from "@/rekankerja/support/services/support-entitlement";
import { getSupportProviderPublic } from "@/rekankerja/support/services/support-provider";

export async function GET(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;

    const monthStart = monthStartUtc();
    const [tenants, entitlements, usageRows, provider] = await Promise.all([
      platformDb.tenant.findMany({
        select: { id: true, name: true, slug: true, plan: true, status: true, createdAt: true },
        orderBy: { name: "asc" },
      }),
      platformDb.supportEntitlement.findMany(),
      // ringkasan pemakaian bulan berjalan per tenant (atribusi biaya)
      platformDb.supportUsageLog.groupBy({
        by: ["tenantId"],
        where: { createdAt: { gte: monthStart } },
        _count: { _all: true },
        _sum: { llmSteps: true, tokensIn: true, tokensOut: true },
      }),
      getSupportProviderPublic(),
    ]);

    const entByTenant = new Map(entitlements.map((e) => [e.tenantId, e]));
    const usageByTenant = new Map(
      usageRows.map((u) => [u.tenantId, {
        turns: u._count._all,
        llmSteps: u._sum.llmSteps ?? 0,
        tokensIn: u._sum.tokensIn ?? 0,
        tokensOut: u._sum.tokensOut ?? 0,
      }]),
    );

    const out = tenants.map((t) => {
      const e = entByTenant.get(t.id);
      const u = usageByTenant.get(t.id);
      const quota = e?.monthlyTurnQuota ?? 0;
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        status: t.status,
        support: {
          status: e?.status ?? "INACTIVE",
          monthlyTurnQuota: quota,
          notes: e?.notes ?? null,
          activatedAt: e?.activatedAt?.toISOString() ?? null,
        },
        usage: {
          turns: u?.turns ?? 0,
          llmSteps: u?.llmSteps ?? 0,
          tokensIn: u?.tokensIn ?? 0,
          tokensOut: u?.tokensOut ?? 0,
          /** sisa kuota bulan ini; null = tanpa batas (kuota 0) */
          quotaLeft: quota > 0 ? Math.max(0, quota - (u?.turns ?? 0)) : null,
        },
      };
    });

    const totals = out.reduce(
      (acc, t) => ({
        tenants: acc.tenants + 1,
        activeSupport: acc.activeSupport + (["TRIAL", "ACTIVE"].includes(t.support.status) ? 1 : 0),
        turns: acc.turns + t.usage.turns,
        tokensIn: acc.tokensIn + t.usage.tokensIn,
        tokensOut: acc.tokensOut + t.usage.tokensOut,
      }),
      { tenants: 0, activeSupport: 0, turns: 0, tokensIn: 0, tokensOut: 0 },
    );
    const estCostUsd =
      (totals.tokensIn / 1_000_000) * provider.priceInPerM +
      (totals.tokensOut / 1_000_000) * provider.priceOutPerM;

    return NextResponse.json({
      month: monthStart.toISOString().slice(0, 7),
      tenants: out,
      provider,
      totals: { ...totals, estCostUsd },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = typeof b.tenantId === "string" ? b.tenantId.trim() : "";
    const status = typeof b.status === "string" ? b.status.trim().toUpperCase() : "";
    if (!tenantId) return NextResponse.json({ error: "tenantId wajib diisi" }, { status: 400 });
    if (!(SUPPORT_ENTITLEMENT_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json(
        { error: `status harus salah satu: ${SUPPORT_ENTITLEMENT_STATUSES.join(" | ")}` },
        { status: 400 },
      );
    }
    const monthlyTurnQuota = Math.max(0, Math.floor(Number(b.monthlyTurnQuota) || 0));
    const notesRaw = typeof b.notes === "string" ? b.notes.trim() : null;
    const notes = notesRaw && notesRaw.length > 0 ? notesRaw.slice(0, 500) : null;

    const tenant = await platformDb.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
    if (!tenant) return NextResponse.json({ error: "Tenant tidak ditemukan" }, { status: 404 });

    const now = new Date();
    const prev = await supportEntitlementOf(tenantId);
    const existing = await platformDb.supportEntitlement.findUnique({ where: { tenantId }, select: { activatedAt: true } });
    const row = await platformDb.supportEntitlement.upsert({
      where: { tenantId },
      create: {
        tenantId,
        status,
        monthlyTurnQuota,
        notes,
        activatedAt: ["TRIAL", "ACTIVE"].includes(status) ? now : null,
      },
      update: {
        status,
        monthlyTurnQuota,
        notes,
        // (re)aktivasi mempertahankan jejak aktivasi pertama; nonaktif tidak
        // menghapus jejak (audit kapan layanan pertama diaktifkan).
        ...( ["TRIAL", "ACTIVE"].includes(status) && !existing?.activatedAt ? { activatedAt: now } : {} ),
      },
    });
    invalidateEntitlementCache(tenantId);

    console.log(
      `[platform-admin] ${g.actor.email} mengubah layanan support tenant ${tenant.name}: ${prev.status} → ${status} (kuota ${monthlyTurnQuota}/bulan)`,
    );
    return NextResponse.json({
      entitlement: {
        tenantId: row.tenantId,
        status: row.status,
        monthlyTurnQuota: row.monthlyTurnQuota,
        notes: row.notes,
        activatedAt: row.activatedAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
