// QA-SCALING-SUPPORT-100T — teardown artefak load test. =======================
//   · DROP 97 schema tenant_load_tenant_001..097 (CASCADE — tabel ikut hilang)
//   · hapus baris platform: Tenant/User/UserTenant/SupportEntitlement/
//     SupportUsageLog milik slug load-tenant-*
//   · hapus tiket "Loadtest 100T" di 3 tenant demo (pesan ikut cascade)
// Jalankan: bun scripts/qa/12-support-100t-teardown.ts
import "../lib/env";
import { Client } from "pg";

const URL = process.env.PLATFORM_DB_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja";
const pad = (i: number) => String(i).padStart(3, "0");

async function main() {
  const c = new Client({ connectionString: URL });
  await c.connect();

  const tenants = await c.query("SELECT id, slug FROM \"Tenant\" WHERE slug LIKE 'load-tenant-%'");
  console.log(`tenant load ditemukan: ${tenants.rows.length}`);

  for (let i = 1; i <= 97; i++) {
    const schema = `tenant_load_tenant_${pad(i)}`;
    await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
  console.log("97 schema di-drop");

  if (tenants.rows.length) {
    const ids = tenants.rows.map((r: any) => r.id);
    const ph = ids.map((_: unknown, k: number) => `$${k + 1}`).join(",");
    const del = async (table: string) => {
      const r = await c.query(`DELETE FROM "${table}" WHERE "tenantId" = ANY($1::text[])`, [ids]);
      console.log(`  ${table}: ${r.rowCount} baris dihapus`);
    };
    await del("SupportUsageLog");
    await del("SupportEntitlement");
    await c.query(`DELETE FROM "UserTenant" WHERE "tenantId" = ANY($1::text[])`, [ids]);
    await c.query(`DELETE FROM "Tenant" WHERE id = ANY($1::text[])`, [ids]);
    // user platform load — email domain khusus
    const u = await c.query(`DELETE FROM "User" WHERE email LIKE 'load%@loadtest.local'`);
    console.log(`  User load: ${u.rowCount} dihapus`);
  }

  // tiket load-test di 3 tenant demo — hapus penuh (pesan cascade)
  for (const s of [
    "tenant_pt_mitra_industri_internasional",
    "tenant_cahaya_digital_nusantara",
    "tenant_sentra_logistik_prima",
  ]) {
    const r = await c.query(`DELETE FROM "${s}"."SupportTicket" WHERE subject LIKE 'Loadtest 100T%'`);
    console.log(`  tiket load-test di ${s}: ${r.rowCount} dihapus`);
  }

  const total = await c.query('SELECT count(*)::int AS n FROM "Tenant"');
  console.log(`== SELESAI — tenant tersisa: ${total.rows[0].n} ==`);
  await c.end();
}

main().catch((e) => {
  console.error("TEARDOWN GAGAL:", e);
  process.exit(1);
});
