// Migrasi T15-CHAIN-EXT — Lembur & Klaim Travel ke mesin approval berjenjang:
//   1. kolom AttendanceRule.maxOvertimeHours (default 4 — PP 35/2021) +
//      maxOvertimeHoursMonthly (opsional, NULL = tanpa cap) × tenant existing;
//   2. struktur approval baru (idempoten — skip bila docType sudah punya struktur):
//      AS-OT-STD        docType Overtime    : ATASAN_LANGSUNG + P-HRM (HR Manager)
//      AS-TRVLCLAIM-STD docType TravelClaim : ATASAN_LANGSUNG + P-FIN ≥15jt + P-HRD ≥50jt
//        (nominal = totalSettlement klaim; tenant referensi tanpa posisi →
//         jenjang nominal di-skip, level 1 atasan langsung tetap dibuat)
//   3. backfill chain dokumen existing (pola migrate-approval-structure):
//      OvertimeOrder Pending → chain baru; final (Approved/Paid/Rejected/Cancelled)
//        → chain + difinalkan sesuai status
//      TravelClaim Submitted → chain baru (amount = totalSettlement); final
//        (Approved/Transferred/Paid/Rejected/Cancelled) → chain + difinalkan
// Jalankan: bun run scripts/migrate-t15-ot-claim.ts
import { Client } from "pg";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { startApprovalChain } from "@/onevity/shared/services/approval-engine";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

