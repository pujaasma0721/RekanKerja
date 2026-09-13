// Task 64b — WageComponent.prorateBasis: basis prorata per komponen
// ===========================================================================
// null/"Calendar" = hari kalender (perilaku lama); "WorkingDays" = hari kerja
// sesuai jadwal attendance (WorkSchedule cycle + overlay libur; fallback
// Sen–Jum tanpa jadwal). Fresh tenant sudah punya kolom via tenant-ddl.sql;
// tenant existing ditambahkan di sini (idempoten: cek information_schema).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU dijalankan CLI.
import "./lib/env";
import { Client } from "pg";
import { tenantSchemas } from "../src/onevity/shared/lib/parity-runner";

const TENANT_URL = () =>
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas?.length ? schemas : await tenantSchemas();
  if (list.length === 0) {
    console.log("[prorate-basis] belum ada tenant — lewati");
    return;
  }
  const c = new Client({ connectionString: TENANT_URL() });
  await c.connect();
  try {
    for (const schema of list) {
      await c.query(`SET search_path TO "${schema}"`);
      const exists = await c.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'WageComponent' AND column_name = 'prorateBasis'`,
        [schema],
      );
      if (exists.rowCount === 0) {
        await c.query(`ALTER TABLE "WageComponent" ADD COLUMN "prorateBasis" TEXT`);
        console.log(`[${schema}] kolom WageComponent.prorateBasis ditambahkan`);
      } else {
        console.log(`[${schema}] kolom WageComponent.prorateBasis sudah ada (idempoten)`);
      }
    }
  } finally {
    await c.end();
  }
}

// CLI mandiri: npx tsx scripts/migrate-wage-component-prorate-basis.ts
if (process.argv[1] && process.argv[1].includes("migrate-wage-component-prorate-basis")) {
  main().then(
    () => process.exit(0),
    (e) => { console.error(e); process.exit(1); },
  );
}

export {};
