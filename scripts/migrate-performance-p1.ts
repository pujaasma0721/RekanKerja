// Migrasi P1-PERFORMANCE (DEVELOPMENT-PLAN-PERFORMANCE.md §20 P1 — data demo
// §21-5) ke tenant existing — IDEMPOTEN:
//   • Seed SIKLUS HISTORIS PER-2025 (status Closed, periode 2025) sebagai
//     SUMBER SALIN §18.2 untuk E2E "salin PER-2025 → PER-2026":
//       - 12 peserta lintas unit (4 staf HR under Tri Handayani · 6 operator/
//         maintenance produksi under Joko Susilo · 2 software engineer under
//         Agus Salim) — snapshot managerId sesuai penempatan aktif.
//       - Tiap peserta 4–5 baris KPI TERKUNCI (GoalApproved+; status baris
//         appraisal = Closed) dengan Σbobot tepat 100 + finalScore/finalRating
//         terisi (1 under-performer MII00021 Wahyu Saputra — skor 62 rating 2,
//         bahan PIP P6 nanti).
//       - KPI campuran manual + AUTO-binding (IPR-PRESENCE, IPR-LATE-UNPLANNED,
//         IPR-LEAVE-PROC-DAYS) — nilai finalActual realistis terisi.
//   • Skip senyap bila siklus PER-2025 sudah ada / tenant tanpa karyawan
//     aktif (idempoten — aman dijalankan berulang).
// CLI: bun run scripts/migrate-performance-p1.ts [schema1 schema2 …]
import "./lib/env";
import { Client } from "pg";
import { db as platform } from "@/lib/db";

interface KpiSeed {
  code: string;
  target: number;
  threshold: number | null;
  stretch: number | null;
  weight: number;
  actual: number | null;
  critical?: boolean;
}

interface ParticipantSeed {
  employeeNo: string;
  managerNo: string;
  /** null → skor dihitung berbobot actual (fallback ringkas) */
  finalScore: number;
  finalRating: number;
  kpis: KpiSeed[];
}

const HR_SET: KpiSeed[] = [
  { code: "IPR-PRESENCE", target: 97, threshold: 92, stretch: 100, weight: 30, actual: 98.2 },
  { code: "CUS-DOC-ONTIME", target: 95, threshold: 90, stretch: 100, weight: 25, actual: 96.1 },
  { code: "IPR-EMP-DATA-ACC", target: 99, threshold: 95, stretch: 100, weight: 20, actual: 99.5 },
  { code: "LNG-TRAIN-COMPLETE", target: 90, threshold: 80, stretch: 100, weight: 15, actual: 92 },
  { code: "IPR-LEAVE-PROC-DAYS", target: 2, threshold: 5, stretch: 1, weight: 10, actual: 1.8 },
];
const PROD_SET: KpiSeed[] = [
  { code: "IPR-PRESENCE", target: 96, threshold: 90, stretch: 100, weight: 35, actual: 95.1 },
  { code: "CUS-ACCURACY-ORDER", target: 98, threshold: 95, stretch: 100, weight: 30, actual: 97.4, critical: true },
  { code: "IPR-LATE-UNPLANNED", target: 2, threshold: 6, stretch: 0, weight: 20, actual: 3 },
  { code: "FIN-COST-VS-BUDGET", target: 100, threshold: 110, stretch: 95, weight: 15, actual: 104 },
];
const IT_SET: KpiSeed[] = [
  { code: "CUS-SLA-TICKET", target: 95, threshold: 85, stretch: 100, weight: 30, actual: 96.3 },
  { code: "IPR-BACKLOG", target: 10, threshold: 20, stretch: 5, weight: 25, actual: 12 },
  { code: "LNG-CERT-COMPLETE", target: 100, threshold: 75, stretch: 100, weight: 20, actual: 100 },
  { code: "IPR-INPUT-ERROR", target: 3, threshold: 8, stretch: 1, weight: 15, actual: 2 },
  { code: "CUS-FIRST-RESPONSE", target: 4, threshold: 8, stretch: 2, weight: 10, actual: 3.5 },
];

/** 12 peserta — under-performer: MII00021 (Wahyu Saputra, rating 2). */
const PARTICIPANTS: ParticipantSeed[] = [
  { employeeNo: "MII00009", managerNo: "MII00004", finalScore: 87, finalRating: 4, kpis: HR_SET },
  { employeeNo: "MII00010", managerNo: "MII00004", finalScore: 91, finalRating: 5, kpis: HR_SET },
  { employeeNo: "MII00011", managerNo: "MII00004", finalScore: 78, finalRating: 3, kpis: HR_SET },
  { employeeNo: "MII00012", managerNo: "MII00004", finalScore: 83, finalRating: 4, kpis: HR_SET },
  { employeeNo: "MII00018", managerNo: "MII00005", finalScore: 85, finalRating: 4, kpis: PROD_SET },
  { employeeNo: "MII00019", managerNo: "MII00005", finalScore: 76, finalRating: 3, kpis: PROD_SET },
  { employeeNo: "MII00020", managerNo: "MII00005", finalScore: 89, finalRating: 4, kpis: PROD_SET },
  { employeeNo: "MII00021", managerNo: "MII00005", finalScore: 62, finalRating: 2, kpis: PROD_SET },
  { employeeNo: "MII00022", managerNo: "MII00005", finalScore: 81, finalRating: 4, kpis: PROD_SET },
  { employeeNo: "MII00033", managerNo: "MII00005", finalScore: 74, finalRating: 3, kpis: PROD_SET },
  { employeeNo: "MII00037", managerNo: "MII00007", finalScore: 92, finalRating: 5, kpis: IT_SET },
  { employeeNo: "MII00038", managerNo: "MII00007", finalScore: 84, finalRating: 4, kpis: IT_SET },
];

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

