// RekanKerja — DETEKSI ANOMALI ABSENSI (Task 100 F1, G27+G29 — impl-C).
// =====================================================================
// Fungsi murni per-tenant (tanpa HTTP): memindai log presensi & rekap dalam
// jendela waktu dan menghasilkan daftar anomali berklasifikasi severity
// (tinggi|sedang|rendah) + laporan burnout lembur 3 bulan rolling.
//
// Aturan deteksi (benchmark pasar — UKG/Dayforce anomaly alerts):
//   duplicateGeo     tinggi  — 2 karyawan BERBEDA punch IN ≤ 5 menit,
//                              koordinat ≤ 15 m, ≥ 2 pasangan dalam 7 hari
//                              (indikasi buddy punching / GPS share).
//   latePattern      sedang  — telat ≥ 3x pada hari Senin ATAU Jumat dalam
//                              90 hari (pola telat akhir pekan/mingguan).
//   boundaryClock    rendah  — checkIn dalam ±90 detik dari batas toleransi
//                              shift ≥ 4x / 30 hari (punch "pas waktu").
//   impossibleTravel tinggi  — antar-punch karyawan sama kecepatan
//                              > 250 km/jam (GPS spoof / pindah lokasi instan).
//   speedFlag        sedang  — log yang ditandai G22 (anomalyNotes "speed")
//                              saat clock — daftar utk penelaahan.
// burnoutRolling (G29) — total jam lembur 3 bulan terakhir per karyawan +
// rata-rata bulanan; flag bila rata-rata > rule.burnoutOtHoursMonthly.
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

/** Baris anomali — bentuk persis kontrak response endpoint /anomalies. */
export interface AnomalyRow {
  type: "duplicateGeo" | "latePattern" | "boundaryClock" | "impossibleTravel" | "speedFlag";
  severity: "tinggi" | "sedang" | "rendah";
  employeeNo: string;
  fullName: string;
  detail: string;
}

/** Baris burnout lembur (G29) — kontrak response endpoint /anomalies. */
export interface BurnoutRow {
  employeeNo: string;
  fullName: string;
  /** total menit lembur 3 bulan terakhir (order Approved/Paid). */
  otMinutes3m: number;
  /** rata-rata jam lembur per bulan (otMinutes3m / 60 / 3). */
  avgMonthlyHours: number;
  /** true bila avgMonthlyHours > rule.burnoutOtHoursMonthly. */
  flag: boolean;
}

/** Ambang deteksi (konstanta — mengikuti spesifikasi Task 100 F1). */
const DUP_MINUTES_MS = 5 * 60_000; // punch IN dalam 5 menit
const DUP_DISTANCE_M = 15; // koordinat ≤ 15 meter
const DUP_PAIR_WINDOW_MS = 7 * 86_400_000; // ≥ 2 pasangan dalam 7 hari
const LATE_DOW_WINDOW_MS = 90 * 86_400_000; // pola telat Senin/Jumat 90 hari
const LATE_MIN_OCCURRENCES = 3;
const BOUNDARY_SECONDS_MS = 90_000; // ±90 detik dari batas toleransi
const BOUNDARY_WINDOW_MS = 30 * 86_400_000; // ≥ 4x / 30 hari
const BOUNDARY_MIN_OCCURRENCES = 4;
const IMPOSSIBLE_SPEED_KMH = 250; // kecepatan mustahil antar-punch

