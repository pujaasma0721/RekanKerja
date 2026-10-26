// SUITE 08 — VERIFIKASI FIX F1 & F2 (QA-PAGELOAD-BIGTENANT) ==================
// F1: GET /api/rekankerja/payroll-run?id= — dulu SATU respons 9,1 MB
//     (5.000 line × 8 item terdekripsi; cold 11,3 dtk / warm 5,4 dtk).
//     Fix: paginasi server-side (100/hal) + q server-side + agregat komponen
//     query-ramping + cache fingerprint.
// F2: GET /api/rekankerja/employees?sortBy=baseSalary — dulu fetch SEMUA baris
//     full-include + komparator decrypt di SETIAP perbandingan (6,1–9,0 dtk).
//     Fix: dua-fase (proyeksi ramping + kunci precompute → fetch full hanya
//     halaman).
//
// Verifikasi KOREKTENESS (bukan cuma cepat):
//   · paginasi: halaman 1/2/50 disjoint & urut employeeNo;
//   · q=Santoso cocok dgn hitungan DB langsung;
//   · sort gaji DESC page-1 == top-50 gaji terdekripsi langsung dari DB
//     (tenantCrypto ASLI) — bukti sort global tetap benar pasca-refactor;
//   · label total (run._count.lines) tetap 5.000 (run penuh, bukan halaman).
//
// Jalankan: bun scripts/qa/08-f1f2-verify.ts   (dev server :3000 harus hidup)
// Hasil: qa/f1f2-verify.json
import fs from "node:fs";
import { Client } from "pg";
import { loginAs, readEnvVar, BASE } from "./helpers";
import { tenantCrypto } from "@/rekankerja/shared/lib/field-crypto";

export {};

const CREDS = { email: "user42@bench101.test", password: "Bench101!", preferSlug: "bench101" };
const SCHEMA = "tenant_bench_101";
const RUN_ID = "run2";

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const fmt = (ms: number) => `${Math.round(ms)}ms`;

interface Hit { ms: number; bytes: number; json: any; status: number }

async function hit(cookie: string, path: string): Promise<Hit> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
  const buf = await res.arrayBuffer();
  const ms = performance.now() - t0;
  let json: any = null;
  try { json = JSON.parse(new TextDecoder().decode(buf)); } catch { /* biarkan null */ }
  return { ms, bytes: buf.byteLength, json, status: res.status };
}

async function warm(cookie: string, path: string, n: number): Promise<Hit[]> {
  const out: Hit[] = [];
  for (let i = 0; i < n; i++) out.push(await hit(cookie, path));
  return out;
}

