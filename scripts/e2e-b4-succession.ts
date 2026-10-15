// Uji E2E API B4 (Succession Planning — Talent) per
// DEVELOPMENT-PLAN-BACKLOG.md §4 B4 / D-BL13…D-BL15 — di atas data demo MII
// (login owner hrd@mii.co.id; ESS yusuf@mii.co.id):
//   (b) upsertPosition utk Position "Accountant" (id via db) → 200; duplikat
//       positionId → 409.
//   (c) suggest → rows ber-suggested9Box + saran readiness + flightRisk
//       number; TIDAK memuat pemegang jabatan (Joko MII00014 — pemegang
//       assignment aktif TERBARU).
//   (d) addCandidate Tuti MII00013 (readiness dari saran) → 200 + snapshot
//       (2/5 — Tidak Konsisten, flightRisk 42 — deterministik B3); duplikat →
//       409; pemegang jabatan → 400.
//   (e) updateCandidate readiness ReadyNow + devNotes → 200; refreshAllRisk →
//       flightRisk ter-refresh (nilai > 0).
//   (f) coverage: target=2 dgn 1 ReadyNow → 1/2 belum; kandidat kedua
//       ReadyNow (Tuti Iskandar MII00028) → 2/2 ok.
//   (g) deletePosition dgn kandidat → 409; removeCandidate semua →
//       deletePosition → 200.
//   (h) exportXlsx lang id & en → 200 + magic PK + filename "succession" +
//       nama sheet dwibahasa (verifikasi via exceljs load).
//   (i) ESS yusuf POST talent ops (upsertPosition/addCandidate/exportXlsx)
//       → 403 menu guard.
// Cleanup semua data uji di akhir. Jalankan: bun scripts/e2e-b4-succession.ts
import "./lib/env";
import * as fs from "node:fs";
import * as ExcelJS from "exceljs";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
const ESS_YUSUF = "yusuf@mii.co.id";
const ESS_YUSUF_PW = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie masing-masing) + dukungan binary. */
class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown, asBinary = false): Promise<{ status: number; json: any; buf: Buffer | null; headers: Headers }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    if (asBinary) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, json: null, buf, headers: res.headers };
    }
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, buf: null, headers: res.headers };
  }
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const owner = new Sesi();
  const yusuf = new Sesi();

  console.log("\n[(b)] REGISTER PERAN — upsertPosition + guard duplikat");
  const login = await owner.api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);

  const accountant = await db.position.findFirstOrThrow({ where: { title: "Accountant" }, select: { id: true, title: true } });
  const joko = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00014" }, select: { id: true, fullName: true } });
  const tuti = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00013" }, select: { id: true, fullName: true } });
  const tutiIskandar = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00028" }, select: { id: true, fullName: true } });
  // sanity via db: pemegang jabatan Accountant (assignment aktif TERBARU) = Joko
  const incumbentAsg = await db.employeeAssignment.findFirst({
    where: { positionId: accountant.id, validTo: null },
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
    select: { employeeId: true },
  });
  ok(incumbentAsg?.employeeId === joko.id, "pemegang jabatan Accountant (aktif terbaru via db) = Joko MII00014");

  const created = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "upsertPosition", positionId: accountant.id, critical: true, targetSuccessors: 2, note: "e2e b4",
  });
  ok(created.status === 200 && created.json?.id, "upsertPosition Accountant (critical, target 2) → 200 + id", `HTTP ${created.status}`);
  ok(created.json?.positionTitle === "Accountant" && created.json?.incumbentName === joko.fullName
    && Array.isArray(created.json?.candidates) && created.json?.coverage?.target === 2,
    "register ter-load: title + incumbent + candidates[] + coverage", JSON.stringify(created.json?.coverage));
  const succId = created.json?.id as string;

  const dupe = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "upsertPosition", positionId: accountant.id,
  });
  ok(dupe.status === 409, "duplikat positionId → 409 (satu register per posisi)", `HTTP ${dupe.status}`);

  // ================= (c) SARAN KANDIDAT (D-BL13) =================
  console.log("\n[(c)] SUGGEST — saran 9-box + readiness + flightRisk; tanpa pemegang");
  const sug = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "suggest", positionId: accountant.id,
  });
  ok(sug.status === 200 && Array.isArray(sug.json?.rows) && sug.json.rows.length > 0 && sug.json.rows.length <= 20,
    "suggest → 200 + rows 1..20", `HTTP ${sug.status}, rows=${sug.json?.rows?.length}`);
  const sugRows = (sug.json?.rows ?? []) as Record<string, any>[];
  ok(sugRows.every((r) => typeof r.flightRisk === "number" && r.flightRisk >= 0 && r.flightRisk <= 100),
    "tiap saran ber-flightRisk number 0–100 (D-BL10 via attritionRiskOf)",
    `contoh=${sugRows[0]?.employeeNo} risk=${sugRows[0]?.flightRisk}`);
  const READINESS_SET = ["ReadyNow", "Ready1yr", "Ready23yr", "Development"];
  ok(sugRows.every((r) => READINESS_SET.includes(r.suggestedReadiness)),
    "tiap saran ber-suggestedReadiness salah satu dari 4 nilai (D-BL13)");
  ok(sugRows.every((r) => r.suggested9Box == null || /^([1-5])\/5 — /.test(r.suggested9Box)),
    "suggested9Box berformat \"<rating>/5 — <sel>\" atau null (belum terpetakan)",
    `contoh=${sugRows[0]?.suggested9Box ?? "null"}`);
  ok(!sugRows.some((r) => r.employeeId === joko.id), "suggest TIDAK memuat pemegang jabatan (Joko MII00014)");
  const sugTuti = sugRows.find((r) => r.employeeId === tuti.id);
  ok(sugTuti != null && sugTuti.suggested9Box === "2/5 — Tidak Konsisten" && sugTuti.suggestedReadiness === "Development",
    "Tuti MII00013 ada dgn saran 9-box \"2/5 — Tidak Konsisten\" (r=2 p=2) + readiness Development",
    JSON.stringify({ box: sugTuti?.suggested9Box, readiness: sugTuti?.suggestedReadiness, risk: sugTuti?.flightRisk }));

  // ================= (d) TAMBAH KANDIDAT + GUARD =================
  console.log("\n[(d)] ADD CANDIDATE — snapshot otomatis + guard duplikat/pemegang");
  const add = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "addCandidate", successionPositionId: succId, employeeId: tuti.id, readiness: sugTuti?.suggestedReadiness,
  });
  ok(add.status === 200 && add.json?.id, "addCandidate Tuti (readiness dari saran) → 200", `HTTP ${add.status}`);
  ok(add.json?.suggested9Box === "2/5 — Tidak Konsisten" && add.json?.flightRisk === 42,
    "snapshot otomatis saat ditambahkan: 9-box \"2/5 — Tidak Konsisten\" + flightRisk 42 (deterministik B3)",
    JSON.stringify({ box: add.json?.suggested9Box, risk: add.json?.flightRisk }));
  const candId = add.json?.id as string;

  const addDupe = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "addCandidate", successionPositionId: succId, employeeId: tuti.id,
  });
  ok(addDupe.status === 409, "duplikat kandidat (peran+karyawan sama) → 409", `HTTP ${addDupe.status}`);
  const addIncumbent = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "addCandidate", successionPositionId: succId, employeeId: joko.id,
  });
  ok(addIncumbent.status === 400, "tambah pemegang jabatan (Joko) → 400 (bukan penerus perannya sendiri)", `HTTP ${addIncumbent.status}`);

  // ================= (e) UBAH + REFRESH RISIKO =================
  console.log("\n[(e)] UPDATE + REFRESH ALL RISK");
  const upd = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "updateCandidate", id: candId, readiness: "ReadyNow", devNotes: "Mentoring rotasi Finance Q3 + sertifikasi pajak",
  });
  ok(upd.status === 200 && upd.json?.readiness === "ReadyNow" && typeof upd.json?.devNotes === "string",
    "updateCandidate readiness ReadyNow + devNotes → 200", `HTTP ${upd.status}`);
  const refAll = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "refreshAllRisk", successionPositionId: succId,
  });
  const afterRef = await db.successorCandidate.findUniqueOrThrow({ where: { id: candId }, select: { flightRisk: true } });
  ok(refAll.status === 200 && refAll.json?.refreshed >= 1, "refreshAllRisk → 200 + jumlah kandidat di-refresh", `HTTP ${refAll.status}, refreshed=${refAll.json?.refreshed}`);
  ok(typeof afterRef.flightRisk === "number" && afterRef.flightRisk > 0,
    "flightRisk ter-update di db pasca-refresh (nilai > 0)", `flightRisk=${afterRef.flightRisk}`);

  // ================= (f) COVERAGE =================
  console.log("\n[(f)] COVERAGE — 1/2 → tambah kandidat kedua ReadyNow → 2/2");
  let list = await owner.api("GET", "/api/rekankerja/performance/talent?succession=1");
  let row = ((list.json?.positions ?? []) as Record<string, any>[]).find((p) => p.id === succId);
  ok(list.status === 200 && row?.coverage?.readyNow === 1 && row?.coverage?.target === 2 && row?.coverage?.ok === false,
    "coverage tampil 1/2 ReadyNow (belum terpenuhi)", JSON.stringify(row?.coverage));

  const add2 = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "addCandidate", successionPositionId: succId, employeeId: tutiIskandar.id, readiness: "ReadyNow",
  });
  ok(add2.status === 200, "tambah kandidat kedua (Tuti Iskandar, ReadyNow manual) → 200", `HTTP ${add2.status}`);
  list = await owner.api("GET", "/api/rekankerja/performance/talent?succession=1");
  row = ((list.json?.positions ?? []) as Record<string, any>[]).find((p) => p.id === succId);
  ok(row?.coverage?.readyNow === 2 && row?.coverage?.target === 2 && row?.coverage?.ok === true,
    "coverage 2/2 → terpenuhi (hijau)", JSON.stringify(row?.coverage));
  const candIds = (row?.candidates ?? []).map((c: Record<string, any>) => c.id as string);
  ok(candIds.length === 2, "register memuat 2 kandidat", `n=${candIds.length}`);

  // ringkasan succession di GET talent default (overview — server-side)
  const summary = await owner.api("GET", "/api/rekankerja/performance/talent");
  ok(summary.status === 200 && summary.json?.succession?.positions === 1 && summary.json?.succession?.candidates === 2
    && summary.json?.succession?.uncovered === 0,
    "GET talent default menyertakan ringkasan succession {positions,candidates,uncovered} (overview)",
    JSON.stringify(summary.json?.succession));

  // ================= (g) DELETE GUARD + HAPUS =================
  console.log("\n[(g)] DELETE — guard kandidat → bersih → 200");
  const delWithCand = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "deletePosition", id: succId,
  });
  ok(delWithCand.status === 409, "deletePosition dgn kandidat → 409 (guard eksplisit, bukan cascade)", `HTTP ${delWithCand.status}`);
  for (const cid of candIds) {
    const rm = await owner.api("POST", "/api/rekankerja/performance/talent", { action: "removeCandidate", id: cid });
    ok(rm.status === 200, `removeCandidate ${cid.slice(-6)} → 200`, `HTTP ${rm.status}`);
  }
  const delAfter = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "deletePosition", id: succId,
  });
  ok(delAfter.status === 200, "deletePosition pasca-kandidat bersih → 200", `HTTP ${delAfter.status}`);

  // ================= (h) EKSPOR XLSX DWIBAHASA (D-BL15) =================
  console.log("\n[(h)] EXPORT XLSX — PK + filename succession + sheet dwibahasa");
  // register ulang 1 peran + 1 kandidat utk isi laporan, lalu bersihkan lagi
  const re = await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "upsertPosition", positionId: accountant.id, critical: true, targetSuccessors: 2,
  });
  const reId = re.json?.id as string;
  await owner.api("POST", "/api/rekankerja/performance/talent", {
    action: "addCandidate", successionPositionId: reId, employeeId: tuti.id, readiness: "ReadyNow",
  });
  try {
    const xid = await owner.api("POST", "/api/rekankerja/performance/talent", { action: "exportXlsx", lang: "id" }, true);
    const cd = xid.headers.get("content-disposition") ?? "";
    ok(xid.status === 200 && xid.buf?.slice(0, 2).toString() === "PK", "exportXlsx lang=id → 200 + magic bytes PK", `${xid.buf?.length} byte`);
    ok(/succession/.test(cd), "filename berisi \"succession\"", cd);
    const xen = await owner.api("POST", "/api/rekankerja/performance/talent", { action: "exportXlsx", lang: "en" }, true);
    ok(xen.status === 200 && xen.buf?.slice(0, 2).toString() === "PK", "exportXlsx lang=en → 200 + magic bytes PK", `${xen.buf?.length} byte`);
    // verifikasi sheet dwibahasa via exceljs
    const wbId = new ExcelJS.Workbook();
    await wbId.xlsx.load(xid.buf as never);
    const wbEn = new ExcelJS.Workbook();
    await wbEn.xlsx.load(xen.buf as never);
    const namesId = wbId.worksheets.map((w) => w.name);
    const namesEn = wbEn.worksheets.map((w) => w.name);
    ok(namesId.includes("Rencana Suksesi") && namesId.includes("Kandidat"),
      "sheet XLSX ID: \"Rencana Suksesi\" + \"Kandidat\"", namesId.join(" | "));
    ok(namesEn.includes("Succession Plan") && namesEn.includes("Candidates"),
      "sheet XLSX EN: \"Succession Plan\" + \"Candidates\" (header berbeda antar bahasa)", namesEn.join(" | "));
    fs.writeFileSync("/tmp/e2e-b4-succession-id.xlsx", xid.buf as Buffer);
    fs.writeFileSync("/tmp/e2e-b4-succession-en.xlsx", xen.buf as Buffer);
  } finally {
    await db.successorCandidate.deleteMany({ where: { successionPositionId: reId } });
    await db.successionPosition.delete({ where: { id: reId } });
  }

  // ================= (i) AKSES — ESS menu guard 403 =================
  console.log("\n[(i)] AKSES — ESS yusuf POST talent ops → 403");
  const yLogin = await yusuf.api("POST", "/api/auth/login", { email: ESS_YUSUF, password: ESS_YUSUF_PW });
  ok(yLogin.status === 200, `login ESS ${ESS_YUSUF}`, `HTTP ${yLogin.status}`);
  const essOps = [
    { action: "upsertPosition", positionId: accountant.id },
    { action: "addCandidate", successionPositionId: succId, employeeId: tuti.id },
    { action: "exportXlsx", lang: "id" },
  ];
  let all403 = true;
  for (const op of essOps) {
    const r = await yusuf.api("POST", "/api/rekankerja/performance/talent", op);
    if (r.status !== 403) all403 = false;
  }
  ok(all403, "ESS yusuf POST talent ops (upsertPosition/addCandidate/exportXlsx) → 403 semua (menu guard admin-only)");
  const essGet = await yusuf.api("GET", "/api/rekankerja/performance/talent?succession=1");
  ok(essGet.status === 403, "ESS yusuf GET ?succession=1 → 403", `HTTP ${essGet.status}`);

  // ================= CLEANUP =================
  await db.successorCandidate.deleteMany({});
  await db.successionPosition.deleteMany({});
  const left = await db.successionPosition.count();
  const leftCand = await db.successorCandidate.count();
  ok(left === 0 && leftCand === 0, "cleanup: register succession & kandidat bersih (tanpa jejak data uji)", `posisi=${left} kandidat=${leftCand}`);

  console.log(`\n================ HASIL: ${pass}/${pass + fail} ================`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
