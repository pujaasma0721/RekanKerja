import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";

// Task 27-e — Papan Kehadiran real-time ("siapa di kantor sekarang").
// GET /api/rekankerja/attendance/liveboard?date=YYYY-MM-DD (default: hari ini).
//
// Populasi = seluruh karyawan Active (left-join AttendanceDaily tanggal tsb):
// state per karyawan —
//   inOffice : checkIn && !checkOut  → sedang di kantor
//   done     : checkIn && checkOut   → sudah pulang
//   noClock  : tanpa checkIn & status Present/Late (atau tanpa baris rekap
//              sama sekali — belum absen / menunggu clock)
//   off      : status Off/Holiday/WorkOff/OnLeave
//   absent   : status Absent
// Efisien: 2 query saja (employees.findMany + attendanceDaily.findMany pada
// window 00:00..24:00; relasi orgUnit/workLocation ikut select — tanpa N+1).

export interface LiveboardRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  photoUrl: string | null;
  orgUnitName: string | null;
  workLocationName: string | null;
  state: "inOffice" | "done" | "noClock" | "off" | "absent";
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
}

const STATE_ORDER = { inOffice: 0, done: 1, noClock: 2, off: 3, absent: 4 } as const;

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    // Param tanggal opsional — validasi YYYY-MM-DD, default hari ini (server).
    const dateParam = req.nextUrl.searchParams.get("date");
    const now = new Date();
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json({ error: "Parameter date harus YYYY-MM-DD" }, { status: 400 });
    }
    const day = dateParam
      ? new Date(`${dateParam}T00:00:00`)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);

    const [employees, dailies] = await Promise.all([
      db.employee.findMany({
        where: { status: "Active" },
        select: {
          id: true,
          employeeNo: true,
          fullName: true,
          photoUrl: true,
          orgUnit: { select: { name: true } },
          workLocation: { select: { name: true } },
        },
        orderBy: { employeeNo: "asc" },
      }),
      db.attendanceDaily.findMany({
        where: { workDate: { gte: dayStart, lt: dayEnd } },
        select: {
          employeeId: true,
          status: true,
          presence: true,
          checkIn: true,
          checkOut: true,
          lateMinutes: true,
        },
      }),
    ]);

    // Unique [employeeId, workDate] → Map employeeId → baris rekap hari tsb.
    const dailyByEmployee = new Map(dailies.map((d) => [d.employeeId, d]));

    const rows: LiveboardRow[] = employees.map((e) => {
      const d = dailyByEmployee.get(e.id);
      const checkIn = d?.checkIn ?? null;
      const checkOut = d?.checkOut ?? null;
      const status = d?.status ?? null;
      let state: LiveboardRow["state"];
      if (checkIn && !checkOut) state = "inOffice";
      else if (checkIn && checkOut) state = "done";
      else if (status === "Off" || status === "Holiday" || status === "WorkOff" || status === "OnLeave") state = "off";
      else if (status === "Absent") state = "absent";
      else state = "noClock"; // Present/Late tanpa clock, atau tanpa baris rekap
      return {
        employeeId: e.id,
        employeeNo: e.employeeNo,
        fullName: e.fullName,
        photoUrl: e.photoUrl,
        orgUnitName: e.orgUnit?.name ?? null,
        workLocationName: e.workLocation?.name ?? null,
        state,
        status,
        checkIn: checkIn ? checkIn.toISOString() : null,
        checkOut: checkOut ? checkOut.toISOString() : null,
        lateMinutes: d?.lateMinutes ?? 0,
      };
    });

    // Urutan seksi papan: yang di kantor dulu (clock-in paling pagi di atas).
    rows.sort((a, b) => {
      const s = STATE_ORDER[a.state] - STATE_ORDER[b.state];
      if (s !== 0) return s;
      if (a.state === "inOffice") {
        const at = (x: string | null) => (x ? new Date(x).getTime() : Number.MAX_SAFE_INTEGER);
        return at(a.checkIn) - at(b.checkIn);
      }
      return a.employeeNo.localeCompare(b.employeeNo);
    });

    const stats = {
      total: rows.length,
      inOffice: rows.filter((r) => r.state === "inOffice").length,
      done: rows.filter((r) => r.state === "done").length,
      late: rows.filter((r) => r.lateMinutes > 0).length,
      off: rows.filter((r) => r.state === "off").length,
      absent: rows.filter((r) => r.state === "absent").length,
      noClock: rows.filter((r) => r.state === "noClock").length,
    };

    const dateOut = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    return NextResponse.json({ date: dateOut, updatedAt: now.toISOString(), stats, rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
