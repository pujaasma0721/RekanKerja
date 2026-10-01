import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import {
  getActiveConfig, getConfigPublic, sendTestEmail,
} from "@/rekankerja/shared/services/email-service";

// ============ KONFIGURASI EMAIL (Task 34) ============
// GET  — baca konfigurasi (password masked; self-heal seed baris default)
// PUT  — simpan konfigurasi SMTP (guard aksi update menu settings:email)
// POST — TES KIRIM: kirim email uji ke alamat tujuan (guard op:test)

// GET — konfigurasi aktif (masked)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    // self-heal: baris config default bila belum ada
    const row = await getActiveConfig(db);
    if (!row) {
      await db.emailConfig.create({ data: { active: true } });
    }

    const config = await getConfigPublic(db);
    // baca status tes terakhir dari baris mentah (getConfigPublic sengaja
    // tidak membawa state transien — baca langsung agar akurat)
    const fresh = await db.emailConfig.findFirst({ where: { active: true }, select: { lastTestOk: true, lastTestAt: true, lastTestMessage: true } });
    return NextResponse.json({
      config: {
        ...config,
        lastTestOk: fresh?.lastTestOk ?? null,
        lastTestAt: fresh?.lastTestAt ?? null,
        lastTestMessage: fresh?.lastTestMessage ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PUT — simpan konfigurasi
export async function PUT(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:email", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const host = String(b.smtpHost ?? "").trim().slice(0, 200);
    const port = Math.max(1, Math.min(65535, Math.floor(Number(b.smtpPort)) || 587));
    const secure = Boolean(b.smtpSecure);
    const user = String(b.smtpUser ?? "").trim().slice(0, 200);
    const password = String(b.smtpPassword ?? ""); // kosong = JANGAN ubah yang lama
    const fromEmail = String(b.fromEmail ?? "").trim().slice(0, 200);
    const fromName = String(b.fromName ?? "").trim().slice(0, 100) || "RekanKerja HRIS";
    const active = Boolean(b.active);

    if (active) {
      if (!host) return NextResponse.json({ error: "SMTP host wajib diisi saat notifikasi diaktifkan" }, { status: 400 });
      if (!fromEmail.includes("@")) return NextResponse.json({ error: "Email pengirim (from) wajib alamat email valid" }, { status: 400 });
    }
    if (fromEmail && !fromEmail.includes("@")) {
      return NextResponse.json({ error: "Email pengirim bukan alamat valid" }, { status: 400 });
    }

    const row = await getActiveConfig(db);
    const data = {
      active, smtpHost: host, smtpPort: port, smtpSecure: secure, smtpUser: user,
      smtpPassword: password.length > 0 ? password : (row?.smtpPassword ?? ""),
      fromEmail, fromName, updatedById: m.actor.appUserId ?? null,
    };
    const saved = row
      ? await db.emailConfig.update({ where: { id: row.id }, data })
      : await db.emailConfig.create({ data });

    await db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Updated", entity: "EmailConfig", entityId: saved.id,
        detail: `Konfigurasi email ${active ? "diaktifkan" : "dinonaktifkan"} oleh ${m.actor.name} (SMTP ${host || "—"})`,
      },
    });

    return NextResponse.json({ config: await getConfigPublic(db) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — tes kirim email uji
export async function POST(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:email", "op:test");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const to = String(b.to ?? "").trim().slice(0, 200);
    if (!to.includes("@")) return NextResponse.json({ error: "Alamat email tujuan uji tidak valid" }, { status: 400 });

    const res = await sendTestEmail(db, to);
    return NextResponse.json(res, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
