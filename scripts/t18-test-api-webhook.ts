/// <reference types="bun-types" />
// T18-API — UJI E2E PUBLIC API KEY + WEBHOOK (tenant MII, sandbox) ==========
// ============================================================================
// Menguji ujung-ke-ujung lewat HTTP nyata (dev server port 3000):
//   (a) buat API key via API (bypass UI) → GET /api/public/employees dgn
//       header → 200 (42 karyawan MII); tanpa key 401; key dicabut → 401;
//       scope salah → 403; rate limit 61 hit cepat → 429
//   (b) POST /api/public/leave-requests valid → 201 docNo terbuat
//   (c) webhook → mini listener BUN lokal port 3999 (verifikasi HMAC-SHA256
//       di listener) → trigger leave submit (public) + approve (route
//       internal) → listener terima POST dgn signature benar → WebhookLog Sent
//   (d) listener dimatikan → event berikutnya → WebhookLog Failed
//   (e) cleanup: key + webhook + leave request uji dihapus, listener mati
//
//   bun scripts/t18-test-api-webhook.ts
// ============================================================================
import { createHash, createHmac } from "node:crypto";
import { Client } from "pg";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { listBalances } from "@/rekankerja/leave/services/leave-service";

const BASE = "http://localhost:3000";
const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";
const MII_TENANT_ID = "cmtmzy8uz0001rvfowtkg8tw1"; // diisi otomatis dari login

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label: string, ok: boolean, extra = ""): void {
  console.log(`${ok ? "✓" : "✗ GAGAL"}: ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

// ---------- listener webhook mini (port 3999) ----------
interface Received {
  event: string | null;
  signature: string | null;
  signatureValid: boolean | null; // null = tak bisa diverifikasi (secret tak cocok)
  body: string;
  at: number;
}
const received: Received[] = [];
let listenerSecret: string | null = null;
interface ListenerServer {
  /** Bun.serve handle — stop(force) memutus koneksi aktif (tanda argumen force di beberapa versi tipenya 0-arg). */
  stop: (closeActiveConnections?: boolean) => Promise<void> | void;
}
let listenerServer: ListenerServer | null = null;

async function startListener(): Promise<void> {
  listenerServer = Bun.serve({
    port: 3999,
    fetch: async (req) => {
      const body = await req.text();
      const sig = req.headers.get("x-rekankerja-signature");
      const event = req.headers.get("x-rekankerja-event");
      let signatureValid: boolean | null = null;
      if (sig && listenerSecret) {
        const expect = createHmac("sha256", listenerSecret).update(body, "utf8").digest("hex");
        signatureValid = expect === sig;
      }
      received.push({ event, signature: sig, signatureValid, body, at: Date.now() });
      return Response.json({ ok: true, received: received.length });
    },
  });
}

// ---------- HTTP helper dgn cookie session ----------
let cookie = "";
async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0]!;
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main(): Promise<void> {
  const db = getTenantClient(MII_SCHEMA);
  const pg = new Client({
    connectionString: "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
  });
  await pg.connect();

  // ===== 0. login + pilih tenant MII =====
  console.log("== 0. login sesi admin (hrd@mii.co.id) ==");
  const login = await api("POST", "/api/auth/login", { email: "hrd@mii.co.id", password: "onevity123" });
  check("login 200", login.status === 200, `HTTP ${login.status}`);
  const mii = (login.json.workspaces ?? []).find((w: { slug: string }) => w.slug === "pt-mitra-industri-internasional");
  check("workspace MII ditemukan", !!mii);
  const sel = await api("POST", "/api/auth/select-tenant", { tenantId: mii?.id ?? MII_TENANT_ID });
  check("select-tenant 200", sel.status === 200, `HTTP ${sel.status}`);

  // ===== (a) API key via REST =====
  console.log("== (a) API key & guard public ==");
  const created = await api("POST", "/api/rekankerja/api-keys", {
    name: "T18 E2E Full", scopes: ["employees", "leave", "payroll"],
  });
  check("POST /api/rekankerja/api-keys 201", created.status === 201, `HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 120)}`);
  const fullKey: string = created.json.key ?? "";
  check("kunci format ov_ + 32 hex", /^ov_[0-9a-f]{32}$/.test(fullKey), fullKey.slice(0, 16) + "…");
  check("response membawa prefix & scope", created.json.record?.prefix === fullKey.slice(0, 12) && created.json.record?.scopes?.length === 3);
  // hash bukan kunci asli
  const hashRow = await pg.query(`SELECT "keyHash", prefix FROM "${MII_SCHEMA}"."ApiKey" WHERE id=$1`, [created.json.record.id]);
  const sha256 = createHash("sha256").update(fullKey, "utf8").digest("hex");
  check("DB menyimpan hash SHA-256 (bukan kunci)", hashRow.rows[0]?.keyHash === sha256);

  const emp = await api("GET", "/api/public/employees?limit=200", undefined, { "x-api-key": fullKey });
  check("GET /api/public/employees dgn key → 200", emp.status === 200, `HTTP ${emp.status}`);
  check("format respons { data }", Array.isArray(emp.json?.data?.employees), Object.keys(emp.json ?? {}).join(","));
  const total = emp.json?.data?.total ?? 0;
  check(`GET employees → data 42 karyawan`, total === 42, `total=${total}`);
  const sample = emp.json?.data?.employees?.[0];
  check("field ringkas (employeeNo/nama/unit/posisi/status/joinDate)", !!sample && ["employeeNo", "fullName", "unit", "position", "status", "joinDate"].every((k) => k in sample));

  const noKey = await api("GET", "/api/public/employees");
  check("tanpa key → 401 { error }", noKey.status === 401 && typeof noKey.json?.error === "string", `HTTP ${noKey.status} ${noKey.json?.error ?? ""}`);

  const badKey = await api("GET", "/api/public/employees", undefined, { "x-api-key": "ov_" + "f".repeat(32) });
  check("key tak dikenal → 401", badKey.status === 401, `HTTP ${badKey.status}`);

  // scope salah: kunci employees-only
  const createdLimited = await api("POST", "/api/rekankerja/api-keys", { name: "T18 E2E EmpOnly", scopes: ["employees"] });
  const limitedKey: string = createdLimited.json.key ?? "";
  check("kunci scope tunggal dibuat 201", createdLimited.status === 201);
  const scopeLeave = await api("GET", "/api/public/leave-balances", undefined, { "x-api-key": limitedKey });
  check("scope salah (leave dgn kunci employees) → 403", scopeLeave.status === 403, `HTTP ${scopeLeave.status} — ${scopeLeave.json?.error ?? ""}`);
  const scopePayroll = await api("GET", "/api/public/payroll-periods", undefined, { "x-api-key": limitedKey });
  check("scope salah (payroll) → 403", scopePayroll.status === 403, `HTTP ${scopePayroll.status}`);
  const scopeOk = await api("GET", "/api/public/employees", undefined, { "x-api-key": limitedKey });
  check("scope cocok (employees) → 200", scopeOk.status === 200, `HTTP ${scopeOk.status}`);

  // rate limit: 61 hit cepat dgn key sampah SAMA (jendela per-keyHash 60 dtk)
  let got429 = false;
  const rateKey = "ov_t18rate0000000000000000000000000";
  for (let i = 0; i < 62; i++) {
    const r = await api("GET", "/api/public/employees", undefined, { "x-api-key": rateKey });
    if (r.status === 429) { got429 = true; break; }
  }
  check("rate limit 60 req/menit → 429", got429);

  // detail endpoint (by employeeNo)
  const detail = await api("GET", `/api/public/employees/${emp.json?.data?.employees?.[0]?.employeeNo}`, undefined, { "x-api-key": fullKey });
  check("GET /api/public/employees/{employeeNo} → 200 + assignment", detail.status === 200 && detail.json?.data?.assignment !== undefined, `HTTP ${detail.status}`);
  const detail404 = await api("GET", "/api/public/employees/MII99999", undefined, { "x-api-key": fullKey });
  check("detail karyawan tak ada → 404", detail404.status === 404, `HTTP ${detail404.status}`);

  // ===== (b) POST leave-requests via public API =====
  console.log("== (b) POST /api/public/leave-requests ==");
  // pilih ≤3 pasangan karyawan+jenis BERBEDA dgn saldo ≥2 (hindari bentrok/limit)
  const balances = await listBalances(db, {});
  const usable = balances.filter((b) => b.remaining >= 2 && b.paid);
  check("ada pasangan karyawan+jenis dgn saldo ≥2", usable.length > 0, `${usable.length} kandidat`);
  const byEmp = new Map<string, typeof usable[number]>();
  for (const b of usable) if (!byEmp.has(b.employeeId)) byEmp.set(b.employeeId, b);
  const candidates = [...byEmp.values()].slice(0, 15);
  const pick = candidates[0]!;
  check("kandidat terpilih", !!pick, `${pick?.employeeNo} ${pick?.leaveTypeCode} sisa ${pick?.remaining}`);

  /** Coba kombinasi kandidat × offset-hari sampai 201 (hindari bentrok dgn
   *  data demo / mass leave / akhir pekan). */
  const trySubmit = async (
    list: typeof candidates, dayOffs: number[], reason: string,
  ): Promise<{ status: number; json: any; docNo: string }> => {
    let last: { status: number; json: any } = { status: 0, json: {} };
    for (const dayOff of dayOffs) {
      for (const c of list) {
        const d1 = iso(new Date(new Date(from).getTime() + dayOff * 86_400_000));
        const d2 = iso(new Date(new Date(from).getTime() + (dayOff + 1) * 86_400_000));
        const r = await api("POST", "/api/public/leave-requests", {
          employeeId: c.employeeId, typeId: c.leaveTypeId, dateFrom: d1, dateTo: d2, reason,
        }, { "x-api-key": fullKey });
        last = r;
        if (r.status === 201) return { ...r, docNo: r.json?.data?.docNo ?? "" };
      }
    }
    return { ...last, docNo: "" };
  };

  // Senin–Selasa minggu depan (hari kerja, hindari backdate & bentrok)
  const nextMonday = new Date();
  nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7) + 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = iso(nextMonday);

  const lv = await trySubmit(candidates, [0], "T18 E2E — uji Public API submit");
  check("POST leave-requests → 201 dgn docNo", lv.status === 201 && /^LR-/.test(lv.docNo), `HTTP ${lv.status} ${JSON.stringify(lv.json).slice(0, 160)}`);
  const docNo1: string = lv.docNo;

  // audit ActivityLog aktor apikey:{prefix}
  const auditRows = await pg.query(
    `SELECT detail FROM "${MII_SCHEMA}"."ActivityLog" WHERE entity='PublicApi' AND detail LIKE '%' || $1 || '%' ORDER BY "createdAt" DESC LIMIT 5`,
    [`apikey:${fullKey.slice(0, 12)}`],
  );
  check("ActivityLog audit aktor apikey:{prefix}", auditRows.rows.some((r) => (r.detail ?? "").includes(docNo1) || (r.detail ?? "").includes("leave-requests")), `${auditRows.rows.length} baris`);

  // ===== (c) webhook + listener HMAC =====
  console.log("== (c) webhook → listener lokal 3999 (verifikasi HMAC) ==");
  await startListener();
  const wh = await api("POST", "/api/rekankerja/webhooks", {
    url: "http://127.0.0.1:3999/t18-hook",
    events: ["leave.submitted", "leave.approved", "leave.rejected"],
  });
  check("POST /api/rekankerja/webhooks 201", wh.status === 201, `HTTP ${wh.status} ${JSON.stringify(wh.json).slice(0, 120)}`);
  const webhookId: string = wh.json?.webhook?.id ?? "";
  listenerSecret = wh.json?.webhook?.secret ?? null;
  check("secret webhook auto-generate (whsec_…)", /^whsec_[0-9a-f]{32}$/.test(listenerSecret ?? ""), (listenerSecret ?? "").slice(0, 12) + "…");

  // trigger leave.submitted via PUBLIC API (event sama dgn route internal)
  const rest = candidates.slice(1).length > 0 ? candidates.slice(1) : candidates;
  const lv2 = await trySubmit(rest, [4, 5, 6, 7, 8, 9, 11, 12], "T18 E2E — uji webhook submit");
  const docNo2: string = lv2.docNo;
  check("submit #2 (trigger webhook) → 201", lv2.status === 201, `HTTP ${lv2.status} ${JSON.stringify(lv2.json).slice(0, 140)}`);

  await sleep(1800); // tunggu fire-and-forget dispatch
  const subHit = received.find((r) => r.event === "leave.submitted" && r.body.includes(docNo2));
  check("listener menerima leave.submitted", !!subHit, `${received.length} request diterima`);
  check("signature HMAC-256 VERIFIED di listener", subHit?.signatureValid === true, `sig=${(subHit?.signature ?? "").slice(0, 16)}…`);
  const env = subHit ? JSON.parse(subHit.body) : null;
  check("envelope event/tenant/timestamp/data", !!env && env.event === "leave.submitted" && typeof env.tenant === "string" && typeof env.timestamp === "string" && env.data?.docNo === docNo2, env ? `tenant=${env.tenant}` : "—");
  const logSent = await pg.query(
    `SELECT status, "responseStatus" FROM "${MII_SCHEMA}"."WebhookLog" WHERE "webhookId"=$1 AND event='leave.submitted' ORDER BY "createdAt" DESC LIMIT 1`,
    [webhookId],
  );
  check("WebhookLog leave.submitted → Sent", logSent.rows[0]?.status === "Sent" && logSent.rows[0]?.responseStatus === 200, JSON.stringify(logSent.rows[0] ?? null));

  // trigger approve FINAL via route internal (jenjang di-approve sampai final)
  const req2Id = (await db.leaveRequest.findUnique({ where: { docNo: docNo2 } }))?.id ?? "";
  let finalStatus = "";
  for (let i = 0; i < 5; i++) {
    const dec = await api("PATCH", "/api/rekankerja/leave/requests", { id: req2Id, action: "approve", note: "T18 E2E approve" });
    if (dec.status !== 200) { check(`approve jenjang ${i + 1} 200`, false, `HTTP ${dec.status} ${JSON.stringify(dec.json).slice(0, 120)}`); break; }
    if (!dec.json?.approval) { finalStatus = dec.json?.status ?? ""; break; }
  }
  check("approve sampai FINAL", finalStatus === "Approved", `status=${finalStatus}`);
  await sleep(1800);
  const apprHit = received.find((r) => r.event === "leave.approved" && r.body.includes(docNo2));
  check("listener menerima leave.approved", !!apprHit, `total diterima=${received.length}`);
  check("signature leave.approved VERIFIED", apprHit?.signatureValid === true, `sig=${(apprHit?.signature ?? "").slice(0, 16)}…`);
  const apprLog = await pg.query(
    `SELECT status FROM "${MII_SCHEMA}"."WebhookLog" WHERE "webhookId"=$1 AND event='leave.approved' ORDER BY "createdAt" DESC LIMIT 1`,
    [webhookId],
  );
  check("WebhookLog leave.approved → Sent", apprLog.rows[0]?.status === "Sent", JSON.stringify(apprLog.rows[0] ?? null));

  // ===== (d) listener dimatikan → log Failed =====
  console.log("== (d) listener mati → WebhookLog Failed ==");
  // stop(true) = putuskan juga koneksi keep-alive aktif — tanpa ini fetch
  // undici (dev server) memakai ulang koneksi lama yang masih terbuka dan
  // request "berhasil" meski listener sudah berhenti menerima koneksi baru.
  await listenerServer?.stop(true);
  listenerServer = null;
  const lv3 = await trySubmit(rest, [14, 15, 16, 17, 18, 19, 21, 22], "T18 E2E — uji webhook gagal");
  const docNo3: string = lv3.docNo;
  check("submit #3 (listener mati) → 201", lv3.status === 201, `HTTP ${lv3.status} ${JSON.stringify(lv3.json).slice(0, 140)}`);
  await sleep(6500); // koneksi ditolak instan ATAU menggantung sampai timeout 5 dtk
  const failLog = await pg.query(
    `SELECT status, error FROM "${MII_SCHEMA}"."WebhookLog" WHERE "webhookId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
    [webhookId],
  );
  check("WebhookLog terakhir → Failed (ECONNREFUSED)", failLog.rows[0]?.status === "Failed" && /refus|connect|fetch/i.test(String(failLog.rows[0]?.error)), JSON.stringify(failLog.rows[0] ?? null));

  // submit tetap 201 — webhook never-throw tidak mengganggu bisnis
  check("proses bisnis tetap jalan (fire-and-forget)", lv3.status === 201);

  // ===== key revoked → 401 =====
  console.log("== (a2) revoke → 401 ==");
  const rev = await api("PATCH", "/api/rekankerja/api-keys", { id: created.json.record.id, action: "revoke" });
  check("PATCH revoke 200", rev.status === 200, `HTTP ${rev.status}`);
  await sleep(300);
  const afterRevoke = await api("GET", "/api/public/employees", undefined, { "x-api-key": fullKey });
  check("kunci dicabut → 401", afterRevoke.status === 401, `HTTP ${afterRevoke.status} — ${afterRevoke.json?.error ?? ""}`);
  const lastUsedRow = await pg.query(`SELECT "lastUsedAt" FROM "${MII_SCHEMA}"."ApiKey" WHERE id=$1`, [created.json.record.id]);
  check("lastUsedAt terisi", !!lastUsedRow.rows[0]?.lastUsedAt, String(lastUsedRow.rows[0]?.lastUsedAt ?? "null"));

  // ===== (e) CLEANUP =====
  console.log("== (e) cleanup ==");
  // hapus webhook (+ log cascade)
  const delWh = await api("DELETE", `/api/rekankerja/webhooks?id=${webhookId}`);
  check("webhook uji dihapus", delWh.status === 200, `HTTP ${delWh.status}`);
  // hapus kunci uji (hard delete)
  await pg.query(`DELETE FROM "${MII_SCHEMA}"."ApiKey" WHERE id = ANY($1)`, [[created.json.record.id, createdLimited.json.record.id].filter(Boolean)]);
  const keysLeft = await pg.query(`SELECT count(*)::int n FROM "${MII_SCHEMA}"."ApiKey"`);
  check("kunci uji 0 tersisa", keysLeft.rows[0].n === 0, `n=${keysLeft.rows[0].n}`);
  // hapus leave request uji + chain + langkah + notifikasi terkait
  const docNos = [docNo1, docNo2, docNo3].filter(Boolean);
  for (const d of docNos) {
    const r = await db.leaveRequest.findUnique({ where: { docNo: d }, select: { id: true } });
    if (!r) continue;
    await pg.query(`DELETE FROM "${MII_SCHEMA}"."ApprovalStep" WHERE "chainId" IN (SELECT id FROM "${MII_SCHEMA}"."ApprovalChain" WHERE "docType"='Leave' AND "docId"=$1)`, [r.id]);
    await pg.query(`DELETE FROM "${MII_SCHEMA}"."ApprovalChain" WHERE "docType"='Leave' AND "docId"=$1`, [r.id]);
    await pg.query(`DELETE FROM "${MII_SCHEMA}"."Notification" WHERE title LIKE '%' || $1 || '%'`, [d]);
    await pg.query(`DELETE FROM "${MII_SCHEMA}"."LeaveRequest" WHERE id=$1`, [r.id]);
  }
  const lrLeft = await pg.query(`SELECT count(*)::int n FROM "${MII_SCHEMA}"."LeaveRequest" WHERE reason LIKE 'T18 E2E%'`);
  check("leave request uji 0 tersisa", lrLeft.rows[0].n === 0, `n=${lrLeft.rows[0].n}`);
  const wlLeft = await pg.query(`SELECT count(*)::int n FROM "${MII_SCHEMA}"."WebhookLog"`);
  check("WebhookLog 0 tersisa (cascade)", wlLeft.rows[0].n === 0, `n=${wlLeft.rows[0].n}`);
  check("listener 3999 dimatikan", listenerServer === null);

  // ringkasan signature utk bukti laporan
  if (subHit) {
    console.log("\n===== BUKTI WEBHOOK =====");
    console.log("POST http://127.0.0.1:3999/t18-hook");
    console.log("X-RekanKerja-Event: leave.submitted");
    console.log(`X-RekanKerja-Signature: ${subHit.signature}`);
    console.log(`Body: ${subHit.body.slice(0, 220)}…`);
    console.log(`HMAC-SHA256(secret=${listenerSecret?.slice(0, 14)}…, body) === signature → ${subHit.signatureValid}`);
  }

  await pg.end();
  console.log(`\n${failures === 0 ? "SEMUA UJI LULUS" : `${failures} UJI GAGAL`} (T18-API)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
