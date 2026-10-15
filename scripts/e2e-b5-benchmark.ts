// Uji E2E API B5 (Benchmark Pasar Gaji — Payroll) per
// DEVELOPMENT-PLAN-BACKLOG.md §4 B5 / D-BL16/D-BL17 — di atas data demo MII
// (login owner hrd@mii.co.id; ESS yusuf@mii.co.id):
//   (1) Template download lang id+en → PK + sheet dwibahasa (Data/Petunjuk vs
//       Data/How to Use + header Tahun vs Year via exceljs).
//   (2) Impor FILE VALID (8 baris grade G1–G8 sourceLabel "E2E-SURVEI" tahun
//       2026 p25<p50<p75) → preview 0 error → commit → 8 inserted → register
//       list memuat 8.
//   (3) Impor FILE KOTOR (8 baris: G9 tak ada di master, p25>p50, p50
//       negatif, tahun "abc", tanpa kunci, duplikat vs db, mata uang "XYZW"
//       >3 huruf, 1 valid G2 source berbeda) → preview error PER SEL per
//       baris (kolom+alasan) → commit → HANYA baris valid masuk (delta tepat).
//   (4) KOMPA-RATIO deterministik: Tuti MII00013 (G2) + Hartono MII00001 (G8)
//       — p50 dibaca dari db + baseSalary decryptMoney (tenantCryptoForDb,
//       TIDAK impor helper service benchmark) → ratio manual = API ±0.01 +
//       band benar + matchedKey=grade; Siti MII00050 tanpa grade → ratio null
//       "belum ada benchmark" (tidak difabrikasi); konteks default = tahun
//       max + sourceLabel terbaru (createdAt desc).
//   (5) AKSES: ESS yusuf GET dashboard + GET list + POST upsert → 403 semua.
//   (6) CRUD manual: upsert G1 → 200; duplikat 409; kunci ganda 400; tanpa
//       kunci 400; grade tak dikenal 400; p25>p50 400; upsert kunci posisi
//       → 200; delete → 200.
//   (7) Export XLSX id+en → PK + filename benchmark + sheet dwibahasa
//       "Ringkasan Kompa-Ratio"/"Master Benchmark" vs "Compa-Ratio Summary"/
//       "Benchmark Master" (exceljs load).
//   (8) Nominal: response dashboard owner (legacy canSee) memuat
//       baseSalaryNominal number utk ≥1 baris.
//   (9) CLEANUP: deleteMany SalaryBenchmark semua data uji E2E → count 0.
// Jalankan: bun scripts/e2e-b5-benchmark.ts
import "./lib/env";
import * as fs from "node:fs";
import * as ExcelJS from "exceljs";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
const ESS_YUSUF = "yusuf@mii.co.id";
const ESS_YUSUF_PW = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const API = "/api/rekankerja/payroll/benchmark";
const SRC = "E2E-SURVEI";
const SRC_LAIN = "E2E-SURVEI-LAIN";
const YEAR = 2026;

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
  /** POST multipart (impor .xlsx). */
  async upload(action: string, file: { buf: Buffer; name: string }): Promise<{ status: number; json: any }> {
    const form = new FormData();
    form.append("action", action);
    form.append("file", new File([new Uint8Array(file.buf)], file.name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const res = await fetch(`${BASE}${API}`, {
      method: "POST",
      body: form,
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }
}

/** Buat workbook .xlsx impor benchmark (header dwibahasa ID — sama template resmi). */
async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.columns = [
    { header: "Tahun", width: 10 },
    { header: "Label Sumber", width: 30 },
    { header: "Kode Grade", width: 14 },
    { header: "Kode Posisi", width: 16 },
    { header: "p25", width: 14 },
    { header: "p50", width: 14 },
    { header: "p75", width: 14 },
    { header: "Mata Uang", width: 12 },
  ];
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const owner = new Sesi();
  const yusuf = new Sesi();

  // ---- cleanup awal (idempoten bila diulang) ----
  await db.salaryBenchmark.deleteMany({ where: { OR: [{ sourceLabel: SRC }, { sourceLabel: SRC_LAIN }, { sourceLabel: { startsWith: "E2E-" } }] } });

  console.log("\n[(1)] TEMPLATE — PK + sheet dwibahasa");
  const login = await owner.api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);

  const tplId = await owner.api("GET", `${API}?template=1&lang=id`, undefined, true);
  const tplEn = await owner.api("GET", `${API}?template=1&lang=en`, undefined, true);
  ok(tplId.status === 200 && tplId.buf?.slice(0, 2).toString() === "PK", "template lang=id → 200 + magic bytes PK", `${tplId.buf?.length} byte`);
  ok(tplEn.status === 200 && tplEn.buf?.slice(0, 2).toString() === "PK", "template lang=en → 200 + magic bytes PK", `${tplEn.buf?.length} byte`);
  {
    const wbId = new ExcelJS.Workbook();
    await wbId.xlsx.load(tplId.buf as never);
    const wbEn = new ExcelJS.Workbook();
    await wbEn.xlsx.load(tplEn.buf as never);
    const namesId = wbId.worksheets.map((w) => w.name);
    const namesEn = wbEn.worksheets.map((w) => w.name);
    ok(namesId.includes("Petunjuk") && namesId.includes("Data"), "sheet template ID: \"Petunjuk\" + \"Data\"", namesId.join(" | "));
    ok(namesEn.includes("How to Use") && namesEn.includes("Data"), "sheet template EN: \"How to Use\" + \"Data\"", namesEn.join(" | "));
    const headId = (wbId.getWorksheet("Data")?.getRow(1).getCell(1).text ?? "").trim();
    const headEn = (wbEn.getWorksheet("Data")?.getRow(1).getCell(1).text ?? "").trim();
    ok(headId === "Tahun" && headEn === "Year", "header kolom pertama dwibahasa: Tahun (ID) vs Year (EN)", `${headId} / ${headEn}`);
    const col8Id = (wbId.getWorksheet("Data")?.getRow(1).getCell(8).text ?? "").trim();
    const col8En = (wbEn.getWorksheet("Data")?.getRow(1).getCell(8).text ?? "").trim();
    ok((wbId.getWorksheet("Data")?.columnCount ?? 0) === 8 && col8Id === "Mata Uang" && col8En === "Currency",
      "8 kolom — kolom terakhir Mata Uang (ID) vs Currency (EN)", `${col8Id} / ${col8En}`);
  }

  // ================= (2) IMPOR FILE VALID =================
  console.log("\n[(2)] IMPOR VALID — 8 grade G1–G8 → preview → commit 8");
  const p50ByGrade: Record<string, number> = {
    G1: 6_500_000, G2: 7_500_000, G3: 8_500_000, G4: 9_500_000,
    G5: 11_000_000, G6: 13_000_000, G7: 15_500_000, G8: 18_000_000,
  };
  const validRows = (["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]).map((g) => [
    YEAR, SRC, g, "", p50ByGrade[g]! - 1_000_000, p50ByGrade[g]!, p50ByGrade[g]! + 2_500_000, "IDR",
  ]);
  const validBuf = await buildXlsx(validRows);
  const pv1 = await owner.upload("importPreview", { buf: validBuf, name: "benchmark-valid.xlsx" });
  ok(pv1.status === 200 && Array.isArray(pv1.json?.rows) && pv1.json.rows.length === 8, "preview file valid → 200 + 8 baris", `HTTP ${pv1.status}`);
  ok(pv1.json?.summary?.valid === 8 && pv1.json?.summary?.error === 0 && pv1.json?.summary?.dup === 0,
    "summary valid=8 · error=0 · dup=0", JSON.stringify(pv1.json?.summary));
  const cm1 = await owner.api("POST", API, { action: "importCommit", rows: (pv1.json?.rows ?? []).map((r: any) => r.cells) });
  ok(cm1.status === 200 && cm1.json?.inserted === 8, "commit → 8 inserted", `HTTP ${cm1.status}, inserted=${cm1.json?.inserted}, skipped=${cm1.json?.skipped}`);
  const list1 = await owner.api("GET", `${API}?list=1&year=${YEAR}&sourceLabel=${encodeURIComponent(SRC)}`);
  ok(list1.status === 200 && (list1.json?.rows ?? []).length === 8, "register list memuat 8 entri", `n=${list1.json?.rows?.length}`);
  ok((list1.json?.rows ?? []).every((r: any) => r.gradeCode != null && r.p50 === p50ByGrade[r.gradeCode]),
    "tiap entri ber-gradeCode + p50 sesuai file");

  // ================= (3) IMPOR FILE KOTOR =================
  console.log("\n[(3)] IMPOR KOTOR — error per sel, hanya baris valid masuk");
  const countBefore = await db.salaryBenchmark.count();
  const dirtyRows: (string | number)[][] = [
    [YEAR, "E2E-KOTOR-1", "G9", "", 5_000_000, 7_000_000, 9_000_000, "IDR"], // grade tak ada
    [YEAR, "E2E-KOTOR-2", "G3", "", 9_000_000, 7_000_000, 10_000_000, "IDR"], // p25 > p50
    [YEAR, "E2E-KOTOR-3", "G3", "", 5_000_000, -5_000_000, 8_000_000, "IDR"], // p50 negatif
    ["abc", "E2E-KOTOR-4", "G4", "", 5_000_000, 7_000_000, 9_000_000, "IDR"], // tahun bukan angka
    [YEAR, "E2E-KOTOR-5", "", "", 5_000_000, 7_000_000, 9_000_000, "IDR"], // tanpa kunci
    [YEAR, SRC, "G1", "", 4_000_000, 5_500_000, 8_000_000, "IDR"], // duplikat vs db
    [YEAR, "E2E-KOTOR-7", "G5", "", 9_000_000, 11_000_000, 13_000_000, "XYZW"], // mata uang >3 huruf
    [YEAR, SRC_LAIN, "G2", "", 6_000_000, 7_000_000, 8_500_000, "IDR"], // VALID — source berbeda
  ];
  const dirtyBuf = await buildXlsx(dirtyRows);
  const pv2 = await owner.upload("importPreview", { buf: dirtyBuf, name: "benchmark-kotor.xlsx" });
  ok(pv2.status === 200 && Array.isArray(pv2.json?.rows) && pv2.json.rows.length === 8, "preview file kotor → 200 + 8 baris", `HTTP ${pv2.status}`);
  const rows2 = (pv2.json?.rows ?? []) as { rowNo: number; valid: boolean; errors: { col: string; reason: string }[]; cells: Record<string, string> }[];
  const withErrors = rows2.filter((r) => !r.valid);
  ok(withErrors.length >= 5, `baris ber-error ≥5 dgn kolom+alasan (aktual ${withErrors.length})`);
  ok(withErrors.every((r) => r.errors.length > 0 && r.errors.every((e) => typeof e.col === "string" && e.reason.length > 0)),
    "tiap baris error membawa errors[{col,reason}] terisi");
  const cols = new Set(withErrors.flatMap((r) => r.errors.map((e) => e.col)));
  ok(cols.has("gradeCode") && cols.has("p25") && cols.has("year") && cols.has("kunci") && cols.has("currency"),
    "kolom error mencakup gradeCode/p25/year/kunci/currency", [...cols].join(","));
  const g9err = withErrors.find((r) => r.cells.gradeCode === "G9")?.errors.find((e) => e.col === "gradeCode");
  ok(!!g9err && /G9/.test(g9err.reason), "alasan grade G9 menyebut kode grade", g9err?.reason);
  const dupRow = withErrors.find((r) => r.cells.sourceLabel === SRC && r.cells.gradeCode === "G1");
  ok(!!dupRow && dupRow.errors.some((e) => e.col === "kunci" && /database/i.test(e.reason)),
    "duplikat vs db ditandai per baris (kolom kunci, alasan database)");
  ok(pv2.json?.summary?.valid === 1 && pv2.json?.summary?.error + pv2.json?.summary?.dup === 7,
    "summary valid=1 · error+dup=7", JSON.stringify(pv2.json?.summary));
  const cm2 = await owner.api("POST", API, { action: "importCommit", rows: rows2.filter((r) => r.valid).map((r) => r.cells) });
  ok(cm2.status === 200 && cm2.json?.inserted === 1, "commit file kotor → HANYA 1 baris valid masuk", `inserted=${cm2.json?.inserted}, skipped=${cm2.json?.skipped}`);
  const countAfter = await db.salaryBenchmark.count();
  ok(countAfter - countBefore === 1, `delta register db tepat +1 (${countBefore} → ${countAfter})`);
  const lain = await db.salaryBenchmark.findFirst({ where: { year: YEAR, sourceLabel: SRC_LAIN, gradeCode: "G2" } });
  ok(!!lain, "baris valid (G2 source berbeda) tersimpan di db");
  ok(await db.salaryBenchmark.count({ where: { sourceLabel: { startsWith: "E2E-KOTOR" } } }) === 0,
    "tidak ada baris kotor yang lolos (E2E-KOTOR-* = 0)");

  // ================= (4) KOMPA-RATIO DETERMINISTIK (D-BL17) =================
  console.log("\n[(4)] KOMPA-RATIO — manual vs API (decryptMoney + p50 db)");
  const tc = tenantCryptoForDb(db as never);
  const manual = async (employeeNo: string, grade: string) => {
    const asg = await db.employeeAssignment.findFirst({
      where: { employee: { employeeNo }, validTo: null },
      orderBy: { validFrom: "desc" },
      select: { baseSalary: true },
    });
    const b = await db.salaryBenchmark.findFirstOrThrow({ where: { year: YEAR, sourceLabel: SRC, gradeCode: grade } });
    const salary = tc.decryptMoney(asg?.baseSalary);
    if (salary == null) throw new Error(`gaji ${employeeNo} tak terbaca`);
    const ratio = Math.round((salary / b.p50) * 100) / 100;
    const band = ratio < b.p25 / b.p50 ? "below" : ratio > b.p75 / b.p50 ? "above" : "within";
    return { ratio, band, p50: b.p50, salary };
  };
  const dash = await owner.api("GET", `${API}?dashboard=1&year=${YEAR}&sourceLabel=${encodeURIComponent(SRC)}`);
  ok(dash.status === 200 && Array.isArray(dash.json?.rows), "GET dashboard (year+source eksplisit) → 200 + rows", `HTTP ${dash.status}, rows=${dash.json?.rows?.length}`);
  for (const [no, grade] of [["MII00013", "G2"], ["MII00001", "G8"]] as const) {
    const exp = await manual(no, grade);
    const row = (dash.json?.rows ?? []).find((r: any) => r.employeeNo === no);
    ok(!!row, `baris ${no} ada di dashboard`);
    if (row) {
      ok(Math.abs(row.ratio - exp.ratio) <= 0.01, `ratio ${no} = hitungan manual (±0.01)`,
        `api=${row.ratio} manual=${exp.ratio} (p50=${exp.p50.toLocaleString("id-ID")})`);
      ok(row.band === exp.band, `band ${no} benar (${exp.band})`, `api=${row.band}`);
      ok(row.matchedKey === "grade", `matchedKey ${no} = grade (kunci grade diprioritaskan)`, `api=${row.matchedKey}`);
    }
  }
  // stats konsisten dgn rows
  const stats = dash.json?.stats;
  const drows = (dash.json?.rows ?? []) as any[];
  ok(stats?.total === drows.length && stats?.below + stats?.within + stats?.above + stats?.noBenchmark === drows.length,
    "stats distribusi band Σ = total", JSON.stringify(stats));
  // Siti MII00050 tanpa grade → ratio null (tidak difabrikasi)
  const siti = drows.find((r) => r.employeeNo === "MII00050");
  ok(!!siti && siti.ratio == null && siti.matchedKey == null && siti.band == null,
    "Siti MII00050 (tanpa grade) → ratio null \"belum ada benchmark\" (tanpa fallback fabrikasi)",
    `matchedKey=${siti?.matchedKey}`);
  ok(stats?.noBenchmark >= 1, "stats.noBenchmark ≥ 1", `n=${stats?.noBenchmark}`);
  // konteks default: tahun max + sourceLabel terbaru (createdAt desc = SRC_LAIN)
  const dashDefault = await owner.api("GET", `${API}?dashboard=1`);
  ok(dashDefault.status === 200 && dashDefault.json?.context?.year === YEAR,
    "konteks default = tahun maksimum", `year=${dashDefault.json?.context?.year}`);
  ok(dashDefault.json?.context?.sourceLabel === SRC_LAIN,
    "konteks default sourceLabel = TERBARU (createdAt desc)", `source=${dashDefault.json?.context?.sourceLabel}`);
  const sources = await owner.api("GET", `${API}?sources=1`);
  ok(sources.status === 200 && (sources.json?.sources ?? []).some((s: any) => s.year === YEAR && s.sourceLabel === SRC)
    && (sources.json?.sources ?? []).some((s: any) => s.year === YEAR && s.sourceLabel === SRC_LAIN),
    "GET sources=1 memuat kombinasi tahun+sumber uji");

  // ================= (5) AKSES — ESS 403 (menu guard admin-only) =================
  console.log("\n[(5)] AKSES — ESS yusuf → 403 semua jalur");
  const yLogin = await yusuf.api("POST", "/api/auth/login", { email: ESS_YUSUF, password: ESS_YUSUF_PW });
  ok(yLogin.status === 200, `login ESS ${ESS_YUSUF}`, `HTTP ${yLogin.status}`);
  const essGet1 = await yusuf.api("GET", `${API}?dashboard=1`);
  const essGet2 = await yusuf.api("GET", `${API}?list=1`);
  const essPost = await yusuf.api("POST", API, { action: "upsert", year: 2027, sourceLabel: "E2E-ESS", gradeCode: "G1", p25: 1, p50: 2, p75: 3 });
  ok(essGet1.status === 403, "ESS GET dashboard → 403", `HTTP ${essGet1.status}`);
  ok(essGet2.status === 403, "ESS GET list → 403", `HTTP ${essGet2.status}`);
  ok(essPost.status === 403, "ESS POST upsert → 403", `HTTP ${essPost.status}`);

  // ================= (6) CRUD MANUAL + GUARD =================
  console.log("\n[(6)] CRUD MANUAL — upsert/validasi/delete");
  const up1 = await owner.api("POST", API, { action: "upsert", year: 2027, sourceLabel: "E2E-MANUAL", gradeCode: "G1", currency: "IDR", p25: 5_000_000, p50: 6_500_000, p75: 8_000_000 });
  ok(up1.status === 200 && up1.json?.id, "upsert kunci grade → 200 + id", `HTTP ${up1.status}`);
  const up1b = await owner.api("POST", API, { action: "upsert", year: 2027, sourceLabel: "E2E-MANUAL", gradeCode: "G1", p25: 1, p50: 2, p75: 3 });
  ok(up1b.status === 409, "duplikat tahun+sumber+kunci → 409 (guard null-aware service)", `HTTP ${up1b.status}`);
  const up2 = await owner.api("POST", API, { action: "upsert", year: 2027, sourceLabel: "E2E-MANUAL", gradeCode: "G1", positionId: "x", p25: 1, p50: 2, p75: 3 });
  ok(up2.status === 400, "kunci ganda (grade + posisi) → 400", `HTTP ${up2.status}`);
  const up3 = await owner.api("POST", API, { action: "upsert", year: 2027, sourceLabel: "E2E-MANUAL", p25: 1, p50: 2, p75: 3 });
  ok(up3.status === 400, "tanpa kunci → 400", `HTTP ${up3.status}`);
  const up4 = await owner.api("POST", API, { action: "upsert", year: 2027, sourceLabel: "E2E-MANUAL", gradeCode: "G99", p25: 1, p50: 2, p75: 3 });
  ok(up4.status === 400, "grade tak dikenal → 400", `HTTP ${up4.status}`);
  const up5 = await owner.api("POST", API, { action: "upsert", year: 2027, sourceLabel: "E2E-MANUAL", gradeCode: "G5", p25: 9_000_000, p50: 7_000_000, p75: 10_000_000 });
  ok(up5.status === 400, "p25 > p50 → 400", `HTTP ${up5.status}`);
  const posAcc = await db.position.findFirstOrThrow({ where: { code: "P-ACC" }, select: { id: true, code: true } });
  const up6 = await owner.api("POST", API, { action: "upsert", year: 2027, sourceLabel: "E2E-MANUAL-POS", positionId: posAcc.id, p25: 5_500_000, p50: 7_200_000, p75: 9_000_000 });
  ok(up6.status === 200 && up6.json?.positionCode === "P-ACC", "upsert kunci posisi (P-ACC) → 200 + positionCode", `HTTP ${up6.status}`);
  const del1 = await owner.api("POST", API, { action: "delete", id: up6.json?.id });
  ok(del1.status === 200, "delete entri posisi → 200", `HTTP ${del1.status}`);

  // ================= (7) EXPORT XLSX DWIBAHASA =================
  console.log("\n[(7)] EXPORT XLSX — PK + filename + sheet dwibahasa");
  const xid = await owner.api("POST", API, { action: "exportXlsx", lang: "id", year: YEAR, sourceLabel: SRC }, true);
  const cd = xid.headers.get("content-disposition") ?? "";
  ok(xid.status === 200 && xid.buf?.slice(0, 2).toString() === "PK", "exportXlsx lang=id → 200 + magic bytes PK", `${xid.buf?.length} byte`);
  ok(/benchmark/.test(cd), "filename berisi \"benchmark\"", cd);
  const xen = await owner.api("POST", API, { action: "exportXlsx", lang: "en", year: YEAR, sourceLabel: SRC }, true);
  ok(xen.status === 200 && xen.buf?.slice(0, 2).toString() === "PK", "exportXlsx lang=en → 200 + magic bytes PK", `${xen.buf?.length} byte`);
  {
    const wbId = new ExcelJS.Workbook();
    await wbId.xlsx.load(xid.buf as never);
    const wbEn = new ExcelJS.Workbook();
    await wbEn.xlsx.load(xen.buf as never);
    const namesId = wbId.worksheets.map((w) => w.name);
    const namesEn = wbEn.worksheets.map((w) => w.name);
    ok(namesId.includes("Ringkasan Kompa-Ratio") && namesId.includes("Master Benchmark"),
      "sheet XLSX ID: \"Ringkasan Kompa-Ratio\" + \"Master Benchmark\"", namesId.join(" | "));
    ok(namesEn.includes("Compa-Ratio Summary") && namesEn.includes("Benchmark Master"),
      "sheet XLSX EN: \"Compa-Ratio Summary\" + \"Benchmark Master\"", namesEn.join(" | "));
    fs.writeFileSync("/tmp/e2e-b5-benchmark-id.xlsx", xid.buf as Buffer);
    fs.writeFileSync("/tmp/e2e-b5-benchmark-en.xlsx", xen.buf as Buffer);
  }

  // ================= (8) NOMINAL — money-view threading =================
  console.log("\n[(8)] NOMINAL — owner legacy canSee → baseSalaryNominal number");
  const withNominal = drows.filter((r) => typeof r.baseSalaryNominal === "number");
  ok(withNominal.length >= 1, `dashboard memuat baseSalaryNominal number utk ≥1 baris (legacy MoneyVault=0 → canSee)`, `n=${withNominal.length}/${drows.length}`);
  const tutiRow = drows.find((r) => r.employeeNo === "MII00013");
  ok(!!tutiRow && typeof tutiRow.baseSalaryNominal === "number" && tutiRow.baseSalaryNominal > 0,
    "Tuti MII00013 memuat nominal gaji > 0", `nominal=${tutiRow?.baseSalaryNominal}`);

  // ================= (9) CLEANUP =================
  await db.salaryBenchmark.deleteMany({ where: { sourceLabel: { startsWith: "E2E-" } } });
  const left = await db.salaryBenchmark.count();
  ok(left === 0, "cleanup: seluruh data uji E2E bersih (0 baris)", `sisa=${left}`);
  const acts = await db.activityLog.count({ where: { entity: "SalaryBenchmark" } });
  ok(acts >= 8, "ActivityLog mutasi benchmark tercatat (pola B1)", `n=${acts}`);

  console.log(`\n================ HASIL: ${pass}/${pass + fail} ================`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
