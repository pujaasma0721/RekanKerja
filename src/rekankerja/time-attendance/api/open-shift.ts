import { NextRequest, NextResponse } from "next/server";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { notifyEvent, pushNotification } from "@/rekankerja/shared/services/notification-service";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";
import {
  dayStart, addDays, regenerateDaily,
} from "@/rekankerja/time-attendance/services/attendance-service";

// Task 100 F1 (G19) — Open Shift Marketplace (admin).
// =====================================================================
// GET   /api/rekankerja/attendance/open-shift — posting 30 hari ke depan +
//       klaim + status + nama day type/jadwal. Guard VIEW
//       attendance:assignment-schedule.
// POST  — buat posting { workDate, scheduleId, dayTypeId, orgUnitName?,
//       slots 1-20, notes } → guard create; broadcast in-app ke AppUser
//       karyawan + webhook "openshift.posted".
// PATCH — op:"close"|"cancel" (guard update) → tutup/batalkan posting
//       (cancel menolak otomatis klaim Pending);
//       op:"approve-claim" { claimId } → override ScheduleAssignment 1-hari
//       (POLA shift-swap approve: validFrom=validTo=workDate, anchorMonday =
//       Senin minggu workDate, anchorSequence = posisi dayTypeId di cycle
//       WorkScheduleDay) + filled++ (≥slots → Closed) + regenerateDaily +
//       notif karyawan + webhook "openshift.claimed";
//       op:"reject-claim" { claimId, reason } → tolak klaim (alasan ke
//       ActivityLog + notifikasi — model claim tanpa kolom reason).
//
// Model OpenShiftPost/OpenShiftClaim (schema Task 100-impl-C; client sudah
// di-regenerate saat finalisasi file ini). Note tenant yang belum menjalankan
// scripts/migrate-attendance-advance.ts → P2021 "table does not exist" → 503
// ramah (helper notMigrated).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Baris posting hasil findMany (typed client C — dipakai beberapa op). */
type OpenShiftPostList = Awaited<ReturnType<TenantDb["openShiftPost"]["findMany"]>>;

/** Deteksi tabel model belum termigrasi di schema tenant (P2021). */
function modelMissing(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /does not exist|not known/i.test(msg);
}

