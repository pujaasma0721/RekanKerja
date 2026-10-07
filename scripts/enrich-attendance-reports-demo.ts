// Enrich demo data MII untuk tab "Reports" modul Attendance (T113) =========
// Idempoten: tiap langkah mengecek kondisi sebelum menulis. Menambah:
//   1. Koordinat lokasi kerja (WorkLocation PRD-A/B, QC, WH) yang masih null.
//   2. Clock log Oktober 1–7 (hari kerja sesuai resolusi siklus jadwal) +
//      regenerateRange → rekap harian Oktober hidup (telat, lembur, dll).
//      Sengaja: 5 pasang alpa (tanpa log), 2 lupa absen pulang (IN saja).
//   3. Geotag ClockLog Sep–Okt (R1.3 multi-lokasi/geofencing): WFO dekat
//      lokasi resmi, WFH 2 karyawan (di luar radius), kunjungan klien 3
//      tanggal utk Sales, 2 karyawan remote Surabaya.
//   4. Transaksi janggal (R4.3): baris revised hasil audit fingerprint (Sep).
//      (Lupa pulang & tanpa punch dihasilkan langkah 2 via regen.)
//   5. Perintah lembur tambahan (R3.1/R3.2/R3.3): Okt weekday + pending,
//      1 order hari libur nasional (Maulid 25 Agu), pelanggaran cap PP 35
//      (20 jam/minggu & 5 jam/hari) utk audit kepatuhan.
// Jalankan: bun scripts/enrich-attendance-reports-demo.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { regenerateRange } from "@/rekankerja/time-attendance/services/attendance-service";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

// ---------- util geo ----------
const mToLat = (m: number) => m / 111_320;
const mToLng = (m: number, lat: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));

