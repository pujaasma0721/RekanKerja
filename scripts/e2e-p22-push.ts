// Uji E2E P2.2-BM (D-BM17) — WEB PUSH NOTIFICATION (test harness lokal).
// ===========================================================================
// Harness BUKAN browser push nyata: "push service" disimulasikan receiver
// TLS lokal (Bun.serve + sertifikat self-signed ephemeral via openssl —
// web-push SELALU memakai https.request, maka receiver wajib TLS; env
// NODE_TLS_REJECT_UNAUTHORIZED=0 HANYA utk proses skrip ini).
//   (1) SETUP + SEED CONFIG: getPushConfig(MII) self-seed → assert nilai
//       RAW di DB vapidPrivate.startsWith("enc:") (terenkripsi at-rest)
//       + publicKey panjang wajar + decrypt round-trip.
//   (2) SUBSCRIBE: fixture kunci ECDH P-256 acak (node:crypto) →
//       subscribePush → baris DB endpoint/p256dh/auth TERENKRIPSI +
//       endpointHash blind-index ada + idempoten (re-subscribe = 1 baris).
//   (3) KIRIM: sendWebPushToUser → receiver menangkap ≥1 POST: header
//       `authorization` mengandung "vapid" + `ttl` ada + body non-empty
//       (payload terenkripsi aes128gcm). __webpushSend (wrapper tipis)
//       ikut diuji + assert header.
//   (4) INTEGRASI APPROVAL: login ESS yusuf → subscribe kandidat penerima
//       (atasan + fallback Admin/HR) ke receiver → ajukan cuti CT-THN via
//       API → assert Notification approver TERBUAT di DEV SERVER (hook
//       notifyEvent→pushNotification jalan server-side) → jalur PUSH POST
//       deterministik: pushNotification() dipanggil IN-PROCESS utk
//       approver bersubscription → receiver menerima POST.
//       (Deviasi terdoktor: dev server Node menolak TLS self-signed tanpa
//       env — jalur in-process disediakan spesifikasi, "pilih yang
//       deterministik".)
//   (5) OPT-OUT: unsubscribePush → sendWebPushToUser → TIDAK ada POST baru.
//   (6) DEAD SUBSCRIPTION: receiver balas 410 → baris DB terhapus.
//   (7) CLEANUP: subscriptions + notifikasi uji dihapus, cuti ditarik,
//       receiver ditutup (ActivityLog DIPERTAHANKAN — audit trail).
// Jalankan: bun scripts/e2e-p22-push.ts  (server dev :3000 hidup)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // receiver TLS self-signed lokal (skrip saja)
import "./lib/env";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as crypto from "node:crypto";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { primeTenantCrypto, tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import {
  getPushConfig, subscribePush, unsubscribePush, sendWebPushToUser, pushStatusForUser, __webpushSend,
} from "@/rekankerja/shared/services/push-service";
import { pushNotification } from "@/rekankerja/shared/services/notification-service";

const BASE = "http://localhost:3000";
const ESS_EMAIL = "yusuf@mii.co.id";
const ESS_PASSWORD = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST yang ditangkap receiver (url + headers lower-case + body). */
interface CapturedPost { url: string; headers: Record<string, string>; body: Buffer }

/** Tunggu hingga receiver menangkap minimal n POST (poll 50ms). */
async function waitPosts(posts: CapturedPost[], baseline: number, n: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (posts.length - baseline >= n) return posts.length - baseline;
    await sleep(50);
  }
  return posts.length - baseline;
}

