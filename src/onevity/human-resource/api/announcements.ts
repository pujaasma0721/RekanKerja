import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG, type TenantDb } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { pushNotification } from "@/onevity/shared/services/notification-service";
import { sendWaBatch } from "@/onevity/shared/services/wa-service";

// OneVity — Pengumuman Perusahaan (Task 27-f) ==============================
// =====================================================================
// Broadcast pengumuman ke seluruh karyawan ESS + pelacakan dibaca:
//   · GET    /api/onevity/announcements?status=&category=&q= — daftar +
//     statistik dibaca (reads/total Active) + kartu ringkasan. Guard
//     requireTenant (pola assets.ts). Status DERIVED: draft (publishedAt
//     null) | published | expired (published & expiresAt < now → arsip).
//   · POST   /api/onevity/announcements — buat (draft atau terbitkan
//     langsung; menerbitkan butuh op hr:announcements:publish). Kode
//     otomatis PGM-%04d. Menerbitkan → fanout notifikasi in-app ke semua
//     AppUser aktif tertaut karyawan Active (pushNotification langsung —
//     notifyEvent berbasis dokumen approval, tidak cocok broadcast).
//   · PATCH  /api/onevity/announcements — edit field (guard update) atau
//     aksi: publish (guard op:publish), unpublish (kembali draft), pin,
//     unpin.
//   · DELETE /api/onevity/announcements?id= — HANYA draft (guard delete).
// Setiap mutasi menulis ActivityLog (entity Announcement, detail kode+judul).

const CATEGORIES = ["Umum", "Kebijakan", "Event", "Darurat"] as const;

/** Status derived sebuah pengumuman. */
export function announcementStatus(
  a: { publishedAt: Date | null; expiresAt: Date | null },
  now = new Date(),
): "draft" | "published" | "expired" {
  if (!a.publishedAt) return "draft";
  if (a.expiresAt && a.expiresAt.getTime() < now.getTime()) return "expired";
  return "published";
}

/** Ringkas isi pengumuman utk body notifikasi (maks 120 karakter). */
function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}

/**
 * Fanout notifikasi in-app "Pengumuman: <judul>" ke setiap AppUser aktif
 * yang tertaut karyawan Active. NEVER-THROW (fire-and-forget) — mengembalikan
 * jumlah penerima yang berhasil dikirimi (utk ActivityLog & response).
 * Task 28-a: + fanout WhatsApp batch ke karyawan Active yang punya nomor HP
 * (CAP 20 penerima, config+template dicek sekali di sendWaBatch — anti spam
 * log saat kanal mati).
 */
async function fanoutAnnouncement(
  db: TenantDb,
  ann: { code: string; title: string; body: string },
): Promise<number> {
  try {
    const activeEmps = await db.employee.findMany({
      where: { status: "Active" },
      select: { id: true, phone: true },
    });
    if (activeEmps.length === 0) return 0;

    // Task 28-a — WhatsApp: hanya karyawan DENGAN nomor HP, cap 20 (batch)
    const withPhone = activeEmps.filter((e) => e.phone && e.phone.trim()).slice(0, 20);
    if (withPhone.length > 0) {
      void sendWaBatch(db, {
        event: "announcement.published",
        recipients: withPhone.map((e) => ({
          phone: e.phone!,
          placeholders: { judul: ann.title, ringkas: excerpt(ann.body) },
        })),
      });
    }

    const users = await db.appUser.findMany({
      where: { active: true, employeeId: { in: activeEmps.map((e) => e.id) } },
      select: { id: true },
    });
    let sent = 0;
    for (const u of users) {
      const id = await pushNotification(db, {
        appUserId: u.id,
        title: `Pengumuman: ${ann.title}`,
        body: excerpt(ann.body),
        kind: "announcement",
        link: null,
      });
      if (id) sent++;
    }
    return sent;
  } catch {
    return 0; // notifikasi tidak boleh menggagalkan penerbitan
  }
}

