// Migrasi P7-PERFORMANCE (DEVELOPMENT-PLAN-PERFORMANCE.md §20 P7; §28 alur 4)
// — DEMO data MII (kanon E2E §21-5): DUA evaluasi masa percobaan. Karyawan
// percobaan = penempatan aktif employmentStatus "Probation" (MII00014 Joko
// Ramadhan + MII00035 Budi Lubis — catatan: Employee.status tidak punya nilai
// "Probation"; sinyal percobaan hidup di EmployeeAssignment, jadi TIDAK ada
// mutasi data diperlukan). PRB-0001 Open (jatuh tempo H+10 — jendela H-14
// scheduler) + PRB-0002 Assessed (skor atasan 78, 4 kriteria — siap
// direkomendasikan). Idempoten per docNo. Hanya tenant MII.
import "./lib/env";
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const MII = "tenant_pt_mitra_industri_internasional";
const YEAR = new Date().getFullYear();

const CRITERIA_3 = [
  { title: "Penguasaan tugas & kualitas kerja", weight: 40 },
  { title: "Kepatuhan SOP & disiplin", weight: 30 },
  { title: "Kolaborasi & komunikasi tim", weight: 30 },
];
const CRITERIA_4 = [
  { title: "Penguasaan tugas & kualitas kerja", weight: 30 },
  { title: "Kepatuhan SOP & disiplin", weight: 25 },
  { title: "Kolaborasi & komunikasi tim", weight: 20 },
  { title: "Inisiatif & kecepatan belajar", weight: 25 },
];

export async function main(schemas?: string[]): Promise<void> {
  const list = (schemas && schemas.length > 0 ? schemas : (await platform.tenant.findMany({ select: { schemaName: true } })).map((t) => t.schemaName).filter(Boolean).sort())
    .filter((s) => s.includes("mitra_industri")); // demo hanya MII
  if (list.length === 0) { console.log("[migrate-performance-p7] tidak ada tenant MII — lewati"); return; }
  console.log(`[migrate-performance-p7] schema: ${list.join(", ")}`);
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    const schemaName = list[0];

    // karyawan percobaan: penempatan aktif employmentStatus = "Probation"
    const prob = await c.query(
      `SELECT e.id, e."employeeNo", e."fullName" FROM "${schemaName}"."Employee" e
       JOIN "${schemaName}"."EmployeeAssignment" a ON a."employeeId" = e.id AND a."validTo" IS NULL
       WHERE a."employmentStatus" = 'Probation' ORDER BY e."employeeNo"`,
    );
    if (prob.rowCount === 0) {
      console.log("  tidak ada karyawan ber-penempatan Probation — lewati (butuh seed HR base)");
      return;
    }
    const emp1 = prob.rows[0] as { id: string; employeeNo: string; fullName: string };
    const emp2 = (prob.rows[1] ?? prob.rows[0]) as { id: string; employeeNo: string; fullName: string };

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = (days: number) => new Date(today.getTime() + days * 24 * 3600 * 1000);

    // PRB-0001 — Open, jatuh tempo H+10 (jendela H-14 scheduler hidup)
    const doc1 = `PRB-${YEAR}-0001`;
    const has1 = await c.query(`SELECT id FROM "${schemaName}"."ProbationEvaluation" WHERE "docNo" = $1`, [doc1]);
    if (has1.rowCount) {
      console.log(`  ${doc1} sudah ada — lewati`);
    } else {
      await c.query(
        `INSERT INTO "${schemaName}"."ProbationEvaluation"
          (id, "docNo", "employeeId", "onboardingId", "cycleId", "dueDate", "criteriaJson", "managerScore", "hrNote", "recommendation", "decisionDate", "personnelActionId", status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, NULL, NULL, $3, $4, NULL, NULL, NULL, NULL, NULL, 'Open', now(), now())`,
        [doc1, emp1.id, due(10), JSON.stringify(CRITERIA_3)],
      );
      await c.query(
        `INSERT INTO "${schemaName}"."ActivityLog" (id, "actorType", action, entity, "entityId", "employeeId", "personnelActionId", detail, "createdAt")
         VALUES (gen_random_uuid()::text, 'system', 'Created', 'ProbationEvaluation', $1, $2, NULL, $3, now())`,
        [
          // entityId join ke evaluasi lewat docNo tunggal — ambil ulang id baris
          (await c.query(`SELECT id FROM "${schemaName}"."ProbationEvaluation" WHERE "docNo" = $1`, [doc1])).rows[0].id,
          emp1.id,
          `Demo P7: evaluasi masa percobaan ${doc1} dibuat utk ${emp1.fullName} (${emp1.employeeNo}) — status Open, 3 kriteria Σbobot 100, jatuh tempo H+10 (jendela H-14 scheduler) — seed-demo`,
        ],
      );
      console.log(`  ${doc1} dibuat (Open) — ${emp1.fullName}, jatuh tempo H+10, 3 kriteria Σ100`);
    }

    // PRB-0002 — Assessed (skor atasan 78, 4 kriteria), jatuh tempo H+25
    const doc2 = `PRB-${YEAR}-0002`;
    const has2 = await c.query(`SELECT id FROM "${schemaName}"."ProbationEvaluation" WHERE "docNo" = $1`, [doc2]);
    if (has2.rowCount) {
      console.log(`  ${doc2} sudah ada — lewati`);
    } else {
      await c.query(
        `INSERT INTO "${schemaName}"."ProbationEvaluation"
          (id, "docNo", "employeeId", "onboardingId", "cycleId", "dueDate", "criteriaJson", "managerScore", "hrNote", "recommendation", "decisionDate", "personnelActionId", status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, NULL, NULL, $3, $4, 78, NULL, NULL, NULL, NULL, 'Assessed', now(), now())`,
        [doc2, emp2.id, due(25), JSON.stringify(CRITERIA_4)],
      );
      await c.query(
        `INSERT INTO "${schemaName}"."ActivityLog" (id, "actorType", action, entity, "entityId", "employeeId", "personnelActionId", detail, "createdAt")
         VALUES (gen_random_uuid()::text, 'system', 'Processed', 'ProbationEvaluation', $1, $2, NULL, $3, now())`,
        [
          (await c.query(`SELECT id FROM "${schemaName}"."ProbationEvaluation" WHERE "docNo" = $1`, [doc2])).rows[0].id,
          emp2.id,
          `Demo P7: penilaian atasan evaluasi percobaan ${doc2} utk ${emp2.fullName} (${emp2.employeeNo}) — skor 78/100 atas 4 kriteria Σbobot 100 (status Assessed, siap direkomendasikan) — seed-demo`,
        ],
      );
      console.log(`  ${doc2} dibuat (Assessed, skor 78) — ${emp2.fullName}, jatuh tempo H+25, 4 kriteria Σ100`);
    }
  } finally {
    await c.end();
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
