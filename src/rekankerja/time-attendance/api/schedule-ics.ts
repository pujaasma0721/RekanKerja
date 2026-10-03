import { NextRequest, NextResponse } from "next/server";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { dayStart, addDays, diffDays } from "@/rekankerja/time-attendance/services/attendance-service";

// Task 100 F1 (G26) — ICS jadwal shift (RFC 5545) → Google/Outlook/Apple Calendar.
// =====================================================================
// GET /api/rekankerja/attendance/schedule-ics?employeeId= — feed 60 hari ke
// depan, satu VEVENT per HARI KERJA (day type kategori bukan Off/Holiday —
// semantik isOffDay engine regenerateDaily). Pola ICS mengikuti
// leave/api/calendar.ts + services/leave-service.buildLeaveIcs (VEVENT,
// CRLF, DTSTART;VALUE=DATE, folding baris panjang).
// Guard VIEW menu attendance:assignment-schedule (halaman penugasan jadwal).
//
// File ini juga mengekspor buildScheduleIcsForEmployee() — dipakai ESS
// (ess/api/attendance-ics.ts, self-scoped requireEss).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" lokal (tanpa timezone shift — pola ess-auth). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYYMMDD" utk DTSTART/DTEND; "YYYYMMDDTHHMMSSZ" utk DTSTAMP. */
function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Escape teks nilai properti ICS (pola buildLeaveIcs). */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Folding RFC 5545 (§3.1): baris > 74 karakter dipecah dengan CRLF + spasi,
 * dipatahkan di batas spasi (kata) supaya SUMMARY panjang tetap valid.
 */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    // cari spasi terakhir ≤ 74; bila tidak ada (satu kata panjang) potong paksa
    let cut = rest.lastIndexOf(" ", 74);
    if (cut <= 0) cut = 74;
    parts.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut).replace(/^\s+/, "");
  }
  parts.push(rest);
  return parts.join("\r\n");
}

// ============ resolusi day type batch (DUPLIKASI SENGAJA) ============
// resolveDayTypeFromCache di attendance-service bersifat internal (tidak
// diekspor — verifikasi saat task ini ditulis). Logika resolusi day type
// efektif per tanggal untuk SATU karyawan diduplikasi di sini secara minimal
// (overlay libur menang; sequence di-anchor anchorMonday/anchorSequence;
// day type tak aktif → null). TODO orkestrator: bila service mengekspor
// resolver murni (Task 100-impl-C), ganti duplikasi ini dgn pemanggilan.

interface IcsDayTypeRow {
  id: string; active: boolean; code: string; name: string; category: string;
  timeIn: string | null; timeOut: string | null;
}

/** Field assignment+cycle yang dipakai resolusi (subset AssignmentRow service). */
interface IcsAssignmentRow {
  employeeId: string;
  scheduleId: string;
  anchorMonday: Date;
  anchorSequence: number;
  validFrom: Date;
  validTo: Date | null;
  schedule: { name: string; days: { sequence: number; dayTypeId: string }[] };
}

/** Baris hari kerja hasil resolusi (untuk VEVENT). */
export interface ScheduleIcsDay {
  date: Date;
  dayType: IcsDayTypeRow;
  scheduleName: string;
}

