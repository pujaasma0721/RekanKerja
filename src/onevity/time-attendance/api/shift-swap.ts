import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG, type TenantDb } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { dayStart, addDays, regenerateDaily } from "@/onevity/time-attendance/services/attendance-service";
import { pushNotification } from "@/onevity/shared/services/notification-service";
import { sendWa, employeePhoneOf } from "@/onevity/shared/services/wa-service";

// Task 27-g — Tukar Shift: approval admin (diajukan ESS).
// GET   /api/onevity/attendance/shift-swap?status=&date=&q= — daftar permintaan
//       + statistik; nama jadwal snapshot di-resolve saat baca (fallback "-").
// PATCH /api/onevity/attendance/shift-swap { id, action: "approve"|"reject", note? }
//       — guard requireMenuAction "attendance:shift-swap" op:approve.
//
// MEKANISME SWAP (desain Task 27 — override 1-hari):
// assignmentFor (attendance-service) memilih ScheduleAssignment dengan
// validFrom TERBARU ≤ tanggal → saat approve, untuk MASING-MASING karyawan
// dibuat override ScheduleAssignment: validFrom = validTo = <swapDate 00:00>,
// scheduleId = jadwal PASANGAN, anchorMonday + anchorSequence disalin dari
// assignment pasangan (resolveDayType menghitung day type pasangan secara
// persis), clockingRequired dari pasangan, notes "TSK-xxxx tukar shift".
// Override menang HANYA untuk tanggal tsb; rotasi dasar tak tersentuh
// setelahnya. Lalu regenerateDaily kedua karyawan → rekap absensi swapDate
// langsung memakai day type yang tertukar.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Assignment jadwal SAH pada tanggal tsb (duplikat logika assignmentFor
 * attendance-service — helper itu tidak diekspor; baris penuh diperlukan
 * utk menyalin anchorMonday/anchorSequence ke override).
 * T5-TA-FIX konsisten: validFrom ≤ D, validTo null/≥ D, validFrom terbaru.
 */
async function activeAssignmentOn(db: TenantDb, employeeId: string, date: Date) {
  const list = await db.scheduleAssignment.findMany({
    where: {
      employeeId,
      validFrom: { lte: dayStart(date) },
      OR: [{ validTo: null }, { validTo: { gte: dayStart(date) } }],
    },
    orderBy: { validFrom: "desc" },
    take: 1,
  });
  return list[0] ?? null;
}

/** Kirim notifikasi ke semua AppUser aktif tertaut seorang karyawan (never-throw). */
async function notifyEmployee(
  db: TenantDb,
  employeeId: string,
  input: { title: string; body: string; kind?: string },
): Promise<string[]> {
  try {
    const users = await db.appUser.findMany({
      where: { employeeId, active: true },
      select: { id: true },
      take: 5,
    });
    const sent: string[] = [];
    for (const u of users) {
      const nid = await pushNotification(db, {
        appUserId: u.id,
        title: input.title,
        body: input.body,
        kind: input.kind ?? "attendance",
      });
      if (nid) sent.push(u.id);
    }
    return sent;
  } catch {
    return [];
  }
}

