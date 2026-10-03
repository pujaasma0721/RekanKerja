// Uji rantai UMC end-to-end (medis — penerus wave3, item backlog "uji rantai UMC"):
//   transferUnusedToPayroll → assignment UMC Specific×SALARY pada period target
//     (notes "Uang sisa saldo medis {year}: …", saldo CASH tahun itu terkonsumsi)
//   → run SALARY period yang sama dibuat → calculate → CONFIRM
//   → confirmRun() memanggil markMedicalPaidForRun → notes assignment bertambah
//     "— Dibayar via run {runNo}" + ActivityLog MedicalTransfer.
// Resume-safe: skrip dapat dijalankan ulang — bila transfer/saldo sudah terkonsumsi
// atau run sudah Confirmed, lanjut/mengulang verifikasi penandaan (tidak dobel).
// Dampak permanen pada DB demo (by design uji rantai nyata): run SALARY Des {YEAR}
// berstatus Confirmed (tidak dapat dibatalkan), period → Processed, jurnal terpasang,
// cicilan/klaim/OT/encashment/travel window period itu ikut ditandai. Pulihkan bila
// perlu via scripts/restore-demo.ts.
// Jalankan: bun scripts/e2e-medical-umc-chain.ts  (server dev di :3000)
export {};
const BASE = "http://127.0.0.1:3000";
let cookie = "";
const failures: string[] = [];
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures.push(name);
};

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res;
}

async function unlockVaultIfNeeded() {
  const vst = await api("GET", "/api/rekankerja/money-vault");
  const vj = await vst.json().catch(() => ({}));
  if (vj?.configured) {
    const un = await api("POST", "/api/rekankerja/money-vault", { action: "unlock", password: "asmaree.007" });
    ok("buka Money Vault", un.status === 200, `status=${un.status}`);
  } else {
    console.log("  vault: legacy — nilai uang langsung riil");
  }
}

interface Asg { id: string; employeeId: string; notes: string | null; wageComponent: { code: string }; period: { id: string; code: string } }
async function umcAssignments(periodId: string): Promise<Asg[]> {
  const r = await api("GET", "/api/rekankerja/component-assignments?kind=Specific");
  const j = await r.json().catch(() => ({}));
  return (j?.assignments ?? []).filter(
    (a: Asg) => a.wageComponent?.code === "UMC" && a.period?.id === periodId
  );
}

// ===== 1) login owner MII =====
const login = await api("POST", "/api/auth/login", { email: "hrd@mii.co.id", password: "onevity123" });
const lj = await login.json().catch(() => ({}));
ok("login owner MII", login.status === 200, `status=${login.status}`);
if (login.status !== 200) {
  console.error(JSON.stringify(lj));
  process.exit(1);
}
if (!lj?.tenant && Array.isArray(lj?.workspaces) && lj.workspaces.length > 1) {
  const mii = lj.workspaces.find((w: { slug?: string }) => (w.slug ?? "").includes("mitra"));
  const sel = await api("POST", "/api/auth/select-tenant", { tenantId: mii?.id });
  ok("pilih workspace MII", sel.status === 200, `status=${sel.status}`);
}
await unlockVaultIfNeeded();

const YEAR = 2026;

// ===== 2) period target = Desember {YEAR} (akhir tahun — guard W2-1) =====
const perRes = await api("GET", "/api/rekankerja/payroll-periods");
const perJ = await perRes.json().catch(() => ({}));
interface Period { id: string; code: string; name: string; status: string; startDate: string; endDate: string }
const periods: Period[] = perJ?.periods ?? perJ?.data ?? [];
const des = periods.find((p) => p.code === `${YEAR}-12`)
  ?? periods.filter((p) => new Date(p.endDate).getFullYear() === YEAR
    && new Date(p.endDate).getMonth() === 11
    && !["Locked", "Closed"].includes(p.status))
    .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())[0];
ok(`period target Des ${YEAR} tersedia`, !!des, `${des?.code ?? "-"} ${des?.name ?? ""} status=${des?.status}`);
if (!des) process.exit(1);

