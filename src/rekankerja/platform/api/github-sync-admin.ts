// RekanKerja — Online Support P8: API sinkronisasi GitHub (konsol platform). =
// =====================================================================
// GET /api/rekankerja/platform/admin/github-sync
//   Status repo (cabang/remote/ahead-behind/file kotor/commit terakhir)
//   + setelan auto-push + riwayat sinkronisasi terakhir (10).
// POST /api/rekankerja/platform/admin/github-sync
//   { action: "push", message?, remotes?: string[] }
//     Commit semua perubahan tertunda + push ke remote terpilih
//     (default: SEMUA remote). Nama remote divalidasi server-side.
//   { action: "pull", remote?: string, autostash?: boolean }
//     git pull --ff-only dari remote (default origin). Menolak bila ada
//     perubahan lokal yang belum di-commit (kecuali autostash aktif).
//   { action: "set-autopush", enabled: boolean }
//     Setelah patch DISETUJUI: commit + push otomatis dengan pesan
//     yang merujuk nomor tiket.
// Guard: requirePlatformAdmin — realm sesi platform saja; API tenant mana
// pun TIDAK PERNAH bisa men-trigger operasi git.
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/rekankerja/platform/api/platform-admin-auth";
import { db as platformDb } from "@/lib/db";
import {
  getRepoStatus,
  pushChanges,
  pullChanges,
  getAutoPushEnabled,
  setAutoPushEnabled,
  SyncBusyError,
} from "@/rekankerja/platform/services/github-sync";

export async function GET(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;

    const [status, autoPush, history] = await Promise.all([
      getRepoStatus(),
      getAutoPushEnabled(),
      platformDb.githubSyncLog
        .findMany({ orderBy: { createdAt: "desc" }, take: 10 })
        .catch(() => []),
    ]);

    return NextResponse.json({
      status,
      autoPush,
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        status: h.status,
        branch: h.branch,
        message: h.message,
        detail: h.detail,
        byName: h.byName,
        createdAt: h.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof b.action === "string" ? b.action : "";

    // ---- push: commit + kirim ke GitHub ----
    if (action === "push") {
      const message = typeof b.message === "string" ? b.message : "";
      const remotes = Array.isArray(b.remotes)
        ? b.remotes.filter((r): r is string => typeof r === "string").slice(0, 5)
        : [];
      const result = await pushChanges({ message, remotes, byName: g.actor.name });
      return NextResponse.json({ ok: true, result });
    }

    // ---- pull: tarik terbaru (ff-only) ----
    if (action === "pull") {
      const remote = typeof b.remote === "string" ? b.remote : "origin";
      const autostash = b.autostash === true;
      const result = await pullChanges({ remote, autostash, byName: g.actor.name });
      return NextResponse.json({ ok: true, result });
    }

    // ---- setelan auto-push pasca-patch ----
    if (action === "set-autopush") {
      const enabled = b.enabled === true;
      await setAutoPushEnabled(enabled);
      return NextResponse.json({ ok: true, autoPush: enabled });
    }

    return NextResponse.json({ error: "Aksi tidak dikenal" }, { status: 400 });
  } catch (e) {
    if (e instanceof SyncBusyError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
