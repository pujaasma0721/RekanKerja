import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { getWaConfig, sendWaTest, waReady, WA_PROVIDERS, type WaProvider } from "@/rekankerja/shared/services/wa-service";

// ============ KONFIGURASI WHATSAPP (Task 28-a) ============
// GET  — baca konfigurasi (token MASKED: hasToken + last4; self-heal seed)
// PUT  — simpan provider/endpoint/token/keterangan/aktif (guard update settings:whatsapp;
//        token kosong = pertahankan yang lama)
// POST — TES KIRIM: { toPhone } → pesan uji langsung ke provider (guard op:test)

// GET — konfigurasi (token masked)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    // self-heal: baris config default bila belum ada
    const row = await getWaConfig(db);

    // token TIDAK pernah dikirim ke klien — hanya indikator + 4 digit akhir
    const token = row.token ?? "";
    return NextResponse.json({
      config: {
        active: row.active,
        provider: row.provider,
        endpoint: row.endpoint,
        sender: row.sender,
        hasToken: token.length > 0,
        last4: token.length > 0 ? token.slice(-4) : "",
        ready: waReady(row),
        lastTestOk: row.lastTestOk,
        lastTestAt: row.lastTestAt,
        lastTestMessage: row.lastTestMessage,
        updatedAt: row.updatedAt,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PUT — simpan konfigurasi
export async function PUT(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:whatsapp", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = String(b.provider ?? "Fonnte");
    const endpoint = String(b.endpoint ?? "").trim().slice(0, 300);
    const token = String(b.token ?? ""); // kosong = JANGAN ubah yang lama
    const sender = String(b.sender ?? "").trim().slice(0, 60);
    const active = Boolean(b.active);

    if (!WA_PROVIDERS.includes(provider as WaProvider)) {
      return NextResponse.json({ error: `Provider harus salah satu dari ${WA_PROVIDERS.join("/")}` }, { status: 400 });
    }
    if (endpoint && !/^https?:\/\//i.test(endpoint)) {
      return NextResponse.json({ error: "Endpoint harus URL http(s) valid" }, { status: 400 });
    }
    if (provider === "Custom" && active && !endpoint) {
      return NextResponse.json({ error: "Provider Custom wajib mengisi endpoint saat kanal diaktifkan" }, { status: 400 });
    }

    const row = await getWaConfig(db);
    const saved = await db.waConfig.update({
      where: { id: row.id },
      data: {
        active,
        provider,
        endpoint,
        token: token.length > 0 ? token.slice(0, 300) : row.token,
        sender,
        updatedById: m.actor.appUserId ?? null,
      },
    });

    await db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Updated", entity: "WaConfig", entityId: saved.id,
        detail: `Konfigurasi WhatsApp ${active ? "diaktifkan" : "dinonaktifkan"} oleh ${m.actor.name} (provider ${provider}, endpoint ${endpoint || "default provider"})`,
      },
    }).catch(() => { /* audit best-effort */ });

    const tokenNow = saved.token ?? "";
    return NextResponse.json({
      config: {
        active: saved.active, provider: saved.provider, endpoint: saved.endpoint, sender: saved.sender,
        hasToken: tokenNow.length > 0, last4: tokenNow.length > 0 ? tokenNow.slice(-4) : "",
        ready: waReady(saved), lastTestOk: saved.lastTestOk, lastTestAt: saved.lastTestAt,
        lastTestMessage: saved.lastTestMessage, updatedAt: saved.updatedAt,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — tes kirim pesan uji { toPhone }
export async function POST(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:whatsapp", "op:test");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const toPhone = String(b.toPhone ?? "").trim().slice(0, 40);
    if (!toPhone) return NextResponse.json({ error: "Nomor HP tujuan uji wajib diisi" }, { status: 400 });

    const res = await sendWaTest(db, toPhone);
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
