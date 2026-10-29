// E2E P4.1 — lampiran cepat: paste (Ctrl+V) & pesan hanya-lampiran.
// Uji jalur API:
//   1) login OWNER MII (hrd@mii.co.id)
//   2) buat tiket uji "Uji P4.1: …"
//   3) POST pesan multipart TANPA teks + 1 file PNG → harus 201 (dulu 400)
//   4) POST pesan kosong total (tanpa teks & file) → harus 400 pesan baru
//   5) GET messages → pesan hanya-lampiran tampil dgn metadata lampiran
//   6) giliran AI → balasan ada (VLM membaca gambar)
//   7) cleanup: tiket + pesan cascade + Attachment rows + file fisik uploads/
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const log = (...a) => console.log("[p41-api]", ...a);

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

// PNG 8x8 merah polos (base64) — lampiran uji.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8z8DwnwEPYMInOXwUAADYgwL9M76Y5AAAAABJRU5ErkJggg==",
  "base64",
);

const c = new Client({ connectionString: "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja" });
await c.connect();

let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; log("LULUS:", name); } else { failed++; log("GAGAL:", name); } };

try {
  await c.query(`SET search_path TO "${SCHEMA}"`);

  // login
  const lg = await api("/api/auth/login", "POST", { email: "hrd@mii.co.id", password: "onevity123" });
  if (lg.status !== 200) throw new Error("login gagal " + lg.status);
  log("login OK");

  // buat tiket uji
  const tk = await api("/api/rekankerja/support/tickets", "POST", { subject: "Uji P4.1: pesan hanya lampiran" });
  const ticketId = tk.j.ticket?.id;
  log("tiket:", tk.j.ticket?.ticketNo);
  check("tiket uji dibuat", !!ticketId);

  // (3) pesan hanya-lampiran — multipart body kosong + file
  {
    const fd = new FormData();
    fd.set("body", "");
    fd.append("files", new File([TINY_PNG], "tangkapan-layar-20261029-101500.png", { type: "image/png" }));
    const r = await fetch(`${BASE}/api/rekankerja/support/tickets/${ticketId}/messages`, {
      method: "POST", body: fd, headers: { cookie },
    });
    const j = await r.json().catch(() => ({}));
    check(`pesan hanya-lampiran → ${r.status} (harus 201)`, r.status === 201 && j.message?.attachments?.length === 1);
    log("  lampiran:", JSON.stringify(j.message?.attachments?.[0]));
  }

  // (4) pesan kosong total → 400
  {
    const fd = new FormData();
    fd.set("body", "");
    const r = await fetch(`${BASE}/api/rekankerja/support/tickets/${ticketId}/messages`, {
      method: "POST", body: fd, headers: { cookie },
    });
    const j = await r.json().catch(() => ({}));
    check(`pesan kosong total → ${r.status} (harus 400)`, r.status === 400 && /tidak boleh kosong/.test(j.error ?? ""));
    log("  error:", j.error);
  }

  // (5) riwayat — pesan hanya-lampiran tampil
  {
    const r = await api(`/api/rekankerja/support/tickets/${ticketId}/messages`);
    const msgs = r.j.messages ?? [];
    const attOnly = msgs.find((m) => m.senderRole === "USER" && !m.body);
    check("riwayat: pesan USER body kosong + 1 lampiran", !!attOnly && attOnly.attachments?.length === 1);
  }

  // (6) giliran AI atas pesan hanya-lampiran
  {
    const r = await api(`/api/rekankerja/support/tickets/${ticketId}/agent`, "POST");
    check(`giliran AI → ${r.status} (harus 201)`, r.status === 201 && !!r.j.message?.body);
    log("  balasan AI:", (r.j.message?.body ?? "").slice(0, 140).replace(/\n/g, " ¶ "));
  }
} catch (e) {
  failed++;
  log("EXCEPTION:", e?.message ?? e);
} finally {
  // ---------- CLEANUP ----------
  try {
    const atts = (await c.query(
      `SELECT a."id", a."storagePath" FROM "Attachment" a
       JOIN "SupportMessage" m ON m."id" = a."entityId" AND a."entityType" = 'SupportMessage'
       JOIN "SupportTicket" t ON t."id" = m."ticketId"
       WHERE t."subject" LIKE 'Uji P4.1%'`,
    )).rows;
    const del = await c.query(`DELETE FROM "SupportTicket" WHERE "subject" LIKE 'Uji P4.1%' RETURNING "ticketNo"`);
    for (const a of atts) {
      try { if (a.storagePath && existsSync(a.storagePath)) rmSync(a.storagePath); } catch {}
    }
    log("cleanup: tiket dihapus:", del.rows.map((r) => r.ticketNo).join(", ") || "(tidak ada)", "| file fisik:", atts.length);
  } catch (e) {
    log("cleanup error:", e?.message);
  }
  await c.end();
  console.log(`[p41-api] HASIL: ${passed} lulus, ${failed} gagal`);
  process.exit(failed > 0 ? 1 : 0);
}
