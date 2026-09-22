import { NextRequest, NextResponse } from "next/server";
import { UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import {
  clearSignaturePin, createChallenge, pinStatusOf, resolveEsignCtx,
  setSignaturePin, signDocument,
} from "@/onevity/shared/services/esign-service";

// ============ E-SIGN API (Task 80) ==========================================
//   GET  /api/onevity/esign                          — status PIN/kunci sesi
//   POST {action:"challenge", docType, docId}        — minta faktor (PIN/OTP)
//   POST {action:"sign", docType, docId, code}       — tanda tangani
//   POST {action:"set-pin", pin}                     — set/ubah PIN ttd
//   POST {action:"clear-pin", pin}                   — hapus PIN (verifikasi dulu)
// VIEWER otomatis ditolak (resolveEsignCtx). Semua aksi tercatat ActivityLog.
// ============================================================================

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveEsignCtx(req);
    if (!ctx) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    if (!ctx.actor.appUserId) return NextResponse.json({ hasPin: false, hasKey: false });
    const st = await pinStatusOf(ctx.db, ctx.actor.appUserId);
    return NextResponse.json({ ...st, factor: st.hasPin ? "pin" : "otp" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveEsignCtx(req);
    if (!ctx) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const { db, actor } = ctx;
    if (!actor.appUserId) return NextResponse.json({ error: "Hanya pengguna aplikasi (AppUser) yang dapat menandatangani" }, { status: 403 });

    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "");
    const appUserId = actor.appUserId;

    if (action === "challenge") {
      const docType = String(b.docType ?? "");
      const docId = String(b.docId ?? "");
      if (!docType || !docId) return NextResponse.json({ error: "docType & docId wajib" }, { status: 400 });
      const email = actor.email;
      if (!email) return NextResponse.json({ error: "Email sesi tidak tersedia — set PIN tanda tangan" }, { status: 400 });
      const r = await createChallenge(db, appUserId, email, actor.name, docType, docId);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "sign") {
      const docType = String(b.docType ?? "");
      const docId = String(b.docId ?? "");
      const code = String(b.code ?? "");
      if (!docType || !docId || !code) return NextResponse.json({ error: "docType, docId, code wajib" }, { status: 400 });
      const r = await signDocument(req, ctx, docType, docId, code);
      return NextResponse.json(r, { status: r.ok ? 201 : 400 });
    }

    if (action === "set-pin") {
      const pin = String(b.pin ?? "");
      const r = await setSignaturePin(db, appUserId, pin);
      if (r.ok) {
        await db.activityLog.create({ data: { action: "Updated", entity: "SignatureKey", entityId: appUserId, appUserId, detail: "PIN tanda tangan diset/diperbarui" } }).catch(() => {});
      }
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }

    if (action === "clear-pin") {
      const pin = String(b.pin ?? "");
      const st = await pinStatusOf(db, appUserId);
      if (st.hasPin) {
        // verifikasi PIN lama sebelum hapus (anti pengambilalihan sesi curi)
        const key = await db.signatureKey.findUnique({ where: { appUserId }, select: { pinHash: true } });
        const { verifyPassword } = await import("@/onevity/shared/lib/auth");
        if (!key?.pinHash || !verifyPassword(pin, key.pinHash)) {
          return NextResponse.json({ ok: false, message: "PIN lama salah" }, { status: 400 });
        }
      }
      await clearSignaturePin(db, appUserId);
      return NextResponse.json({ ok: true, message: "PIN tanda tangan dihapus — OTP email dipakai" });
    }

    return NextResponse.json({ error: "action tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
