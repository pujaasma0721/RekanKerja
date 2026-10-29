import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { GENESIS_HASH } from "@/onevity/shared/lib/esign-crypto";
import { clearSignaturePin } from "@/onevity/shared/services/esign-service";

// ============ PENGATURAN → eSIGN (Task 80d) =================================
// GET  /api/onevity/esign-admin                 — ringkasan + daftar kunci pengguna
// GET  ?view=chain&limit=&offset=&docType=&q=   — audit rantai tanda tangan
//        (hash-chain per tenant: prevHash→ownHash; verifikasi keutuhan berurutan)
// POST { action: "reset-pin", appUserId }       — paksa hapus PIN user (op:reset-pin)
//        user kembali memakai faktor OTP email; kunci TIDAK dirotasi (ttd lama sah)
// POST { action: "revoke-key", appUserId }      — cabut kunci (op:revoke) — ttd lama
//        tetap terverifikasi (kunci publik tersimpan di record snapshot audit),
//        user tidak bisa menandatangani baru sampai kunci dibuat ulang otomatis.
// Guard: menu settings:esign (view) + aksi khusus op:reset-pin / op:revoke.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:esign", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db } = m;
    const sp = req.nextUrl.searchParams;

    if (sp.get("view") === "chain") {
      const limit = Math.min(200, Math.max(1, Number(sp.get("limit") ?? 50)));
      const offset = Math.max(0, Number(sp.get("offset") ?? 0));
      const docType = sp.get("docType")?.trim() ?? "";
      const q = sp.get("q")?.trim() ?? "";

      const where = {
        ...(docType ? { docType } : {}),
        ...(q ? { OR: [{ docRef: { contains: q } }, { signerName: { contains: q } }] } : {}),
      };
      const [total, records] = await Promise.all([
        db.signatureRecord.count({ where }),
        db.signatureRecord.findMany({
          where,
          orderBy: { signedAt: "desc" },
          take: limit,
          skip: offset,
          select: {
            id: true, docType: true, docId: true, docRef: true, docHash: true,
            signerName: true, signerRole: true, signedAt: true, signerIp: true,
            prevHash: true, ownHash: true,
          },
        }),
      ]);

      // verifikasi keutuhan rantai: prevHash tiap record = ownHash predesesor
      // (urut kronologis). GENESIS untuk record pertama.
      const asc = await db.signatureRecord.findMany({ orderBy: { signedAt: "asc" }, select: { id: true, prevHash: true, ownHash: true } });
      let prev = GENESIS_HASH;
      const broken = new Set<string>();
      for (const r of asc) {
        if (r.prevHash !== prev) broken.add(r.id);
        prev = r.ownHash;
      }
      const chainIntact = broken.size === 0;

      return NextResponse.json({
        total, limit, offset, chainIntact, brokenCount: broken.size,
        records: records.map((r) => ({ ...r, chainBroken: broken.has(r.id) })),
      });
    }

    // default: ringkasan + daftar kunci per pengguna aplikasi
    // (SignatureKey tanpa relasi FK ke AppUser — join manual per appUserId)
    const [keys, signedCount, users] = await Promise.all([
      db.signatureKey.findMany({ orderBy: { createdAt: "desc" } }),
      db.signatureRecord.count(),
      db.appUser.findMany({
        where: { id: { in: (await db.signatureKey.findMany({ select: { appUserId: true } })).map((k) => k.appUserId) } },
        select: { id: true, username: true, fullName: true, role: true, active: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const withPin = keys.filter((k) => k.pinHash).length;
    const revoked = keys.filter((k) => k.status !== "Active").length;

    return NextResponse.json({
      summary: { totalKeys: keys.length, withPin, revoked, signedCount },
      keys: keys.map((k) => {
        const u = userById.get(k.appUserId);
        return {
          appUserId: k.appUserId,
          username: u?.username ?? "—",
          fullName: u?.fullName ?? "(pengguna dihapus)",
          role: u?.role ?? null,
          active: u?.active ?? false,
          status: k.status,
          hasPin: !!k.pinHash,
          pinSetAt: k.pinSetAt?.toISOString() ?? null,
          algorithm: k.algorithm,
          publicKeyFp: k.publicKey.replace(/\r?\n/g, "").slice(-24), // fingerprint pendek
          createdAt: k.createdAt.toISOString(),
          rotatedAt: k.rotatedAt?.toISOString() ?? null,
        };
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as { action?: string; appUserId?: string };
    const appUserId = String(b.appUserId ?? "");
    if (!appUserId) return NextResponse.json({ error: "appUserId wajib" }, { status: 400 });

    if (b.action === "reset-pin") {
      const m = await requireMenuAction(req, "settings:esign", "op:reset-pin");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const key = await m.db.signatureKey.findUnique({ where: { appUserId }, select: { pinHash: true } });
      if (!key) return NextResponse.json({ error: "Kunci tanda tangan pengguna tidak ditemukan" }, { status: 404 });
      await clearSignaturePin(m.db, appUserId);
      await m.db.activityLog.create({
        data: { action: "Updated", entity: "SignatureKey", entityId: appUserId, appUserId: m.actor.appUserId, detail: "PIN tanda tangan direset oleh admin — faktor kembali ke OTP email" },
      }).catch(() => { /* trail tidak menggagalkan */ });
      return NextResponse.json({ ok: true, message: "PIN tanda tangan dihapus — pengguna memakai OTP email untuk sementara" });
    }

    if (b.action === "revoke-key") {
      const m = await requireMenuAction(req, "settings:esign", "op:revoke");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const key = await m.db.signatureKey.findUnique({ where: { appUserId }, select: { status: true } });
      if (!key) return NextResponse.json({ error: "Kunci tanda tangan pengguna tidak ditemukan" }, { status: 404 });
      if (key.status !== "Active") return NextResponse.json({ error: "Kunci sudah dicabut sebelumnya" }, { status: 409 });
      await m.db.signatureKey.update({ where: { appUserId }, data: { status: "Revoked", rotatedAt: new Date() } });
      await m.db.activityLog.create({
        data: { action: "Updated", entity: "SignatureKey", entityId: appUserId, appUserId: m.actor.appUserId, detail: "Kunci tanda tangan DICABUT oleh admin — ttd baru tertahan sampai kunci dibuat ulang" },
      }).catch(() => { /* trail tidak menggagalkan */ });
      return NextResponse.json({ ok: true, message: "Kunci dicabut — kunci baru dibuat otomatis saat pengguna menandatangani lagi" });
    }

    return NextResponse.json({ error: "action tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