let essCookie = "";
async function apiEss(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(essCookie ? { cookie: essCookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) essCookie = setCookie.split(";")[0] ?? "";
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const startedAt = new Date();
  const db = getTenantClient(SCHEMA);
  await primeTenantCrypto(SCHEMA).catch(() => {});
  const tc = tenantCryptoForDb(db);

  // ---------- receiver TLS lokal (self-signed ephemeral) ----------
  const certDir = mkdtempSync(join(tmpdir(), "p22-push-"));
  const keyPath = join(certDir, "key.pem");
  const certPath = join(certDir, "cert.pem");
  const gen = spawnSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
    "-keyout", keyPath, "-out", certPath, "-days", "1", "-nodes",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
  ], { stdio: "pipe" });
  if (gen.status !== 0) {
    console.error("openssl gagal membuat sertifikat uji:", gen.stderr?.toString() ?? "?");
    process.exit(1);
  }
  const posts: CapturedPost[] = [];
  const receiver = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") },
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST") {
        const body = Buffer.from(await req.arrayBuffer());
        const headers: Record<string, string> = {};
        req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
        posts.push({ url: req.url, headers, body });
      }
      // endpoint mati utk uji dead-subscription (404/410 → baris dihapus)
      if (url.pathname === "/dead") return new Response(null, { status: 410 });
      return new Response(null, { status: 201 });
    },
  });
  const EP_LIVE = `https://127.0.0.1:${receiver.port}/push`;
  const EP_APPROVER = `https://127.0.0.1:${receiver.port}/approver`;
  const EP_DEAD = `https://127.0.0.1:${receiver.port}/dead`;
  console.log(`\nreceiver push harness: https://127.0.0.1:${receiver.port}`);

  // fixture kunci ECDH P-256 (browser-style) — p256dh 65 byte + auth 16 byte
  const ecdh = crypto.createECDH("prime256v1");
  const p256dh = Buffer.from(ecdh.generateKeys()).toString("base64url");
  const auth = crypto.randomBytes(16).toString("base64url");

  // ---------- (0) SETUP aktor ----------
  console.log("\n[(0)] SETUP — login ESS + aktor MII");
  const login = await apiEss("POST", "/api/auth/login", { email: ESS_EMAIL, password: ESS_PASSWORD });
  ok(login.status === 200, `login ESS ${ESS_EMAIL}`, `HTTP ${login.status}`);
  const yusufEmp = await db.employee.findFirst({
    where: { fullName: { contains: "Yusuf" } },
    select: { id: true, employeeNo: true },
  });
  ok(!!yusufEmp, "karyawan yusuf ditemukan", yusufEmp?.employeeNo ?? "—");
  // atasan yusuf via assignment aktif (managerId ada di EmployeeAssignment, bukan Employee)
  const mgrAssign = yusufEmp
    ? await db.employeeAssignment.findFirst({
        where: { employeeId: yusufEmp.id, validTo: null },
        orderBy: { validFrom: "desc" },
        select: { managerId: true },
      })
    : null;
  const yusufManagerId = mgrAssign?.managerId ?? null;
  ok(!!yusufManagerId, "atasan yusuf teresolve (assignment aktif)", yusufManagerId ? "ok" : "—");
  const yusufAppUser = await db.appUser.findFirst({ where: { employeeId: yusufEmp?.id }, select: { id: true } });
  ok(!!yusufAppUser, "AppUser yusuf ada (penerima langganan uji)");

  // ---------- (1) SEED CONFIG + AT-REST ----------
  console.log("\n[(1)] getPushConfig — self-seed + kunci TERENKRIPSI at-rest");
  const cfg = await getPushConfig(db);
  ok(!!cfg?.publicKey && !!cfg?.privateKey, "config VAPID ter-resolve (self-seed sukses)");
  const rawCfg = await db.pushConfig.findFirst();
  ok(!!rawCfg, "baris PushConfig ada di DB");
  ok(!!rawCfg?.vapidPrivate?.startsWith("enc:"), "vapidPrivate RAW di DB TERENKRIPSI (enc:…)", (rawCfg?.vapidPrivate ?? "").slice(0, 24));
  ok(typeof rawCfg?.vapidPublic === "string" && rawCfg.vapidPublic.length >= 60 && rawCfg.vapidPublic.length <= 200,
    "publicKey panjang wajar (base64url P-256)", `${rawCfg?.vapidPublic?.length ?? 0} kar`);
  ok(!!cfg && cfg.privateKey.length > 0 && cfg.privateKey !== rawCfg?.vapidPrivate, "decrypt round-trip kunci privat sukses");

  // ---------- (2) SUBSCRIBE — idempoten + terenkripsi ----------
  console.log("\n[(2)] subscribePush — fixture ECDH P-256");
  ok(p256dh.length === 87 && auth.length === 22, "fixture kunci valid (p256dh 87 kar + auth 22 kar)", `p=${p256dh.length} a=${auth.length}`);
  const sub1 = await subscribePush(db, { appUserId: yusufAppUser!.id, endpoint: EP_LIVE, p256dh, auth });
  ok(sub1.ok, "subscribePush → ok", sub1.ok ? sub1.id : sub1.error);
  const rawSub = await db.pushSubscription.findFirst({ where: { appUserId: yusufAppUser!.id } });
  ok(!!rawSub?.endpoint?.startsWith("enc:"), "endpoint RAW di DB TERENKRIPSI (enc:…)", (rawSub?.endpoint ?? "").slice(0, 24));
  ok(!!rawSub?.p256dh?.startsWith("enc:") && !!rawSub?.auth?.startsWith("enc:"), "p256dh + auth RAW TERENKRIPSI");
  ok(!!rawSub?.endpointHash && rawSub.endpointHash.length > 0, "endpointHash blind-index terisi", rawSub?.endpointHash?.slice(0, 14) ?? "—");
  const dup = await subscribePush(db, { appUserId: yusufAppUser!.id, endpoint: EP_LIVE, p256dh, auth });
  ok(dup.ok, "re-subscribe endpoint sama → idempoten (update, bukan baris baru)");
  ok((await db.pushSubscription.count({ where: { appUserId: yusufAppUser!.id } })) === 1, "tepat 1 baris langganan (tidak menumpuk)");
  const st1 = await pushStatusForUser(db, yusufAppUser!.id);
  ok(st1.enabled && st1.subscribed, "pushStatusForUser → enabled + subscribed");

  // ---------- (3) KIRIM — receiver menerima POST VAPID ----------
  console.log("\n[(3)] sendWebPushToUser — POST dgn header VAPID + TTL + body terenkripsi");
  const r3 = await sendWebPushToUser(db, yusufAppUser!.id, { title: "E2e P22 push", body: "Halo dari harness", tag: "e2e" });
  ok(r3.sent === 1, "sendWebPushToUser → sent=1", `sent=${r3.sent} pruned=${r3.pruned}`);
  const n3 = await waitPosts(posts, 0, 1, 5000);
  ok(n3 >= 1, "receiver menangkap ≥1 POST", `${n3} post`);
  const post1 = posts[0];
  ok(!!post1?.headers["authorization"]?.toLowerCase().includes("vapid"), "header authorization mengandung vapid", (post1?.headers["authorization"] ?? "").slice(0, 40));
  ok(!!post1?.headers["ttl"], "header ttl ada", post1?.headers["ttl"]);
  ok((post1?.body?.length ?? 0) > 0, "body non-empty (payload terenkripsi)", `${post1?.body?.length ?? 0} byte`);
  ok(post1?.headers["content-encoding"] === "aes128gcm" || !!post1?.headers["encryption"] || !!post1?.headers["crypto-key"],
    "payload terenkripsi web-push (header crypto terlihat)", post1?.headers["content-encoding"] ?? "?");

  // wrapper tipis __webpushSend (diekspor utk harness) — kirim + assert
  const cfgKeys = { subject: "mailto:hr@rekankerja.local", publicKey: cfg!.publicKey, privateKey: cfg!.privateKey };
  const base3 = posts.length;
  await __webpushSend({ endpoint: EP_LIVE, keys: { p256dh, auth } }, JSON.stringify({ title: "E2e P22 wrapper" }), { vapidDetails: cfgKeys, TTL: 3600 });
  ok((await waitPosts(posts, base3, 1, 4000)) >= 1, "__webpushSend (wrapper tipis) terkirim");
  const postWrap = posts[posts.length - 1]!;
  ok(!!postWrap.headers["authorization"]?.toLowerCase().includes("vapid"), "__webpushSend header vapid", (postWrap.headers["authorization"] ?? "").slice(0, 40));

  // ---------- (4) INTEGRASI APPROVAL ----------
  console.log("\n[(4)] Integrasi approval — ESS ajukan cuti → hook notifikasi → push");
  // kandidat penerima: atasan yusuf + fallback Admin/HR (resolusi nextApprover)
  const managerUsers = yusufManagerId
    ? await db.appUser.findMany({ where: { employeeId: yusufManagerId, active: true }, select: { id: true } })
    : [];
  const adminUsers = await db.appUser.findMany({
    where: { active: true, role: { in: ["Admin", "HR Manager", "HR Staff"] } },
    orderBy: { username: "asc" }, select: { id: true }, take: 10,
  });
  const candidates = Array.from(new Set([...managerUsers.map((u) => u.id), ...adminUsers.map((u) => u.id)])).filter((id) => id !== yusufAppUser?.id);
  ok(candidates.length > 0, "kandidat penerima (atasan + Admin/HR) ditemukan", `${candidates.length} AppUser`);
  for (const cid of candidates) {
    await subscribePush(db, { appUserId: cid, endpoint: EP_APPROVER, p256dh, auth });
  }
  ok((await db.pushSubscription.count({ where: { endpointHash: tc.blindIndex(EP_APPROVER) ?? "" } })) === candidates.length,
    "subscription approver terpasang", `${candidates.length} baris`);

  const leave0 = await apiEss("GET", "/api/rekankerja/ess/leave");
  const thn = (leave0.json?.balances ?? []).find((b: { code: string }) => b.code === "CT-THN");
  ok(!!thn, "jenis cuti CT-THN tersedia (saldo demo)", `sisa=${thn?.available ?? "?"}`);
  const far = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const sub4 = await apiEss("POST", "/api/rekankerja/ess/leave", {
    typeId: thn.typeId, dateFrom: far, dateTo: far, halfDay: false,
    reason: `E2e P2.2 approval push harness ${Date.now()}`,
  });
  ok(sub4.status === 201, "ESS ajukan cuti CT-THN → 201", `HTTP ${sub4.status}${sub4.json?.error ? ` — ${sub4.json.error}` : ""}`);
  const docNo = sub4.json?.docNo ?? "";
  ok(!!docNo, "docNo tergenerasi", docNo);

  // hook server-side: Notification approver TERBUAT oleh DEV SERVER
  // (bukti notifyEvent→pushNotification jalan di proses server dev)
  let notified: { id: string; appUserId: string } | null = null;
  for (let i = 0; i < 30 && !notified; i++) {
    notified = await db.notification.findFirst({
      where: { kind: "leave", title: { contains: docNo } },
      select: { id: true, appUserId: true },
    });
    if (!notified) await sleep(100);
  }
  ok(!!notified, "hook notifikasi approval jalan di DEV SERVER (Notification approver ter-create)");
  ok(!!notified && candidates.includes(notified.appUserId), "penerima notifikasi = kandidat bersubscription (atasan/Admin-HR)");

  // jalur PUSH deterministik (spesifikasi): pushNotification in-process
  // utk approver bersubscription → receiver menerima POST
  const base4 = posts.length;
  const notifId = await pushNotification(db, {
    appUserId: notified!.appUserId,
    title: `Pengajuan cuti ${docNo} menunggu persetujuan Anda`,
    body: "E2e P22 — integrasi approval → web push",
    kind: "leave",
    link: "leave:leave-approval",
  });
  ok(!!notifId, "pushNotification in-process → id notifikasi", notifId ?? "—");
  ok((await waitPosts(posts, base4, 1, 5000)) >= 1, "receiver approver menerima POST (event approval → push)");
  const post4 = posts[posts.length - 1]!;
  ok(!!post4?.headers["authorization"]?.toLowerCase().includes("vapid"), "POST integrasi bawa header vapid", (post4?.headers["authorization"] ?? "").slice(0, 40));
  ok(post4?.url?.includes("/approver"), "POST datang ke endpoint approver", post4?.url?.slice(-16) ?? "?");

  // ---------- (5) OPT-OUT ----------
  console.log("\n[(5)] Opt-out — unsubscribe → tidak ada POST baru");
  const removed = await unsubscribePush(db, { appUserId: yusufAppUser!.id, endpoint: EP_LIVE });
  ok(removed === 1, "unsubscribePush → 1 baris dihapus", `${removed}`);
  const base5 = posts.length;
  const r5 = await sendWebPushToUser(db, yusufAppUser!.id, { title: "E2e P22 setelah opt-out", body: "tidak boleh sampai" });
  await sleep(400);
  ok(posts.length === base5, "TIDAK ada POST baru setelah opt-out", `+${posts.length - base5} post`);
  ok(r5.sent === 0, "sendWebPushToUser pasca opt-out → sent=0", `sent=${r5.sent}`);
  const st5 = await pushStatusForUser(db, yusufAppUser!.id);
  ok(st5.enabled && !st5.subscribed, "status subscribed=false (enabled tetap true)");

  // ---------- (6) DEAD SUBSCRIPTION (410 → prune) ----------
  console.log("\n[(6)] Dead subscription — 410 dari push service → baris dihapus");
  const sub6 = await subscribePush(db, { appUserId: yusufAppUser!.id, endpoint: EP_DEAD, p256dh, auth });
  ok(sub6.ok, "subscribe endpoint mati (receiver akan balas 410)");
  const r6 = await sendWebPushToUser(db, yusufAppUser!.id, { title: "E2e P22 dead", body: "prune aku" });
  ok(r6.pruned === 1, "410 → langganan mati DIBERSIHKAN (pruned=1)", `sent=${r6.sent} pruned=${r6.pruned}`);
  ok((await db.pushSubscription.count({ where: { appUserId: yusufAppUser!.id, endpointHash: tc.blindIndex(EP_DEAD) ?? "" } })) === 0,
    "baris DB langganan mati TERHAPUS");

  // ---------- (7) CLEANUP ----------
  console.log("\n[(7)] CLEANUP — langganan + cuti uji + receiver");
  const hashLive = tc.blindIndex(EP_LIVE) ?? "";
  const hashAppr = tc.blindIndex(EP_APPROVER) ?? "";
  const hashDead = tc.blindIndex(EP_DEAD) ?? "";
  const cleaned = await db.pushSubscription.deleteMany({ where: { endpointHash: { in: [hashLive, hashAppr, hashDead] } } });
  ok(cleaned.count === candidates.length, "semua subscription uji dihapus", `${cleaned.count} baris`);
  ok((await db.pushSubscription.count({ where: { endpointHash: { in: [hashLive, hashAppr, hashDead] } } })) === 0, "DB bersih dari langganan uji");

  // tarik cuti uji (PATCH cancel — pemilik sendiri, status masih Submitted)
  const mine = await apiEss("GET", "/api/rekankerja/ess/leave");
  const mineRow = (mine.json?.requests ?? []).find((r: { docNo: string }) => r.docNo === docNo);
  if (mineRow?.id) {
    const cancel = await apiEss("PATCH", "/api/rekankerja/ess/leave", { id: mineRow.id, note: "E2e P2.2 cleanup" });
    ok(cancel.status === 200, "cuti uji ditarik (cancel)", `HTTP ${cancel.status}`);
  } else {
    ok(false, "cuti uji ditemukan di riwayat ESS utk cancel", docNo);
  }
  await db.notification.deleteMany({ where: { OR: [{ title: { contains: "E2e P22" } }, { title: { contains: docNo } }] } }).catch(() => {});

  receiver.stop(true);
  rmSync(certDir, { recursive: true, force: true });
  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