// ===== 3) processType SALARY + run (baru / lanjutan / sudah confirmed) =====
const ptRes = await api("GET", "/api/rekankerja/process-types");
const ptJ = await ptRes.json().catch(() => ({}));
const ptSalary = (ptJ?.processTypes ?? []).find((t: { code: string }) => t.code === "SALARY");
ok("processType SALARY tersedia", !!ptSalary?.id, ptSalary?.id ?? "-");
if (!ptSalary) process.exit(1);

const runListRes = await api("GET", `/api/rekankerja/payroll-runs?periodId=${des.id}`);
const runListJ = await runListRes.json().catch(() => ({}));
interface RunRow { id: string; runNo: string; status: string; processTypeId: string }
const salRuns: RunRow[] = (runListJ?.runs ?? []).filter((r: RunRow) => r.processTypeId === ptSalary.id && r.status !== "Cancelled");
let run: RunRow | undefined = salRuns.find((r) => ["Confirmed", "Paid"].includes(r.status))
  ?? salRuns.find((r) => ["Draft", "Calculated"].includes(r.status));
if (!run) {
  const created = await api("POST", "/api/rekankerja/payroll-runs", {
    periodId: des.id, processTypeId: ptSalary.id,
    notes: `E2E uji rantai UMC — transfer sisa saldo medis ${YEAR}`,
  });
  const cj = await created.json().catch(() => ({}));
  run = cj?.run;
  ok("buat run SALARY Des (Draft)", created.status === 201 && !!run?.id, `status=${created.status} ${run?.runNo ?? JSON.stringify(cj)}`);
} else {
  console.log(`  reuse run ${run.runNo} (${run.status})`);
}
if (!run) process.exit(1);
const verifyOnly = ["Confirmed", "Paid"].includes(run.status);

// state assignment UMC period (pre-read — dipakai resume & verifikasi)
const preAsg = await umcAssignments(des.id);
const preEmp = new Set(preAsg.map((a) => a.employeeId)).size;

let trEmp = preEmp;
let transferDetail = "";
if (verifyOnly) {
  console.log("  run sudah Confirmed — mode VERIFIKASI penandaan (tanpa mutasi baru)");
  transferDetail = "resume (run sudah confirmed)";
} else {
  // ===== 4) transfer UMC {YEAR} → period Des =====
  async function doTransfer(): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await api("POST", "/api/rekankerja/medical/transfer", { periodId: des!.id, year: YEAR });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  }
  let tr = await doTransfer();
  let cleanupCount = 0;
  // guard K-2(b): klaim CASH {YEAR} masih menunggu → batalkan klaim tsb lalu retry
  for (let attempt = 0; attempt < 2 && tr.status === 400; attempt++) {
    const msg = String(tr.body?.error ?? "");
    const docNos = [...msg.matchAll(/MC-\d+-\d+/g)].map((m) => m[0]);
    if (docNos.length === 0) break;
    console.log(`  guard klaim pending CASH: ${docNos.join(", ")} — dibatalkan utk melanjutkan uji`);
    const claimsRes = await api("GET", `/api/rekankerja/medical/claims?year=${YEAR}`);
    const claimsJ = await claimsRes.json().catch(() => ({}));
    const claims: { id: string; docNo: string }[] = claimsJ?.claims ?? [];
    for (const dn of docNos) {
      const c = claims.find((x) => x.docNo === dn);
      if (!c) continue;
      const cc = await api("PATCH", "/api/rekankerja/medical/claims", { id: c.id, action: "cancel", note: "E2E uji rantai UMC — klaim dibatalkan agar transfer sisa saldo dapat diuji" });
      if (cc.status === 200) cleanupCount++;
    }
    tr = await doTransfer();
  }
  const trBody = tr.body as { employees?: number } | undefined;
  if (tr.status === 200 || tr.status === 201) {
    trEmp = trBody?.employees ?? 0;
    transferDetail = `${trEmp} karyawan, Rp ${((tr.body as { totalAmount?: number })?.totalAmount ?? 0).toLocaleString("id-ID")}${cleanupCount ? ` (${cleanupCount} klaim pending dibatalkan)` : ""}`;
  } else if (String(tr.body?.error ?? "").includes("Tidak ada sisa saldo CASH") && preEmp > 0) {
    // resume: transfer sebelumnya sudah menulis assignment & mengonsumsi saldo
    trEmp = preEmp;
    transferDetail = `resume — assignment UMC sudah ada (${preEmp} karyawan)`;
  } else {
    transferDetail = `status=${tr.status} ${JSON.stringify(tr.body)}`;
  }
  ok(`transfer sisa saldo CASH ${YEAR} → ${des.code}`, trEmp > 0, transferDetail);
  if (trEmp === 0) process.exit(1);

  // ===== 5) calculate run — UMC harus masuk snapshot item =====
  const calc = await api("PATCH", "/api/rekankerja/payroll-runs", { id: run.id, action: "calculate" });
  const calcJ = await calc.json().catch(() => ({}));
  ok("calculate run SALARY Des", calc.status === 200 && (calcJ?.summary?.employees ?? 0) > 0,
    `${calcJ?.summary?.employees ?? 0} karyawan, THP ${calcJ?.summary?.totalNet ?? "-"}`);

  const runDetailRes = await api("GET", `/api/rekankerja/payroll-run?id=${run.id}`);
  const rdJ = await runDetailRes.json().catch(() => ({}));
  interface RunLine { employeeId: string; employeeNo: string; items: { code: string; type: string }[] }
  const lines: RunLine[] = rdJ?.run?.lines ?? [];
  const umcLines = lines.filter((l) => l.items.some((i) => i.code === "UMC"));
  ok("item UMC masuk snapshot run (assignment → PayrollRunItem)", umcLines.length > 0,
    `${umcLines.length}/${lines.length} baris karyawan menerima UMC`);
  ok("jumlah baris UMC == karyawan transfer", umcLines.length === trEmp, `${umcLines.length} vs ${trEmp}`);
  if (umcLines.length === 0) process.exit(1);

  // ===== 6) confirm run → markMedicalPaidForRun =====
  const conf = await api("PATCH", "/api/rekankerja/payroll-runs", { id: run.id, action: "confirm" });
  ok("confirm run SALARY Des", conf.status === 200, `status=${conf.status}`);
}