/** Pesan 503 ramah saat tabel open shift belum termigrasi. */
function notMigrated(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Tabel OpenShift belum tersedia di schema tenant — jalankan scripts/migrate-attendance-advance.ts (Task 100-impl-C) sebelum memakai open shift marketplace",
    },
    { status: 503 },
  );
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ================= GET — daftar posting + klaim =================
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:assignment-schedule"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const today = dayStart(new Date());
    const until = addDays(today, 31); // posting ≤ 30 hari ke depan

    let posts: OpenShiftPostList;
    try {
      posts = await db.openShiftPost.findMany({
        where: { workDate: { gte: today, lt: until } },
        orderBy: [{ workDate: "asc" }, { createdAt: "desc" }],
      });
    } catch (e) {
      if (modelMissing(e)) return notMigrated();
      throw e;
    }
    const postIds = posts.map((p) => p.id);
    const claims = postIds.length > 0
      ? await db.openShiftClaim.findMany({
          where: { postId: { in: postIds } },
          orderBy: { createdAt: "asc" },
        })
      : [];

    // join manual (nama karyawan/jadwal/day type) — tidak bergantung relasi
    const empIds = [...new Set(claims.map((c) => c.employeeId))];
    const [employees, schedules, dayTypes] = await Promise.all([
      empIds.length
        ? db.employee.findMany({
            where: { id: { in: empIds } },
            select: { id: true, employeeNo: true, fullName: true, photoUrl: true, status: true },
          })
        : Promise.resolve([] as { id: string; employeeNo: string; fullName: string; photoUrl: string | null; status: string }[]),
      db.workSchedule.findMany({
        where: { id: { in: [...new Set(posts.map((p) => p.scheduleId))] } },
        select: { id: true, name: true, code: true },
      }),
      db.workDayType.findMany({
        where: { id: { in: [...new Set(posts.map((p) => p.dayTypeId))] } },
        select: { id: true, code: true, name: true, category: true, timeIn: true, timeOut: true, color: true },
      }),
    ]);
    const empById = new Map(employees.map((e) => [e.id, e]));
    const schedById = new Map(schedules.map((s) => [s.id, s]));
    const dtById = new Map(dayTypes.map((d) => [d.id, d]));

    return NextResponse.json({
      posts: posts.map((p) => {
        const dt = dtById.get(p.dayTypeId);
        return {
          id: p.id,
          workDate: isoLocal(p.workDate),
          scheduleId: p.scheduleId,
          scheduleName: schedById.get(p.scheduleId)?.name ?? "-",
          dayTypeId: p.dayTypeId,
          dayTypeName: dt?.name ?? "-",
          dayTypeCode: dt?.code ?? "-",
          dayTypeColor: dt?.color ?? null,
          timeIn: dt?.timeIn ?? null,
          timeOut: dt?.timeOut ?? null,
          orgUnitName: p.orgUnitName,
          slots: p.slots,
          filled: p.filled,
          notes: p.notes,
          status: p.status, // Open|Filled|Closed|Cancelled
          createdAt: p.createdAt.toISOString(),
          claims: claims
            .filter((c) => c.postId === p.id)
            .map((c) => {
              const emp = empById.get(c.employeeId);
              return {
                id: c.id,
                status: c.status, // Pending|Approved|Rejected
                decidedBy: c.decidedBy,
                decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
                createdAt: c.createdAt.toISOString(),
                employee: emp
                  ? { id: emp.id, employeeNo: emp.employeeNo, fullName: emp.fullName, photoUrl: emp.photoUrl, status: emp.status }
                  : null,
              };
            }),
        };
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST — buat posting =================
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:assignment-schedule", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json().catch(() => ({}));

    const workDateStr = String(b.workDate ?? "").trim();
    const scheduleId = String(b.scheduleId ?? "").trim();
    const dayTypeId = String(b.dayTypeId ?? "").trim();
    const orgUnitName = String(b.orgUnitName ?? "").trim() || null;
    const slots = Number(b.slots ?? 0);
    const notes = String(b.notes ?? "").trim() || null;

    if (!DATE_RE.test(workDateStr)) {
      return NextResponse.json({ error: "Tanggal kerja wajib format YYYY-MM-DD" }, { status: 400 });
    }
    const workDate = new Date(`${workDateStr}T00:00:00`);
    const today = dayStart(new Date());
    if (workDate < today) {
      return NextResponse.json({ error: "Tanggal open shift tidak boleh di masa lalu" }, { status: 400 });
    }
    if (workDate >= addDays(today, 31)) {
      return NextResponse.json({ error: "Open shift hanya bisa diposting maksimal 30 hari ke depan" }, { status: 400 });
    }
    if (!scheduleId || !dayTypeId) {
      return NextResponse.json({ error: "scheduleId & dayTypeId wajib dipilih" }, { status: 400 });
    }
    if (!Number.isInteger(slots) || slots < 1 || slots > 20) {
      return NextResponse.json({ error: "Jumlah slot harus bilangan bulat 1–20" }, { status: 400 });
    }
    if (notes && notes.length > 500) {
      return NextResponse.json({ error: "Catatan maksimal 500 karakter" }, { status: 400 });
    }

    // jadwal + day type harus valid & day type bagian cycle jadwal (dipakai
    // anchorSequence saat approve-claim nanti — gagal cepat di sini)
    const sched = await db.workSchedule.findUnique({
      where: { id: scheduleId },
      include: { days: true },
    });
    if (!sched || !sched.active) {
      return NextResponse.json({ error: "Jadwal tidak ditemukan / tidak aktif" }, { status: 404 });
    }
    const dt = await db.workDayType.findUnique({ where: { id: dayTypeId } });
    if (!dt || !dt.active) {
      return NextResponse.json({ error: "Tipe hari tidak ditemukan / tidak aktif" }, { status: 404 });
    }
    if (!sched.days.some((d) => d.dayTypeId === dayTypeId)) {
      return NextResponse.json(
        { error: `Tipe hari "${dt.name}" bukan bagian cycle jadwal ${sched.name} — pilih tipe hari yang terdaftar di jadwal` },
        { status: 400 },
      );
    }

    let post;
    try {
      post = await db.openShiftPost.create({
        data: {
          workDate,
          scheduleId,
          dayTypeId,
          orgUnitName,
          slots,
          filled: 0,
          notes,
          status: "Open",
          createdBy: m.actor.name, // nama aktor (kolom bebas — bukan FK)
        },
      });
    } catch (e) {
      if (modelMissing(e)) return notMigrated();
      throw e;
    }

    // broadcast in-app ke AppUser karyawan (aktif + tertaut karyawan —
    // notifikasi langsung via pushNotification, never-throw; take 200 utk
    // menjaga payload)
    void (async () => {
      try {
        const users = await db.appUser.findMany({
          where: { active: true, employeeId: { not: null } },
          select: { id: true },
          take: 200,
        });
        for (const u of users) {
          void pushNotification(db, {
            appUserId: u.id,
            title: `Open shift ${workDateStr} — ${dt.name}`,
            body: `Tersedia ${slots} slot shift terbuka${orgUnitName ? ` (${orgUnitName})` : ""} pada ${workDateStr}. Ajukan klaim dari ESS → Open Shift.`,
            kind: "attendance",
          });
        }
      } catch { /* broadcast tidak boleh menggagalkan pembuatan posting */ }
    })();

    // webhook + audit
    void dispatchWebhookEvent(db, null, "openshift.posted", {
      postId: post.id, workDate: workDateStr, scheduleId, dayTypeId,
      dayTypeName: dt.name, slots, orgUnitName,
    }).catch(() => { /* never */ });
    await db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId,
        action: "Created", entity: "OpenShiftPost", entityId: post.id,
        detail: `Open shift ${workDateStr} (${dt.name}, jadwal ${sched.name}, ${slots} slot) diposting oleh ${m.actor.name}`,
      },
    }).catch(() => { /* audit best-effort */ });

    return NextResponse.json(
      { ok: true, post: { ...post, workDate: workDateStr } },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// ================= PATCH — close | cancel | approve-claim | reject-claim =================
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:assignment-schedule", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json().catch(() => ({}));
    const op = String(b.op ?? "");

    // ---------- op:"close" / op:"cancel" — tutup / batalkan posting ----------
    if (op === "close" || op === "cancel") {
      const id = String(b.id ?? "");
      if (!id) return NextResponse.json({ error: "id posting wajib" }, { status: 400 });
      let post;
      try {
        post = await db.openShiftPost.findUnique({ where: { id } });
      } catch (e) {
        if (modelMissing(e)) return notMigrated();
        throw e;
      }
      if (!post) return NextResponse.json({ error: "Posting open shift tidak ditemukan" }, { status: 404 });
      if (post.status !== "Open") {
        return NextResponse.json(
          { error: `Posting sudah berstatus ${post.status} — hanya posting Open yang bisa ditutup/dibatalkan` },
          { status: 400 },
        );
      }

      // cancel → klaim Pending ditolak otomatis (posting batal);
      // close → klaim yang sudah masuk tetap diproses admin
      let rejectedClaims = 0;
      if (op === "cancel") {
        const res = await db.openShiftClaim.updateMany({
          where: { postId: id, status: "Pending" },
          data: { status: "Rejected", decidedBy: m.actor.name, decidedAt: new Date() },
        });
        rejectedClaims = res.count;
      }
      const updated = await db.openShiftPost.update({
        where: { id },
        data: { status: op === "cancel" ? "Cancelled" : "Closed" },
      });

      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId,
          action: op === "cancel" ? "Cancelled" : "Updated",
          entity: "OpenShiftPost", entityId: id,
          detail: `Open shift ${isoLocal(post.workDate)} ${op === "cancel" ? "dibatalkan" : "ditutup"} oleh ${m.actor.name}` +
            (rejectedClaims > 0 ? ` — ${rejectedClaims} klaim Pending otomatis ditolak` : ""),
        },
      }).catch(() => { /* audit best-effort */ });

      return NextResponse.json({ ok: true, post: updated, rejectedClaims });
    }

    // ---------- op:"approve-claim" — setujui klaim → override 1-hari ----------
    if (op === "approve-claim") {
      const claimId = String(b.claimId ?? "");
      if (!claimId) return NextResponse.json({ error: "claimId wajib" }, { status: 400 });

      let claim;
      try {
        claim = await db.openShiftClaim.findUnique({ where: { id: claimId } });
      } catch (e) {
        if (modelMissing(e)) return notMigrated();
        throw e;
      }
      if (!claim) return NextResponse.json({ error: "Klaim open shift tidak ditemukan" }, { status: 404 });
      if (claim.status !== "Pending") {
        return NextResponse.json(
          { error: `Klaim sudah diputuskan sebelumnya (status: ${claim.status})` },
          { status: 400 },
        );
      }
      const post = await db.openShiftPost.findUnique({ where: { id: claim.postId } });
      if (!post) return NextResponse.json({ error: "Posting open shift tidak ditemukan" }, { status: 404 });
      if (post.status !== "Open") {
        return NextResponse.json(
          { error: `Posting sudah berstatus ${post.status} — klaim tidak bisa disetujui` },
          { status: 400 },
        );
      }
      if (post.filled >= post.slots) {
        return NextResponse.json({ error: "Semua slot posting sudah terisi" }, { status: 400 });
      }

      const workDate = dayStart(post.workDate);
      const dateStr = isoLocal(workDate);

      const emp = await db.employee.findUnique({
        where: { id: claim.employeeId },
        select: { id: true, employeeNo: true, fullName: true, status: true },
      });
      if (!emp || emp.status !== "Active") {
        return NextResponse.json(
          { error: "Karyawan pengklaim tidak ditemukan / sudah tidak aktif" },
          { status: 400 },
        );
      }

      // ---- konflik override 1-hari yang sudah ada (pola shift-swap approve) ----
      const clash = await db.scheduleAssignment.findFirst({
        where: { employeeId: emp.id, validFrom: workDate, validTo: workDate },
        select: { id: true, notes: true },
      });
      if (clash) {
        return NextResponse.json(
          {
            error: `${emp.fullName} sudah memiliki penugasan jadwal override 1-hari pada ${dateStr}${clash.notes ? ` (${clash.notes})` : ""} — selesaikan konfliknya dulu`,
          },
          { status: 400 },
        );
      }

      // ---- anchorSequence = posisi dayTypeId di cycle jadwal posting ----
      const schedDay = await db.workScheduleDay.findFirst({
        where: { scheduleId: post.scheduleId, dayTypeId: post.dayTypeId },
        orderBy: { sequence: "asc" },
      });
      if (!schedDay) {
        return NextResponse.json(
          { error: "Tipe hari posting tidak ditemukan pada cycle jadwal — posting tidak konsisten, batalkan dan buat ulang" },
          { status: 400 },
        );
      }

      // ---- clockingRequired mengikuti assignment aktif karyawan hari itu ----
      const active = await db.scheduleAssignment.findMany({
        where: {
          employeeId: emp.id,
          validFrom: { lte: workDate },
          OR: [{ validTo: null }, { validTo: { gte: workDate } }],
        },
        orderBy: { validFrom: "desc" },
        take: 1,
        select: { clockingRequired: true },
      });
      const clockingRequired = active[0]?.clockingRequired ?? true;

      // ---- override 1-hari (POLA shift-swap approve L239-296) ----
      // anchorMonday = Senin minggu workDate; rotasi sequence dihitung dari
      // posisi dayTypeId posting pada cycle jadwal posting.
      const monday = addDays(workDate, -((workDate.getDay() + 6) % 7));
      const override = await db.scheduleAssignment.create({
        data: {
          employeeId: emp.id,
          scheduleId: post.scheduleId,
          anchorMonday: monday,
          anchorSequence: schedDay.sequence,
          clockingRequired,
          validFrom: workDate,
          validTo: workDate,
          notes: `OpenShift ${post.id.slice(-6)} — klaim disetujui oleh ${m.actor.name}`,
        },
      });

      await db.openShiftClaim.update({
        where: { id: claimId },
        data: { status: "Approved", decidedBy: m.actor.name, decidedAt: new Date() },
      });

      // filled++ → ≥ slots auto-Closed
      const filled = post.filled + 1;
      const updatedPost = await db.openShiftPost.update({
        where: { id: post.id },
        data: { filled, status: filled >= post.slots ? "Closed" : post.status },
      });

      // ---- rekap absensi karyawan dihitung ulang (idempoten; error tak
      // membatalkan approve — pola shift-swap) ----
      let regenError: string | null = null;
      try {
        await regenerateDaily(db, workDate, emp.id);
      } catch (e) {
        regenError = e instanceof Error ? e.message : "unknown";
        console.warn("[open-shift] regenerateDaily gagal:", regenError);
      }

      // ---- notif karyawan + webhook + audit ----
      const dt = await db.workDayType.findUnique({
        where: { id: post.dayTypeId },
        select: { name: true, timeIn: true, timeOut: true },
      });
      void notifyEvent(db, {
        to: "employee", docType: "OpenShift", docNo: `OS-${post.id.slice(-6).toUpperCase()}`, docId: post.id,
        employeeId: emp.id,
        title: `Klaim open shift ${dateStr} disetujui`,
        body: `Anda terjadwal shift ${dt?.name ?? "-"}${dt?.timeIn ? ` (${dt.timeIn}${dt.timeOut ? `–${dt.timeOut}` : ""})` : ""} pada ${dateStr} — jadwal dari open shift marketplace.`,
        kind: "attendance",
      });
      void dispatchWebhookEvent(db, null, "openshift.claimed", {
        claimId, postId: post.id, employeeId: emp.id, employeeNo: emp.employeeNo,
        workDate: dateStr, scheduleId: post.scheduleId, decidedBy: m.actor.name,
      }).catch(() => { /* never */ });

      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId,
          action: "Approved", entity: "OpenShiftClaim", entityId: claimId,
          detail: `Klaim open shift ${dateStr} (${emp.employeeNo} ${emp.fullName}) disetujui oleh ${m.actor.name} — override 1-hari ${override.id.slice(-6)}, rekap harian dihitung ulang`,
        },
      }).catch(() => { /* audit best-effort */ });

      return NextResponse.json({ ok: true, post: updatedPost, claimId, overrideId: override.id, regenError });
    }

    // ---------- op:"reject-claim" — tolak klaim ----------
    if (op === "reject-claim") {
      const claimId = String(b.claimId ?? "");
      const reason = String(b.reason ?? "").trim();
      if (!claimId) return NextResponse.json({ error: "claimId wajib" }, { status: 400 });
      if (!reason) {
        return NextResponse.json({ error: "Alasan penolakan wajib diisi" }, { status: 400 });
      }
      if (reason.length > 300) {
        return NextResponse.json({ error: "Alasan maksimal 300 karakter" }, { status: 400 });
      }

      let claim;
      try {
        claim = await db.openShiftClaim.findUnique({ where: { id: claimId } });
      } catch (e) {
        if (modelMissing(e)) return notMigrated();
        throw e;
      }
      if (!claim) return NextResponse.json({ error: "Klaim open shift tidak ditemukan" }, { status: 404 });
      if (claim.status !== "Pending") {
        return NextResponse.json(
          { error: `Klaim sudah diputuskan sebelumnya (status: ${claim.status})` },
          { status: 400 },
        );
      }
      const post = await db.openShiftPost.findUnique({ where: { id: claim.postId } });

      // model claim tanpa kolom reason — alasan penolakan dicatat di
      // ActivityLog + notifikasi karyawan (audit tetap jejak penuh)
      await db.openShiftClaim.update({
        where: { id: claimId },
        data: { status: "Rejected", decidedBy: m.actor.name, decidedAt: new Date() },
      });

      void notifyEvent(db, {
        to: "employee", docType: "OpenShift", docNo: `OS-${(post?.id ?? claim.postId).slice(-6).toUpperCase()}`, docId: claim.postId,
        employeeId: claim.employeeId,
        title: `Klaim open shift ditolak`,
        body: `Klaim Anda${post ? ` untuk ${isoLocal(dayStart(post.workDate))}` : ""} ditolak admin — alasan: ${reason}`,
        kind: "attendance",
      });
      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId,
          action: "Rejected", entity: "OpenShiftClaim", entityId: claimId,
          detail: `Klaim open shift ditolak oleh ${m.actor.name} — alasan: ${reason}`,
        },
      }).catch(() => { /* audit best-effort */ });

      return NextResponse.json({ ok: true, claimId, status: "Rejected" });
    }

    return NextResponse.json(
      { error: "op tidak dikenal — pilihan: close|cancel|approve-claim|reject-claim" },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
