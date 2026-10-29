// E2E tambahan P4 — jalur KONFLIK (hash beda) & TOLAK via API, lalu cleanup
// seluruh data uji P4 (tiket + usulan + file demo).
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const DEMO = "/home/z/my-project/scripts/tmp-p4-demo.ts";
const log = (...a) => console.log("[p4-api]", ...a);

let cookie = "";
async function api(path, method = "GET", body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

const c = new Client({ connectionString: "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja" });
await c.connect();

try {
  // login
  const lg = await api("/api/auth/login", "POST", { email: "hrd@mii.co.id", password: "onevity123" });
  if (lg.status !== 200) throw new Error("login gagal " + lg.status);
  log("login OK (tenant:", lg.j.tenant?.name + ")");

  // buat tiket uji
  const tk = await api("/api/rekankerja/support/tickets", "POST", { subject: "Uji P4 API: konflik & tolak" });
  if (tk.status !== 201 && tk.status !== 200) throw new Error("buat tiket gagal " + tk.status + " " + JSON.stringify(tk.j));
  const ticketId = tk.j.ticket?.id;
  log("tiket:", tk.j.ticket?.ticketNo, ticketId);

  // proposal #1 — baseHash SALAH (simulasi file berubah sejak usulan)
  const wrongHash = "deadbeef".repeat(8);
  await c.query(`SET search_path TO "${SCHEMA}"`);
  const p1 = await c.query(
    `INSERT INTO "SupportPatchProposal" ("id","ticketId","filePath","description","diffText","replacementsJson","baseHash","baseLineCount","status","createdAt","updatedAt")
     VALUES ($3,$1,'scripts/tmp-p4-demo.ts','uji konflik — hash basis salah','--- a/scripts/tmp-p4-demo.ts','[]',$2,12,'MENUNGGU',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING "id"`,
    [ticketId, wrongHash, randomUUID()],
  );
  const id1 = p1.rows[0].id;
  const dec1 = await api(`/api/rekankerja/support/tickets/${ticketId}/patches`, "POST", { proposalId: id1, decision: "approve", note: "harus konflik" });
  const st1 = (await c.query(`SELECT "status" FROM "SupportPatchProposal" WHERE "id"=$1`, [id1])).rows[0].status;
  log("approve hash-salah → HTTP", dec1.status, "| status DB:", st1, dec1.status === 409 && st1 === "KONFLIK" ? "(LULUS)" : "(GAGAL)");

  // proposal #2 — valid, tapi akan DITOLAK
  const cur = readFileSync(DEMO, "utf8");
  const goodHash = createHash("sha256").update(cur, "utf8").digest("hex");
  const p2 = await c.query(
    `INSERT INTO "SupportPatchProposal" ("id","ticketId","filePath","description","diffText","replacementsJson","baseHash","baseLineCount","status","createdAt","updatedAt")
     VALUES ($3,$1,'scripts/tmp-p4-demo.ts','uji tolak — tidak jadi','--- a/scripts/tmp-p4-demo.ts','[]',$2,12,'MENUNGGU',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING "id"`,
    [ticketId, goodHash, randomUUID()],
  );
  const id2 = p2.rows[0].id;
  const dec2 = await api(`/api/rekankerja/support/tickets/${ticketId}/patches`, "POST", { proposalId: id2, decision: "reject", note: "Bukan prioritas" });
  const st2 = (await c.query(`SELECT "status","decidedByName","decisionNote" FROM "SupportPatchProposal" WHERE "id"=$1`, [id2])).rows[0];
  const sysMsg = (await c.query(`SELECT "body" FROM "SupportMessage" WHERE "ticketId"=$1 AND "senderRole"='SYSTEM' ORDER BY "createdAt" DESC LIMIT 2`, [ticketId])).rows;
  log("reject → HTTP", dec2.status, "| status DB:", st2.status, "| oleh:", st2.decidedByName, "| catatan:", st2.decisionNote);
  log("pesan SYSTEM terakhir:", JSON.stringify(sysMsg.map((r) => r.body.slice(0, 90))));
  const ok2 = dec2.status === 200 && st2.status === "DITOLAK" && sysMsg.some((r) => /DITOLAK oleh/.test(r.body));
  log("jalur TOLAK:", ok2 ? "LULUS" : "GAGAL");

  // duplikat keputusan → 409
  const dec3 = await api(`/api/rekankerja/support/tickets/${ticketId}/patches`, "POST", { proposalId: id2, decision: "approve" });
  log("keputusan ulang atas usulan sudah diputus → HTTP", dec3.status, dec3.status === 409 ? "(LULUS)" : "(GAGAL)");
} finally {
  // ---------- CLEANUP seluruh data uji P4 ----------
  const del = await c.query(
    `DELETE FROM "SupportTicket" WHERE "subject" LIKE 'Uji P4%' RETURNING "ticketNo"`,
  );
  console.log("[p4-api] cleanup: tiket dihapus:", del.rows.map((r) => r.ticketNo).join(", ") || "(tidak ada)");
  const sisa = await c.query(`SELECT COUNT(*)::int AS n FROM "SupportPatchProposal"`);
  console.log("[p4-api] sisa usulan patch di schema MII:", sisa.rows[0].n, "(harus 0 — ter-cascade)");
  await c.end();
}