// ===== 7) assignment UMC bertanda "Dibayar via run {runNo}" =====
const asg = await umcAssignments(des.id);
const paid = asg.filter((a) => (a.notes ?? "").includes("Dibayar via run"));
ok("semua assignment UMC period Des bertanda Dibayar via run",
  asg.length > 0 && paid.length === asg.length && new Set(asg.map((a) => a.employeeId)).size === trEmp,
  `${paid.length}/${asg.length} assignment, ${new Set(asg.map((a) => a.employeeId)).size} karyawan (target ${trEmp})`);
ok("penanda memuat runNo yang benar", paid.every((a) => (a.notes ?? "").includes(run!.runNo)),
  `runNo=${run!.runNo}`);
const sample = paid[0]?.notes ?? "";
console.log(`  contoh notes: "${sample}"`);

// ===== 8) ActivityLog MedicalTransfer =====
const logRes = await api("GET", `/api/rekankerja/activity-logs?entity=MedicalTransfer&limit=100`);
const logJ = await logRes.json().catch(() => ({}));
const logs: { detail: string }[] = logJ?.logs ?? logJ?.items ?? [];
const paidLog = logs.find((l) => (l.detail ?? "").includes("ditandai Dibayar via run") && (l.detail ?? "").includes(run!.runNo));
ok("ActivityLog MedicalTransfer mencatat penandaan", !!paidLog, paidLog?.detail?.slice(0, 120) ?? "tidak ditemukan");

// ===== 9) idempoten: confirm ulang ditolak & notes tidak terduplikasi =====
const conf2 = await api("PATCH", "/api/rekankerja/payroll-runs", { id: run.id, action: "confirm" });
ok("confirm ulang ditolak (run sudah dikonfirmasi)", conf2.status !== 200,
  `status=${conf2.status} ${String((await conf2.json().catch(() => ({})))?.error ?? "").slice(0, 80)}`);
const asg2 = await umcAssignments(des.id);
const noDup = asg2.every((a) => ((a.notes ?? "").match(new RegExp(run!.runNo, "g")) ?? []).length === 1);
ok("notes tidak terduplikasi (satu penanda runNo per assignment)", noDup);

// ===== ringkasan =====
console.log(`\n${failures.length === 0 ? "SEMUA LULUS" : `${failures.length} GAGAL`}: uji rantai UMC (transfer → run SALARY → confirm → markMedicalPaidForRun)`);
process.exit(failures.length === 0 ? 0 : 1);