// ================= GET — daftar + statistik dibaca =================
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const status = req.nextUrl.searchParams.get("status") ?? "all";
    const category = req.nextUrl.searchParams.get("category");
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

    // 2 query agregat: total karyawan Active (penanda progres) + jumlah
    // dibaca per pengumuman (groupBy) — tanpa N+1.
    const [totalActive, readsGroup] = await Promise.all([
      db.employee.count({ where: { status: "Active" } }),
      db.announcementRead.groupBy({
        by: ["announcementId"],
        _count: { _all: true },
      }),
    ]);
    const readsByAnn = new Map(readsGroup.map((g) => [g.announcementId, g._count._all]));

    const all = await db.announcement.findMany({
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    const now = new Date();

    // statistik GLOBAL (dasar kartu ringkasan — sebelum filter)
    const stats = {
      active: all.filter((a) => announcementStatus(a, now) === "published").length,
      draft: all.filter((a) => announcementStatus(a, now) === "draft").length,
      expired: all.filter((a) => announcementStatus(a, now) === "expired").length,
      totalReads: Array.from(readsByAnn.values()).reduce((s, n) => s + n, 0),
      totalActive,
    };

    // filter status / kategori / pencarian
    const rows = all
      .filter((a) => (status === "all" ? true : announcementStatus(a, now) === status))
      .filter((a) => (category && CATEGORIES.includes(category as (typeof CATEGORIES)[number]) ? a.category === category : true))
      .filter((a) =>
        q
          ? a.title.toLowerCase().includes(q.toLowerCase()) ||
            a.code.toLowerCase().includes(q.toLowerCase()) ||
            a.body.toLowerCase().includes(q.toLowerCase())
          : true,
      )
      .map((a) => ({
        id: a.id,
        code: a.code,
        title: a.title,
        body: a.body,
        category: a.category,
        pinned: a.pinned,
        publishedAt: a.publishedAt,
        expiresAt: a.expiresAt,
        createdById: a.createdById,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        status: announcementStatus(a, now),
        reads: readsByAnn.get(a.id) ?? 0,
      }));

    return NextResponse.json({ announcements: rows, stats, categories: CATEGORIES });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST — buat pengumuman (draft / terbit) =================
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:announcements", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json().catch(() => ({}));
    const title = String(b.title ?? "").trim();
    const body = String(b.body ?? "").trim();
    const category = String(b.category ?? "Umum");
    const pinned = b.pinned === true;
    const publish = b.publish === true;

    if (!title) return NextResponse.json({ error: "Judul pengumuman wajib diisi" }, { status: 400 });
    if (title.length > 160) return NextResponse.json({ error: "Judul maksimal 160 karakter" }, { status: 400 });
    if (!body) return NextResponse.json({ error: "Isi pengumuman wajib diisi" }, { status: 400 });
    if (body.length > 20000) return NextResponse.json({ error: "Isi pengumuman maksimal 20.000 karakter" }, { status: 400 });
    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      return NextResponse.json({ error: `Kategori tidak valid (${CATEGORIES.join(", ")})` }, { status: 400 });
    }

    // kedaluwarsa opsional (validasi tanggal)
    let expiresAt: Date | null = null;
    if (b.expiresAt) {
      expiresAt = new Date(String(b.expiresAt));
      if (Number.isNaN(expiresAt.getTime())) {
        return NextResponse.json({ error: "Tanggal kedaluwarsa tidak valid" }, { status: 400 });
      }
    }

    // terbitkan langsung → butuh operasi khusus publish
    if (publish) {
      const pm = await requireMenuAction(req, "hr:announcements", "op:publish");
      if (!pm.ok) return NextResponse.json({ error: pm.error }, { status: pm.status });
    }

    // kode berurutan tenant (tahan tabrakan dgn data luar migrasi)
    const count = await db.announcement.count();
    let code = `PGM-${String(count + 1).padStart(4, "0")}`;
    for (let i = 0; i < 100; i++) {
      const clash = await db.announcement.findUnique({ where: { code }, select: { id: true } });
      if (!clash) break;
      code = `PGM-${String(count + 2 + i).padStart(4, "0")}`;
    }

    const ann = await db.announcement.create({
      data: {
        code,
        title,
        body,
        category,
        pinned,
        publishedAt: publish ? new Date() : null,
        expiresAt,
        createdById: actor.appUserId,
      },
    });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Created", entity: "Announcement", entityId: ann.id,
        detail: `Pengumuman baru ${ann.code} — "${ann.title}" (${ann.category}${pinned ? ", disematkan" : ""}${publish ? ", terbit langsung" : ", draft"}) oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    let notified = 0;
    if (publish) {
      notified = await fanoutAnnouncement(db, ann);
      await db.activityLog.create({
        data: {
          appUserId: actor.appUserId,
          action: "Published", entity: "Announcement", entityId: ann.id,
          detail: `Pengumuman ${ann.code} — "${ann.title}" diterbitkan ke seluruh ESS (${notified} notifikasi terkirim) oleh ${actor.appUsername ?? actor.name}`,
        },
      }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });
    }

    return NextResponse.json({ announcement: ann, notified }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= PATCH — edit / publish / unpublish / pin =================
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const id = String(b.id ?? "");
    const action = String(b.action ?? "");
    if (!id) return NextResponse.json({ error: "id pengumuman wajib" }, { status: 400 });

    // aksi publish digerbang operasi khusus; edit/unpublish/pin digerbang update
    const m = await requireMenuAction(
      req,
      "hr:announcements",
      action === "publish" ? "op:publish" : "update",
    );
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const ann = await db.announcement.findUnique({ where: { id } });
    if (!ann) return NextResponse.json({ error: "Pengumuman tidak ditemukan" }, { status: 404 });

    // ---- aksi: terbitkan (draft → live + fanout notifikasi) ----
    if (action === "publish") {
      if (ann.publishedAt) {
        return NextResponse.json({ error: `Pengumuman ${ann.code} sudah diterbitkan` }, { status: 400 });
      }
      const updated = await db.announcement.update({
        where: { id },
        data: { publishedAt: new Date() },
      });
      const notified = await fanoutAnnouncement(db, updated);
      await db.activityLog.create({
        data: {
          appUserId: actor.appUserId,
          action: "Published", entity: "Announcement", entityId: id,
          detail: `Pengumuman ${ann.code} — "${ann.title}" diterbitkan ke seluruh ESS (${notified} notifikasi terkirim) oleh ${actor.appUsername ?? actor.name}`,
        },
      }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });
      return NextResponse.json({ announcement: updated, notified });
    }

    // ---- aksi: batalkan terbitan (kembali draft) ----
    if (action === "unpublish") {
      if (!ann.publishedAt) {
        return NextResponse.json({ error: `Pengumuman ${ann.code} masih draft` }, { status: 400 });
      }
      const updated = await db.announcement.update({
        where: { id },
        data: { publishedAt: null },
      });
      await db.activityLog.create({
        data: {
          appUserId: actor.appUserId,
          action: "Updated", entity: "Announcement", entityId: id,
          detail: `Penerbitan pengumuman ${ann.code} — "${ann.title}" dibatalkan (kembali draft) oleh ${actor.appUsername ?? actor.name}`,
        },
      }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });
      return NextResponse.json({ announcement: updated });
    }

    // ---- aksi: sematkan / lepas sematan ----
    if (action === "pin" || action === "unpin") {
      const pinned = action === "pin";
      const updated = await db.announcement.update({ where: { id }, data: { pinned } });
      await db.activityLog.create({
        data: {
          appUserId: actor.appUserId,
          action: "Updated", entity: "Announcement", entityId: id,
          detail: `Pengumuman ${ann.code} — "${ann.title}" ${pinned ? "disematkan di feed ESS" : "lepas dari sematan"} oleh ${actor.appUsername ?? actor.name}`,
        },
      }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });
      return NextResponse.json({ announcement: updated });
    }

    // ---- edit field biasa ----
    const data: Record<string, unknown> = {};
    if (b.title !== undefined) {
      const title = String(b.title ?? "").trim();
      if (!title) return NextResponse.json({ error: "Judul pengumuman wajib diisi" }, { status: 400 });
      if (title.length > 160) return NextResponse.json({ error: "Judul maksimal 160 karakter" }, { status: 400 });
      data.title = title;
    }
    if (b.body !== undefined) {
      const body = String(b.body ?? "").trim();
      if (!body) return NextResponse.json({ error: "Isi pengumuman wajib diisi" }, { status: 400 });
      if (body.length > 20000) return NextResponse.json({ error: "Isi pengumuman maksimal 20.000 karakter" }, { status: 400 });
      data.body = body;
    }
    if (b.category !== undefined) {
      const category = String(b.category);
      if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
        return NextResponse.json({ error: `Kategori tidak valid (${CATEGORIES.join(", ")})` }, { status: 400 });
      }
      data.category = category;
    }
    if (b.pinned !== undefined) data.pinned = b.pinned === true;
    if (b.expiresAt !== undefined) {
      if (!b.expiresAt) data.expiresAt = null;
      else {
        const d = new Date(String(b.expiresAt));
        if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Tanggal kedaluwarsa tidak valid" }, { status: 400 });
        data.expiresAt = d;
      }
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan data" }, { status: 400 });
    }

    const updated = await db.announcement.update({ where: { id }, data });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Updated", entity: "Announcement", entityId: id,
        detail: `Pengumuman ${ann.code} — "${ann.title}" diperbarui (${Object.keys(data).join(", ")}) oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    return NextResponse.json({ announcement: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= DELETE — hapus (hanya draft) =================
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:announcements", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    const ann = await db.announcement.findUnique({ where: { id } });
    if (!ann) return NextResponse.json({ error: "Pengumuman tidak ditemukan" }, { status: 404 });

    if (ann.publishedAt) {
      return NextResponse.json(
        { error: `Pengumuman ${ann.code} sudah diterbitkan — batalkan terbitannya dulu (kembali draft) sebelum menghapus` },
        { status: 400 },
      );
    }

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Deleted", entity: "Announcement", entityId: id,
        detail: `Pengumuman draft ${ann.code} — "${ann.title}" dihapus oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    await db.announcement.delete({ where: { id } }); // AnnouncementRead ikut ter-cascade
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
