import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import {
  listDaily, regenerateDaily, regenerateRange, recordClockLog, isValidTimeStr,
} from "@/rekankerja/time-attendance/services/attendance-service";

/** "YYYY-MM-DD" lokal dari Date (tanpa timezone shift — pola ess-auth). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD HH:MM" lokal utk teks ActivityLog. */
function fmtLogTs(d: Date): string {
  return `${isoLocal(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// GET /api/rekankerja/attendance/clocking?date=YYYY-MM-DD — rekap harian (padanan
// EmpClocking.jsp) + log mentah hari tsb.
// Task 100 (G1, audit A-01) — guard VIEW menu attendance:clocking (dulu
// requireTenant: rekap + log mentah clock seluruh karyawan terbaca bebas).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:clocking"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const dateParam = req.nextUrl.searchParams.get("date");
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? new Date(`${dateParam}T00:00:00`)
      : new Date();

    const [rows, logs, employees] = await Promise.all([
      listDaily(db, date),
      db.attendanceClockLog.findMany({
        where: { timestamp: { gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()), lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1) } },
        include: { employee: { select: { employeeNo: true, fullName: true } } },
        orderBy: { timestamp: "asc" },
      }),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);

    const stats = {
      total: rows.length,
      present: rows.filter((r) => r.status === "Present").length,
      late: rows.filter((r) => r.status === "Late").length,
      absent: rows.filter((r) => r.status === "Absent").length,
      workoff: rows.filter((r) => r.status === "WorkOff").length,
      off: rows.filter((r) => r.status === "Off").length,
      lateMinutes: rows.reduce((s, r) => s + r.lateMinutes, 0),
      overtimeMinutes: rows.reduce((s, r) => s + r.overtimeMinutes, 0),
    };
    return NextResponse.json({ date: date.toISOString().slice(0, 10), rows, logs, employees, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — catat clock manual/web (padanan Temporary Employee Clocking):
// body { employeeId, time: "HH:MM", direction, note } → log + rekap ulang.
// Guard hak AKSI menu attendance:clocking + VIEWER (requireMenuAction).
export async function POST(req: NextRequest) {
  try {
    // Task 79 — guard hak AKSI menu (input clock) — dulu hanya role-check.
    const m = await requireMenuAction(req, "attendance:clocking", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    const dateParam = String(b.date ?? "");
    const time = String(b.time ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || !/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json({ error: "Tanggal & jam wajib (YYYY-MM-DD, HH:MM)" }, { status: 400 });
    }
    const timestamp = new Date(`${dateParam}T${time}:00`);
    // Task 100 (G12, audit A-05) — validasi jendela timestamp input manual:
    // masa depan (>5 mnt) & backdate jauh (>30 hari) ditolak — clock masa depan
    // adalah jalur manipulasi presensi (hadir "terjadwal"), backdate jauh
    // seharusnya lewat koreksi histori (regen) dengan jejak audit.
    {
      const now = new Date();
      if (timestamp.getTime() > now.getTime() + 5 * 60_000) {
        return NextResponse.json({ error: "Waktu clock tidak boleh di masa depan (toleransi 5 menit)" }, { status: 400 });
      }
      if (timestamp.getTime() < now.getTime() - 30 * 86_400_000) {
        return NextResponse.json(
          { error: "Waktu clock tidak boleh lebih dari 30 hari ke belakang — gunakan regenerasi rekap untuk koreksi histori" },
          { status: 400 },
        );
      }
    }
    await recordClockLog(m.db, {
      employeeId: String(b.employeeId ?? ""),
      timestamp,
      direction: b.direction === "OUT" ? "OUT" : "IN",
      source: "Manual",
      note: b.note ?? null,
    });
    const rows = await listDaily(m.db, timestamp);
    return NextResponse.json({ ok: true, rows }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — op koreksi data Task 100 F1 (G24) + regen satu tanggal (lama).
// Guard hak AKSI menu attendance:clocking + VIEWER (requireMenuAction) —
// regenerasi & koreksi adalah operasi tulis.
//
// Body tanpa "op"  → perilaku lama: { date } → regen satu tanggal (Refresh).
// op:"regen-range"  → { from, to, employeeId? } — regen rentang (maks 62 hari).
// op:"override-daily" → { id, status?, checkIn?, checkOut?, paidFlag?, reason } —
//                      koreksi manual baris rekap → state "Revised" (dipertahankan
//                      regenerateDaily — kontrak service Task 100-impl-C).
export async function PATCH(req: NextRequest) {
  try {
    // Task 79 — guard hak AKSI menu (regenerasi rekap harian).
    const m = await requireMenuAction(req, "attendance:clocking", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json().catch(() => ({}));
    const op = String((b as { op?: unknown }).op ?? "");

    // ============ G24 — op:"regen-range": koreksi histori massal ============
    if (op === "regen-range") {
      const from = String((b as { from?: unknown }).from ?? "");
      const to = String((b as { to?: unknown }).to ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return NextResponse.json({ error: "Parameter from & to wajib (YYYY-MM-DD)" }, { status: 400 });
      }
      const fromDate = new Date(`${from}T00:00:00`);
      const toDate = new Date(`${to}T00:00:00`);
      if (toDate < fromDate) {
        return NextResponse.json({ error: "Tanggal awal tidak boleh setelah tanggal akhir" }, { status: 400 });
      }
      const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
      if (days > 62) {
        return NextResponse.json(
          { error: `Rentang regenerasi maksimal 62 hari (diminta ${days} hari) — pecah menjadi beberapa batch` },
          { status: 400 },
        );
      }
      const employeeId = String((b as { employeeId?: unknown }).employeeId ?? "").trim() || undefined;
      if (employeeId) {
        const emp = await m.db.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, employeeNo: true, fullName: true },
        });
        if (!emp) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
      }
      const rows = await regenerateRange(m.db, fromDate, toDate, employeeId);
      await m.db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId,
          action: "Processed", entity: "AttendanceDaily",
          detail: `Regenerasi rekap rentang ${from} → ${to} (${days} hari, ${employeeId ? "satu karyawan" : "seluruh karyawan aktif"}) oleh ${m.actor.name} — ${rows} baris`,
        },
      }).catch(() => { /* audit best-effort */ });
      return NextResponse.json({ from, to, days, rows, employeeId: employeeId ?? null });
    }

    // ============ G24 — op:"override-daily": koreksi manual satu baris ============
    if (op === "override-daily") {
      const id = String((b as { id?: unknown }).id ?? "");
      const reason = String((b as { reason?: unknown }).reason ?? "").trim();
      if (!id) return NextResponse.json({ error: "id baris rekap (AttendanceDaily) wajib" }, { status: 400 });
      if (!reason) {
        return NextResponse.json(
          { error: "Alasan koreksi wajib diisi (tercatat di log aktivitas)" },
          { status: 400 },
        );
      }
      if (reason.length > 300) {
        return NextResponse.json({ error: "Alasan koreksi maksimal 300 karakter" }, { status: 400 });
      }

      const row = await m.db.attendanceDaily.findUnique({
        where: { id },
        include: { employee: { select: { employeeNo: true, fullName: true } } },
      });
      if (!row) return NextResponse.json({ error: "Baris rekap tidak ditemukan" }, { status: 404 });

      // validasi field opsional — hanya yang dikirim yang diubah
      const data: Record<string, unknown> = {};
      const statusIn = (b as { status?: unknown }).status;
      if (statusIn !== undefined) {
        const s = String(statusIn);
        if (!["Present", "Late", "Absent", "Off", "Holiday", "WorkOff", "OnLeave"].includes(s)) {
          return NextResponse.json(
            { error: `Status tidak valid ("${s}") — pilihan: Present|Late|Absent|Off|Holiday|WorkOff|OnLeave` },
            { status: 400 },
          );
        }
        data.status = s;
      }
      const hhmm = (v: unknown, label: string): Date | null => {
        const s = String(v ?? "");
        if (!/^\d{2}:\d{2}$/.test(s) || !isValidTimeStr(s)) {
          throw new Error(`${label} harus format HH:MM (00:00–23:59)`);
        }
        const [h, mi] = s.split(":").map((x) => parseInt(x, 10));
        const d = new Date(row.workDate);
        d.setHours(h, mi, 0, 0);
        return d;
      };
      try {
        if ((b as { checkIn?: unknown }).checkIn !== undefined) {
          data.checkIn = hhmm((b as { checkIn?: unknown }).checkIn, "Jam masuk");
        }
        if ((b as { checkOut?: unknown }).checkOut !== undefined) {
          data.checkOut = hhmm((b as { checkOut?: unknown }).checkOut, "Jam pulang");
        }
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Format jam tidak valid" }, { status: 400 });
      }
      const paidFlag = (b as { paidFlag?: unknown }).paidFlag;
      if (paidFlag !== undefined) {
        if (typeof paidFlag !== "boolean") {
          return NextResponse.json({ error: "paidFlag harus boolean" }, { status: 400 });
        }
        data.paidFlag = paidFlag;
      }

      // KONTRAK service (Task 100-impl-C): baris state "Revised" DIPERTAHANKAN
      // oleh regenerateDaily (tidak ditimpa hasil kalkulasi ulang) — kolom
      // revised/revisedBy (sudah ada di schema, belum pernah dipakai) kini aktif.
      const updated = await m.db.attendanceDaily.update({
        where: { id },
        data: {
          ...data,
          state: "Revised",
          revised: true,
          revisedBy: m.actor.name,
          notes: reason, // alasan koreksi tampil di rekap (fallback display)
        },
      });

      await m.db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId,
          action: "Updated", entity: "AttendanceDaily", entityId: id,
          detail: `Koreksi rekap ${row.employee.employeeNo} ${row.employee.fullName} — ${isoLocal(row.workDate)}: ` +
            `${Object.keys(data).length > 0 ? Object.entries(data).map(([k, v]) => `${k}=${v instanceof Date ? fmtLogTs(v) : String(v)}`).join(", ") : "tanpa perubahan field"} ` +
            `(alasan: ${reason}) oleh ${m.actor.name}`,
        },
      }).catch(() => { /* audit best-effort */ });

      return NextResponse.json({ ok: true, row: { ...updated, employeeNo: row.employee.employeeNo, fullName: row.employee.fullName } });
    }

    // ============ perilaku lama: regen satu tanggal (Refresh Clocking) ============
    const dateParam = String(b.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json({ error: "Tanggal wajib (YYYY-MM-DD)" }, { status: 400 });
    }
    const date = new Date(`${dateParam}T00:00:00`);
    const count = await regenerateDaily(m.db, date);
    const rows = await listDaily(m.db, date);
    return NextResponse.json({ regenerated: count, rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE ?id={logId} — Task 100 F1 (G24) koreksi data: hapus SALAH SATU log clock
// mentah (mis. clock ganda / clock orang lain di mesin) lalu hitung ulang rekap
// (employeeId, tanggal log tsb). Guard hak AKSI update attendance:clocking —
// menghapus log mentah adalah operasi koreksi destruktif (beraudit via ActivityLog).
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:clocking", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Parameter id log clock wajib" }, { status: 400 });
    }
    const log = await m.db.attendanceClockLog.findUnique({
      where: { id },
      include: { employee: { select: { employeeNo: true, fullName: true } } },
    });
    if (!log) return NextResponse.json({ error: "Log clock tidak ditemukan" }, { status: 404 });

    await m.db.attendanceClockLog.delete({ where: { id } });

    // rekap tanggal log dihitung ulang (idempoten; regen error tidak membatalkan
    // penghapusan — dikembalikan sebagai peringatan, pola shift-swap approve).
    let regenError: string | null = null;
    try {
      await regenerateDaily(m.db, log.timestamp, log.employeeId);
    } catch (e) {
      regenError = e instanceof Error ? e.message : "unknown";
      console.warn("[clocking] regenerateDaily gagal pasca hapus log:", regenError);
    }

    await m.db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId,
        action: "Deleted", entity: "AttendanceClockLog", entityId: id,
        detail: `Hapus log clock ${fmtLogTs(log.timestamp)} ${log.direction} (${log.source}) ` +
          `${log.employee.employeeNo} ${log.employee.fullName} oleh ${m.actor.name}`,
      },
    }).catch(() => { /* audit best-effort */ });

    return NextResponse.json({ ok: true, deletedId: id, regenError });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
