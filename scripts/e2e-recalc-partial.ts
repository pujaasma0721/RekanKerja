/**
 * Task 64j — E2E PROD: HITUNG ULANG PARSIAL (recalcEmployees) pada run Confirmed.
 * Alur:
 *   1. Login owner + unlock Money Vault (baca nilai uang nyata).
 *   2. Cari run SALARY September berstatus Confirmed.
 *   3. Snapshot baris kontrol (karyawan yang TIDAK di-recalc) — harus tak berubah.
 *   4. Buat komponen Earning "E2E_RECALC" + assignment Specific (Rp 777.000)
 *      untuk SAYONE00003 pada period×processType run (simulasi upload terlambat).
 *   5. PATCH payroll-runs { action: "recalcEmployees", employeeIds: [emp] }.
 *   6. Verifikasi:
 *      - run.status === "Calculated" (kembali menunggu konfirmasi)
 *      - baris karyawan uji memuat item E2E_RECALC = 777.000; THP naik tepat +777.000
 *      - baris KONTROL tidak berubah (net sama persis)
 *      - jurnal lama berstatus Reversed + jurnal baru ada (Posted)
 *   7. Cleanup: hapus assignment → recalcEmployees sekali lagi → verifikasi item
 *      hilang → konfirmasi ulang run → status kembali Confirmed.
 * Usage: npx tsx scripts/e2e-recalc-partial.ts <base-url>
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const EMAIL = "puja.asmara@sayone.com";
const PASSWORD = "Asmaree.007";
const VAULT_PASSWORD = "asmaree.007";
const EMP_NO = "SAYONE00003";
const TEST_AMOUNT = 777_000;
const TEST_CODE = "E2E_RECALC";

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
async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: cookieHeader(), ...(init?.headers ?? {}) },
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body };
}
const post = (p: string, d: unknown) => api(p, { method: "POST", body: JSON.stringify(d) });
const patch = (p: string, d: unknown) => api(p, { method: "PATCH", body: JSON.stringify(d) });
const del = (p: string) => api(p, { method: "DELETE" });
const get = (p: string) => api(p);

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}
function die(msg: string): never {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

async function fetchRun(runId: string) {
  const det = await get(`/api/rekankerja/payroll-run?id=${runId}`);
  if (det.status !== 200) die(`run detail ${det.status}`);
  return det.body as { run: any; logs?: any[] };
}
const lineOf = (run: any, empNo: string) => (run.lines as any[]).find((l) => l.employeeNo === empNo);

async function main(): Promise<void> {
  // 1) Login + vault
  const login = await post("/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (login.status !== 200) die(`login ${login.status}`);
  const vault = await post("/api/rekankerja/money-vault", { action: "unlock", password: VAULT_PASSWORD });
  if (vault.status !== 200) die(`vault ${vault.status}`);
  console.log("LOGIN + VAULT OK");

  // 2) Run SALARY September Confirmed
  const periods = await get("/api/rekankerja/payroll-periods");
  const sep = (periods.body.periods ?? []).find((p: any) => p.name?.toLowerCase().includes("sep") && new Date(p.startDate).getFullYear() === 2026);
  if (!sep) die("period Sep tidak ditemukan");
  const runs = await get(`/api/rekankerja/payroll-runs?periodId=${sep.id}`);
  const run = (runs.body.runs ?? []).find((r: any) => r.processType?.code === "SALARY" && (r.status === "Confirmed" || r.status === "Calculated"));
  if (!run) die("tidak ada run SALARY Sep berstatus Confirmed/Calculated untuk uji");
  console.log(`RUN ${run.runNo} (${run.status}, ${run.employeeCount} karyawan)`);

  // 3) Karyawan uji + snapshot kontrol (+ bersihkan sisa uji sebelumnya)
  let det0 = await fetchRun(run.id);
  let line0 = lineOf(det0.run, EMP_NO);
  if (!line0) die(`${EMP_NO} tidak ada di run`);
  if ((line0.items ?? []).some((i: any) => i.code === TEST_CODE)) {
    // Sisa uji sebelumnya masih menempel di run → recalc sekali tanpa assignment
    // supaya snapshot bersih.
    console.log("STALE ITEM terdeteksi — recalc pembersihan awal…");
    const purge = await patch("/api/rekankerja/payroll-runs", { id: run.id, action: "recalcEmployees", employeeIds: [line0.employeeId] });
    if (purge.status !== 200) die(`purge recalc ${purge.status}: ${JSON.stringify(purge.body).slice(0, 200)}`);
    det0 = await fetchRun(run.id);
    line0 = lineOf(det0.run, EMP_NO);
    if (!line0) die(`${EMP_NO} hilang setelah purge`);
  }
  const control = (det0.run.lines as any[]).find((l) => l.employeeId !== line0.employeeId);
  if (!control) die("tidak ada baris kontrol");
  const snapControl = { net: control.net, bruto: control.bruto };
  const runNetBefore = det0.run.totalNet;
  console.log(`TARGET ${EMP_NO} ${line0.employeeName} — THP awal ${line0.net}; kontrol ${control.employeeNo} net ${snapControl.net}`);

  // 4) Komponen uji + assignment Specific terlambat
  const comps = await get("/api/rekankerja/wage-components");
  if (comps.status !== 200) die(`wage-components ${comps.status}`);
  let comp = (comps.body.components ?? []).find((c: any) => c.code === TEST_CODE);
  if (!comp) {
    const created = await post("/api/rekankerja/wage-components", {
      code: TEST_CODE, name: "E2E Uji Recalc Parsial", type: "Earning", wageType: "Allowance",
      classification: "Earning", active: true, prorated: false,
    });
    if (created.status !== 200 && created.status !== 201) die(`create comp ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
    comp = created.body.component ?? created.body;
  }
  console.log(`COMPONENT ${comp.code} (${comp.id})`);
  const existingAssignments = await get(`/api/rekankerja/component-assignments?employeeId=${line0.employeeId}&kind=Specific`);
  const stale = ((existingAssignments.body.assignments ?? []) as any[]).filter((a) => a.wageComponentId === comp.id && a.periodId === sep.id);
  for (const s of stale) await del(`/api/rekankerja/component-assignments?id=${s.id}`);
  const asg = await post("/api/rekankerja/component-assignments", {
    employeeId: line0.employeeId, wageComponentId: comp.id, kind: "Specific",
    periodId: sep.id, processTypeId: run.processType.id, amount: TEST_AMOUNT,
    notes: "E2E 64j — upload terlambat (uji recalc parsial)",
  });
  if (asg.status !== 200 && asg.status !== 201) die(`assignment ${asg.status}: ${JSON.stringify(asg.body).slice(0, 200)}`);
  const asgId = (asg.body.assignment ?? asg.body).id;
  console.log(`ASSIGNMENT dibuat ${asgId} (Specific Rp ${TEST_AMOUNT})`);

  // 5) RECALC PARSIAL
  const rec = await patch("/api/rekankerja/payroll-runs", { id: run.id, action: "recalcEmployees", employeeIds: [line0.employeeId] });
  if (rec.status !== 200) die(`recalcEmployees ${rec.status}: ${JSON.stringify(rec.body).slice(0, 300)}`);
  console.log(`RECALC OK: ${JSON.stringify(rec.body).slice(0, 200)}`);

  // 6) Verifikasi
  const det1 = await fetchRun(run.id);
  check("run kembali ke Calculated", det1.run.status === "Calculated", `status=${det1.run.status}`);
  const line1 = lineOf(det1.run, EMP_NO);
  if (!line1) die("baris target hilang setelah recalc");
  const item = (line1.items ?? []).find((i: any) => i.code === TEST_CODE);
  check("item E2E_RECALC muncul di slip", !!item, `amount=${item?.amount}`);
  check("nilai item = 777.000", Math.abs((item?.amount ?? 0) - TEST_AMOUNT) < 1);
  // Allowance kena PPh21: bruto naik penuh +777.000, THP naik setelah pajak.
  check("bruto target naik tepat +777.000", Math.abs((line1.bruto - line0.bruto) - TEST_AMOUNT) < 1, `${line0.bruto} → ${line1.bruto}`);
  check("THP target naik ≤ +777.000 (setelah PPh21)", line1.net > line0.net && (line1.net - line0.net) <= TEST_AMOUNT + 1, `+${line1.net - line0.net}`);
  const ctrl1 = lineOf(det1.run, control.employeeNo);
  check("baris KONTROL tidak berubah", !!ctrl1 && Math.abs(ctrl1.net - snapControl.net) < 1 && Math.abs(ctrl1.bruto - snapControl.bruto) < 1);
  check("total run naik ≤ +777.000 (THP setelah pajak)", det1.run.totalNet > runNetBefore && (det1.run.totalNet - runNetBefore) <= TEST_AMOUNT + 1, `${runNetBefore} → ${det1.run.totalNet}`);
  check("employeeCount tetap", det1.run.employeeCount === det0.run.employeeCount, `${det0.run.employeeCount} → ${det1.run.employeeCount}`);

  // Jurnal: lama Reversed + baru ada
  const jrn = await get("/api/rekankerja/payroll-journals");
  const journals = (jrn.body.journals ?? []) as any[];
  const linked = journals.filter((j) => j.runNo === run.runNo || j.runId === run.id);
  const reversed = linked.filter((j) => j.status === "Reversed");
  const posted = linked.filter((j) => j.status === "Posted");
  check("jurnal lama berstatus Reversed", reversed.length >= 1, `${linked.length} jurnal terkait`);
  check("jurnal baru Posted (hasil gabungan)", posted.length >= 1);

  // Log run memuat jejak recalc parsial? (ActivityLog — via run log saja cukup)
  const logErr = (det1.logs ?? []).filter((l) => l.employeeId === line0.employeeId && l.level === "error").length;
  check("tanpa log error baru utk target", logErr === 0, `${logErr} error`);

  // 7) CLEANUP: hapus assignment → recalc ulang → konfirmasi kembali
  await del(`/api/rekankerja/component-assignments?id=${asgId}`);
  // Recalc beruntun pada run Calculated kini didukung (tanpa konfirmasi dulu).
  const rec2 = await patch("/api/rekankerja/payroll-runs", { id: run.id, action: "recalcEmployees", employeeIds: [line0.employeeId] });
  if (rec2.status !== 200) die(`recalc cleanup ${rec2.status}: ${JSON.stringify(rec2.body).slice(0, 200)}`);
  const det2 = await fetchRun(run.id);
  const line2 = lineOf(det2.run, EMP_NO);
  const gone = line2 && !(line2.items ?? []).some((i: any) => i.code === TEST_CODE);
  check("cleanup: item E2E_RECALC hilang", !!gone);
  check("cleanup: THP target kembali ke awal", !!line2 && Math.abs(line2.net - line0.net) < 1, `${line2?.net} vs ${line0.net}`);
  const cf = await patch("/api/rekankerja/payroll-runs", { id: run.id, action: "confirm" });
  check("cleanup: run dikonfirmasi ulang", cf.status === 200, `status=${cf.status}`);
  const det3 = await fetchRun(run.id);
  check("cleanup: status akhir Confirmed", det3.run.status === "Confirmed", `status=${det3.run.status}`);

  console.log(failures === 0 ? "\n=== SEMUA TES PASS ===" : `\n=== ${failures} TES GAGAL ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));

// modul (hindari konflik identifier global dgn skrip e2e lain)
export {}