function hashOf(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
/** [0,1) deterministik dari string — pseudo-random stabil utk seeding. */
const randOf = (s: string) => (hashOf(s) % 10_000) / 10_000;

const BASE = {
  HO: { lat: -6.2563, lng: 106.8654 },
  PRD_A: { lat: -6.258, lng: 106.869 },
  PRD_B: { lat: -6.2595, lng: 106.871 },
  QC: { lat: -6.2572, lng: 106.867 },
  WH: { lat: -6.2601, lng: 106.8735 },
  SBY: { lat: -7.2906, lng: 112.7386 },
  WFH1: { lat: -6.171, lng: 106.798 },
  WFH2: { lat: -6.301, lng: 106.832 },
  CLIENT1: { lat: -6.225, lng: 106.901 },
};

function baseFor(no: string, unit: string | null): { lat: number; lng: number } {
  if (no === "MII00015") return BASE.WFH1;
  if (no === "MII00036") return BASE.WFH2;
  if (no === "MII00045" || no === "MII00046") return BASE.SBY;
  if (unit === "Assembly Line") return Number(no.slice(-1)) % 2 === 0 ? BASE.PRD_A : BASE.PRD_B;
  if (unit === "Maintenance") return BASE.WH;
  if (unit === "Quality Assurance") return BASE.QC;
  return BASE.HO;
}
const CLIENT_VISITS = new Set(["2026-09-10", "2026-09-24", "2026-10-01"]);

// ---------- jadwal: resolusi day type siklus (mirror resolveDayTypeFromCache) ----------
interface DayTypeLite {
  code: string; category: string; timeIn: string | null; timeOut: string | null;
  nextDay: boolean; toleranceLateMinutes: number;
}
const DAY_MS = 86_400_000;
const diffDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

/** Waktu punch [menit-ofset dari 00:00 tanggal] per kode day type & arah. */
function punchWindow(code: string, dir: "IN" | "OUT"): { base: number; span: number; lateFrom: number } {
  // OFFICE 08:00–17:00 (tol 10) · SHIFT1 06:00–14:00 (5) · SHIFT2 14:00–22:00 (5) · SHIFT3 22:00–06:00+1 (5)
  switch (code) {
    case "SHIFT1": return dir === "IN" ? { base: 5 * 60 + 25, span: 34, lateFrom: 6 * 60 + 11 } : { base: 14 * 60 + 3, span: 35, lateFrom: 0 };
    case "SHIFT2": return dir === "IN" ? { base: 13 * 60 + 25, span: 34, lateFrom: 14 * 60 + 11 } : { base: 22 * 60 + 2, span: 34, lateFrom: 0 };
    case "SHIFT3": return dir === "IN" ? { base: 21 * 60 + 25, span: 34, lateFrom: 22 * 60 + 11 } : { base: 30 * 60 + 3, span: 35, lateFrom: 0 }; // OUT = D+1 06:03
    default: return dir === "IN" ? { base: 7 * 60 + 28, span: 41, lateFrom: 8 * 60 + 16 } : { base: 17 * 60 + 2, span: 42, lateFrom: 0 }; // OFFICE / FLEX
  }
}

async function main() {
  const db = getTenantClient(MII_SCHEMA);
  const log = (msg: string) => console.log(`[enrich-att] ${msg}`);

  const company = await db.company.findFirst({ select: { id: true } });
  if (!company) throw new Error("Company MII tidak ditemukan — jalankan restore-demo dulu");

  // ---------- 1. Koordinat lokasi kerja yang masih null ----------
  const locCoords: Record<string, { lat: number; lng: number; r: number }> = {
    "LOC-PRD-A": { ...BASE.PRD_A, r: 200 },
    "LOC-PRD-B": { ...BASE.PRD_B, r: 200 },
    "LOC-QC": { ...BASE.QC, r: 150 },
    "LOC-WH": { ...BASE.WH, r: 250 },
  };
  let locUp = 0;
  for (const [code, c] of Object.entries(locCoords)) {
    const loc = await db.workLocation.findFirst({ where: { code }, select: { id: true, latitude: true } });
    if (loc && loc.latitude == null) {
      await db.workLocation.update({ where: { id: loc.id }, data: { latitude: c.lat, longitude: c.lng, radiusMeters: c.r, active: true } });
      locUp++;
    }
  }
  log(`WorkLocation berkoordinat: ${locUp} lokasi diisi (sisanya sudah ada).`);

  // ---------- 2. Clock log Oktober 1–7 + regenerateRange ----------
  const OCT_FROM = new Date("2026-10-01T00:00:00Z");
  const OCT_TO = new Date("2026-10-07T00:00:00Z");
  const octLogs = await db.attendanceClockLog.count({ where: { timestamp: { gte: OCT_FROM, lt: new Date("2026-10-08T00:00:00Z") } } });
  if (octLogs > 0) {
    log(`Clock log Oktober sudah ada (${octLogs}) — lewati seeding.`);
  } else {
    const empsAll = await db.employee.findMany({
      where: { status: "Active" },
      select: {
        id: true, employeeNo: true,
        assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 },
      },
    });
    const unitOf = new Map(empsAll.map((e) => [e.id, e.assignments[0]?.orgUnit?.name ?? null]));

    const assignments = await db.scheduleAssignment.findMany({
      where: { validTo: null },
      include: { schedule: { include: { days: true } } },
      orderBy: { validFrom: "desc" },
    });
    const assignByEmp = new Map<string, (typeof assignments)[number]>();
    for (const a of assignments) if (!assignByEmp.has(a.employeeId)) assignByEmp.set(a.employeeId, a);

    const dayTypes = await db.workDayType.findMany();
    const dtById = new Map(dayTypes.map((d) => [d.id, d as DayTypeLite & { id: string }]));

    /** Sengaja alpa (tanpa log sama sekali) & lupa absen pulang (IN saja). */
    const ALPA = new Set(["MII00009|2026-10-07", "MII00013|2026-10-06", "MII00037|2026-10-02", "MII00017|2026-10-07", "MII00040|2026-10-05", "MII00024|2026-10-06"]);
    const NO_OUT = new Set(["MII00007|2026-10-02", "MII00033|2026-10-05"]);

    const toCreate: { employeeId: string; timestamp: Date; direction: "IN" | "OUT"; source: string }[] = [];
    for (let d = new Date(OCT_FROM); d <= OCT_TO; d = new Date(d.getTime() + DAY_MS)) {
      const dateStr = d.toISOString().slice(0, 10);
      for (const emp of empsAll) {
        const a = assignByEmp.get(emp.id);
        if (!a || !a.clockingRequired) continue;
        const cycle = a.schedule.days;
        if (cycle.length === 0) continue;
        const offset = diffDays(a.anchorMonday, d);
        const idx = ((offset + (a.anchorSequence - 1)) % cycle.length + cycle.length) % cycle.length;
        // CATATAN BUG BUN 1.3.14: reduce dgn body ternary + properti akumulator
        // mengembalikan akumulator undefined → pakai loop for-of biasa.
        let minSeq = Number.MAX_SAFE_INTEGER;
        for (const x of cycle) minSeq = Math.min(minSeq, x.sequence);
        const seq = minSeq + idx;
        const day = cycle.find((x) => x.sequence === seq) ?? cycle.find((x) => x.sequence === idx + 1);
        if (!day) continue;
        const dt = dtById.get(day.dayTypeId);
        if (!dt || dt.category !== "Workday" || !dt.timeIn) continue;
        if (ALPA.has(`${emp.employeeNo}|${dateStr}`)) continue;

        const wIn = punchWindow(dt.code, "IN");
        const r = randOf(`${emp.employeeNo}|${dateStr}|IN`);
        const late = r > 0.82; // ~18% karyawan telat hari itu
        const inMin = late
          ? wIn.lateFrom + Math.floor(randOf(`${emp.employeeNo}|${dateStr}|L`) * 27)
          : wIn.base + Math.floor(r * wIn.span);
        toCreate.push({ employeeId: emp.id, timestamp: new Date(d.getTime() + inMin * 60_000), direction: "IN", source: "Web" });

        if (NO_OUT.has(`${emp.employeeNo}|${dateStr}`)) continue; // lupa absen pulang
        const wOut = punchWindow(dt.code, "OUT");
        const r2 = randOf(`${emp.employeeNo}|${dateStr}|OUT`);
        const early = r2 < 0.08 && dt.code !== "SHIFT3"; // ~8% pulang cepat
        const outMin = early
          ? (dt.code === "OFFICE" ? 16 * 60 + 20 + Math.floor(r2 * 100) : wOut.base - 40)
          : wOut.base + Math.floor(r2 * wOut.span);
        toCreate.push({ employeeId: emp.id, timestamp: new Date(d.getTime() + outMin * 60_000), direction: "OUT", source: "Web" });
      }
    }
    await db.attendanceClockLog.createMany({ data: toCreate });
    log(`Clock log Oktober: ${toCreate.length} punch dibuat (alpa ${ALPA.size} · lupa pulang ${NO_OUT.size}).`);

    const n = await regenerateRange(db, OCT_FROM, OCT_TO);
    log(`regenerateRange Okt 1–7: ${n} baris rekap harian dihitung ulang.`);
  }

  // ---------- 3. Geotag ClockLog Sep–Okt ----------
  const emps = await db.employee.findMany({
    where: { status: "Active" },
    select: {
      id: true, employeeNo: true,
      assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 },
    },
  });
  const unitOf = new Map(emps.map((e) => [e.id, e.assignments[0]?.orgUnit?.name ?? null]));
  const noOf = new Map(emps.map((e) => [e.id, e.employeeNo]));

  const from = new Date("2026-09-01T00:00:00Z");
  const to = new Date("2026-10-08T00:00:00Z");
  const logs = await db.attendanceClockLog.findMany({
    where: { timestamp: { gte: from, lt: to }, latitude: null },
    select: { id: true, employeeId: true, timestamp: true },
  });
  let geoN = 0;
  for (const l of logs) {
    const no = noOf.get(l.employeeId);
    if (!no) continue;
    let base = baseFor(no, unitOf.get(l.employeeId) ?? null);
    if (no === "MII00006" && CLIENT_VISITS.has(l.timestamp.toISOString().slice(0, 10))) base = BASE.CLIENT1;
    const h = hashOf(no);
    const dx = ((h % 41) - 20) * 1.2;
    const dy = (((h >> 6) % 41) - 20) * 1.2;
    const jit = ((l.timestamp.getUTCDate() + l.timestamp.getUTCHours()) % 7) - 3;
    await db.attendanceClockLog.update({
      where: { id: l.id },
      data: {
        latitude: base.lat + mToLat(dy + jit),
        longitude: base.lng + mToLng(dx + jit, base.lat),
      },
    });
    geoN++;
  }
  log(`ClockLog geotag: ${geoN} baris diberi koordinat (rentang Sep 1 – Okt 7).`);

  // ---------- 4. Transaksi janggal: baris revised (audit fingerprint) ----------
  const findRow = async (no: string, date: string) => {
    const e = emps.find((x) => x.employeeNo === no);
    if (!e) return null;
    return db.attendanceDaily.findFirst({
      where: { employeeId: e.id, workDate: new Date(`${date}T00:00:00Z`) },
      select: { id: true, notes: true },
    });
  };
  const mark = "(demo enrich)";
  let exN = 0;
  for (const [no, date] of [["MII00014", "2026-09-22"], ["MII00026", "2026-09-15"], ["MII00037", "2026-09-08"]] as const) {
    const r = await findRow(no, date);
    if (r && !r.notes?.includes(mark) && !r.notes?.includes("Koreksi manual")) {
      await db.attendanceDaily.update({ where: { id: r.id }, data: { revised: true, revisedBy: "admin.hrd", notes: `Koreksi manual hasil audit fingerprint ${mark}` } });
      exN++;
    }
  }
  log(`Baris revised (audit fingerprint): ${exN} ditandai.`);

  // ---------- 5. Perintah lembur tambahan ----------
  interface SeedOt {
    no: string; emp: string; date: string; from: string; to: string;
    plan: number; actual: number; verified: number; cat: string; mult?: number;
    status: string; reason: string; approver?: string;
  }
  const otEmpId = (no: string) => emps.find((e) => e.employeeNo === no)?.id;
  const SEED_OT: SeedOt[] = [
    { no: "OT-2026-101", emp: "MII00016", date: "2026-10-01", from: "17:30", to: "20:30", plan: 180, actual: 180, verified: 180, cat: "Weekday", status: "Approved", reason: "Penyelesaian order ekspor batch #52", approver: "MII00005" },
    { no: "OT-2026-102", emp: "MII00018", date: "2026-10-05", from: "15:30", to: "17:30", plan: 120, actual: 120, verified: 120, cat: "Weekday", status: "Approved", reason: "Setup mesin line B pergantian shift", approver: "MII00005" },
    { no: "OT-2026-103", emp: "MII00007", date: "2026-10-06", from: "18:00", to: "21:30", plan: 210, actual: 210, verified: 210, cat: "Weekday", status: "Approved", reason: "Deployment ERP modul payroll", approver: "MII00002" },
    { no: "OT-2026-104", emp: "MII00022", date: "2026-10-06", from: "22:00", to: "23:59", plan: 150, actual: 120, verified: 120, cat: "Weekday", status: "Pending", reason: "Overhaul conveyor belt #3 (menunggu approval)" },
    { no: "OT-2026-105", emp: "MII00005", date: "2026-08-25", from: "08:00", to: "12:00", plan: 240, actual: 240, verified: 240, cat: "Holiday", mult: 2, status: "Paid", reason: "Standby produksi hari libur nasional (Maulid Nabi)", approver: "MII00002" },
    { no: "OT-2026-106", emp: "MII00019", date: "2026-09-07", from: "14:00", to: "18:00", plan: 240, actual: 240, verified: 240, cat: "Weekday", status: "Approved", reason: "Recovery backlog line A", approver: "MII00005" },
    { no: "OT-2026-107", emp: "MII00019", date: "2026-09-08", from: "14:00", to: "18:00", plan: 240, actual: 240, verified: 240, cat: "Weekday", status: "Approved", reason: "Recovery backlog line A", approver: "MII00005" },
    { no: "OT-2026-108", emp: "MII00019", date: "2026-09-09", from: "14:00", to: "18:00", plan: 240, actual: 240, verified: 240, cat: "Weekday", status: "Approved", reason: "Recovery backlog line A", approver: "MII00005" },
    { no: "OT-2026-109", emp: "MII00019", date: "2026-09-10", from: "14:00", to: "18:00", plan: 240, actual: 240, verified: 240, cat: "Weekday", status: "Approved", reason: "Recovery backlog line A", approver: "MII00005" },
    { no: "OT-2026-110", emp: "MII00019", date: "2026-09-11", from: "14:00", to: "18:00", plan: 240, actual: 240, verified: 240, cat: "Weekday", status: "Approved", reason: "Recovery backlog line A", approver: "MII00005" },
    { no: "OT-2026-111", emp: "MII00021", date: "2026-09-15", from: "14:00", to: "19:00", plan: 300, actual: 300, verified: 300, cat: "Weekday", status: "Approved", reason: "Penanganan mesin breakdown (dieset profil manajemen)", approver: "MII00005" },
  ];
  let otN = 0;
  for (const s of SEED_OT) {
    const exists = await db.overtimeOrder.findFirst({ where: { orderNo: s.no }, select: { id: true } });
    if (exists) continue;
    const empId = otEmpId(s.emp);
    if (!empId) continue;
    await db.overtimeOrder.create({
      data: {
        orderNo: s.no, employeeId: empId,
        overtimeDate: new Date(`${s.date}T00:00:00Z`),
        timeFrom: new Date(`${s.date}T${s.from}:00Z`),
        timeTo: new Date(`${s.date}T${s.to}:00Z`),
        planMinutes: s.plan, actualMinutes: s.actual, verifiedMinutes: s.verified,
        dayCategory: s.cat, rateMultiplier: s.mult ?? 1.5,
        calculationTime: true, reason: s.reason, status: s.status,
        approverId: s.approver ? otEmpId(s.approver) : null,
        decidedAt: s.status === "Pending" ? null : new Date(`${s.date}T23:00:00Z`),
      },
    });
    otN++;
  }
  log(`Perintah lembur tambahan: ${otN} order dibuat (Okt + libur nasional + pelanggaran cap utk audit).`);

  const [att, clocks, ots, octLate] = await Promise.all([
    db.attendanceDaily.count(),
    db.attendanceClockLog.count({ where: { latitude: { not: null } } }),
    db.overtimeOrder.count(),
    db.attendanceDaily.count({ where: { workDate: { gte: OCT_FROM, lt: new Date("2026-10-08T00:00:00Z") }, lateMinutes: { gt: 0 } } }),
  ]);
  log(`Selesai. AttendanceDaily=${att} · ClockLog berkoordinat=${clocks} · OvertimeOrder=${ots} · baris telat Okt=${octLate}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
