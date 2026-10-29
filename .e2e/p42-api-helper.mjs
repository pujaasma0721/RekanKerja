// E2E P4.2 helper — kirim pesan user + picu giliran AI via API (sesi curl
// terpisah, user sama: hrd) untuk menguji pill "Pesan baru" & auto-scroll
// di browser yang sedang membaca riwayat (scroll ke atas).
// Pakai: bun .e2e/p42-api-helper.mjs <ticketId> "pesan"
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const BASE = "http://localhost:3000";
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

const ticketId = process.argv[2];
const text = process.argv[3] ?? "Pesan uji dari sesi lain (P4.2)";
if (!ticketId) { console.error("pakai: bun p42-api-helper.mjs <ticketId> [pesan]"); process.exit(1); }

const lg = await api("/api/auth/login", "POST", { email: "hrd@mii.co.id", password: "onevity123" });
if (lg.status !== 200) { console.error("login gagal", lg.status); process.exit(1); }

// kirim pesan multipart (body + tanpa file)
const fd = new FormData();
fd.set("body", text);
const r1 = await fetch(`${BASE}/api/rekankerja/support/tickets/${ticketId}/messages`, {
  method: "POST", body: fd, headers: { cookie },
});
console.log("[p42-helper] pesan →", r1.status);
if (r1.status !== 201) { console.error(await r1.text()); process.exit(1); }
