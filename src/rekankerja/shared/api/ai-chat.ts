import { NextRequest, NextResponse } from "next/server";
import {
  resolveAiActor, chatHistory, clearHistory, askAi, listChatContacts, listDm, sendDm,
  type AiChatMode,
} from "@/rekankerja/shared/services/ai-chat-service";

// ============ AI CHAT + KONTAK + DM (Task 96) =======================
// Semua endpoint butuh sesi valid (admin ATAU ESS — keduanya punya AppUser):
//   GET    /api/rekankerja/ai/chat?mode=assistant|hr_expert  → riwayat
//   POST   /api/rekankerja/ai/chat { mode, message }         → tanya AI
//   DELETE /api/rekankerja/ai/chat?mode=…                    → hapus riwayat
//   GET    /api/rekankerja/ai/contacts                        → bawahan/atasan + unread
//   GET    /api/rekankerja/ai/dm?with=<appUserId>            → pesan dua arah
//   POST   /api/rekankerja/ai/dm { to, body }                 → kirim pesan
// =====================================================================

const UNAUTHORIZED = "Sesi tidak valid — silakan masuk kembali.";

function parseMode(v: string | null): AiChatMode {
  return v === "hr_expert" ? "hr_expert" : "assistant";
}

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveAiActor(req);
    if (!actor?.appUserId) return NextResponse.json({ error: UNAUTHORIZED }, { status: 401 });
    const mode = parseMode(req.nextUrl.searchParams.get("mode"));
    const messages = await chatHistory(actor.db, actor, mode);
    return NextResponse.json({ mode, messages });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await resolveAiActor(req);
    if (!actor?.appUserId) return NextResponse.json({ error: UNAUTHORIZED }, { status: 401 });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const message = String(b.message ?? "");
    if (!message.trim()) return NextResponse.json({ error: "Pesan kosong" }, { status: 400 });
    const mode = parseMode(b.mode == null ? null : String(b.mode));
    const res = await askAi(actor.db, actor, mode, message);
    return NextResponse.json(res);
  } catch (e) {
    // provider error (key salah, timeout, kuota) → 502 ramah
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await resolveAiActor(req);
    if (!actor?.appUserId) return NextResponse.json({ error: UNAUTHORIZED }, { status: 401 });
    const modeParam = req.nextUrl.searchParams.get("mode");
    await clearHistory(actor.db, actor, modeParam === "all" ? "all" : parseMode(modeParam));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ---------- kontak (bawahan/atasan terhubung) ----------

export async function GET_CONTACTS(req: NextRequest) {
  try {
    const actor = await resolveAiActor(req);
    if (!actor?.appUserId) return NextResponse.json({ error: UNAUTHORIZED }, { status: 401 });
    const contacts = await listChatContacts(actor.db, actor);
    return NextResponse.json({ contacts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ---------- DM ----------

export async function GET_DM(req: NextRequest) {
  try {
    const actor = await resolveAiActor(req);
    if (!actor?.appUserId) return NextResponse.json({ error: UNAUTHORIZED }, { status: 401 });
    const withUser = req.nextUrl.searchParams.get("with");
    if (!withUser) return NextResponse.json({ error: "Parameter ?with= wajib" }, { status: 400 });
    const messages = await listDm(actor.db, actor, withUser);
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST_DM(req: NextRequest) {
  try {
    const actor = await resolveAiActor(req);
    if (!actor?.appUserId) return NextResponse.json({ error: UNAUTHORIZED }, { status: 401 });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const to = String(b.to ?? "");
    const body = String(b.body ?? "");
    if (!to) return NextResponse.json({ error: "Penerima wajib" }, { status: 400 });
    const msg = await sendDm(actor.db, actor, to, body);
    return NextResponse.json({ message: msg }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
