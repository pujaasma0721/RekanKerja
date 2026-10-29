// Cleanup P4.1 — hapus semua data uji "Uji P4.1%" (tiket + pesan cascade +
// baris Attachment polimorfik manual + file fisik uploads/).
import { createRequire } from "node:module";
import { existsSync, rmSync } from "node:fs";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const SCHEMA = "tenant_pt_mitra_industri_internasional";
const c = new Client({ connectionString: "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja" });
await c.connect();
try {
  await c.query(`SET search_path TO "${SCHEMA}"`);
  const atts = (await c.query(
    `SELECT a."id", a."storagePath" FROM "Attachment" a
     JOIN "SupportMessage" m ON m."id" = a."entityId" AND a."entityType" = 'SupportMessage'
     JOIN "SupportTicket" t ON t."id" = m."ticketId"
     WHERE t."subject" LIKE 'Uji P4.1%'`,
  )).rows;
  for (const a of atts) {
    await c.query(`DELETE FROM "Attachment" WHERE "id" = $1`, [a.id]);
    try { if (a.storagePath && existsSync(a.storagePath)) rmSync(a.storagePath); } catch {}
  }
  const del = await c.query(`DELETE FROM "SupportTicket" WHERE "subject" LIKE 'Uji P4.1%' RETURNING "ticketNo"`);
  const orphan = (await c.query(
    `SELECT COUNT(*)::int AS n FROM "Attachment" a
     WHERE a."entityType" = 'SupportMessage'
       AND NOT EXISTS (SELECT 1 FROM "SupportMessage" m WHERE m."id" = a."entityId")`,
  )).rows[0].n;
  console.log("[p41-cleanup] tiket dihapus:", del.rows.map((r) => r.ticketNo).join(", ") || "(tidak ada)",
    "| Attachment rows + file fisik dihapus:", atts.length, "| orphan SupportMessage-Attachment tersisa:", orphan);
} finally {
  await c.end();
}
