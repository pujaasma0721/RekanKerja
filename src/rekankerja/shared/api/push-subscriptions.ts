// GET/POST /api/rekankerja/push/subscriptions — manajemen opt-in web push
// (P2.2-BM · D-BM17). Kontrak chip/tombol UI admin shell:
//   GET  → {enabled, subscribed, publicKey} (publicKey utk subscribe browser);
//   POST {action:"subscribe", endpoint, p256dh, auth}       → 200/400;
//   POST {action:"unsubscribe", endpoint}                     → 200;
//   POST {action:"unsubscribe-all"}                          → 200.
// Guard requireAppUser (pola notifications.ts) — user platform tanpa AppUser
// tenant → push dianggap off tenang (enabled/subscribed=false, bukan error).
import { NextResponse } from "next/server";
import { requireAppUser } from "@/rekankerja/shared/api/notifications";
import {
  pushStatusForUser, subscribePush, unsubscribePush, unsubscribeAll,
} from "@/rekankerja/shared/services/push-service";
import { getPushConfig } from "@/rekankerja/shared/services/push-service";

export async function GET(req: Request) {
  const m = await requireAppUser(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, appUserId } = m;

  try {
    if (!appUserId) {
      // tanpa AppUser tenant → fitur off tenang (pola feed kosong bell)
      const cfg = await getPushConfig(db).catch(() => null);
      return NextResponse.json({ enabled: false, subscribed: false, publicKey: cfg?.publicKey ?? null });
    }
    const status = await pushStatusForUser(db, appUserId);
    const cfg = status.enabled ? await getPushConfig(db) : null;
    return NextResponse.json({ ...status, publicKey: cfg?.publicKey ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireAppUser(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, appUserId } = m;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string; endpoint?: string; p256dh?: string; auth?: string;
    };
    if (!appUserId) {
      return NextResponse.json({ error: "Akun tidak terhubung data karyawan" }, { status: 403 });
    }

    if (body.action === "subscribe") {
      const r = await subscribePush(db, {
        appUserId,
        endpoint: String(body.endpoint ?? ""),
        p256dh: String(body.p256dh ?? ""),
        auth: String(body.auth ?? ""),
      });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, id: r.id });
    }
    if (body.action === "unsubscribe") {
      const removed = await unsubscribePush(db, { appUserId, endpoint: String(body.endpoint ?? "") });
      return NextResponse.json({ ok: true, removed });
    }
    if (body.action === "unsubscribe-all") {
      const removed = await unsubscribeAll(db, appUserId);
      return NextResponse.json({ ok: true, removed });
    }
    return NextResponse.json({ error: "Aksi tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
