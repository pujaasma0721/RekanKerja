// ESS — Open Shift Marketplace (Task 100 F1 G19) ===========================
// =====================================================================
// Self-scope karyawan sesi (requireEss):
//   GET  /api/rekankerja/ess/open-shift — posting Open ≤ 30 hari ke depan
//        + status klaim SENDIRI per posting.
//   POST /api/rekankerja/ess/open-shift { postId } — ajukan klaim; double-claim
//        ditangani unique constraint (P2002 → 409 "sudah mengajukan");
//        notifikasi admin + webhook "openshift.claimed".
import { NextResponse } from "next/server";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { dispatchWebhookEvent } from "@/rekankerja/shared/services/webhook-service";
import { dayStart, addDays } from "@/rekankerja/time-attendance/services/attendance-service";

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Baris posting hasil findMany (typed client C — dipakai beberapa op). */
type OpenShiftPostList = Awaited<ReturnType<TenantDb["openShiftPost"]["findMany"]>>;

/** Deteksi tabel model belum termigrasi (tenant belum menjalankan migrate-attendance-advance). */
function modelMissing(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /does not exist|not known/i.test(msg);
}

function notMigrated(): NextResponse {
  return NextResponse.json(
    { error: "Tabel OpenShift belum tersedia di schema tenant — hubungi admin (jalankan migrasi Task 100-impl-C)" },
    { status: 503 },
  );
}

// ================= GET — daftar posting utk karyawan =================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const today = dayStart(new Date());
    const until = addDays(today, 31);

    let posts: OpenShiftPostList;
    try {
      posts = await db.openShiftPost.findMany({
        where: { status: "Open", workDate: { gte: today, lt: until } },
        orderBy: { workDate: "asc" },
      });
    } catch (e) {
      if (modelMissing(e)) return notMigrated();
      throw e;
    }
    const postIds = posts.map((p) => p.id);
    const myClaims = postIds.length > 0
      ? await db.openShiftClaim.findMany({ where: { postId: { in: postIds }, employeeId } })
      : [];
    const myByPost = new Map(myClaims.map((c) => [c.postId, c]));

    // join manual nama jadwal + day type
    const [schedules, dayTypes] = await Promise.all([
      db.workSchedule.findMany({
        where: { id: { in: [...new Set(posts.map((p) => p.scheduleId))] } },
        select: { id: true, name: true },
      }),
      db.workDayType.findMany({
        where: { id: { in: [...new Set(posts.map((p) => p.dayTypeId))] } },
        select: { id: true, code: true, name: true, category: true, timeIn: true, timeOut: true, color: true },
      }),
    ]);
    const schedById = new Map(schedules.map((s) => [s.id, s.name]));
    const dtById = new Map(dayTypes.map((d) => [d.id, d]));

    return NextResponse.json({
      posts: posts.map((p) => {
        const dt = dtById.get(p.dayTypeId);
        const mine = myByPost.get(p.id);
        return {
          id: p.id,
          workDate: isoLocal(p.workDate),
          scheduleName: schedById.get(p.scheduleId) ?? "-",
          dayTypeName: dt?.name ?? "-",
          dayTypeCode: dt?.code ?? "-",
          dayTypeColor: dt?.color ?? null,
          timeIn: dt?.timeIn ?? null,
          timeOut: dt?.timeOut ?? null,
          orgUnitName: p.orgUnitName,
          slots: p.slots,
          filled: p.filled,
          slotsLeft: Math.max(0, p.slots - p.filled),
          notes: p.notes,
          myClaim: mine ? { id: mine.id, status: mine.status, createdAt: mine.createdAt.toISOString() } : null,
        };
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST — ajukan klaim =================
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName, appUserId } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const postId = String(b.postId ?? "").trim();
    if (!postId) return NextResponse.json({ error: "postId posting wajib dipilih" }, { status: 400 });

    // karyawan pengklaim harus aktif
    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, employeeNo: true, fullName: true, status: true },
    });
    if (!emp || emp.status !== "Active") {
      return NextResponse.json({ error: "Data karyawan Anda tidak aktif — hubungi HR" }, { status: 400 });
    }

    let post;
    try {
      post = await db.openShiftPost.findUnique({ where: { id: postId } });
    } catch (e) {
      if (modelMissing(e)) return notMigrated();
      throw e;
    }
    if (!post) return NextResponse.json({ error: "Posting open shift tidak ditemukan" }, { status: 404 });
    if (post.status !== "Open") {
      return NextResponse.json({ error: `Posting sudah ${post.status === "Closed" ? "ditutup" : "dibatalkan"}` }, { status: 400 });
    }
    const today = dayStart(new Date());
    const workDate = dayStart(post.workDate);
    if (workDate < today) {
      return NextResponse.json({ error: "Posting sudah lewat tanggalnya" }, { status: 400 });
    }
    if (post.filled >= post.slots) {
      return NextResponse.json({ error: "Semua slot posting sudah terisi" }, { status: 400 });
    }

    // klaim — unique constraint [postId, employeeId] menangani double-claim /
    // race dua klik paralel (P2002 → 409)
    let claim;
    try {
      claim = await db.openShiftClaim.create({
        data: { postId, employeeId, status: "Pending" },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") {
        return NextResponse.json(
          { error: "Anda sudah mengajukan klaim untuk posting open shift ini" },
          { status: 409 },
        );
      }
      if (modelMissing(e)) return notMigrated();
      throw e;
    }

    const dateStr = isoLocal(workDate);
    const dt = await db.workDayType.findUnique({
      where: { id: post.dayTypeId },
      select: { name: true },
    });

    await db.activityLog.create({
      data: {
        appUserId,
        employeeId,
        action: "Created", entity: "OpenShiftClaim", entityId: claim.id,
        detail: `Klaim open shift ${dateStr} (${dt?.name ?? "-"}) diajukan dari ESS oleh ${fullName}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan pengajuan */ });

    // kabari Admin/HR (resolusi notifyEvent to:"admins" — never-throw)
    void notifyEvent(db, {
      to: "admins", docType: "OpenShift", docNo: `OS-${post.id.slice(-6).toUpperCase()}`, docId: post.id,
      title: `Klaim open shift ${dateStr}`,
      body: `${fullName} mengajukan klaim open shift (${dt?.name ?? "-"}) pada ${dateStr}. Buka Kehadiran → Penugasan Jadwal → Open Shift.`,
      kind: "attendance",
      link: "attendance:assignment-schedule",
    });

    // webhook — fire-and-forget
    void dispatchWebhookEvent(db, null, "openshift.claimed", {
      claimId: claim.id, postId, employeeId, employeeNo: emp.employeeNo,
      workDate: dateStr, source: "ess",
    }).catch(() => { /* never */ });

    return NextResponse.json({ ok: true, claimId: claim.id, status: claim.status }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
