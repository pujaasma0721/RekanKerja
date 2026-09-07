// Task 27-b smoke cleanup — hapus aset uji AST-0009 + penugasan + activity log
import { Client } from "pg";

const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
await c.connect();
try {
  await c.query(`SET search_path TO "tenant_pt_mitra_industri_internasional"`);
  const del = await c.query(`DELETE FROM "AssetAssignment" WHERE "assetId" IN (SELECT id FROM "Asset" WHERE code = 'AST-0009')`);
  const del2 = await c.query(`DELETE FROM "Asset" WHERE code = 'AST-0009'`);
  const del3 = await c.query(`DELETE FROM "ActivityLog" WHERE "entity" = 'Asset' AND "entityId" NOT IN (SELECT id FROM "Asset")`);
  const del4 = await c.query(`DELETE FROM "ActivityLog" WHERE "entity" = 'AssetAssignment' AND "entityId" NOT IN (SELECT id FROM "AssetAssignment")`);
  console.log(`assignment: ${del.rowCount}, asset: ${del2.rowCount}, log Asset: ${del3.rowCount}, log AA: ${del4.rowCount}`);
  const left = await c.query(`SELECT code, status FROM "Asset" ORDER BY code`);
  console.log("sisa aset:", left.rows.map((r: { code: string }) => r.code).join(", "));
} finally {
  await c.end();
}
