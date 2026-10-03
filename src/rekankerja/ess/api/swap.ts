// ESS — Tukar Shift (Task 27-g) =================================================
// =====================================================================
// Self-service shift swap: karyawan mengajukan, ADMIN memutuskan (menu
// Kehadiran → Tukar Shift — API time-attendance/api/shift-swap.ts yang
// membuat override ScheduleAssignment 1-hari per pasangan saat approve).
//   GET  /api/rekankerja/ess/swap?date=YYYY-MM-DD — resolusi jadwal SAYA pada
//        tanggal tsb (resolveDayType: dayType + assignment) + daftar kandidat
//        rekan Active yang (a) punya assignment sah tanggal tsb dan (b) day
//        type-nya BEDA dari saya (tukar shift sama = tak bermakna) + permintaan
//        Pending saya pada tanggal tsb (blokir duplikat di UI).
//   GET  /api/rekankerja/ess/swap?list=mine (default tanpa param) — riwayat
//        permintaan SAYA + permintaan yang ditujukan KE SAYA (target).
//   POST /api/rekankerja/ess/swap { targetId, date, reason } — TSK-%04d,
//        status Pending, snapshot scheduleId kedua pihak, notifikasi ke
//        karyawan TARGET (AppUser tertaut) + Admin/HR, ActivityLog.
//   PATCH /api/rekankerja/ess/swap { id, action: "cancel" } — pemohon membatalkan
//        saat masih Pending.
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import { dayStart, addDays, resolveDayType } from "@/rekankerja/time-attendance/services/attendance-service";
import { notifyEvent, pushNotification } from "@/rekankerja/shared/services/notification-service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-09-09" → Date lokal 00:00 (tanpa timezone shift). */
function parseDay(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

/** Rentang [00:00, 00:00+1) untuk filter swapDate pada satu tanggal. */
function dayWindow(d: Date): { gte: Date; lt: Date } {
  return { gte: dayStart(d), lt: addDays(dayStart(d), 1) };
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Label "08:00–17:00" / "—" untuk day type tanpa jam. */
function shiftTimeLabel(timeIn: string | null, timeOut: string | null): string {
  if (!timeIn && !timeOut) return "—";
  return `${timeIn ?? "?"}–${timeOut ?? "?"}`;
}

// ================= GET =================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date");
    const listMode = !dateParam || url.searchParams.get("list") === "mine";

    // ---------- mode riwayat: permintaan saya + permintaan ke saya ----------
    if (listMode) {
      const [mine, toMe] = await Promise.all([
        db.shiftSwapRequest.findMany({
          where: { requesterId: employeeId },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            requester: { select: { employeeNo: true, fullName: true, photoUrl: true } },
            target: { select: { employeeNo: true, fullName: true, photoUrl: true } },
          },
        }),
        db.shiftSwapRequest.findMany({
          where: { targetId: employeeId },
          orderBy: { createdAt: "desc" },
          take: 30,
          include: {
            requester: { select: { employeeNo: true, fullName: true, photoUrl: true } },
            target: { select: { employeeNo: true, fullName: true, photoUrl: true } },
          },
        }),
      ]);

      // nama jadwal snapshot — resolve saat baca (fallback "-"), pola admin GET
      const schedIds = new Set<string>();
      for (const r of [...mine, ...toMe]) {
        if (r.requesterScheduleId) schedIds.add(r.requesterScheduleId);
        if (r.targetScheduleId) schedIds.add(r.targetScheduleId);
      }
      const schedules = schedIds.size
        ? await db.workSchedule.findMany({ where: { id: { in: Array.from(schedIds) } }, select: { id: true, name: true } })
        : [];
      const schedName = new Map(schedules.map((s) => [s.id, s.name]));

      const mapRow = (r: (typeof mine)[number]) => ({
        id: r.id,
        code: r.code,
        swapDate: isoDate(dayStart(r.swapDate)),
        reason: r.reason,
        status: r.status, // Pending|Approved|Rejected|Cancelled|Done
        decisionNote: r.decisionNote,
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        requester: r.requester,
        target: r.target,
        requesterScheduleName: r.requesterScheduleId ? schedName.get(r.requesterScheduleId) ?? "-" : "-",
        targetScheduleName: r.targetScheduleId ? schedName.get(r.targetScheduleId) ?? "-" : "-",
        applied: !!(r.appliedAssignment1 && r.appliedAssignment2),
      });
      return NextResponse.json({ mine: mine.map(mapRow), toMe: toMe.map(mapRow) });
    }

    // ---------- mode pengajuan: jadwal saya + kandidat pada tanggal ----------
    if (!DATE_RE.test(dateParam!)) {
      return NextResponse.json({ error: "Parameter date harus YYYY-MM-DD" }, { status: 400 });
    }
    const date = parseDay(dateParam!);
    const myRes = await resolveDayType(db, employeeId, date);
    const hasAssignment = myRes.assignment.id !== "";
    const myDayTypeId = myRes.dayType?.id ?? null;

    // kandidat: karyawan Active lain (maks 50) yang punya assignment + day type
    // BERBEDA dari saya pada tanggal tsb (resolveDayType — termasuk overlay libur).
    const others = await db.employee.findMany({
      where: { status: "Active", id: { not: employeeId } },
      select: {
        id: true, employeeNo: true, fullName: true, photoUrl: true,
        orgUnit: { select: { name: true } },
      },
      orderBy: { employeeNo: "asc" },
      take: 50,
    });
    const candidates: Array<{
      employeeId: string; employeeNo: string; fullName: string;
      photoUrl: string | null; unitName: string | null;
      dayType: { name: string; timeIn: string | null; timeOut: string | null; category: string; color: string };
      timeLabel: string;
    }> = [];
    for (const e of others) {
      const res = await resolveDayType(db, e.id, date);
      if (!res.assignment.id || !res.dayType) continue; // tanpa jadwal sah → skip
      if (res.dayType.id === myDayTypeId) continue; // shift sama → tukar tak bermakna
      candidates.push({
        employeeId: e.id,
        employeeNo: e.employeeNo,
        fullName: e.fullName,
        photoUrl: e.photoUrl,
        unitName: e.orgUnit?.name ?? null,
        dayType: {
          name: res.dayType.name,
          timeIn: res.dayType.timeIn,
          timeOut: res.dayType.timeOut,
          category: res.dayType.category,
          color: res.dayType.color,
        },
        timeLabel: shiftTimeLabel(res.dayType.timeIn, res.dayType.timeOut),
      });
    }

    // permintaan Pending saya pada tanggal tsb (UI blokir duplikat)
    const pendingMine = await db.shiftSwapRequest.findMany({
      where: { requesterId: employeeId, swapDate: dayWindow(date), status: "Pending" },
      orderBy: { createdAt: "desc" },
      include: { target: { select: { fullName: true } } },
    });

    // nama jadwal saya (display)
    const myScheduleName = hasAssignment && myRes.assignment.scheduleId
      ? (await db.workSchedule.findUnique({ where: { id: myRes.assignment.scheduleId }, select: { name: true } }))?.name ?? null
      : null;

    return NextResponse.json({
      date: dateParam!,
      myShift: {
        dayType: myRes.dayType
          ? {
              id: myRes.dayType.id, code: myRes.dayType.code, name: myRes.dayType.name,
              color: myRes.dayType.color, category: myRes.dayType.category,
              timeIn: myRes.dayType.timeIn, timeOut: myRes.dayType.timeOut,
            }
          : null,
        scheduleName: myScheduleName,
        hasAssignment,
        clockingRequired: myRes.assignment.clockingRequired,
        holiday: myRes.holiday ? { date: myRes.holiday.date, name: myRes.holiday.name, kind: myRes.holiday.kind } : null,
      },
      candidates,
      pendingMine: pendingMine.map((r) => ({
        id: r.id, code: r.code, status: r.status, targetName: r.target.fullName,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST — ajukan tukar shift =================
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const targetId = String(b.targetId ?? "").trim();
    const dateStr = String(b.date ?? "").trim();
    const reason = String(b.reason ?? "").trim();

    if (!targetId) return NextResponse.json({ error: "Rekan tujuan tukar wajib dipilih" }, { status: 400 });
    if (!DATE_RE.test(dateStr)) return NextResponse.json({ error: "Tanggal tukar tidak valid" }, { status: 400 });
    if (!reason) return NextResponse.json({ error: "Alasan tukar shift wajib diisi" }, { status: 400 });
    if (reason.length > 300) return NextResponse.json({ error: "Alasan maksimal 300 karakter" }, { status: 400 });
    if (targetId === employeeId) {
      return NextResponse.json({ error: "Tidak bisa mengajukan tukar shift dengan diri sendiri" }, { status: 400 });
    }

    const date = parseDay(dateStr);
    if (dayStart(date).getTime() < dayStart(new Date()).getTime()) {
      return NextResponse.json({ error: "Tanggal tukar tidak boleh di masa lalu" }, { status: 400 });
    }

    // kedua karyawan harus Active
    const [me, target] = await Promise.all([
      db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, status: true } }),
      db.employee.findUnique({ where: { id: targetId }, select: { id: true, fullName: true, status: true } }),
    ]);
    if (!me || me.status !== "Active") {
      return NextResponse.json({ error: "Data karyawan Anda tidak aktif — hubungi HR" }, { status: 400 });
    }
    if (!target || target.status !== "Active") {
      return NextResponse.json({ error: "Rekan tujuan tidak ditemukan atau tidak aktif" }, { status: 400 });
    }

    // resolusi jadwal kedua pihak — keduanya wajib punya jadwal pada tanggal tsb
    const [myRes, targetRes] = await Promise.all([
      resolveDayType(db, employeeId, date),
      resolveDayType(db, targetId, date),
    ]);
    if (!myRes.assignment.id || !myRes.dayType) {
      return NextResponse.json(
        { error: `Anda tidak memiliki jadwal pada ${dateStr} — tukar shift tidak bisa diajukan` },
        { status: 400 },
      );
    }
    if (!targetRes.assignment.id || !targetRes.dayType) {
      return NextResponse.json(
        { error: `${target.fullName} tidak memiliki jadwal pada ${dateStr}` },
        { status: 400 },
      );
    }
    if (myRes.dayType.id === targetRes.dayType.id) {
      return NextResponse.json(
        { error: `Shift Anda dan ${target.fullName} sama pada ${dateStr} (${myRes.dayType.name}) — tukar shift tidak bermakna` },
        { status: 400 },
      );
    }

    // maks 1 permintaan Pending per pemohon per tanggal
    const pendingSame = await db.shiftSwapRequest.findFirst({
      where: { requesterId: employeeId, swapDate: dayWindow(date), status: "Pending" },
      select: { code: true },
    });
    if (pendingSame) {
      return NextResponse.json(
        { error: `Anda masih punya permintaan tukar shift menunggu keputusan untuk ${dateStr} (${pendingSame.code})` },
        { status: 400 },
      );
    }

    // kode berurutan tenant: TSK-0001
    // Task 100 (G7b, audit A-04) — race-suffix: dua pengajuan paralel menghitung
    // max+1 sama → unique code P2002 (dulu error 500 generik). Bungkus create
    // dengan retry regen nomor (maks 3) — pola createWithDocNoRetry travel-service.
    const created = await (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const tskRows = await db.shiftSwapRequest.findMany({ where: { code: { startsWith: "TSK-" } }, select: { code: true } });
        let tskMax = 0;
        for (const r of tskRows) {
          const n = parseInt(r.code.slice("TSK-".length), 10);
          if (Number.isFinite(n) && n > tskMax) tskMax = n;
        }
        const code = `TSK-${String(tskMax + 1).padStart(4, "0")}`;
        try {
          return await db.shiftSwapRequest.create({
            data: {
              code,
              requesterId: employeeId,
              targetId,
              swapDate: dayStart(date),
              requesterScheduleId: myRes.assignment.scheduleId || null,
              targetScheduleId: targetRes.assignment.scheduleId || null,
              reason: reason || null,
              status: "Pending",
            },
          });
        } catch (e) {
          if ((e as { code?: string })?.code === "P2002" && attempt < 2) continue; // nomor dipakai proses lain — regen
          throw e;
        }
      }
      throw new Error("Kode TSK unik tidak berhasil dialokasikan setelah 3 percobaan — coba ulang sesaat lagi");
    })();
    // Task 100 (G7b) — `code` scope IIFE: turunkan dari row hasil create agar
    // referensi ActivityLog/notifikasi di bawah tetap valid.
    const code = created.code;

    await db.activityLog.create({
      data: {
        action: "Created", entity: "ShiftSwapRequest", entityId: created.id,
        employeeId,
        detail: `Tukar shift ${code} diajukan dari ESS — ${me.fullName} ↔ ${target.fullName} pada ${dateStr} (${myRes.dayType.name} ↔ ${targetRes.dayType.name})`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan pengajuan */ });

    // kabari karyawan TARGET (AppUser tertaut karyawan tsb — never-throw)
    try {
      const targetUsers = await db.appUser.findMany({
        where: { employeeId: target.id, active: true },
        select: { id: true },
        take: 5,
      });
      for (const u of targetUsers) {
        void pushNotification(db, {
          appUserId: u.id,
          title: `Permintaan tukar shift ${code}`,
          body: `${fullName} mengajukan tukar shift dengan Anda pada ${dateStr} — ${myRes.dayType.name} ↔ ${targetRes.dayType.name}. Menunggu persetujuan admin.`,
          kind: "attendance",
        });
      }
    } catch { /* notifikasi tidak boleh mengganggu pengajuan */ }

    // kabari Admin/HR (resolusi notifyEvent to:"admins" — never-throw)
    void notifyEvent(db, {
      to: "admins",
      docType: "ShiftSwap",
      docNo: code,
      title: `Permintaan tukar shift ${code}`,
      body: `${fullName} ↔ ${target.fullName} pada ${dateStr} (${myRes.dayType.name} ↔ ${targetRes.dayType.name}). Buka Kehadiran → Tukar Shift.`,
      kind: "attendance",
      link: "attendance:shift-swap",
    });

    return NextResponse.json({ code: created.code, status: created.status }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= PATCH — batalkan (pemohon, saat Pending) =================
export async function PATCH(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const id = String(b.id ?? "");
    const action = String(b.action ?? "cancel");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    if (action !== "cancel") {
      return NextResponse.json({ error: "Aksi tidak dikenal — ESS hanya dapat membatalkan" }, { status: 400 });
    }

    const row = await db.shiftSwapRequest.findUnique({
      where: { id },
      include: { target: { select: { fullName: true } } },
    });
    if (!row) return NextResponse.json({ error: "Permintaan tidak ditemukan" }, { status: 404 });
    if (row.requesterId !== employeeId) {
      return NextResponse.json({ error: "Hanya pemohon yang dapat membatalkan permintaan ini" }, { status: 403 });
    }
    if (row.status !== "Pending") {
      return NextResponse.json(
        { error: `Permintaan ${row.code} sudah diputuskan (${row.status}) — tidak bisa dibatalkan` },
        { status: 400 },
      );
    }

    const updated = await db.shiftSwapRequest.update({
      where: { id },
      data: { status: "Cancelled" },
    });

    await db.activityLog.create({
      data: {
        action: "Cancelled", entity: "ShiftSwapRequest", entityId: id,
        employeeId,
        detail: `Tukar shift ${row.code} dibatalkan pemohon dari ESS (${fullName} ↔ ${row.target.fullName})`,
      },
    }).catch(() => { /* audit best-effort */ });

    void notifyEvent(db, {
      to: "admins",
      docType: "ShiftSwap",
      docNo: row.code,
      title: `Tukar shift ${row.code} dibatalkan pemohon`,
      body: `${fullName} membatalkan permintaan tukar shift dengan ${row.target.fullName} pada ${isoDate(dayStart(row.swapDate))}.`,
      kind: "attendance",
      link: "attendance:shift-swap",
    });

    return NextResponse.json({ code: updated.code, status: updated.status, note: `Permintaan ${updated.code} dibatalkan` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
