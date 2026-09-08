// Migrasi T16-ATTACH ke tenant existing — idempoten:
//   1. CREATE TABLE "Attachment" + "EmployeeDocument" (IF NOT EXISTS)
//   2. indeks (entityType,entityId) / employeeId / expiresAt
//   3. FK EmployeeDocument → Employee (Cascade) & → Attachment (SetNull)
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI: bun scripts/migrate-attachments.ts
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const BASE_URL =
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

async function applyDdl(schemaName: string): Promise<string[]> {
  const out: string[] = [];
  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS "Attachment" (
          "id" TEXT NOT NULL,
          "entityType" TEXT NOT NULL,
          "entityId" TEXT NOT NULL,
          "fileName" TEXT NOT NULL,
          "mimeType" TEXT NOT NULL,
          "sizeBytes" INTEGER NOT NULL,
          "storagePath" TEXT NOT NULL,
          "uploadedBy" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
      );`);
    out.push("tabel Attachment");

    await c.query(`
      CREATE TABLE IF NOT EXISTS "EmployeeDocument" (
          "id" TEXT NOT NULL,
          "employeeId" TEXT NOT NULL,
          "docType" TEXT NOT NULL,
          "docNumber" TEXT,
          "issuedAt" TIMESTAMP(3),
          "expiresAt" TIMESTAMP(3),
          "notes" TEXT,
          "attachmentId" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
      );`);
    out.push("tabel EmployeeDocument");

    await c.query(`CREATE INDEX IF NOT EXISTS "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");`);
    await c.query(`CREATE INDEX IF NOT EXISTS "EmployeeDocument_employeeId_idx" ON "EmployeeDocument"("employeeId");`);
    await c.query(`CREATE INDEX IF NOT EXISTS "EmployeeDocument_expiresAt_idx" ON "EmployeeDocument"("expiresAt");`);
    out.push("3 indeks");

    // FK — hanya buat bila belum ada (cek information_schema, idempoten)
    const fkExists = async (name: string) => {
      const r = await c.query(
        `SELECT 1 FROM information_schema.table_constraints
         WHERE constraint_type = 'FOREIGN KEY' AND constraint_name = $1 AND table_schema = $2`,
        [name, schemaName],
      );
      return r.rowCount === 1;
    };
    if (!(await fkExists("EmployeeDocument_employeeId_fkey"))) {
      await c.query(`ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;`);
      out.push("FK EmployeeDocument→Employee");
    }
    if (!(await fkExists("EmployeeDocument_attachmentId_fkey"))) {
      await c.query(`ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_attachmentId_fkey"
        FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;`);
      out.push("FK EmployeeDocument→Attachment");
    }

    const n = await c.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Attachment"`);
    out.push(`baris Attachment: ${n.rows[0]!.n}`);
    const d = await c.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "EmployeeDocument"`);
    out.push(`baris EmployeeDocument: ${d.rows[0]!.n}`);
  } finally {
    await c.end();
  }
  return out;
}

let steps = 0;

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  steps = 0;
  for (const schema of list) {
  console.log(`\n[${schema}] migrasi T16-ATTACH…`);
  const out = await applyDdl(schema);
  steps += out.length;
  console.log(`  ${out.join(" · ")}`);
  }
  console.log(`\nDONE — ${steps} langkah (idempoten) di ${list.length} tenant`);
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
