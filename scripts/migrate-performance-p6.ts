// Migrasi P6-PERFORMANCE (DEVELOPMENT-PLAN-PERFORMANCE.md §20 P6; §33 alur 9) —
// DEMO data MII (kanon E2E §21-5): SATU draf PipPlan utk Ayu Yulianti
// (PER-2026-0008 — rating 1, usul PIP terbuka dari tab Merit), durasi 2 bulan,
// 3 target manufaktur Σbobot 100, pembina = atasan assignment aktifnya,
// checkpoint +20/+40/+60 hari. Idempoten per docNo. Hanya tenant MII.
import "./lib/env";
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const MII = "tenant_pt_mitra_industri_internasional";
const YEAR = new Date().getFullYear();

const TARGETS = [
  { title: "Kualitas produk — defect rate", metric: "Defect rate line produksi", target: "≤ 1.5%", weight: 40 },
  { title: "Kepatuhan SOP produksi", metric: "Audit kepatuhan SOP", target: "100% langkah SOP", weight: 30 },
  { title: "Produktivitas line", metric: "Output per shift", target: "≥ 95% standar output", weight: 30 },
];

export async function main(schemas?: string[]): Promise<void> {
  const list = (schemas && schemas.length > 0 ? schemas : (await platform.tenant.findMany({ select: { schemaName: true } })).map((t) => t.schemaName).filter(Boolean).sort())
    .filter((s) => s.includes("mitra_industri")); // demo hanya MII
  if (list.length === 0) { console.log("[migrate-performance-p6] tidak ada tenant MII — lewati"); return; }
  console.log(`[migrate-performance-p6] schema: ${list.join(", ")}`);
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    const schemaName = list[0];
    const docNo = `PIP-${YEAR}-0001`;
    const already = await c.query(`SELECT id FROM "${schemaName}"."PipPlan" WHERE "docNo" = $1`, [docNo]);
    if (already.rowCount) { console.log(`  ${docNo} sudah ada — lewati`); return; }

    // peserta: appraisal PER-2026-0008 (Ayu Yulianti — rating ≤2 pasca Closed)
    const appr = await c.query(
      `SELECT a.id, a."employeeId", a."finalRating" FROM "${schemaName}"."AppraisalRecord" a WHERE a."docNo" = $1`,
      [`PER-${YEAR}-0008`],
    );
    if (!appr.rowCount) { console.log(`  PER-${YEAR}-0008 tidak ditemukan — lewati (seed P5?)`); return; }
    const employeeId = appr.rows[0].employeeId as string;

    // pembina: atasan assignment aktif karyawan
    const mgr = await c.query(
      `SELECT a."managerId" FROM "${schemaName}"."EmployeeAssignment" a WHERE a."employeeId" = $1 AND a."validTo" IS NULL AND a."managerId" IS NOT NULL ORDER BY a."validFrom" DESC LIMIT 1`,
      [employeeId],
    );
    const reviewerId = (mgr.rows[0]?.managerId as string | undefined) ?? null;
    if (!reviewerId) { console.log("  atasan aktif tidak ditemukan — lewati"); return; }

    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 24 * 3600 * 1000);
    const due = [20, 40, 60].map((d) => new Date(start.getTime() + d * 24 * 3600 * 1000));

    const pip = await c.query(
      `INSERT INTO "${schemaName}"."PipPlan"
        (id, "docNo", "employeeId", "appraisalId", "startDate", "endDate", "targetsJson", "reviewerId", "hrAdvisorId", status, "outcomeNotes", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NULL, 'Draft', NULL, now(), now())
       RETURNING id`,
      [docNo, employeeId, appr.rows[0].id, start, end, JSON.stringify(TARGETS), reviewerId],
    );
    const pipId = pip.rows[0].id as string;
    for (let i = 0; i < 3; i++) {
      await c.query(
        `INSERT INTO "${schemaName}"."PipCheckpoint" (id, "pipId", seq, "dueDate", "achievementPct", notes, status, "reviewedById", "reviewedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, NULL, NULL, 'Pending', NULL, NULL)`,
        [pipId, i + 1, due[i]],
      );
    }
    await c.query(
      `INSERT INTO "${schemaName}"."ActivityLog" (id, "actorType", action, entity, "entityId", "employeeId", "personnelActionId", detail, "createdAt")
       VALUES (gen_random_uuid()::text, 'system', 'Created', 'PipPlan', $1, $2, NULL, $3, now())`,
      [pipId, employeeId, `Demo P6: draf PIP ${docNo} dibuat (dari penilaian PER-${YEAR}-0008 rating ${appr.rows[0].finalRating}) — 3 target Σbobot 100, durasi 2 bln, 3 checkpoint +20/+40/+60 hari — seed-demo`],
    );
    console.log(`  ${docNo} dibuat (Draft) — 3 target Σ100, pembina terpasang, 3 checkpoint`);
  } finally {
    await c.end();
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
