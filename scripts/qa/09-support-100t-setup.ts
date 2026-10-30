// QA-SCALING-SUPPORT-100T — setup 100 tenant utk load test support service. =====
// ==============================================================================
// Skenario user: 100 tenant, case berbeda-beda, dikirim BERSAMAAN. Setup ini
// memprovisi 97 tenant tambahan (load-tenant-001..097) di samping 3 tenant demo
// (MII/Cahaya/Sentra) → total 100. Per tenant load:
//   · schema penuh via provisionTenantSchema (TANPA seed referensi payroll —
//     support service tidak butuh; hemat waktu setup);
//   · platform: Tenant ACTIVE + User (password LoadTest123!) + UserTenant OWNER
//     + SupportEntitlement ACTIVE (kuota 1000);
//   · tenant: AppUser (role "HR Staff" → menu scope default-deny) + 1 tiket
//     support + greeting AI + 1 pesan USER siap-balas (untuk uji giliran agent).
// Idempoten: tenant yang sudah ada di-skip. Cleanup: 10-teardown.
// Jalankan: bun scripts/qa/09-support-100t-setup.ts
import "../lib/env";
import { randomBytes, scryptSync } from "node:crypto";
import { Client } from "pg";
import { provisionTenantSchema } from "@/rekankerja/shared/lib/provisioning";

const PLATFORM_URL = process.env.PLATFORM_DB_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja";
const N = Number(process.env.LOAD_N ?? 97);
const PASSWORD = "LoadTest123!";
const CONCURRENCY = Number(process.env.LOAD_CONC ?? 6);

function scryptHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

const pad = (i: number) => String(i).padStart(3, "0");
const cuid = () => "c" + randomBytes(12).toString("hex");

interface Row { i: number; slug: string; schema: string; email: string }

async function setupOne(row: Row, pc: Client): Promise<void> {
  const { i, slug, schema, email } = row;
  const exists = await pc.query('SELECT id FROM "Tenant" WHERE slug=$1', [slug]);
  if (exists.rowCount) {
    console.log(`[${pad(i)}] sudah ada — skip`);
    return;
  }
  const t0 = Date.now();
  await provisionTenantSchema(schema);

  const tenantId = cuid();
  const userId = cuid();
  const appUserId = cuid();
  const ticketId = cuid();
  const name = `Load Tenant ${pad(i)}`;
  const uname = `load${pad(i)}`;

  await pc.query("BEGIN");
  try {
    await pc.query(
      `INSERT INTO "Tenant" (id, name, slug, "schemaName", plan, status, "updatedAt")
       VALUES ($1,$2,$3,$4,'trial','ACTIVE',now())`,
      [tenantId, name, slug, schema],
    );
    await pc.query(
      `INSERT INTO "User" (id, email, name, "passwordHash", "isSuperadmin", "failedAttempts", "sessionVersion", "updatedAt")
       VALUES ($1,$2,$3,$4,false,0,0,now())`,
      [userId, email, `Load User ${pad(i)}`, scryptHash(PASSWORD)],
    );
    await pc.query(
      `INSERT INTO "UserTenant" (id, "userId", "tenantId", role) VALUES ($1,$2,$3,'OWNER')`,
      [cuid(), userId, tenantId],
    );
    await pc.query(
      `INSERT INTO "SupportEntitlement" (id, "tenantId", status, "monthlyTurnQuota", notes, "activatedAt", "updatedAt")
       VALUES ($1,$2,'ACTIVE',1000,'qa-100t',now(),now())`,
      [cuid(), tenantId],
    );
    await pc.query(`SET search_path TO "${schema}"`);
    try {
      await pc.query(
        `INSERT INTO "AppUser" (id, username, "fullName", email, role, active)
         VALUES ($1,$2,$3,$4,'HR Staff',true)`,
        [appUserId, uname, `Load User ${pad(i)}`, email],
      );
      await pc.query(
        `INSERT INTO "SupportTicket" (id, "ticketNo", subject, category, priority, status, "createdById", "createdByName", "lastMessageAt", "updatedAt")
         VALUES ($1,$2,$3,'LAINNYA','SEDANG','AKTIF',$4,$5,now(),now())`,
        [ticketId, `LT-${pad(i)}`, `Pertanyaan penggunaan aplikasi ${pad(i)}`, appUserId, `Load User ${pad(i)}`],
      );
      await pc.query(
        `INSERT INTO "SupportMessage" (id, "ticketId", "senderRole", "senderName", body)
         VALUES ($1,$2,'AI','Support AI',$3), ($4,$2,'USER',$5,$6)`,
        [
          cuid(), ticketId,
          "Halo! Saya Support AI — layanan dukungan RekanKerja yang siap membantu Anda.",
          cuid(), `Load User ${pad(i)}`,
          `Halo, saya pengguna workspace ${name}. Saya ingin bertanya bagaimana cara melihat riwayat slip gaji saya di aplikasi? Terima kasih.`,
        ],
      );
    } finally {
      await pc.query("SET search_path TO public");
    }
    await pc.query("COMMIT");
  } catch (e) {
    await pc.query("ROLLBACK").catch(() => {});
    throw e;
  }
  console.log(`[${pad(i)}] OK ${Date.now() - t0}ms`);
}

async function main() {
  const pc = new Client({ connectionString: PLATFORM_URL });
  await pc.connect();
  const total = await pc.query('SELECT count(*)::int AS n FROM "Tenant"');
  console.log(`Tenant sekarang: ${total.rows[0].n} — menambah ${N} (target ${total.rows[0].n + N})`);

  const rows: Row[] = Array.from({ length: N }, (_, k) => {
    const i = k + 1;
    const slug = `load-tenant-${pad(i)}`;
    return { i, slug, schema: `tenant_${slug.replace(/-/g, "_")}`, email: `load${pad(i)}@loadtest.local` };
  });

  const t0 = Date.now();
  let done = 0;
  const queue = [...rows];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    // satu koneksi pg per worker (search_path di-mutasi — jangan share koneksi)
    const wc = new Client({ connectionString: PLATFORM_URL });
    await wc.connect();
    for (;;) {
      const row = queue.shift();
      if (!row) break;
      await setupOne(row, wc);
      done++;
    }
    await wc.end();
  });
  await Promise.all(workers);

  const after = await pc.query('SELECT count(*)::int AS n FROM "Tenant"');
  console.log(`== SELESAI: ${done} tenant baru dalam ${Math.round((Date.now() - t0) / 1000)}s — total ${after.rows[0].n} tenant ==`);
  await pc.end();
}

main().catch((e) => {
  console.error("SETUP GAGAL:", e);
  process.exit(1);
});
