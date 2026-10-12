// Migrasi P1-PERFORMANCE (DEVELOPMENT-PLAN-PERFORMANCE.md §20 P1) — DEMO data
// MII (kanon E2E §21-5): siklus PER-2025 (Closed — peserta ber-KPI terkunci,
// sumber salinan §18.2) + PER-2026 (GoalSetting — peserta kosong menunggu
// builder/salin/impor). Idempoten per kode siklus. Hanya tenant MII.
import "./lib/env";
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const MII = "tenant_pt_mitra_industri_internasional";

const YEAR = new Date().getFullYear();
const PREV = YEAR - 1;

// peserta + KPI terkunci PER-2025 (9 orang lintas unit; kode KPI dari starter-pack)
type DemoKpi = { code: string; title: string; polarity: string; unit: string; thresholdMin: number | null; target: number; stretchValue: number | null; weight: number; isCritical: boolean; dataSource: string; sourceKey: string | null };
const P25: { no: string; kpis: DemoKpi[] }[] = [
  {
    no: "MII00004", kpis: [
      { code: null as unknown as string, title: "Ketepatan closing payroll", polarity: "Higher", unit: "%", thresholdMin: 80, target: 100, stretchValue: 105, weight: 30, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: null as unknown as string, title: "Akurasi data karyawan", polarity: "Higher", unit: "%", thresholdMin: 90, target: 99, stretchValue: null, weight: 25, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: null as unknown as string, title: "Kepuasan pelanggan internal", polarity: "Higher", unit: "skala", thresholdMin: 3, target: 4, stretchValue: 4.5, weight: 20, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: null as unknown as string, title: "Sesi mentoring/coaching bawahan", polarity: "Higher", unit: "sesi", thresholdMin: 6, target: 12, stretchValue: null, weight: 25, isCritical: false, dataSource: "Manual", sourceKey: null },
    ],
  },
  {
    no: "MII00009", kpis: [
      { code: "IP-TIME-TO-FILL", title: "Waktu proses PR → hire", polarity: "Lower", unit: "hari", thresholdMin: 60, target: 45, stretchValue: 35, weight: 40, isCritical: false, dataSource: "Recruitment", sourceKey: "recruitment_time_to_fill" },
      { code: "IP-FULFILLED-H", title: "Pemenuhan MPP rekrutmen", polarity: "Higher", unit: "%", thresholdMin: 70, target: 90, stretchValue: null, weight: 30, isCritical: false, dataSource: "Recruitment", sourceKey: "recruitment_fulfilled_h" },
      { code: null as unknown as string, title: "Ketepatan pengiriman laporan rutin", polarity: "Higher", unit: "%", thresholdMin: 80, target: 95, stretchValue: null, weight: 30, isCritical: false, dataSource: "Manual", sourceKey: null },
    ],
  },
  {
    no: "MII00010", kpis: [
      { code: "IP-TIME-TO-FILL", title: "Waktu proses PR → hire", polarity: "Lower", unit: "hari", thresholdMin: 60, target: 45, stretchValue: 35, weight: 40, isCritical: false, dataSource: "Recruitment", sourceKey: "recruitment_time_to_fill" },
      { code: "IP-FULFILLED-H", title: "Pemenuhan MPP rekrutmen", polarity: "Higher", unit: "%", thresholdMin: 70, target: 90, stretchValue: null, weight: 35, isCritical: false, dataSource: "Recruitment", sourceKey: "recruitment_fulfilled_h" },
      { code: null as unknown as string, title: "Sesi knowledge sharing", polarity: "Higher", unit: "sesi", thresholdMin: 2, target: 6, stretchValue: null, weight: 25, isCritical: false, dataSource: "Manual", sourceKey: null },
    ],
  },
  {
    no: "MII00012", kpis: [
      { code: "IP-PROSES-SURAT", title: "Waktu proses surat ≤ 2 hari", polarity: "Higher", unit: "%", thresholdMin: 70, target: 90, stretchValue: null, weight: 35, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: null as unknown as string, title: "Keluhan internal layanan GA", polarity: "Lower", unit: "kasus", thresholdMin: 5, target: 0, stretchValue: null, weight: 25, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: "IP-KEHADIRAN", title: "Persentase kehadiran", polarity: "Higher", unit: "%", thresholdMin: 90, target: 98, stretchValue: 100, weight: 40, isCritical: false, dataSource: "Attendance", sourceKey: "attendance_presence_pct" },
    ],
  },
  {
    no: "MII00013", kpis: [
      { code: null as unknown as string, title: "Ketepatan posting jurnal", polarity: "Higher", unit: "%", thresholdMin: 85, target: 99, stretchValue: null, weight: 40, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: "FIN-REKONSILIASI-BANK", title: "Rekonsiliasi bank tepat waktu", polarity: "Higher", unit: "%", thresholdMin: 80, target: 100, stretchValue: null, weight: 30, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: "FIN-SELISIH-STOK", title: "Selisih stok fisik vs sistem", polarity: "Lower", unit: "%", thresholdMin: 2, target: 0.5, stretchValue: null, weight: 30, isCritical: false, dataSource: "Manual", sourceKey: null },
    ],
  },
  {
    no: "MII00015", kpis: [
      { code: "FIN-PELAPORAN-PAJAK", title: "Ketepatan pelaporan pajak", polarity: "Higher", unit: "%", thresholdMin: 90, target: 100, stretchValue: null, weight: 50, isCritical: true, dataSource: "Manual", sourceKey: null },
      { code: "FIN-BIAYA-VS-ANGGARAN", title: "Biaya operasional vs anggaran", polarity: "Lower", unit: "%", thresholdMin: 10, target: 0, stretchValue: null, weight: 25, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: null as unknown as string, title: "Ketepatan posting jurnal", polarity: "Higher", unit: "%", thresholdMin: 85, target: 99, stretchValue: null, weight: 25, isCritical: false, dataSource: "Manual", sourceKey: null },
    ],
  },
  {
    no: "MII00016", kpis: [
      { code: null as unknown as string, title: "Ketepatan pengiriman laporan rutin", polarity: "Higher", unit: "%", thresholdMin: 80, target: 95, stretchValue: null, weight: 30, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: "IP-ERROR-INPUT", title: "Tingkat error input data", polarity: "Lower", unit: "kasus", thresholdMin: 10, target: 2, stretchValue: null, weight: 30, isCritical: false, dataSource: "Manual", sourceKey: null },
      { code: "LG-CROSS-TRAINING", title: "Cross-training penguasaan proses", polarity: "Higher", unit: "proses", thresholdMin: 1, target: 3, stretchValue: 4, weight: 40, isCritical: false, dataSource: "Manual", sourceKey: null },
    ],
  },
  {
    no: "MII00018", kpis: [
      { code: "IP-KEHADIRAN", title: "Persentase kehadiran", polarity: "Higher", unit: "%", thresholdMin: 90, target: 98, stretchValue: 100, weight: 50, isCritical: false, dataSource: "Attendance", sourceKey: "attendance_presence_pct" },
      { code: "LG-ABSEN-TAK-TERENCANA", title: "Absen tak terencana", polarity: "Lower", unit: "hari", thresholdMin: 6, target: 0, stretchValue: null, weight: 30, isCritical: false, dataSource: "Leave", sourceKey: "leave_unplanned_days" },
      { code: "IP-ERROR-INPUT", title: "Tingkat error input data", polarity: "Lower", unit: "kasus", thresholdMin: 10, target: 2, stretchValue: null, weight: 20, isCritical: false, dataSource: "Manual", sourceKey: null },
    ],
  },
  {
    no: "MII00019", kpis: [
      { code: "IP-KEHADIRAN", title: "Persentase kehadiran", polarity: "Higher", unit: "%", thresholdMin: 90, target: 98, stretchValue: 100, weight: 55, isCritical: false, dataSource: "Attendance", sourceKey: "attendance_presence_pct" },
      { code: "LG-ABSEN-TAK-TERENCANA", title: "Absen tak terencana", polarity: "Lower", unit: "hari", thresholdMin: 6, target: 0, stretchValue: null, weight: 25, isCritical: false, dataSource: "Leave", sourceKey: "leave_unplanned_days" },
      { code: null as unknown as string, title: "Proyek perbaikan selesai (kaizen)", polarity: "Higher", unit: "proyek", thresholdMin: 0, target: 1, stretchValue: 2, weight: 20, isCritical: false, dataSource: "Manual", sourceKey: null },
    ],
  },
];