/** ADD COLUMN idempoten (cek information_schema) — pola migrate-t5-ta. */
async function addColumns(schemaName: string): Promise<number> {
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);
    const cols: { table: string; column: string; ddl: string }[] = [
      { table: "AttendanceRule", column: "maxOvertimeHours", ddl: 'INTEGER NOT NULL DEFAULT 4' },
      { table: "AttendanceRule", column: "maxOvertimeHoursMonthly", ddl: 'INTEGER' },
    ];
    let added = 0;
    for (const { table, column, ddl } of cols) {
      const has = await c.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
        [schemaName, table, column],
      );
      if (has.rowCount === 0) {
        await c.query(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddl}`);
        added++;
      }
    }
    return added;
  } finally {
    await c.end();
  }
}

/** AS-OT-STD — Overtime: ATASAN_LANGSUNG + P-HRM (fallback HR_ADMIN). Idempoten. */
async function ensureOvertimeStructure(db: TenantDb): Promise<boolean> {
  if (await db.approvalStructure.findFirst({ where: { docType: "Overtime" } })) return false;
  const hrm = await db.position.findFirst({ where: { code: "P-HRM" }, select: { id: true } });
  await db.approvalStructure.create({
    data: {
      code: "AS-OT-STD", name: "Persetujuan Perintah Lembur", docType: "Overtime",
      levels: {
        create: [
          { levelNo: 1, approverType: "ATASAN_LANGSUNG" },
          hrm
            ? { levelNo: 2, approverType: "POSISI", approverPositionId: hrm.id, note: "HR Manager" }
            : { levelNo: 2, approverType: "HR_ADMIN" },
        ],
      },
    },
  });
  return true;
}

/** AS-TRVLCLAIM-STD — TravelClaim: ATASAN_LANGSUNG + P-FIN ≥15jt + P-HRD ≥50jt.
 *  Jenjang nominal dibuat hanya bila posisi ada (tenant referensi tanpa posisi
 *  → cukup atasan langsung). Idempoten. */
async function ensureTravelClaimStructure(db: TenantDb): Promise<boolean> {
  if (await db.approvalStructure.findFirst({ where: { docType: "TravelClaim" } })) return false;
  const fin = await db.position.findFirst({ where: { code: "P-FIN" }, select: { id: true } });
  const hrd = await db.position.findFirst({ where: { code: "P-HRD" }, select: { id: true } });
  const levels: {
    levelNo: number; approverType: string; approverPositionId?: string | null;
    minAmount?: number | null; maxAmount?: number | null; note?: string | null;
  }[] = [{ levelNo: 1, approverType: "ATASAN_LANGSUNG" }];
  let levelNo = 2;
  if (fin) {
    levels.push({ levelNo: levelNo++, approverType: "POSISI", approverPositionId: fin.id, minAmount: 15_000_000, note: "≥ Rp 15 jt: Finance Manager" });
  }
  if (hrd) {
    levels.push({ levelNo: levelNo++, approverType: "POSISI", approverPositionId: hrd.id, minAmount: 50_000_000, note: "≥ Rp 50 jt: HR Director" });
  }
  await db.approvalStructure.create({
    data: {
      code: "AS-TRVLCLAIM-STD", name: "Persetujuan Klaim Travel (Settlement)", docType: "TravelClaim",
      levels: { create: levels },
    },
  });
  return true;
}

/** Backfill chain Overtime + TravelClaim (pola backfillChains Task 25). */
async function backfillChains(db: TenantDb): Promise<{ created: number; finalized: number }> {
  const now = new Date();
  let created = 0;
  let finalized = 0;

  const finalize = async (docType: string, docId: string, docStatus: string) => {
    const chain = await db.approvalChain.findUnique({ where: { docType_docId: { docType, docId } }, select: { id: true, status: true, totalLevels: true } });
    if (!chain || chain.status !== "InProgress") return;
    if (docStatus === "Rejected" || docStatus === "Cancelled") {
      await db.approvalStep.updateMany({ where: { chainId: chain.id, status: "Current" }, data: { status: docStatus, decidedBy: "Backfill migrasi", decidedAt: now } });
      await db.approvalChain.update({ where: { id: chain.id }, data: { status: docStatus, completedAt: now } });
    } else {
      // dokumen sudah final-approve (Approved/Paid/Transferred)
      await db.approvalStep.updateMany({ where: { chainId: chain.id }, data: { status: "Approved", decidedBy: "Backfill migrasi", decidedAt: now } });
      await db.approvalChain.update({ where: { id: chain.id }, data: { status: "Approved", currentLevel: chain.totalLevels, completedAt: now } });
    }
    finalized++;
  };

  // Overtime (tanpa nominal)
  const orders = await db.overtimeOrder.findMany({ select: { id: true, employeeId: true, status: true } });
  for (const o of orders) {
    const before = await db.approvalChain.findUnique({ where: { docType_docId: { docType: "Overtime", docId: o.id } } });
    if (!before) {
      await startApprovalChain(db, { docType: "Overtime", docId: o.id, employeeId: o.employeeId, createdBy: "backfill" });
      created++;
    }
    if (o.status !== "Pending") await finalize("Overtime", o.id, o.status);
  }

  // TravelClaim (nominal = totalSettlement)
  const claims = await db.travelClaim.findMany({ select: { id: true, employeeId: true, status: true, totalSettlement: true } });
  for (const cl of claims) {
    const before = await db.approvalChain.findUnique({ where: { docType_docId: { docType: "TravelClaim", docId: cl.id } } });
    if (!before) {
      await startApprovalChain(db, {
        docType: "TravelClaim", docId: cl.id, employeeId: cl.employeeId,
        amount: cl.totalSettlement, createdBy: "backfill",
      });
      created++;
    }
    if (cl.status !== "Submitted") await finalize("TravelClaim", cl.id, cl.status);
  }

  return { created, finalized };
}

// ============ main ============

for (const schema of SCHEMAS) {
  console.log(`\n[${schema}] migrasi T15 lembur + klaim travel berjenjang…`);
  const cols = await addColumns(schema);
  console.log(`  AttendanceRule: ${cols} kolom baru (maxOvertimeHours default 4, maxOvertimeHoursMonthly)`);
  const db = getTenantClient(schema);
  const ot = await ensureOvertimeStructure(db);
  if (ot) console.log("  Struktur Overtime: AS-OT-STD dibuat (ATASAN_LANGSUNG + P-HRM/HR_ADMIN)");
  const tc = await ensureTravelClaimStructure(db);
  if (tc) console.log("  Struktur TravelClaim: AS-TRVLCLAIM-STD dibuat (ATASAN_LANGSUNG + P-FIN ≥15jt + P-HRD ≥50jt)");
  const chains = await backfillChains(db);
  console.log(`  Chain backfill: ${chains.created} dibuat, ${chains.finalized} difinalkan`);
  await db.$disconnect();
}
console.log("\nDONE");
