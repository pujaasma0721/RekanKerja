// RekanKerja — helper premi shift malam (P1.5-BM, D-BM13) =====================
// ============================================================================
// Menghitung JAM MALAM (jendela 22:00–06:00) per karyawan untuk satu periode
// payroll, dari data clock nyata AttendanceDaily (presence=1, checkIn+checkOut
// terisi — termasuk shift lintas tengah malam nextDay dan lembur menjelang
// tutup malam).
//
// Konvensi:
//   • Jendela malam berjangkar pada workDate baris: [D 22:00 → D+1 06:00] dan
//     [D-1 22:00 → D 06:00] (dua jangkar diperiksa — menangkap shift malam
//     lintas tanggal dan clock-out dini hari).
//   • Jam malam = irisan [checkIn, checkOut] ∩ jendela malam, dalam MENIT,
//     dibulatkan ke atas ke kelipatan 15 menit (kebijakan konservatif —
//     premi dibayar penuh untuk menit yang dimulai).
//   • Atribusi mengikuti workDate baris (baris 31 Mar dgn clock-out 1 Apr
//     dihitung ke periode Maret).
//   • Baris tanpa clock lengkap / presence=0 (Off/Holiday/OnLeave/WorkOff)
//     → 0 menit.
//
// Pemakaian: payroll-engine memanggil saat membangun env formula per baris
// karyawan → variabel NIGHT_HOURS (jam, 2 desimal). Komponen contoh seed:
//   NIGHT_PREM = NIGHT_HOURS*BASE_SALARY/173  (1/173 — PP 35/2021 basis jam).
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

/** Kelipatan pembulatan ke atas (menit). */
const ROUND_TO_MIN = 15;
/** Durasi jendela malam (milidetik) — 22:00 → 06:00 = 8 jam. */
const NIGHT_WINDOW_MS = 8 * 3600000;

/** Irisan [aStart,aEnd] ∩ [bStart,bEnd] dalam milidetik (≥0). */
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Menit malam satu baris clock (checkIn→checkOut, bisa lintas tengah malam).
 * Jendela malam diperiksa pada jangkar workDate dan workDate-1.
 */
export function nightMinutesOfRow(
  workDate: Date,
  checkIn: Date,
  checkOut: Date,
): number {
  if (checkOut <= checkIn) return 0;
  let totalMs = 0;
  for (const day of [workDate, new Date(workDate.getTime() - 86400000)]) {
    const wStart = new Date(day);
    wStart.setHours(22, 0, 0, 0);
    const wEnd = new Date(wStart.getTime() + NIGHT_WINDOW_MS); // 06:00 hari berikut
    totalMs += overlapMs(checkIn.getTime(), checkOut.getTime(), wStart.getTime(), wEnd.getTime());
  }
  // Dua jangkar tidak tumpang tindih (jendela 8 jam terpisah 24 jam) —
  // total langsung; bulatkan ke atas kelipatan ROUND_TO_MIN.
  const totalMin = Math.floor(totalMs / 60000);
  if (totalMin <= 0) return 0;
  return Math.ceil(totalMin / ROUND_TO_MIN) * ROUND_TO_MIN;
}

/**
 * Σ jam malam per karyawan untuk satu periode payroll.
 * @param db          tenant client
 * @param employeeIds daftar karyawan run (dipakai filter IN)
 * @param periodStart tanggal mulai periode (inklusif)
 * @param periodEnd   tanggal akhir periode (inklusif)
 * @returns Map employeeId → jam malam (mis. 7,5) — 2 desimal.
 */
export async function nightHoursForPeriod(
  db: TenantDb,
  employeeIds: string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (employeeIds.length === 0) return out;
  const rows = await db.attendanceDaily.findMany({
    where: {
      employeeId: { in: employeeIds },
      workDate: { gte: periodStart, lte: periodEnd },
      presence: 1,
      checkIn: { not: null },
      checkOut: { not: null },
    },
    select: { employeeId: true, workDate: true, checkIn: true, checkOut: true },
  });
  const minutes = new Map<string, number>();
  for (const r of rows) {
    if (!r.checkIn || !r.checkOut) continue;
    const m = nightMinutesOfRow(r.workDate, r.checkIn, r.checkOut);
    if (m > 0) minutes.set(r.employeeId, (minutes.get(r.employeeId) ?? 0) + m);
  }
  for (const [empId, m] of minutes) out.set(empId, Math.round((m / 60) * 100) / 100);
  return out;
}