/** Jarak haversine dua titik koordinat (meter). */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDayShort(d: Date): string {
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function fmtHhMm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Deteksi seluruh anomali presensi dalam jendela [from, to) — murni read-only. */
export async function detectAnomalies(db: TenantDb, from: Date, to: Date): Promise<AnomalyRow[]> {
  const anomalies: AnomalyRow[] = [];
  const employees = await db.employee.findMany({
    select: { id: true, employeeNo: true, fullName: true },
  });
  const empById = new Map(employees.map((e) => [e.id, e]));
  const nameOf = (id: string) => {
    const e = empById.get(id);
    return e ? `${e.employeeNo} — ${e.fullName}` : id;
  };
  const noOf = (id: string) => empById.get(id)?.employeeNo ?? id;
  const fullOf = (id: string) => empById.get(id)?.fullName ?? id;

  // ---- 1. duplicateGeo (buddy punching) + 4. impossibleTravel ----
  // satu query log berkoordinat utk dua aturan (urut employee lalu waktu).
  const geoLogs = await db.attendanceClockLog.findMany({
    where: {
      timestamp: { gte: from, lt: to },
      latitude: { not: null },
      longitude: { not: null },
    },
    orderBy: [{ employeeId: "asc" }, { timestamp: "asc" }],
    select: { employeeId: true, timestamp: true, direction: true, latitude: true, longitude: true, anomalyNotes: true },
  });

  // 4. impossibleTravel — antar-punch berurutan karyawan sama.
  {
    const perEmp = new Map<string, typeof geoLogs>();
    for (const l of geoLogs) {
      const arr = perEmp.get(l.employeeId) ?? [];
      arr.push(l);
      perEmp.set(l.employeeId, arr);
    }
    for (const [empId, list] of perEmp) {
      let violations = 0;
      let maxKmh = 0;
      let sample = "";
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]!;
        const b = list[i]!;
        const hours = (b.timestamp.getTime() - a.timestamp.getTime()) / 3_600_000;
        if (hours <= 0) continue;
        const kmh = haversineM(a.latitude as number, a.longitude as number, b.latitude as number, b.longitude as number) / 1000 / hours;
        if (kmh > IMPOSSIBLE_SPEED_KMH) {
          violations++;
          if (kmh > maxKmh) {
            maxKmh = kmh;
            sample = `${fmtDayShort(a.timestamp)} ${fmtHhMm(a.timestamp)} → ${fmtDayShort(b.timestamp)} ${fmtHhMm(b.timestamp)}`;
          }
        }
      }
      if (violations > 0) {
        anomalies.push({
          type: "impossibleTravel",
          severity: "tinggi",
          employeeNo: noOf(empId),
          fullName: fullOf(empId),
          detail:
            `${violations} perpindahan mustahil (kecepatan > ${IMPOSSIBLE_SPEED_KMH} km/jam) antar-punch berkoordinat — ` +
            `tercepat ${Math.round(maxKmh)} km/jam (${sample}). Periksa indikasi GPS spoof / perangkat dibawa orang lain.`,
        });
      }
    }
  }

  // 1. duplicateGeo — karyawan berbeda, IN ≤ 5 menit, jarak ≤ 15 m, ≥ 2 pasangan / 7 hari.
  {
    // urut GLOBAL waktu dulu (geoLogs terurut per-employee) supaya window
    // dua-pointer 5 menit di bawah valid.
    const ins = geoLogs
      .filter((l) => l.direction === "IN")
      .sort((x, y) => x.timestamp.getTime() - y.timestamp.getTime());
    // dua pointer pada timeline (window 5 menit) → hindari O(n²) penuh.
    const pairEvents = new Map<string, Date[]>(); // key "empA|empB" (id terurut)
    for (let i = 0; i < ins.length; i++) {
      const a = ins[i]!;
      for (let j = i + 1; j < ins.length; j++) {
        const b = ins[j]!;
        const dt = b.timestamp.getTime() - a.timestamp.getTime();
        if (dt > DUP_MINUTES_MS) break; // terurut waktu global — sisa pasti lebih jauh
        if (b.employeeId === a.employeeId) continue;
        const dist = haversineM(a.latitude as number, a.longitude as number, b.latitude as number, b.longitude as number);
        if (dist <= DUP_DISTANCE_M) {
          const key = a.employeeId < b.employeeId ? `${a.employeeId}|${b.employeeId}` : `${b.employeeId}|${a.employeeId}`;
          const arr = pairEvents.get(key) ?? [];
          arr.push(b.timestamp);
          pairEvents.set(key, arr);
        }
      }
    }
    for (const [key, times] of pairEvents) {
      times.sort((x, y) => x.getTime() - y.getTime());
      // ≥ 2 kejadian dalam 7 hari?
      let inWindow = false;
      for (let i = 1; i < times.length; i++) {
        if (times[i]!.getTime() - times[i - 1]!.getTime() <= DUP_PAIR_WINDOW_MS) {
          inWindow = true;
          break;
        }
      }
      if (inWindow && times.length >= 2) {
        const [idA, idB] = key.split("|") as [string, string];
        anomalies.push({
          type: "duplicateGeo",
          severity: "tinggi",
          employeeNo: noOf(idA),
          fullName: fullOf(idA),
          detail:
            `Koordinat presensi identik (≤ ${DUP_DISTANCE_M} m, punch ≤ ${DUP_MINUTES_MS / 60_000} menit) dengan ${nameOf(idB)} ` +
            `${times.length}x dalam 7 hari — indikasi buddy punching / perangkat dipakai bersama.`,
        });
      }
    }
  }

  // ---- 2. latePattern — telat ≥ 3x Senin ATAU Jumat dalam 90 hari ----
  {
    const winFrom = new Date(Math.max(from.getTime(), to.getTime() - LATE_DOW_WINDOW_MS));
    const lates = await db.attendanceDaily.findMany({
      where: { status: "Late", workDate: { gte: winFrom, lt: to } },
      select: { employeeId: true, workDate: true },
    });
    const countMonFri = new Map<string, { mon: number; fri: number }>();
    for (const r of lates) {
      const dow = r.workDate.getDay(); // 1=Senin, 5=Jumat
      if (dow !== 1 && dow !== 5) continue;
      const c = countMonFri.get(r.employeeId) ?? { mon: 0, fri: 0 };
      if (dow === 1) c.mon++;
      else c.fri++;
      countMonFri.set(r.employeeId, c);
    }
    for (const [empId, c] of countMonFri) {
      const parts: string[] = [];
      if (c.mon >= LATE_MIN_OCCURRENCES) parts.push(`Senin ${c.mon}x`);
      if (c.fri >= LATE_MIN_OCCURRENCES) parts.push(`Jumat ${c.fri}x`);
      if (parts.length > 0) {
        anomalies.push({
          type: "latePattern",
          severity: "sedang",
          employeeNo: noOf(empId),
          fullName: fullOf(empId),
          detail: `Pola keterlambatan berulang dalam 90 hari: ${parts.join(" dan ")} (≥ ${LATE_MIN_OCCURRENCES}x) — pertimbangkan pembinaan/pergeseran jadwal.`,
        });
      }
    }
  }

  // ---- 3. boundaryClock — checkIn ±90 dtk dari batas toleransi ≥ 4x/30 hari ----
  {
    const winFrom = new Date(Math.max(from.getTime(), to.getTime() - BOUNDARY_WINDOW_MS));
    const rows = await db.attendanceDaily.findMany({
      where: { checkIn: { not: null }, workDate: { gte: winFrom, lt: to } },
      select: {
        employeeId: true,
        checkIn: true,
        workDate: true,
        dayType: { select: { timeIn: true, toleranceLateMinutes: true } },
      },
    });
    const counts = new Map<string, number>();
    for (const r of rows) {
      const tIn = r.dayType?.timeIn;
      if (!tIn || !r.checkIn) continue;
      const [h, min] = tIn.split(":").map((x) => parseInt(x, 10));
      const boundary = new Date(r.workDate);
      boundary.setHours(h || 0, min || 0, 0, 0);
      boundary.setSeconds(boundary.getSeconds() + (r.dayType?.toleranceLateMinutes ?? 0) * 60);
      if (Math.abs(r.checkIn.getTime() - boundary.getTime()) <= BOUNDARY_SECONDS_MS) {
        counts.set(r.employeeId, (counts.get(r.employeeId) ?? 0) + 1);
      }
    }
    for (const [empId, n] of counts) {
      if (n >= BOUNDARY_MIN_OCCURRENCES) {
        anomalies.push({
          type: "boundaryClock",
          severity: "rendah",
          employeeNo: noOf(empId),
          fullName: fullOf(empId),
          detail: `${n}x clock-in "pas di batas" (±${BOUNDARY_SECONDS_MS / 1000} detik dari akhir toleransi shift) dalam 30 hari — pola menunggu menit terakhir.`,
        });
      }
    }
  }

  // ---- 5. speedFlag — log ditandai G22 (anomalyNotes "speed") ----
  {
    const flagged = new Map<string, number>();
    for (const l of geoLogs) {
      if (l.anomalyNotes && l.anomalyNotes.split(",").map((s) => s.trim()).includes("speed")) {
        flagged.set(l.employeeId, (flagged.get(l.employeeId) ?? 0) + 1);
      }
    }
    for (const [empId, n] of flagged) {
      anomalies.push({
        type: "speedFlag",
        severity: "sedang",
        employeeNo: noOf(empId),
        fullName: fullOf(empId),
        detail: `${n} punch ditandai kecepatan mustahil (> ${IMPOSSIBLE_SPEED_KMH} km/jam dari punch sebelumnya) saat presensi — ditandai G22, bukti selfie/koordinat perlu ditelaah.`,
      });
    }
  }

  // urut: tinggi dulu, lalu sedang, rendah.
  const order = { tinggi: 0, sedang: 1, rendah: 2 } as const;
  anomalies.sort((a, b) => order[a.severity] - order[b.severity]);
  return anomalies;
}

