// GET/POST /api/rekankerja/ess/push-subscriptions — manajemen opt-in web
// push JALUR ESS (P2.2-BM · D-BM17). Kontrak sama dengan jalur admin
// (chip status + subscribe/unsubscribe) namun aktor = ess actor
// (requireEss → appUserId tertaut karyawan ESS).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import {
  pushStatusForUser, subscribePush, unsubscribePush, unsubscribeAll, getPushConfig,
} from "@/rekankerja/shared/services/push-service";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, appUserId } = m.actor;

  try {
    const status = await pushStatusForUser(db, appUserId);
    const cfg = status.enabled ? await getPushConfig(db) : null;
    return NextResponse.json({ ...status, publicKey: cfg?.publicKey ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, appUserId } = m.actor;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string; endpoint?: string; p256dh?: string; auth?: string;
    };

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