// ================= GET — daftar permintaan =================
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    const q = (sp.get("q") ?? "").trim();
    const date = sp.get("date");

    let where: Record<string, unknown> = {};
    if (status && status !== "all") where.status = status;
    if (date && DATE_RE.test(date)) {
      const d = new Date(`${date}T00:00:00`);
      where.swapDate = { gte: dayStart(d), lt: addDays(dayStart(d), 1) };
    }
    if (q) {
      where = {
        ...where,
        OR: [
          { code: { contains: q, mode: "insensitive" } },
          { reason: { contains: q, mode: "insensitive" } },
          { requester: { fullName: { contains: q, mode: "insensitive" } } },
          { target: { fullName: { contains: q, mode: "insensitive" } } },
          { requester: { employeeNo: { contains: q, mode: "insensitive" } } },
          { target: { employeeNo: { contains: q, mode: "insensitive" } } },
        ],
      };
    }

    const requests = await db.shiftSwapRequest.findMany({
      where,
      orderBy: [{ swapDate: "desc" }, { createdAt: "desc" }],
      take: 300,
      include: {
        requester: { select: { id: true, employeeNo: true, fullName: true, photoUrl: true } },
        target: { select: { id: true, employeeNo: true, fullName: true, photoUrl: true } },
      },
    });

    // stats seluruh populasi (filter chips akurat walau view terfilter)
    const all = await db.shiftSwapRequest.findMany({ select: { status: true } });
    const stats = {
      total: all.length,
      pending: all.filter((r) => r.status === "Pending").length,
      approved: all.filter((r) => r.status === "Approved").length,
      rejected: all.filter((r) => r.status === "Rejected").length,
      cancelled: all.filter((r) => r.status === "Cancelled").length,
    };

    // resolve nama jadwal snapshot + nama pemutus (baca-saat-tampil, fallback)
    const schedIds = new Set<string>();
    const deciderIds = new Set<string>();
    for (const r of requests) {
      if (r.requesterScheduleId) schedIds.add(r.requesterScheduleId);
      if (r.targetScheduleId) schedIds.add(r.targetScheduleId);
      if (r.decidedById) deciderIds.add(r.decidedById);
    }
    const [schedules, deciders] = await Promise.all([
      schedIds.size
        ? db.workSchedule.findMany({ where: { id: { in: Array.from(schedIds) } }, select: { id: true, name: true } })
        : Promise.resolve([] as { id: string; name: string }[]),
      deciderIds.size
        ? db.appUser.findMany({ where: { id: { in: Array.from(deciderIds) } }, select: { id: true, fullName: true, username: true } })
        : Promise.resolve([] as { id: string; fullName: string | null; username: string }[]),
    ]);
    const schedName = new Map<string, string>(schedules.map((s) => [s.id, s.name] as [string, string]));
    const deciderName = new Map<string, string>(deciders.map((d) => [d.id, d.fullName || d.username] as [string, string]));

    return NextResponse.json({
      requests: requests.map((r) => ({
        id: r.id,
        code: r.code,
        swapDate: isoDate(dayStart(r.swapDate)),
        reason: r.reason,
        status: r.status,
        decisionNote: r.decisionNote,
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        decidedByName: r.decidedById ? deciderName.get(r.decidedById) ?? "-" : null,
        createdAt: r.createdAt.toISOString(),
        requester: r.requester,
        target: r.target,
        requesterScheduleName: r.requesterScheduleId ? schedName.get(r.requesterScheduleId) ?? "-" : "-",
        targetScheduleName: r.targetScheduleId ? schedName.get(r.targetScheduleId) ?? "-" : "-",
        appliedAssignment1: r.appliedAssignment1,
        appliedAssignment2: r.appliedAssignment2,
        applied: !!(r.appliedAssignment1 && r.appliedAssignment2),
      })),
      stats,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= PATCH — approve | reject =================
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:shift-swap", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });

    const b = await req.json().catch(() => ({}));
    const id = String(b.id ?? "");
    const action = String(b.action ?? "");
    const note = b.note != null ? String(b.note).trim() : "";
    if (!id || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "id & action (approve|reject) wajib" }, { status: 400 });
    }
    if (note.length > 300) {
      return NextResponse.json({ error: "Catatan keputusan maksimal 300 karakter" }, { status: 400 });
    }

    const row = await m.db.shiftSwapRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, employeeNo: true, fullName: true, status: true } },
        target: { select: { id: true, employeeNo: true, fullName: true, status: true } },
      },
    }).catch(() => null);
    if (!row) return NextResponse.json({ error: "Permintaan tukar shift tidak ditemukan" }, { status: 404 });

    // idempoten — hanya Permintaan Pending yang bisa diputuskan
    if (row.status !== "Pending") {
      return NextResponse.json(
        { error: `Permintaan ${row.code} sudah diputuskan sebelumnya (status: ${row.status})` },
        { status: 400 },
      );
    }

    const dateStr = isoDate(dayStart(row.swapDate));
    const swapDate = dayStart(row.swapDate);
    const notified: string[] = [];

    if (action === "approve") {
      // ---- re-validasi: kedua karyawan masih Active + punya assignment sah ----
      for (const emp of [row.requester, row.target]) {
        if (emp.status !== "Active") {
          return NextResponse.json(
            { error: `${emp.fullName} (${emp.employeeNo}) sudah tidak aktif — tukar shift ${row.code} tidak bisa disetujui` },
            { status: 400 },
          );
        }
      }
      const a1 = await activeAssignmentOn(m.db, row.requesterId, swapDate);
      if (!a1) {
        return NextResponse.json(
          { error: `Jadwal ${row.requester.fullName} pada ${dateStr} sudah tidak berlaku — batalkan permintaan ${row.code} atau perbaiki penugasan jadwalnya` },
          { status: 400 },
        );
      }
      const a2 = await activeAssignmentOn(m.db, row.targetId, swapDate);
      if (!a2) {
        return NextResponse.json(
          { error: `Jadwal ${row.target.fullName} pada ${dateStr} sudah tidak berlaku — batalkan permintaan ${row.code} atau perbaiki penugasan jadwalnya` },
          { status: 400 },
        );
      }

      // ---- konflik override 1-hari yang sudah ada pada tanggal tsb ----
      // (tukar shift lain yang sudah disetujui / penugasan manual 1-hari)
      const clash = await m.db.scheduleAssignment.findFirst({
        where: { employeeId: { in: [row.requesterId, row.targetId] }, validFrom: swapDate, validTo: swapDate },
        select: { id: true, employeeId: true, notes: true },
      });
      if (clash) {
        const who = clash.employeeId === row.requesterId ? row.requester.fullName : row.target.fullName;
        return NextResponse.json(
          {
            error: `${who} sudah memiliki penugasan jadwal override 1-hari pada ${dateStr}${clash.notes ? ` (${clash.notes})` : ""} — selesaikan dulu konfliknya sebelum menyetujui ${row.code}`,
          },
          { status: 400 },
        );
      }

      // ---- buat DUA override: masing-masing mengikuti jadwal PASANGAN ----
      const o1 = await m.db.scheduleAssignment.create({
        data: {
          employeeId: row.requesterId,
          scheduleId: a2.scheduleId,
          anchorMonday: a2.anchorMonday,
          anchorSequence: a2.anchorSequence,
          clockingRequired: a2.clockingRequired,
          validFrom: swapDate,
          validTo: swapDate,
          notes: `${row.code} tukar shift dgn ${row.target.fullName}`,
        },
      });
      const o2 = await m.db.scheduleAssignment.create({
        data: {
          employeeId: row.targetId,
          scheduleId: a1.scheduleId,
          anchorMonday: a1.anchorMonday,
          anchorSequence: a1.anchorSequence,
          clockingRequired: a1.clockingRequired,
          validFrom: swapDate,
          validTo: swapDate,
          notes: `${row.code} tukar shift dgn ${row.requester.fullName}`,
        },
      });

      await m.db.shiftSwapRequest.update({
        where: { id },
        data: {
          status: "Approved",
          decidedById: m.actor.appUserId,
          decidedAt: new Date(),
          decisionNote: note || null,
          appliedAssignment1: o1.id,
          appliedAssignment2: o2.id,
        },
      });

      // ---- rekap absensi kedua karyawan dihitung ulang (idempoten) ----
      let regenError: string | null = null;
      try {
        await regenerateDaily(m.db, swapDate, row.requesterId);
        await regenerateDaily(m.db, swapDate, row.targetId);
      } catch (e) {
        regenError = e instanceof Error ? e.message : "unknown";
        console.warn("[shift-swap] regenerateDaily gagal:", regenError);
      }

      // ---- notifikasi kedua karyawan (never-throw) ----
      const [s1, s2] = await Promise.all([
        m.db.workSchedule.findUnique({ where: { id: a1.scheduleId }, select: { name: true } }),
        m.db.workSchedule.findUnique({ where: { id: a2.scheduleId }, select: { name: true } }),
      ]).catch(() => [null, null] as const);
      notified.push(
        ...(await notifyEmployee(m.db, row.requesterId, {
          title: `Tukar shift ${row.code} disetujui`,
          body: `Pada ${dateStr} jadwal Anda bertukar dengan ${row.target.fullName} — Anda mengikuti ${s2?.name ?? "jadwal pasangan"}.${note ? ` Catatan admin: ${note}.` : ""}`,
        })),
      );
      notified.push(
        ...(await notifyEmployee(m.db, row.targetId, {
          title: `Tukar shift ${row.code} disetujui`,
          body: `Pada ${dateStr} jadwal Anda bertukar dengan ${row.requester.fullName} — Anda mengikuti ${s1?.name ?? "jadwal pasangan"}.${note ? ` Catatan admin: ${note}.` : ""}`,
        })),
      );

      // Task 28-a — notifikasi WhatsApp kedua pihak (fire-and-forget, never-throw;
      // lookup nomor di background agar PATCH tidak menunggu)
      void (async () => {
        const [p1, p2] = await Promise.all([
          employeePhoneOf(m.db, row.requesterId),
          employeePhoneOf(m.db, row.targetId),
        ]);
        void sendWa(m.db, { event: "shiftswap.approved", toPhone: p1, placeholders: { nama: row.requester.fullName, pasangan: row.target.fullName, docNo: row.code, tanggal: dateStr } });
        void sendWa(m.db, { event: "shiftswap.approved", toPhone: p2, placeholders: { nama: row.target.fullName, pasangan: row.requester.fullName, docNo: row.code, tanggal: dateStr } });
      })();

      await m.db.activityLog.create({
        data: {
          action: "Approved", entity: "ShiftSwapRequest", entityId: id,
          appUserId: m.actor.appUserId,
          detail: `Tukar shift ${row.code} disetujui — ${row.requester.fullName} ↔ ${row.target.fullName} pada ${dateStr}; override 1-hari ${o1.id.slice(-6)} & ${o2.id.slice(-6)} dibuat, rekap harian kedua karyawan dihitung ulang`,
        },
      }).catch(() => { /* audit best-effort */ });

      return NextResponse.json({
        note: `Tukar shift ${row.code} disetujui — jadwal ${row.requester.fullName} ↔ ${row.target.fullName} pada ${dateStr} telah tertukar`,
        status: "Approved",
        appliedAssignment1: o1.id,
        appliedAssignment2: o2.id,
        regenError,
        notified,
      });
    }

    // ---- reject ----
    await m.db.shiftSwapRequest.update({
      where: { id },
      data: {
        status: "Rejected",
        decidedById: m.actor.appUserId,
        decidedAt: new Date(),
        decisionNote: note || null,
      },
    });

    notified.push(
      ...(await notifyEmployee(m.db, row.requesterId, {
        title: `Tukar shift ${row.code} ditolak`,
        body: `Permintaan tukar shift dengan ${row.target.fullName} pada ${dateStr} ditolak admin.${note ? ` Alasan: ${note}.` : ""}`,
      })),
    );
    notified.push(
      ...(await notifyEmployee(m.db, row.targetId, {
        title: `Tukar shift ${row.code} ditolak`,
        body: `Permintaan tukar shift dengan ${row.requester.fullName} pada ${dateStr} ditolak admin.${note ? ` Alasan: ${note}.` : ""}`,
      })),
    );

    await m.db.activityLog.create({
      data: {
        action: "Rejected", entity: "ShiftSwapRequest", entityId: id,
        appUserId: m.actor.appUserId,
        detail: `Tukar shift ${row.code} ditolak — ${row.requester.fullName} ↔ ${row.target.fullName} pada ${dateStr}${note ? ` — ${note}` : ""}`,
      },
    }).catch(() => { /* audit best-effort */ });

    return NextResponse.json({
      note: `Tukar shift ${row.code} ditolak`,
      status: "Rejected",
      notified,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