/**
 * G29 — burnout lembur 3 bulan rolling per karyawan: total menit lembur
 * (order Approved/Paid — verifiedMinutes bila > 0, else actualMinutes) +
 * rata-rata jam per bulan; flag bila rata-rata > rule.burnoutOtHoursMonthly
 * (default 40 jam/bulan; baca defensif — tenant tanpa kolom = tanpa flag).
 */
export async function burnoutRolling(db: TenantDb): Promise<BurnoutRow[]> {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - 3, 1); // 3 bulan rolling
  let threshold = 40;
  try {
    const rule = await db.attendanceRule.findFirst({
      orderBy: { id: "asc" },
      select: { burnoutOtHoursMonthly: true },
    });
    if (rule?.burnoutOtHoursMonthly != null && rule.burnoutOtHoursMonthly > 0) {
      threshold = rule.burnoutOtHoursMonthly;
    }
  } catch {
    /* kolom belum termigrasi — ambang default */
  }

  const orders = await db.overtimeOrder.findMany({
    where: {
      overtimeDate: { gte: since, lte: now },
      status: { in: ["Approved", "Paid"] },
    },
    select: { employeeId: true, verifiedMinutes: true, actualMinutes: true },
  });
  const perEmp = new Map<string, number>();
  for (const o of orders) {
    const minutes = o.verifiedMinutes > 0 ? o.verifiedMinutes : o.actualMinutes;
    perEmp.set(o.employeeId, (perEmp.get(o.employeeId) ?? 0) + minutes);
  }
  if (perEmp.size === 0) return [];

  const employees = await db.employee.findMany({
    where: { id: { in: [...perEmp.keys()] } },
    select: { id: true, employeeNo: true, fullName: true },
    orderBy: { employeeNo: "asc" },
  });
  const rows: BurnoutRow[] = [];
  for (const e of employees) {
    const otMinutes3m = perEmp.get(e.id) ?? 0;
    const avgMonthlyHours = Math.round(((otMinutes3m / 60) / 3) * 10) / 10;
    rows.push({
      employeeNo: e.employeeNo,
      fullName: e.fullName,
      otMinutes3m,
      avgMonthlyHours,
      flag: avgMonthlyHours > threshold,
    });
  }
  rows.sort((a, b) => b.avgMonthlyHours - a.avgMonthlyHours);
  return rows;
}