async function seedTenant(c: Client, schemaName: string): Promise<void> {
  // idempoten: sudah ada PER-2025 → skip
  const dup = await c.query<{ id: string }>(
    `SELECT id FROM "PerformanceCycle" WHERE code = 'PER-2025' LIMIT 1`,
  );
  if (dup.rows.length > 0) {
    console.log(`[migrate-performance-p1] ${schemaName}: PER-2025 sudah ada — skip`);
    return;
  }

  // KPI definisi aktif → id per kode
  const defs = await c.query<{ id: string; code: string; polarity: string; unit: string; dataSource: string }>(
    `SELECT id, code, polarity, unit, "dataSource" FROM "KpiDefinition" WHERE status = 'Active'`,
  );
  const defByCode = new Map(defs.rows.map((d) => [d.code, d]));

  // karyawan aktif → id per employeeNo
  const emps = await c.query<{ id: string; employeeNo: string }>(
    `SELECT id, "employeeNo" FROM "Employee" WHERE status = 'Active'`,
  );
  const empByNo = new Map(emps.rows.map((e) => [e.employeeNo, e.id]));
  if (empByNo.size === 0) {
    console.log(`[migrate-performance-p1] ${schemaName}: tanpa karyawan aktif — skip`);
    return;
  }

  // 1 — siklus historis (jendela fase tahun lalu; status Closed)
  const cycleId = `seedper2025${Date.now().toString(36)}`;
  await c.query(
    `INSERT INTO "PerformanceCycle" ("id","code","name","cycleType","periodStart","periodEnd",
      "goalStart","goalEnd","midStart","midEnd","selfStart","selfEnd","mgrStart","mgrEnd",
      "calibStart","calibEnd","publishAt","weightsJson","feedback360","status","createdAt","updatedAt")
     VALUES ($1,'PER-2025','Penilaian Kinerja Tahunan 2025 (historis — sumber salin)','Annual',
      '2025-01-01','2025-12-31','2025-01-06','2025-02-14','2025-06-16','2025-06-30',
      '2025-11-17','2025-11-28','2025-12-01','2025-12-12','2025-12-15','2025-12-19','2025-12-22',
      '{"kpi":70,"competency":20,"core":10}', false, 'Closed', now(), now())`,
    [cycleId],
  );

  // 2 — peserta + baris KPI terkunci (capaian terisi — data historis utuh)
  let seq = 0;
  for (const p of PARTICIPANTS) {
    const empId = empByNo.get(p.employeeNo);
    const mgrId = empByNo.get(p.managerNo);
    if (!empId || !mgrId) continue; // data demo beda tenant — skip baris ini
    seq++;
    const appraisalId = `seedper25a${seq.toString(36)}${Date.now().toString(36).slice(-4)}`;
    await c.query(
      `INSERT INTO "AppraisalRecord" ("id","docNo","cycleId","employeeId","managerId","goalsCopiedFrom",
         "kpiTotalWeight","selfScore","managerScore","finalScore","finalRating","status","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,NULL,100,$6,$6,$7,$8,'Closed',now(),now())`,
      [appraisalId, `PER-2025-${String(seq).padStart(4, "0")}`, cycleId, empId, mgrId,
        p.finalScore, p.finalScore, p.finalRating],
    );
    for (const k of p.kpis) {
      const def = defByCode.get(k.code);
      const kpiId = `seedper25k${seq.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await c.query(
        `INSERT INTO "AppraisalKpi" ("id","appraisalId","kpiDefId","title","polarity","unit",
           "thresholdMin","target","stretchValue","weight","isCritical","dataSource","autoValueJson",
           "midActual","finalActual","proposedBy","origin","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Manager','Fresh',now(),now())`,
        [
          kpiId, appraisalId, def?.id ?? null,
          def ? def.code : k.code, // title ringkas demo: kode pustaka
          def?.polarity ?? "Higher", def?.unit ?? "%",
          k.threshold, k.target, k.stretch, k.weight, k.critical === true,
          def?.dataSource ?? "Manual",
          def?.dataSource != null && def.dataSource !== "Manual"
            ? JSON.stringify({ source: def.dataSource, period: "2025", value: k.actual })
            : null,
          k.actual, // midActual = capaian tengah tahun (demo ringkas)
          k.actual,
        ],
      );
    }
  }

  if (seq === 0) {
    // tidak ada peserta cocok di tenant ini — hapus siklus kosong agar tetap
    // idempoten-bersih (tenant tanpa data MII demo)
    await c.query(`DELETE FROM "PerformanceCycle" WHERE id = $1`, [cycleId]);
    console.log(`[migrate-performance-p1] ${schemaName}: tanpa peserta demo cocok — siklus kosong dibuang`);
    return;
  }
  console.log(`[migrate-performance-p1] ${schemaName}: PER-2025 Closed + ${seq} peserta terkunci OK`);
}

export async function main(schemas?: string[]): Promise<void> {
  const targets = schemas && schemas.length ? schemas : await DEFAULT_SCHEMAS();
  if (!targets.length) return;
  const c = new Client({
    connectionString:
      process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
  });
  await c.connect();
  try {
    for (const schemaName of targets) {
      await c.query(`SET search_path TO "${schemaName}"`);
      await seedTenant(c, schemaName);
    }
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
