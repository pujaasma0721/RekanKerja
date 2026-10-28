// RekanKerja — Online Support P2 (FEAT-SUPPORT-P2): konfigurasi agen support.
// =====================================================================
//   GET  → { config: { toolsEnabled } }  (baris ABSEN → default true)
//   PUT  → { toolsEnabled: boolean } — upsert singleton SupportAgentConfig.
//          Mengubah mode agen: L2 (alat baca read-only aktif — agen bisa
//          memeriksa kode/data tenant utk diagnosis) ⇄ L1 (murni percakapan).
// Guard: sesi tenant valid utk GET; PUT memakai op settings:ai-provider
//          update (admin) — kartu ini tampil di halaman Pengaturan → AI.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    let toolsEnabled = true;
    try {
      const row = await db.supportAgentConfig.findFirst();
      if (row) toolsEnabled = row.toolsEnabled !== false;
    } catch { /* tabel belum termigrasi → default ON */ }
    return NextResponse.json({ config: { toolsEnabled } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:ai-provider", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof b.toolsEnabled !== "boolean") {
      return NextResponse.json({ error: "Field 'toolsEnabled' (boolean) wajib diisi" }, { status: 400 });
    }

    const existing = await db.supportAgentConfig.findFirst().catch(() => null);
    if (existing) {
      await db.supportAgentConfig.update({ where: { id: existing.id }, data: { toolsEnabled: b.toolsEnabled } });
    } else {
      await db.supportAgentConfig.create({ data: { toolsEnabled: b.toolsEnabled } });
    }
    return NextResponse.json({ config: { toolsEnabled: b.toolsEnabled } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