/** Resolve hari kerja seorang karyawan rentang [from..to] (batch, 4 kueri). */
async function resolveWorkDays(
  db: TenantDb,
  employeeId: string,
  from: Date,
  to: Date,
): Promise<ScheduleIcsDay[]> {
  // assignment yang overlap rentang — pilihan terbaru per tanggal (semantik
  // assignmentFor: validFrom ≤ D, validTo null/≥ D, validFrom terbaru).
  const assignments = (await db.scheduleAssignment.findMany({
    where: {
      employeeId,
      validFrom: { lte: dayStart(to) },
      OR: [{ validTo: null }, { validTo: { gte: dayStart(from) } }],
    },
    include: { schedule: { include: { days: true } } },
    orderBy: { validFrom: "desc" },
  })) as unknown as IcsAssignmentRow[];

  // day type yang dirujuk seluruh cycle
  const dayTypeIds = new Set<string>();
  for (const a of assignments) for (const d of a.schedule.days) dayTypeIds.add(d.dayTypeId);
  const dayTypeRows = dayTypeIds.size > 0
    ? await db.workDayType.findMany({ where: { id: { in: [...dayTypeIds] } } })
    : [];
  const dtById = new Map<string, IcsDayTypeRow>(
    dayTypeRows.map((d) => [d.id, {
      id: d.id, active: d.active, code: d.code, name: d.name, category: d.category,
      timeIn: d.timeIn, timeOut: d.timeOut,
    }]),
  );

  // overlay libur rentang (kind desc → National dulu per tanggal, pola holidayOn)
  const holidayByDate = new Map<string, string>();
  try {
    const holidays = await db.holidayDate.findMany({
      where: { date: { gte: dayStart(from), lt: addDays(dayStart(to), 1) } },
      orderBy: [{ kind: "desc" }, { name: "asc" }],
    });
    for (const h of holidays) {
      const key = isoLocal(dayStart(h.date));
      if (!holidayByDate.has(key)) holidayByDate.set(key, h.name);
    }
  } catch {
    // schema tenant belum termigrasi — overlay libur mati anggun (pola holidayOn)
  }

  const days: ScheduleIcsDay[] = [];
  for (let d = dayStart(from); d <= dayStart(to); d = addDays(d, 1)) {
    if (holidayByDate.has(isoLocal(d))) continue; // libur menang atas cycle
    const a = assignments.find((x) => x.validFrom <= d && (x.validTo === null || x.validTo >= d));
    if (!a) continue;
    const cycle = a.schedule.days;
    if (cycle.length === 0) continue;
    // sequence efektif: offset hari dari anchor, diputar dalam cycle
    const offset = diffDays(a.anchorMonday, d);
    const idx = ((offset + (a.anchorSequence - 1)) % cycle.length + cycle.length) % cycle.length;
    const seq = cycle.reduce((best, x) => (x.sequence < best.sequence ? x : best), cycle[0]!).sequence + idx;
    const day = cycle.find((x) => x.sequence === seq) ?? cycle.find((x) => x.sequence === idx + 1);
    if (!day) continue;
    const dt = dtById.get(day.dayTypeId);
    if (!dt || !dt.active) continue;
    // hari KERJA = kategori bukan Off/Holiday (semantik isOffDay engine)
    if (dt.category === "Off" || dt.category === "Holiday") continue;
    days.push({ date: d, dayType: dt, scheduleName: a.schedule.name });
  }
  return days;
}

/**
 * Bangun feed ICS jadwal shift seorang karyawan (dipakai admin & ESS).
 * Return null bila karyawan tidak ditemukan.
 */
export async function buildScheduleIcsForEmployee(
  db: TenantDb,
  employeeId: string,
  daysAhead = 60,
): Promise<{ ics: string; employeeNo: string; fullName: string; eventCount: number } | null> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employeeNo: true, fullName: true },
  });
  if (!emp) return null;

  const from = dayStart(new Date());
  const to = addDays(from, daysAhead);
  const workDays = await resolveWorkDays(db, employeeId, from, to);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RekanKerja//Attendance Schedule//ID",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(`Jadwal Shift — ${emp.fullName}`)}`,
  ];
  const dtstamp = `${ymd(new Date())}T000000Z`;
  for (const wd of workDays) {
    const jam = wd.dayType.timeIn || wd.dayType.timeOut
      ? ` ${wd.dayType.timeIn ?? "?"}–${wd.dayType.timeOut ?? "?"}`
      : "";
    lines.push(
      "BEGIN:VEVENT",
      `UID:schedule-${emp.employeeNo}-${ymd(wd.date)}@rekankerja`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${ymd(wd.date)}`,
      `DTEND;VALUE=DATE:${ymd(addDays(wd.date, 1))}`, // eksklusif (+1 hari)
      `SUMMARY:${esc(`Shift ${wd.dayType.name} — ${wd.dayType.code}`)}`,
      `DESCRIPTION:${esc(`Jadwal ${wd.scheduleName}${jam}`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return { ics: lines.map(fold).join("\r\n"), employeeNo: emp.employeeNo, fullName: emp.fullName, eventCount: workDays.length };
}

/** Response HTTP text/calendar dgn filename standar. */
export function icsResponse(ics: string, employeeNo: string): Response {
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="jadwal-${employeeNo}.ics"`,
    },
  });
}

// ================= GET — admin (per karyawan, wajib employeeId) =================
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:assignment-schedule"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });

    const employeeId = (req.nextUrl.searchParams.get("employeeId") ?? "").trim();
    if (!employeeId) {
      return NextResponse.json(
        { error: "Parameter employeeId wajib — pilih karyawan pada halaman penugasan jadwal" },
        { status: 400 },
      );
    }
    const built = await buildScheduleIcsForEmployee(m.db, employeeId);
    if (!built) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
    return icsResponse(built.ics, built.employeeNo);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
