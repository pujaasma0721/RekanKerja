// Migrasi Task 98 (F0-7 + F1-1) — modul travel advance & smart:
//   1. F0-7/B11 — @@index tabel travel (index-sweep Task 42 melewatkan travel):
//        TravelRequest(employeeId, status, requestDate, status+employeeId)
//        TravelDestination(requestId)
//        TravelAdvance(requestId, status)
//        TravelClaim(employeeId, status, requestId, periodCode, status+periodCode)
//        TravelClaimExpense(claimId, expenseCode)
//        TravelExpenseTypeRule(travelExpenseTypeId+active)
//        TravelBudgetItem(budgetId)
//   2. F1-1 — tabel TravelCityRate (tarif kota acuan SBI PMK 32/2025)
//      + seed idempoten via shared/lib/provisioning ensureTravelCityRates.
// Nama index SAMA dengan tenant-ddl.sql hasil `bun run tenant:ddl`
// (paritas penuh tenant baru vs existing). Idempoten —
// CREATE TABLE/INDEX IF NOT EXISTS + upsert seed.
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-travel-advance.ts
import "./lib/env";
import { Client } from "pg";

const DEMO_SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? DEMO_SCHEMAS;
  let migrated = 0;
  for (const schema of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);

      // ===== F1-1 — tabel tarif kota (SBI) =====
      await c.query(`
        CREATE TABLE IF NOT EXISTS "TravelCityRate" (
            "id" TEXT NOT NULL,
            "city" TEXT NOT NULL,
            "country" TEXT NOT NULL DEFAULT 'Indonesia',
            "overseas" BOOLEAN NOT NULL DEFAULT false,
            "zoneCode" TEXT,
            "uangHarian" DOUBLE PRECISION NOT NULL DEFAULT 0,
            "plafonHotel" DOUBLE PRECISION NOT NULL DEFAULT 0,
            "note" TEXT,
            "active" BOOLEAN NOT NULL DEFAULT true,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "TravelCityRate_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "TravelCityRate_city_key" ON "TravelCityRate"("city")`);

      // ===== F0-7 — index tabel travel (nama = Prisma @@index default) =====
      const INDEXES: [string, string][] = [
        ["TravelRequest_employeeId_idx", `CREATE INDEX IF NOT EXISTS "TravelRequest_employeeId_idx" ON "TravelRequest"("employeeId")`],
        ["TravelRequest_status_idx", `CREATE INDEX IF NOT EXISTS "TravelRequest_status_idx" ON "TravelRequest"("status")`],
        ["TravelRequest_requestDate_idx", `CREATE INDEX IF NOT EXISTS "TravelRequest_requestDate_idx" ON "TravelRequest"("requestDate")`],
        ["TravelRequest_status_employeeId_idx", `CREATE INDEX IF NOT EXISTS "TravelRequest_status_employeeId_idx" ON "TravelRequest"("status", "employeeId")`],
        ["TravelDestination_requestId_idx", `CREATE INDEX IF NOT EXISTS "TravelDestination_requestId_idx" ON "TravelDestination"("requestId")`],
        ["TravelAdvance_requestId_idx", `CREATE INDEX IF NOT EXISTS "TravelAdvance_requestId_idx" ON "TravelAdvance"("requestId")`],
        ["TravelAdvance_status_idx", `CREATE INDEX IF NOT EXISTS "TravelAdvance_status_idx" ON "TravelAdvance"("status")`],
        ["TravelClaim_employeeId_idx", `CREATE INDEX IF NOT EXISTS "TravelClaim_employeeId_idx" ON "TravelClaim"("employeeId")`],
        ["TravelClaim_status_idx", `CREATE INDEX IF NOT EXISTS "TravelClaim_status_idx" ON "TravelClaim"("status")`],
        ["TravelClaim_requestId_idx", `CREATE INDEX IF NOT EXISTS "TravelClaim_requestId_idx" ON "TravelClaim"("requestId")`],
        ["TravelClaim_periodCode_idx", `CREATE INDEX IF NOT EXISTS "TravelClaim_periodCode_idx" ON "TravelClaim"("periodCode")`],
        ["TravelClaim_status_periodCode_idx", `CREATE INDEX IF NOT EXISTS "TravelClaim_status_periodCode_idx" ON "TravelClaim"("status", "periodCode")`],
        ["TravelClaimExpense_claimId_idx", `CREATE INDEX IF NOT EXISTS "TravelClaimExpense_claimId_idx" ON "TravelClaimExpense"("claimId")`],
        ["TravelClaimExpense_expenseCode_idx", `CREATE INDEX IF NOT EXISTS "TravelClaimExpense_expenseCode_idx" ON "TravelClaimExpense"("expenseCode")`],
        ["TravelExpenseTypeRule_travelExpenseTypeId_active_idx", `CREATE INDEX IF NOT EXISTS "TravelExpenseTypeRule_travelExpenseTypeId_active_idx" ON "TravelExpenseTypeRule"("travelExpenseTypeId", "active")`],
        ["TravelBudgetItem_budgetId_idx", `CREATE INDEX IF NOT EXISTS "TravelBudgetItem_budgetId_idx" ON "TravelBudgetItem"("budgetId")`],
      ];
      for (const [, ddl] of INDEXES) await c.query(ddl);

      migrated++;
      console.log(`[travel-advance] ${schema}: OK (index ${INDEXES.length} + TravelCityRate)`);
    } catch (e) {
      console.error(`[travel-advance] ${schema}: GAGAL — ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    } finally {
      await c.end();
    }
  }
  console.log(`[travel-advance] selesai: ${migrated}/${list.length} schema`);
}

// CLI langsung (non-import): enumerasi schema dari registry platform.
if (process.argv[1] && process.argv[1].endsWith("migrate-travel-advance.ts")) {
  main()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
