// Migrasi F9-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F9 — Compliance
// Hardening UU PDP) ke tenant existing — idempoten:
//   1. CREATE TABLE IF NOT EXISTS DataSubjectRequest + index + FK.
//   2. Demo MII (insert-only bila DSR kosong): 1 DSR Export ter-Completed
//      (Siti — paket terunduh) + 1 DSR Erase New (Agus Outdated — target
//      retensi) supaya inbox Kepatuhan langsung bisa didemokan.
import "./lib/env";
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'New',
    "note" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "resultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
  )`,
];

const AFTER_TABLE: string[] = [
  `CREATE INDEX IF NOT EXISTS "DataSubjectRequest_status_dueAt_idx" ON "DataSubjectRequest"("status", "dueAt")`,
  `CREATE INDEX IF NOT EXISTS "DataSubjectRequest_applicantId_idx" ON "DataSubjectRequest"("applicantId")`,
  `ALTER TABLE "DataSubjectRequest" DROP CONSTRAINT IF EXISTS "DataSubjectRequest_applicantId_fkey"`,
  `ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "DataSubjectRequest" DROP CONSTRAINT IF EXISTS "DataSubjectRequest_handledById_fkey"`,
  `ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

async function seedDemoF9(schema: string): Promise<string> {
  const db = getTenantClient(schema);
  const existing = await db.dataSubjectRequest.count();
  if (existing > 0) return "";

  const hrdUser = await db.appUser.findFirst({ where: { email: "hrd@mii.co.id" }, select: { employeeId: true } });
  const hrdEmployeeId = hrdUser?.employeeId ?? null;
  if (!hrdEmployeeId) return "";

  const days = (n: number) => new Date(Date.now() + n * 86400000);

  // Siti (Employed) minta ekspor data → sudah ditangani (ter-Completed)
  const siti = await db.applicant.findFirst({ where: { firstName: "Siti" }, select: { id: true, applicantNo: true } });
  if (siti) {
    await db.dataSubjectRequest.create({
      data: {
        applicantId: siti.id,
        type: "Export",
        status: "Completed",
        note: "Permintaan ekspor data pribadi via email (hak akses UU PDP Pasal 7).",
        dueAt: days(7),
        handledById: hrdEmployeeId,
        handledAt: new Date(),
        resultNote: "Paket data (JSON + CSV) diunduh & dikirim ke email pelamar — ter-audit ActivityLog.",
      },
    });
  }

  // Agus (Outdated — kandidat retensi) minta penghapusan → New (menunggu)
  const agus = await db.applicant.findFirst({ where: { firstName: "Agus" }, select: { id: true } });
  if (agus) {
    await db.dataSubjectRequest.create({
      data: {
        applicantId: agus.id,
        type: "Erase",
        status: "New",
        note: "Permintaan penghapusan data pribadi (hak hapus UU PDP Pasal 9).",
        dueAt: days(7),
      },
    });
  }

  return "DSR demo: 1 Export Completed (Siti) + 1 Erase New (Agus)";
}

// ============ main ============

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f9] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    try {
      await c.connect();
      console.log(`  ${schemaName}:`);
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        await c.query(ddl);
      }
      console.log(`    tabel F9 siap (DataSubjectRequest)`);

      if (schemaName.includes("mitra_industri")) {
        const demo = await seedDemoF9(schemaName);
        if (demo) console.log(`    demo: ${demo}`);
      }
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
