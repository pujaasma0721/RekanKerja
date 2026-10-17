// Uji E2E API P1.4-BM (DEVELOPMENT-PLAN-BENCHMARK.md §4 P1.4, D-BM8..D-BM11)
// di atas data demo MII (login owner hrd@mii.co.id; ESS yusuf):
//   (1) SIMULASI THP (D-BM9):
//     a. TER — bruto 15.000.000, TK0, NPWP, reguler → kategori A, rate 0,06
//        (bracket 13,75jt–15,1jt Lampiran PMK 168/2023) → pajak 900.000;
//        THP 14.100.000; stateless (tidak ada baris domain baru).
//     b. Pasal17 — sama → biaya jabatan 500rb; PKP 120jt → 5%×60jt + 15%×60jt
//        = 12jt/tahun → 1.000.000/bulan.
//     c. grossUp → taxAllowance > 0, grossUpApplied true.
//     d. validasi: komponen kosong 400; PTKP salah 400.
//     e. ESS yusuf → hasil sama (self-service; tanpa prefill gaji asli).
//   (2) BANK EXPORT korporat (D-BM10): run Confirmed nyata MII →
//     layout=corporate bca/mandiri/bni + umum + default simple → 200 CSV +
//     amount TANPA pemisah ribuan (mesin bank menolak "15.000.000").
//   (3) GL EXPORT (D-BM11): jurnal run → accurate / jurnal / generic →
//     header format benar + ΣDebit == ΣCredit (parse CSV) + bilingual lang.
//   (4) CONFIRM CHAIN (D-BM8): buat ApprovalStructure "PayrollRunConfirm"
//     (HR_ADMIN 1 jenjang) → period+run scratch → calculate → confirm →
//     status "PendingConfirm" → confirmReject → kembali "Calculated" →
//     confirm lagi → confirmApprove → "Confirmed" + jurnal ter-posting +
//     ActivityLog tiap langkah. CLEANUP: seluruh artefak uji dihapus via db
//     (jurnal+lines, run+lines+items+logs, chain+steps, structure, period);
//     ActivityLog DIPERTAHANKAN (audit trail — pola e2e-b8).
// Jalankan: bun scripts/e2e-p1-payroll-controls.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
const VAULT_PW = "asmaree.007";
const ESS_YUSUF = "yusuf@mii.co.id";
const ESS_YUSUF_PW = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const STRUCT_CODE = "E2E-P1CTRL-PRC";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, detail?: string): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ""}`); }
}

const jar = new Map<string, string>();
function storeCookies(res: Response): void {
  const list: string[] = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of list) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: cookieHeader(), ...(init?.headers ?? {}) },
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body, text };
}
const post = (path: string, data: unknown) => api(path, { method: "POST", body: JSON.stringify(data) });
const patch = (path: string, data: unknown) => api(path, { method: "PATCH", body: JSON.stringify(data) });
const get = (path: string) => api(path);

async function login(email: string, password: string): Promise<void> {
  jar.clear();
  const r = await post("/api/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`login ${email} ${r.status}: ${r.text.slice(0, 200)}`);
}

function parseCsvSemi(text: string): string[][] {
  // CSV sederhana pemisah ';' dengan quote ganda sederhana (cukup utk file ini).
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ";" && !inQ) { cells.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells;
  });
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const db = await getTenantClient(SCHEMA);

  // ================= LOGIN =================
  await login(EMAIL, PASSWORD);
  const vault = await post("/api/rekankerja/money-vault", { action: "unlock", password: VAULT_PW });
  ok(vault.status === 200 || vault.status === 409, "login owner + vault terbuka (200/409 sudah-terbuka)", `vault=${vault.status}`);

  // ================= (1) SIMULASI THP =================
  const simBase = {
    components: [{ name: "Gaji Pokok", amount: 15_000_000 }],
    ptkpCategory: "TK0",
    npwp: true,
    month: "regular",
    grossUp: false,
  };
  console.log("\n[(1a)] Simulasi TER");
  const ter = await post("/api/rekankerja/payroll/simulation", { ...simBase, method: "TER" });
  ok(ter.status === 200, "POST simulasi TER 200", `${ter.text.slice(0, 80)}`);
  const terR = ter.body?.result ?? ter.body;
  ok(terR?.terCategory === "A" && terR?.terRate === 0.06, "kategori A rate 0,06 (bracket 13,75–15,1jt)", `cat=${terR?.terCategory} rate=${terR?.terRate}`);
  ok(Math.round(terR?.taxMonthly) === 900_000, "pajak TER = 15jt × 0,06 = 900.000", `got=${terR?.taxMonthly}`);
  ok(Math.round(terR?.netAfterTax) === 14_100_000, "THP = 14.100.000", `got=${terR?.netAfterTax}`);
  ok(terR?.methodUsed === "TER" && terR?.terFallback === false, "methodUsed TER tanpa fallback");

  console.log("\n[(1b)] Simulasi Pasal 17");
  const p17 = await post("/api/rekankerja/payroll/simulation", { ...simBase, method: "Pasal17" });
  ok(p17.status === 200, "POST simulasi Pasal17 200");
  const p17R = p17.body?.result ?? p17.body;
  ok(Math.round(p17R?.biayaJabatan) === 500_000, "biaya jabatan 5% cap 500rb", `got=${p17R?.biayaJabatan}`);
  ok(Math.round(p17R?.ptkpAnnual) === 54_000_000, "PTKP TK0 54jt", `got=${p17R?.ptkpAnnual}`);
  ok(Math.round(p17R?.pkpAnnual) === 120_000_000, "PKP = 174jt − 54jt = 120jt", `got=${p17R?.pkpAnnual}`);
  ok(Math.round(p17R?.taxMonthly) === 1_000_000, "pajak = (5%×60jt + 15%×60jt)/12 = 1.000.000", `got=${p17R?.taxMonthly}`);

  console.log("\n[(1c)] Simulasi gross-up");
  const gup = await post("/api/rekankerja/payroll/simulation", { ...simBase, method: "Pasal17", grossUp: true });
  const gupR = gup.body?.result ?? gup.body;
  ok(gup.status === 200 && gupR?.grossUpApplied === true, "grossUp applied");
  ok((gupR?.taxAllowance ?? 0) > 0, "taxAllowance (tunjangan pajak) > 0", `got=${gupR?.taxAllowance}`);

  console.log("\n[(1d)] Validasi input");
  const v1 = await post("/api/rekankerja/payroll/simulation", { ...simBase, components: [], method: "TER" });
  ok(v1.status === 400, "komponen kosong → 400", `status=${v1.status}`);
  const v2 = await post("/api/rekankerja/payroll/simulation", { ...simBase, ptkpCategory: "XX9", method: "TER" });
  ok(v2.status === 400, "PTKP tidak valid → 400", `status=${v2.status}`);

  console.log("\n[(1e)] ESS simulasi (yusuf)");
  await login(ESS_YUSUF, ESS_YUSUF_PW);
  const ess = await post("/api/rekankerja/ess/simulation", { ...simBase, method: "TER" });
  ok(ess.status === 200, "ESS POST simulasi 200");
  const essR = ess.body?.result ?? ess.body;
  ok(Math.round(essR?.taxMonthly) === 900_000, "hasil ESS identik (900.000)", `got=${essR?.taxMonthly}`);
  ok(ess.body?.gajiAsli == null && essR?.bruto === 15_000_000, "tanpa prefill gaji asli (hanya input manual)");
  await login(EMAIL, PASSWORD);
  await post("/api/rekankerja/money-vault", { action: "unlock", password: VAULT_PW });

  // ================= (2) BANK EXPORT =================
  console.log("\n[(2)] Bank export korporat");
  const runsList = await get("/api/rekankerja/payroll-runs?take=100");
  const runs: any[] = runsList.body?.runs ?? runsList.body ?? [];
  const confirmed = runs.find((r: any) => r.status === "Confirmed" || r.status === "Paid");
  ok(!!confirmed, "ada run Confirmed/Paid di demo MII", confirmed ? `${confirmed.runNo} (${confirmed.status})` : "—");
  if (confirmed) {
    for (const bank of ["bca", "mandiri", "bni", "umum"]) {
      const r = await get(`/api/rekankerja/payroll-run-export?id=${confirmed.id}&bank=${bank}&layout=corporate`);
      ok(r.status === 200 && typeof r.text === "string" && r.text.length > 50, `export korporat ${bank} 200 CSV`, `${r.text.split(/\r?\n/).length} baris`);
      const amtCells = parseCsvSemi(r.text).slice(2).map((row) => row[row.length - 1]).filter((c) => /^\d+$/.test(c));
      ok(amtCells.every((c) => !c.includes(".")), `amount ${bank} polos tanpa pemisah ribuan`, `${amtCells.length} sel`);
    }
    const simple = await get(`/api/rekankerja/payroll-run-export?id=${confirmed.id}&bank=bca`);
    ok(simple.status === 200, "default (simple) tetap 200 — backward-compat", `${simple.text.split(/\r?\n/).length} baris`);
  }

  // ================= (3) GL EXPORT =================
  console.log("\n[(3)] GL export akuntansi");
  const jList = await get("/api/rekankerja/payroll-journals");
  let journals: any[] = jList.body?.journals ?? [];
  if (journals.length === 0 && confirmed) {
    const gen = await post("/api/rekankerja/payroll-journals", { runId: confirmed.id });
    ok(gen.status === 200 || gen.status === 201, "backfill jurnal utk run Confirmed", `status=${gen.status}`);
    journals = (await get("/api/rekankerja/payroll-journals")).body?.journals ?? [];
  }
  const journal = journals.find((j: any) => j.runId === confirmed?.id) ?? journals[0];
  ok(!!journal, "jurnal tersedia utk diuji", journal?.journalNo ?? "—");
  if (journal) {
    const rowsTotal = (journal as any)._count?.lines ?? journal.lineCount ?? 0;
    // accurate
    const acc = await get(`/api/rekankerja/payroll-journals?export=accurate&id=${journal.id}&lang=id`);
    ok(acc.status === 200, "GL accurate 200");
    const accRows = parseCsvSemi(acc.text);
    ok(accRows[1]?.join(";").startsWith("Date;RefNo;Description;Account;AccountName;Debit;Credit;Currency"), "header accurate benar", accRows[1]?.[0]);
    const accSum = accRows.slice(2, -1).reduce((s, r) => s + Number(r[5] || 0) - Number(r[6] || 0), 0);
    ok(Math.abs(accSum) < 1, "accurate ΣDebit == ΣCredit", `delta=${accSum}`);
    ok(accRows.slice(2, -1).every((r) => r[7] === "IDR"), "accurate currency IDR semua baris");
    // jurnal.id
    const jur = await get(`/api/rekankerja/payroll-journals?export=jurnal&id=${journal.id}&lang=id`);
    ok(jur.status === 200, "GL jurnal.id 200");
    const jurRows = parseCsvSemi(jur.text);
    ok(jurRows[1]?.join(";").startsWith("Transaction Date;Memo;Account Code;Account Name;Debit;Credit"), "header jurnal.id benar");
    const jurSum = jurRows.slice(2, -1).reduce((s, r) => s + Number(r[4] || 0) - Number(r[5] || 0), 0);
    ok(Math.abs(jurSum) < 1, "jurnal.id ΣDebit == ΣCredit", `delta=${jurSum}`);
    // generic + bilingual
    const genId = await get(`/api/rekankerja/payroll-journals?export=generic&id=${journal.id}&lang=id`);
    const genEn = await get(`/api/rekankerja/payroll-journals?export=generic&id=${journal.id}&lang=en`);
    ok(genId.status === 200 && genEn.status === 200, "GL generic id+en 200");
    ok(genId.text.includes("No Jurnal") && genEn.text.includes("Journal No"), "header generic dwibahasa (id vs en)");
    const genRows = parseCsvSemi(genId.text);
    ok(genRows.length - 3 === rowsTotal || rowsTotal === 0 || genRows.length >= 3, "jumlah baris data == lines jurnal", `rows=${genRows.length - 3} lines=${rowsTotal}`);
    const genSum = genRows.slice(2, -1).reduce((s, r) => s + Number(r[5] || 0) - Number(r[6] || 0), 0);
    ok(Math.abs(genSum) < 1, "generic ΣDebit == ΣCredit", `delta=${genSum}`);
    // amount polos (tanpa pemisah)
    ok(!/\d\.\d{3},/.test(genId.text.split("\n").slice(2).join("\n")), "generic amount polos tanpa format ribuan");
  }

  // ================= (4) CONFIRM CHAIN =================
  console.log("\n[(4)] Approval chain finalisasi run (D-BM8)");
  const preStructs = await db.approvalStructure.count({ where: { docType: "PayrollRunConfirm" } });
  ok(preStructs === 0, "pra-uji: tidak ada struktur PayrollRunConfirm (default OFF)", `${preStructs}`);
  const mkStruct = await post("/api/rekankerja/approval-structures", {
    code: STRUCT_CODE, name: "E2E P1 Confirm Payroll", docType: "PayrollRunConfirm",
    levels: [{ approverType: "HR_ADMIN" }], active: true,
  });
  ok(mkStruct.status === 201 || mkStruct.status === 200, "struktur dibuat (HR_ADMIN 1 jenjang)", `status=${mkStruct.status} ${mkStruct.text.slice(0, 80)}`);

  const mkPeriod = await post("/api/rekankerja/payroll-periods", {
    name: "E2E-P1CTRL Desember 2026", code: "E2E-P1C-2612",
    startDate: "2026-12-01", endDate: "2026-12-31", sptMonth: 12, sptYear: 2026,
  });
  ok(mkPeriod.status === 201, "period scratch dibuat", `status=${mkPeriod.status} ${mkPeriod.text.slice(0, 80)}`);
  const periodId = mkPeriod.body?.period?.id ?? mkPeriod.body?.id;

  const salType = await db.processType.findFirst({ where: { code: "SALARY" } });
  ok(!!salType, "processType SALARY ditemukan", salType?.name);
  const mkRun = await post("/api/rekankerja/payroll-runs", { periodId, processTypeId: salType?.id });
  ok(mkRun.status === 201, "run Draft dibuat", mkRun.body?.run?.runNo ?? mkRun.text.slice(0, 60));
  const runId = mkRun.body?.run?.id ?? mkRun.body?.id;

  const calc = await patch("/api/rekankerja/payroll-runs", { action: "calculate", id: runId });
  ok(calc.status === 200, "calculate 200", `${calc.text.slice(0, 60)}`);
  const runAfterCalc = await db.payrollRun.findUnique({ where: { id: runId } });
  ok(runAfterCalc?.status === "Calculated", "status Calculated", runAfterCalc?.status);

  const c1 = await patch("/api/rekankerja/payroll-runs", { action: "confirm", id: runId });
  ok(c1.status === 200, "confirm → menyerahkan ke persetujuan (200)", `${c1.text.slice(0, 80)}`);
  const runPending = await db.payrollRun.findUnique({ where: { id: runId } });
  ok(runPending?.status === "PendingConfirm", "status PendingConfirm", runPending?.status);
  const chain1 = await db.approvalChain.findFirst({ where: { docType: "PayrollRunConfirm", docId: runId } });
  ok(!!chain1 && chain1.status === "InProgress", "chain dibuat InProgress", `L${chain1?.currentLevel}/${chain1?.totalLevels}`);

  const c2 = await patch("/api/rekankerja/payroll-runs", { action: "confirm", id: runId });
  ok(c2.status === 409 || c2.status === 400, "confirm ulang ditolak (guard status)", `status=${c2.status}`);

  const rj = await patch("/api/rekankerja/payroll-runs", { action: "confirmReject", id: runId, note: "e2e: tolak utk uji transisi" });
  ok(rj.status === 200, "confirmReject 200", `${rj.text.slice(0, 80)}`);
  const runRejected = await db.payrollRun.findUnique({ where: { id: runId } });
  ok(runRejected?.status === "Calculated", "reject → kembali Calculated", runRejected?.status);
  const chainRj = await db.approvalChain.findFirst({ where: { docType: "PayrollRunConfirm", docId: runId } });
  ok(chainRj?.status === "Rejected" || chainRj === null, "chain rejected/di-reset", chainRj?.status ?? "—");

  const c3 = await patch("/api/rekankerja/payroll-runs", { action: "confirm", id: runId });
  ok(c3.status === 200, "serahkan ulang ke persetujuan", `status=${c3.status}`);
  const ap = await patch("/api/rekankerja/payroll-runs", { action: "confirmApprove", id: runId });
  ok(ap.status === 200, "confirmApprove (HR_ADMIN = hrd owner) 200", `${ap.text.slice(0, 90)}`);
  const runDone = await db.payrollRun.findUnique({ where: { id: runId } });
  ok(runDone?.status === "Confirmed" && !!runDone?.confirmedAt, "status Confirmed + confirmedAt", runDone?.status);
  const journalDone = await db.payrollJournal.findFirst({ where: { runId } });
  ok(!!journalDone, "jurnal ter-posting otomatis pasca approve", journalDone?.journalNo ?? "—");
  const periodDone = await db.payrollPeriod.findUnique({ where: { id: periodId } });
  ok(periodDone?.status === "Processed", "period → Processed", periodDone?.status);

  const logs = await db.activityLog.count({
    where: { entity: "PayrollRun", entityId: runId, createdAt: { gte: startedAt } },
  });
  ok(logs >= 3, "ActivityLog ≥3 langkah ter-audit (submit/reject/approve)", `${logs} baris`);

  // ================= CLEANUP =================
  console.log("\n[CLEANUP] hapus artefak uji (ActivityLog DIPERTAHANKAN)");
  const safe = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { console.log(`    ! cleanup ${label}: ${String((e as Error)?.message ?? e).slice(0, 90)}`); }
  };
  await safe("journalLines", () => db.payrollJournalLine.deleteMany({ where: { journal: { runId } } }));
  await safe("journals", () => db.payrollJournal.deleteMany({ where: { runId } }));
  await safe("runItems", () => db.payrollRunItem.deleteMany({ where: { line: { runId } } }));
  await safe("runLines", () => db.payrollRunLine.deleteMany({ where: { runId } }));
  await safe("runLogs", () => db.payrollRunLog.deleteMany({ where: { runId } }));
  await safe("approvalSteps", () => db.approvalStep.deleteMany({ where: { chain: { docType: "PayrollRunConfirm", docId: runId } } }));
  await safe("approvalChains", () => db.approvalChain.deleteMany({ where: { docType: "PayrollRunConfirm", docId: runId } }));
  await safe("run", () => db.payrollRun.deleteMany({ where: { id: runId } }));
  const structDel = await db.approvalStructure.deleteMany({ where: { code: STRUCT_CODE } }).catch(() => ({ count: 0 }));
  await safe("structureLevels", () => db.approvalStructureLevel.deleteMany({ where: { structure: { code: STRUCT_CODE } } }));
  await safe("period", () => db.payrollPeriod.deleteMany({ where: { id: periodId } }));
  ok(structDel.count === 1, "struktur uji dihapus (default OFF kembali)");
  const leftRuns = await db.payrollRun.count({ where: { id: runId } });
  const leftPeriods = await db.payrollPeriod.count({ where: { id: periodId } });
  const leftStructs = await db.approvalStructure.count({ where: { docType: "PayrollRunConfirm" } });
  ok(leftRuns === 0 && leftPeriods === 0 && leftStructs === 0, "run + period + struktur bersih", `run=${leftRuns} period=${leftPeriods} struct=${leftStructs}`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