function summarize(hits: Hit[]) {
  const times = hits.map((h) => h.ms);
  return {
    n: hits.length,
    status: [...new Set(hits.map((h) => h.status))],
    p50: fmt(pct(times, 50)),
    p95: fmt(pct(times, 95)),
    max: fmt(Math.max(...times, 0)),
    bytes: hits.map((h) => h.bytes),
    bytesMax: Math.max(...hits.map((h) => h.bytes), 0),
  };
}

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name} — ${detail}`);
};

(async () => {
  console.log("[08] login …");
  const s = await loginAs(CREDS);
  const cookie = s.cookie;

  // ============ F1 — payroll-run detail (paginasi) ============
  console.log("\n=== F1 payroll-run?id=run2 (paginasi) ===");
  const cold1 = await hit(cookie, `/api/rekankerja/payroll-run?id=${RUN_ID}&page=1&pageSize=100`);
  console.log(`  cold page1: ${fmt(cold1.ms)} · ${(cold1.bytes / 1024).toFixed(0)} KB · HTTP ${cold1.status}`);
  const w1 = await warm(cookie, `/api/rekankerja/payroll-run?id=${RUN_ID}&page=1&pageSize=100`, 6);
  console.log(`  warm page1 ×6: p50 ${summarize(w1).p50} · p95 ${summarize(w1).p95} · max ${(summarize(w1).bytesMax / 1024).toFixed(0)} KB`);
  const p2 = await hit(cookie, `/api/rekankerja/payroll-run?id=${RUN_ID}&page=2&pageSize=100`);
  const p50 = await hit(cookie, `/api/rekankerja/payroll-run?id=${RUN_ID}&page=50&pageSize=100`);
  const qhit = await hit(cookie, `/api/rekankerja/payroll-run?id=${RUN_ID}&page=1&pageSize=100&q=Santoso`);
  const q2 = await warm(cookie, `/api/rekankerja/payroll-run?id=${RUN_ID}&page=1&pageSize=100&q=Santoso`, 3);
  console.log(`  page2: ${fmt(p2.ms)} · page50: ${fmt(p50.ms)} · q=Santoso: ${fmt(qhit.ms)} (warm p50 ${summarize(q2).p50})`);

  const j1 = w1[0].json ?? {};
  const lines1: any[] = j1?.run?.lines ?? [];
  const pg = j1?.pagination ?? {};
  check("F1 status 200", w1.every((h) => h.status === 200), `HTTP ${summarize(w1).status.join(",")}`);
  check("F1 paginasi aktif", pg.totalLines === 5000 && pg.totalPages === 50 && pg.pageSize === 100,
    `totalLines=${pg.totalLines} totalPages=${pg.totalPages} pageSize=${pg.pageSize}`);
  check("F1 lines terpotong per halaman", lines1.length === 100, `lines.length=${lines1.length} (dulu 5000/9,1MB)`);
  check("F1 respons ramping", summarize(w1).bytesMax < 400 * 1024, `max ${(summarize(w1).bytesMax / 1024).toFixed(0)} KB (dulu 9.116 KB)`.replace("9.116 KB", "9.116KB→9MB"));
  check("F1 agregat komponen tetap ada", Array.isArray(j1?.componentTotals) && j1.componentTotals.length >= 5,
    `${j1?.componentTotals?.length ?? 0} komponen (seluruh run, via cache fingerprint)`);
  check("F1 label total run penuh", j1?.run?._count?.lines === 5000, `run._count.lines=${j1?.run?._count?.lines}`);
  check("F1 logs top-level (fix tab Log)", Array.isArray(j1?.logs), `logs=${Array.isArray(j1?.logs) ? j1.logs.length : "absent"}`);
  check("F1 umkWarnings server-side", Array.isArray(j1?.umkWarnings), `umkWarnings=${Array.isArray(j1?.umkWarnings) ? j1.umkWarnings.length : "absent"}`);
  const nos = lines1.map((l) => l.employeeNo);
  const sortedNos = [...nos].every((n, i) => i === 0 || nos[i - 1] <= n);
  check("F1 halaman urut employeeNo", sortedNos, "orderBy employeeNo asc");
  const ids1 = new Set(lines1.map((l) => l.id));
  const ids2 = new Set((p2.json?.run?.lines ?? []).map((l: any) => l.id));
  const ids50 = new Set((p50.json?.run?.lines ?? []).map((l: any) => l.id));
  const disjoint = [...ids1].every((id) => !ids2.has(id)) && [...ids1].every((id) => !ids50.has(id));
  check("F1 halaman disjoint", disjoint && ids50.size === 100, `p1∩p2=${[...ids1].filter((i) => ids2.has(i)).length}, p50.size=${ids50.size}`);
  check("F1 halaman terakhir valid", (p50.json?.pagination?.page ?? 0) === 50, `page=${p50.json?.pagination?.page}`);

  // q=Santoso — cocokkan dgn DB langsung
  const db = new Client({ connectionString: readEnvVar("TENANT_DB_BASE_URL") ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja" });
  await db.connect();
  const dbSantoso = await db.query(
    `SELECT count(*)::int n FROM ${SCHEMA}."PayrollRunLine" WHERE "runId"=$1 AND ("employeeName" ILIKE '%Santoso%' OR "employeeNo" ILIKE '%Santoso%')`,
    [RUN_ID],
  );
  const qTotal = qhit.json?.pagination?.totalLines;
  check("F1 q=Santoso = hitungan DB", qTotal === dbSantoso.rows[0].n, `API totalLines=${qTotal} vs DB=${dbSantoso.rows[0].n}`);

  // ============ F2 — employees sortBy=baseSalary (dua-fase) ============
  console.log("\n=== F2 employees sortBy=baseSalary (dua-fase) ===");
  const SAL = "/api/rekankerja/employees?sortBy=baseSalary&sortDir=desc&limit=50&offset=0";
  const salCold = await hit(cookie, SAL);
  console.log(`  cold: ${fmt(salCold.ms)}`);
  const salW = await warm(cookie, SAL, 6);
  console.log(`  warm ×6: p50 ${summarize(salW).p50} · p95 ${summarize(salW).p95}`);
  const salAsc = (await warm(cookie, "/api/rekankerja/employees?sortBy=baseSalary&sortDir=asc&limit=50&offset=0", 2))[0];
  const posW = await warm(cookie, "/api/rekankerja/employees?sortBy=position&sortDir=asc&limit=50&offset=0", 4);
  console.log(`  sortBy=position ×4: p50 ${summarize(posW).p50} · p95 ${summarize(posW).p95}`);
  const baseW = await warm(cookie, "/api/rekankerja/employees?limit=50&offset=0", 3);
  console.log(`  baseline (tanpa sort) ×3: p50 ${summarize(baseW).p50}`);
  const salDeep = await hit(cookie, "/api/rekankerja/employees?sortBy=baseSalary&sortDir=desc&limit=50&offset=4950");

  const salRows: any[] = salW[0].json?.employees ?? [];
  check("F2 status 200", salW.every((h) => h.status === 200), `HTTP ${summarize(salW).status.join(",")}`);
  check("F2 total 5000", salW[0].json?.total === 5000 && salRows.length === 50, `total=${salW[0].json?.total}, rows=${salRows.length}`);
  // NOTE: respons baseSalary bisa null (masking M-9 utk scope LIMITED — perilaku
  // pre-existing, sort tetap di server atas nilai TERDEKRIPSI) → verifikasi
  // korektness memakai URUTAN employeeId vs dekripsi DB langsung.
  const tc = tenantCrypto(SCHEMA);
  const dbSal = await db.query(
    `SELECT e."id", a."baseSalary" FROM ${SCHEMA}."Employee" e LEFT JOIN ${SCHEMA}."EmployeeAssignment" a ON a."employeeId"=e."id" AND a."validTo" IS NULL`,
  );
  const dbKeyed = dbSal.rows.map((r: any) => ({ id: r.id, sal: r.baseSalary == null ? 0 : (tc.decryptMoney(r.baseSalary) ?? 0) }));
  const salById = new Map(dbKeyed.map((k: any) => [k.id, k.sal]));

  const apiDescIds = salRows.map((e) => e.id);
  const apiSalVals = apiDescIds.map((id) => salById.get(id) ?? 0);
  const nonIncr = apiSalVals.every((v: number, i: number) => i === 0 || apiSalVals[i - 1] >= v);
  check("F2 desc non-naik (nilai DB dekrip)", nonIncr, `top5=${apiSalVals.slice(0, 5).map((v: number) => v.toLocaleString("id")).join(", ")}`);
  // URUTAN GLOBAL persis: id halaman-1 API == 50 gaji tertinggi versi DB.
  // (tiebreak employeeNo di API vs id-string di ref lokal — samakan pakai employeeNo DB)
  const empNos = await db.query(`SELECT "id", "employeeNo" FROM ${SCHEMA}."Employee"`);
  const noById = new Map(empNos.rows.map((r: any) => [r.id, r.employeeNo]));
  const descRefNo = [...dbKeyed].sort((a, b) =>
    b.sal - a.sal || String(noById.get(a.id) ?? "").localeCompare(String(noById.get(b.id) ?? ""), "id", { numeric: true }));
  const apiDescNos = apiDescIds.map((id: any) => noById.get(id));
  const refNos = descRefNo.slice(0, 50).map((k: any) => noById.get(k.id));
  const match = apiDescNos.length === refNos.length && apiDescNos.every((n: any, i: number) => n === refNos[i]);
  check("F2 top-50 == dekripsi DB langsung (urutan persis)", match,
    `API[0..2]=${apiDescNos.slice(0, 3).join(",")} · DB[0..2]=${refNos.slice(0, 3).join(",")}`);

  const ascRows: any[] = salAsc.json?.employees ?? [];
  const ascVals = ascRows.map((e) => salById.get(e.id) ?? 0);
  const ascOk = ascRows.length === 50 && ascVals.every((v: number, i: number) => i === 0 || ascVals[i - 1] <= v);
  check("F2 asc non-turun (nilai DB dekrip)", ascOk, `bottom5=${ascVals.slice(0, 5).map((v: number) => v.toLocaleString("id")).join(", ")}`);
  check("F2 desc-top1 ≥ asc-top1", apiSalVals[0] >= ascVals[ascVals.length - 1], `${apiSalVals[0]} ≥ ${ascVals[ascVals.length - 1]}`);
  const deepVals = (salDeep.json?.employees ?? []).map((e: any) => salById.get(e.id) ?? 0);
  const deepOk = deepVals.length === 50 && deepVals.every((v: number, i: number) => i === 0 || deepVals[i - 1] >= v);
  check("F2 halaman dalam (offset 4950) tetap urut", deepOk && apiSalVals[0] >= deepVals[0], `deep top1=${deepVals[0] ?? "—"}`);
  const posRows: any[] = posW[0].json?.employees ?? [];
  const posTitles = posRows.map((e) => e.position?.title ?? "");
  const posOk = posTitles.every((t: string, i: number) => i === 0 || posTitles[i - 1].localeCompare(t, "id") <= 0);
  check("F2 sortBy=position urut", posOk && posRows.length === 50, `contoh: ${posTitles.slice(0, 3).join(" | ")}`);
  await db.end();

  // ============ ringkasan ============
  const before = { f1_warm: { cold: fmt(cold1.ms), ...summarize(w1) }, f1_q: summarize(q2), f2: { cold: fmt(salCold.ms), ...summarize(salW) }, f2_position: summarize(posW), baseline: summarize(baseW) };
  const out = {
    meta: {
      date: new Date().toISOString(),
      tenant: "bench101 (5.000 karyawan, 5.000 line payroll run2)",
      fix: "F1 paginasi payroll detail + F2 sort dua-fase (QA-PAGELOAD-BIGTENANT)",
      sebelum: {
        "payroll-run-detail": { warmP50: "5.400ms", resp: "9.116KB (9,1MB)", cold: "11.341ms" },
        "directory-sort-salary": { warmP50: "6.100ms", p95: "9.000ms" },
      },
    },
    hasil: before,
    checks,
    lulus: checks.filter((c) => c.ok).length,
    total: checks.length,
  };
  fs.mkdirSync("qa", { recursive: true });
  fs.writeFileSync("qa/f1f2-verify.json", JSON.stringify(out, null, 2));
  console.log(`\n=== ${out.lulus}/${out.total} check LULUS ===`);
  console.log(`F1 payroll detail: warm p50 ${summarize(w1).p50} (dulu ~5.400ms) · respons ≤ ${(summarize(w1).bytesMax / 1024).toFixed(0)} KB (dulu 9,1 MB)`);
  console.log(`F2 sort gaji    : warm p50 ${summarize(salW).p50} (dulu ~6.100ms, p95 9.000ms)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