// peserta PER-2026 (10 = 9 di atas + Agus Salim tanpa sumber → jalur template)
const P26 = ["MII00004", "MII00009", "MII00010", "MII00012", "MII00013", "MII00015", "MII00016", "MII00018", "MII00019", "MII00007"];

export async function main(schemas?: string[]): Promise<void> {
  const list = (schemas && schemas.length > 0 ? schemas : (await platform.tenant.findMany({ select: { schemaName: true } })).map((t) => t.schemaName).filter(Boolean).sort())
    .filter((s) => s.includes("mitra_industri")); // demo hanya MII
  if (list.length === 0) { console.log("[migrate-performance-p1] tidak ada tenant MII — lewati"); return; }
  console.log(`[migrate-performance-p1] schema: ${list.join(", ")}`);
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    const schemaName = list[0];
    const alreadyCur = await c.query(`SELECT id FROM "${schemaName}"."PerformanceCycle" WHERE code = $1`, [`PER-${YEAR}`]);
    const alreadyPrev = await c.query(`SELECT id FROM "${schemaName}"."PerformanceCycle" WHERE code = $1`, [`PER-${PREV}`]);
    if (alreadyCur.rowCount && alreadyPrev.rowCount) {
      console.log(`  demo P1 sudah ada (PER-${PREV} + PER-${YEAR}) — lewati`);
      return;
    }
    let prevId = alreadyPrev.rows[0]?.id as string | undefined;

    // ---- karyawan & atasan ----
    const nos = Array.from(new Set([...P25.map((p) => p.no), ...P26]));
    const empQ = await c.query(
      `SELECT e.id, e."employeeNo" FROM "${schemaName}"."Employee" e WHERE e."employeeNo" = ANY($1::text[])`,
      [nos],
    );
    const empByNo = new Map<string, string>(empQ.rows.map((r: { employeeNo: string; id: string }) => [r.employeeNo, r.id]));
    const mgrQ = await c.query(
      `SELECT a."employeeId" AS eid, a."managerId" FROM "${schemaName}"."EmployeeAssignment" a WHERE a."validTo" IS NULL`,
    );
    const mgrOf = new Map<string, string>(mgrQ.rows.map((r: { eid: string; managerId: string | null }) => [r.eid, r.managerId].filter(Boolean) as [string, string]));

    // ---- definisi pustaka (id per kode) ----
    const defQ = await c.query(`SELECT id, code FROM "${schemaName}"."KpiDefinition" WHERE "versionNo" = 1`);
    const defByCode = new Map<string, string>(defQ.rows.filter((r: { code: string }) => r.code).map((r: { id: string; code: string }) => [r.code, r.id]));

    // ---- siklus PER-{PREV} (Closed — sumber salinan) ----
    if (!prevId) {
    const cycPrev = await c.query(
      `INSERT INTO "${schemaName}"."PerformanceCycle"
        (id, code, name, "cycleType", "periodStart", "periodEnd", "goalStart", "goalEnd", "midStart", "midEnd",
         "selfStart", "selfEnd", "mgrStart", "mgrEnd", "calibStart", "calibEnd", "publishAt", "weightsJson", "feedback360", status, "createdBy", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'Annual', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, false, 'Closed', 'seed-demo', now(), now())
       RETURNING id`,
      [
        `PER-${PREV}`, `Penilaian Kinerja ${PREV}`,
        `${PREV}-01-01`, `${PREV}-12-31`,
        `${PREV}-01-05`, `${PREV}-02-28`, `${PREV}-06-01`, `${PREV}-07-15`,
        `${PREV}-11-01`, `${PREV}-12-01`, `${PREV}-12-02`, `${PREV}-12-15`,
        `${PREV}-12-16`, `${PREV}-12-20`, `${PREV}-12-28`,
        JSON.stringify({ kpi: 70, competency: 20, core: 10 }),
      ],
    );
    prevId = cycPrev.rows[0].id as string;
    console.log(`  PER-${PREV} dibuat (Closed) — ${P25.length} peserta ber-KPI terkunci`);
    } else {
      console.log(`  PER-${PREV} sudah ada — hanya lengkapi PER-${YEAR}`);
    }

    let seq = 0;
    for (const p of P25) {
      const empId = empByNo.get(p.no);
      if (!empId) continue;
      seq++;
      const ar = await c.query(
        `INSERT INTO "${schemaName}"."AppraisalRecord"
          (id, "docNo", "cycleId", "employeeId", "managerId", "kpiTotalWeight", "finalScore", "finalRating", status)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 100, $5, $6, 'Published') RETURNING id`,
        [`PER-${PREV}-${String(seq).padStart(4, "0")}`, prevId, empId, mgrOf.get(empId) ?? null,
          74 + Math.round(Math.random() * 14), 3 + (seq % 3)],
      );
      const appraisalId = ar.rows[0].id as string;
      for (const k of p.kpis) {
        await c.query(
          `INSERT INTO "${schemaName}"."AppraisalKpi"
            (id, "appraisalId", "kpiDefId", title, polarity, unit, "thresholdMin", target, "stretchValue", weight, "isCritical", "dataSource", "sourceKey", "proposedBy", origin)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Manager', 'Fresh')`,
          [appraisalId, k.code ? defByCode.get(k.code) ?? null : null, k.title, k.polarity, k.unit, k.thresholdMin, k.target, k.stretchValue, k.weight, k.isCritical, k.dataSource, k.sourceKey],
        );
      }
    }

    // ---- siklus PER-{YEAR} (GoalSetting — peserta kosong) ----
    if (alreadyCur.rowCount) { console.log(`  PER-${YEAR} sudah ada — selesai`); return; }
    const cycCur = await c.query(
      `INSERT INTO "${schemaName}"."PerformanceCycle"
        (id, code, name, "cycleType", "periodStart", "periodEnd", "goalStart", "goalEnd", "midStart", "midEnd",
         "selfStart", "selfEnd", "mgrStart", "mgrEnd", "calibStart", "calibEnd", "weightsJson", "feedback360", status, "createdBy", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'Annual', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, false, 'GoalSetting', 'seed-demo', now(), now())
       RETURNING id`,
      [
        `PER-${YEAR}`, `Penilaian Kinerja ${YEAR}`,
        `${YEAR}-01-01`, `${YEAR}-12-31`,
        `${YEAR}-01-05`, `${YEAR}-03-31`, `${YEAR}-06-01`, `${YEAR}-07-15`,
        `${YEAR}-11-01`, `${YEAR}-12-01`, `${YEAR}-12-02`, `${YEAR}-12-15`,
        `${YEAR}-12-16`, `${YEAR}-12-20`,
        JSON.stringify({ kpi: 70, competency: 20, core: 10 }),
      ],
    );
    const curId = cycCur.rows[0].id as string;
    let seq2 = 0;
    for (const no of P26) {
      const empId = empByNo.get(no);
      if (!empId) continue;
      seq2++;
      await c.query(
        `INSERT INTO "${schemaName}"."AppraisalRecord"
          (id, "docNo", "cycleId", "employeeId", "managerId", status)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'Enrolled')`,
        [`PER-${YEAR}-${String(seq2).padStart(4, "0")}`, curId, empId, mgrOf.get(empId) ?? null],
      );
    }
    console.log(`  PER-${YEAR} dibuat (GoalSetting) — ${seq2} peserta kosong (siap builder/salin/impor)`);
  } finally {
    await c.end();
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
