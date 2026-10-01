/**
 * Task 64h — E2E PROD: bukti BASIC = penuh versi period end (tidak diprorata).
 * Alur: login (puja.asmara@sayone.com) → unlock Money Vault → PA SalaryAdjustment
 * (eff 16 Sep, tengah bulan) utk SAYONE00002 → submit/approve/process via API
 * → jalankan run payroll September (recalculate bila ada) → baca BASIC dari
 * PayrollLine → bandingkan dgn gaji versi period end.
 * Usage: npx tsx scripts/e2e-basic-periodend.ts <base-url>
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const EMAIL = "puja.asmara@sayone.com";
const PASSWORD = "Asmaree.007";
const VAULT_PASSWORD = "asmaree.007";
const EMP_NO = "SAYONE00002";

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
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(),
      ...(init?.headers ?? {}),
    },
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body };
}
const post = (path: string, data: unknown) => api(path, { method: "POST", body: JSON.stringify(data) });
const patch = (path: string, data: unknown) => api(path, { method: "PATCH", body: JSON.stringify(data) });
const get = (path: string) => api(path);

function die(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // 1) Login
  const login = await post("/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (login.status !== 200) die(`login ${login.status}: ${JSON.stringify(login.body).slice(0, 200)}`);
  console.log("LOGIN OK");

  // 2) Money Vault unlock (nilai uang nyata terbaca + engine pakai data asli)
  const vault = await post("/api/rekankerja/money-vault", { action: "unlock", password: VAULT_PASSWORD });
  if (vault.status !== 200) die(`vault unlock ${vault.status}: ${JSON.stringify(vault.body).slice(0, 200)}`);
  console.log("VAULT UNLOCKED");

  // 3) Cari karyawan + periode September
  const emps = await get("/api/rekankerja/payroll-profiles");
  if (emps.status !== 200) die(`profiles ${emps.status}`);
  const emp = (emps.body.employees as any[]).find((e) => e.employeeNo === EMP_NO);
  if (!emp) die(`karyawan ${EMP_NO} tidak ditemukan`);
  const curSalary = emp.baseSalary as number;
  console.log(`EMP ${emp.employeeNo} ${emp.fullName} — gaji berlaku sekarang: ${curSalary}`);

  const periods = await get("/api/rekankerja/payroll-periods");
  if (periods.status !== 200) die(`periods ${periods.status}`);
  const sep = (periods.body.periods ?? periods.body ?? []).find((p: any) =>
    p.name?.toLowerCase().includes("sep") && new Date(p.startDate).getFullYear() === 2026);
  if (!sep) die("periode September 2026 tidak ditemukan");
  console.log(`PERIOD ${sep.name} (${sep.startDate?.slice(0, 10)} → ${sep.endDate?.slice(0, 10)})`);

  // 4) PA SalaryAdjustment eff 16 Sep (mid-month) — gaji baru = sekarang + 500.000
  // Idempoten: pakai PA uji sebelumnya yang belum diproses bila ada.
  const existing = await get(`/api/rekankerja/personnel-actions?employeeId=${emp.employeeId}`);
  const prev = ((existing.body.actions ?? existing.body ?? []) as any[]).find(
    (a) => a.type === "SalaryAdjustment" && a.status !== "Processed" && String(a.reason ?? "").includes("E2E 64h"));
  let paId: string; let paDoc: string; const newSalary = curSalary + 500_000;
  if (prev?.id) {
    paId = prev.id; paDoc = prev.docNo;
    console.log(`PA REUSED ${paDoc} (status ${prev.status})`);
  } else {
    const pa = await post("/api/rekankerja/personnel-actions", {
      employeeId: emp.employeeId,
      type: "SalaryAdjustment",
      effectiveDate: "2026-09-16",
      reason: "E2E 64h — kenaikan gaji mid-month (uji BASIC period end)",
      detail: { newSalary },
    });
    if (pa.status !== 200 && pa.status !== 201) die(`PA create ${pa.status}: ${JSON.stringify(pa.body).slice(0, 200)}`);
    paId = pa.body.action?.id ?? pa.body.id;
    paDoc = pa.body.action?.docNo ?? pa.body.docNo;
    console.log(`PA CREATED ${paDoc} — newSalary ${newSalary}`);
  }

  // 5) submit → approve semua layer → process
  let sub = await patch(`/api/rekankerja/personnel-actions/${paId}`, { action: "submit" });
  if (sub.status !== 200) die(`submit ${sub.status}: ${JSON.stringify(sub.body).slice(0, 200)}`);
  for (let i = 0; i < 5; i++) {
    const ap = await patch(`/api/rekankerja/personnel-actions/${paId}`, { action: "approve" });
    if (ap.status !== 200) die(`approve ${ap.status}: ${JSON.stringify(ap.body).slice(0, 200)}`);
    if (ap.body.status === "Approved") break;
  }
  const proc = await patch(`/api/rekankerja/personnel-actions/${paId}`, { action: "process" });
  if (proc.status !== 200) die(`process ${proc.status}: ${JSON.stringify(proc.body).slice(0, 200)}`);
  console.log("PA PROCESSED (chain updated, eff 16 Sep)");

  // 6) Run payroll September (SALARY) — pakai run yang ada (recalculate) atau buat baru
  const pts = await get("/api/rekankerja/process-types");
  if (pts.status !== 200) die(`process-types ${pts.status}`);
  const pt = (pts.body.processTypes as any[]).find((x) => x.code === "SALARY");
  if (!pt) die("processType SALARY tidak ditemukan");

  const runs = await get(`/api/rekankerja/payroll-runs?periodId=${sep.id}`);
  if (runs.status !== 200) die(`runs ${runs.status}`);
  const runList = (runs.body.runs ?? []) as any[];
  let run = runList.find((r) => r.processType?.code === "SALARY") ?? runList[0];
  if (run) {
    console.log(`RUN EXISTS ${run.runNo} (status ${run.status}) → recalculate`);
    const rec = await patch("/api/rekankerja/payroll-runs", { id: run.id, action: "calculate" });
    if (rec.status !== 200) die(`recalculate ${rec.status}: ${JSON.stringify(rec.body).slice(0, 200)}`);
    console.log(`RECALCULATED: ${JSON.stringify(rec.body.summary ?? {}).slice(0, 160)}`);
  } else {
    const st = await post("/api/rekankerja/payroll-runs", { periodId: sep.id, processTypeId: pt.id });
    if (st.status !== 200 && st.status !== 201) die(`run create ${st.status}: ${JSON.stringify(st.body).slice(0, 200)}`);
    run = st.body.run;
    console.log(`RUN CREATED ${run.runNo}`);
    const calc = await patch("/api/rekankerja/payroll-runs", { id: run.id, action: "calculate" });
    if (calc.status !== 200) die(`calculate ${calc.status}: ${JSON.stringify(calc.body).slice(0, 200)}`);
    console.log(`CALCULATED: ${JSON.stringify(calc.body.summary ?? {}).slice(0, 160)}`);
  }

  // 7) Baca BASIC milik karyawan uji dari run detail
  const det = await get(`/api/rekankerja/payroll-run?id=${run.id}`);
  if (det.status !== 200) die(`run detail ${det.status}`);
  const lines = (det.body.run?.lines ?? []) as any[];
  const line = lines.find((l) => l.employeeNo === EMP_NO);
  if (!line) die("line karyawan uji tidak ditemukan di run");
  const basic = (line.items ?? []).find((i: any) => i.wageType === "BasicSalary" || i.code === "BASIC");
  if (!basic) die("baris BASIC tidak ditemukan di slip");

  console.log("=== HASIL ===");
  console.log(`Gaji versi lama        : ${curSalary}`);
  console.log(`Gaji versi baru (16 Sep): ${newSalary}`);
  console.log(`BASIC pada run Sep      : ${basic.amount}`);
  if (basic.note) console.log(`Note                   : ${basic.note}`);
  const full = basic.amount === newSalary;
  const prorated = Math.abs(basic.amount - newSalary) > 1 && basic.amount !== curSalary;
  console.log(full
    ? "✅ PASS — BASIC = penuh gaji versi PERIOD END (tidak diprorata)"
    : prorated
      ? "❌ FAIL — BASIC tampak diprorata/dicampur"
      : `❌ FAIL — BASIC = ${basic.amount} (bukan versi period end)`);
  process.exit(full ? 0 : 1);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));

export {}
