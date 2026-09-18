/**
 * Task 70 — E2E PROD: ubah penempatan SAYONE TANPA Personnel Action
 * (PATCH /api/onevity/employee-detail jalur "Ubah Penempatan" → ManualEdit),
 * lalu buktikan di run payroll September (run Confirmed → recalcEmployees parsial):
 *   1. Timeline riwayat bertambah 1 langkah "Perubahan Manual".
 *   2. BASIC = penuh gaji versi AKHIR period (tidak diprorata) — aturan period end.
 *   3. Prorate segmen bekerja: JHT (3.7% dari basis BPJS) memakai RATA-RATA
 *      TERBOBOT HARI dua segmen (gaji lama × d1 + gaji baru × d2) / hari period.
 *   4. Rollback: gaji & penempatan kembali seperti semula + recalc final.
 * Usage: npx tsx scripts/e2e-transfer-no-pa.ts <base-url> [YYYY-MM-DD]
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const EMAIL = "puja.asmara@sayone.com";
const PASSWORD = "Asmaree.007";
const VAULT_PASSWORD = "asmaree.007";
const EMP_NO = "SAYONE00003";
const ORG_CODE = "E2E-NO-PA-ORG";
const SALARY_DELTA = 1_000_000;

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
const get = (p: string) => api(p);

function die(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
const near = (a: number, b: number) => Math.abs(a - b) <= 2;

async function main(): Promise<void> {
  // 1) Login + unlock Money Vault
  const login = await post("/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (login.status !== 200) die(`login ${login.status}: ${JSON.stringify(login.body).slice(0, 200)}`);
  console.log("LOGIN OK");
  const vault = await post("/api/onevity/money-vault", { action: "unlock", password: VAULT_PASSWORD });
  if (vault.status !== 200) die(`vault unlock ${vault.status}`);
  console.log("VAULT UNLOCKED");

  // 2) Karyawan uji + baseline
  const emps = await get("/api/onevity/payroll-profiles");
  if (emps.status !== 200) die(`profiles ${emps.status}`);
  const emp = (emps.body.employees as any[]).find((e) => e.employeeNo === EMP_NO);
  if (!emp) die(`karyawan ${EMP_NO} tidak ditemukan`);

  const det0 = await get(`/api/onevity/employee-detail?id=${emp.employeeId}`);
  if (det0.status !== 200) die(`detail ${det0.status}`);
  let rows0 = det0.body.employee.assignments as any[];
  let cur = rows0.find((a) => a.validTo == null) ?? rows0[rows0.length - 1];
  // Pembersihan mandiri: bila aktif masih di org uji (sisa run sebelumnya),
  // pulihkan dulu ke org ASLI (baris ter awal) sebelum uji.
  const isE2eOrgRow = (a: any) => (a.orgUnit?.code ?? "").includes("E2E-NO-PA") || (a.orgUnit?.name ?? "").includes("Org Uji E2E");
  if (isE2eOrgRow(cur)) {
    const orig = rows0.find((a) => !isE2eOrgRow(a)) ?? rows0[0];
    const fix = await patch(`/api/onevity/employee-detail?id=${emp.employeeId}`, {
      orgUnitId: orig.orgUnitId, baseSalary: Number(orig.baseSalary ?? 0) || undefined,
      effectiveDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      changeNote: "E2E — pembersihan sisa uji (kembali ke org asli)",
    });
    if (fix.status !== 200) die(`cleanup ${fix.status}: ${JSON.stringify(fix.body).slice(0, 200)}`);
    console.log("CLEANUP: sisa uji lama dipulihkan ke org asli");
    const det0b = await get(`/api/onevity/employee-detail?id=${emp.employeeId}`);
    rows0 = det0b.body.employee.assignments as any[];
    cur = rows0.find((a) => a.validTo == null) ?? rows0[rows0.length - 1];
  }
  const curSalary = Number(cur.baseSalary ?? 0);
  if (!curSalary) die("gaji aktif kosong — isi profil payroll dulu");
  const newSalary = curSalary + SALARY_DELTA;
  console.log(`EMP ${emp.employeeNo} ${emp.fullName} — baseline: gaji ${curSalary}, org ${cur.orgUnit?.name ?? "-"}, rows=${rows0.length}`);

  // 3) Target org = org uji E2E bila ada & ≠ aktif; selain itu org nyata lain
  const orgs = await get("/api/onevity/org-units");
  if (orgs.status !== 200) die(`org-units ${orgs.status}`);
  const units = (orgs.body.units ?? []) as any[];
  const prevRow = rows0.filter((a) => a.validTo != null).slice(-1)[0];
  const usable = (o: any) => o.id !== cur.orgUnitId && o.id !== (prevRow?.orgUnitId ?? null);
  let targetOrg = units.find((o) => o.code === ORG_CODE && usable(o))
    ?? units.find((o) => !(o.code ?? "").includes("E2E-NO-PA") && usable(o));
  if (!targetOrg) die("tidak ada org target yang usable");

  // 4) Tanggal efektif: SETELAH validFrom baris aktif (hindari no-op merge),
  //    default 19 Sep (mid-month) → segmen 18 hari lama + 12 hari baru.
  const actFrom = new Date(cur.validFrom ?? Date.now());
  const minEff = new Date(actFrom.getTime() + 86400000).toISOString().slice(0, 10);
  let eff = process.argv[3] ?? "2026-09-19";
  if (new Date(eff) <= actFrom) eff = minEff;
  const periodStart = new Date("2026-09-01");
  const d1 = Math.max(1, Math.round((new Date(eff).getTime() - periodStart.getTime()) / 86400000));
  const d2 = 30 - d1;
  console.log(`PARAM: org→${targetOrg.code}, gaji→${newSalary}, eff ${eff} (segmen ${d1}+${d2} hari)`);

  // 5) UBAH PENEMPATAN tanpa PA (org + gaji sekaligus, satu langkah riwayat)
  const ch = await patch(`/api/onevity/employee-detail?id=${emp.employeeId}`, {
    orgUnitId: targetOrg.id,
    baseSalary: newSalary,
    effectiveDate: eff,
    changeNote: "E2E — ubah penempatan tanpa PA (uji prorate segmen)",
  });
  if (ch.status !== 200) die(`ubah penempatan ${ch.status}: ${JSON.stringify(ch.body).slice(0, 200)}`);
  console.log("PATCH OK (ManualEdit tercatat)");

  // 6) Timeline bertambah 1 langkah ManualEdit
  const det1 = await get(`/api/onevity/employee-detail?id=${emp.employeeId}`);
  if (det1.status !== 200) die(`detail2 ${det1.status}`);
  const rows1 = det1.body.employee.assignments as any[];
  const manual = rows1.filter((a) => a.changeReason === "ManualEdit");
  if (rows1.length !== rows0.length + 1 || manual.length === 0) {
    die(`timeline tidak bertambah (before=${rows0.length}, after=${rows1.length})`);
  }
  console.log(`TIMELINE OK — +1 langkah "Perubahan Manual" (total ${rows1.length} versi)`);

  // 7) Run payroll Sep (Confirmed) → hitung ulang PARSIAL karyawan uji
  const periods = await get("/api/onevity/payroll-periods");
  const sep = (periods.body.periods ?? periods.body ?? []).find((p: any) =>
    p.name?.toLowerCase().includes("sep") && new Date(p.startDate).getFullYear() === 2026);
  if (!sep) die("periode September 2026 tidak ditemukan");
  const runs = await get(`/api/onevity/payroll-runs?periodId=${sep.id}`);
  const run = ((runs.body.runs ?? []) as any[]).find((r) => r.processType?.code === "SALARY") ?? (runs.body.runs ?? [])[0];
  if (!run) die("run payroll Sep tidak ditemukan");
  const rec = await patch("/api/onevity/payroll-runs",
    run.status === "Confirmed"
      ? { id: run.id, action: "recalcEmployees", employeeIds: [emp.employeeId] }
      : { id: run.id, action: "calculate" });
  if (rec.status !== 200) die(`recalc ${rec.status}: ${JSON.stringify(rec.body).slice(0, 200)}`);
  console.log(`RECALC OK (${run.runNo}, status ${run.status})`);

  // 8) Baca hasil: BASIC (period end) + JHT company (wavg 2 segmen)
  const detRun = await get(`/api/onevity/payroll-run?id=${run.id}`);
  if (detRun.status !== 200) die(`run detail ${detRun.status}`);
  const line = ((detRun.body.run?.lines ?? []) as any[]).find((l) => l.employeeNo === EMP_NO);
  if (!line) die("line karyawan uji tidak ada di run");
  const basic = (line.items ?? []).find((i: any) => i.wageType === "BasicSalary" || i.code === "BASIC");
  const jhtCo = (line.items ?? []).find((i: any) => i.code === "JHTCO"
    || (i.name ?? "").toLowerCase().includes("jht"));
  if (!basic) die("baris BASIC tidak ada");
  console.log(`BASIC = ${basic.amount}${basic.note ? ` (${basic.note})` : ""}`);
  if (jhtCo) console.log(`JHT-CO = ${jhtCo.amount}${jhtCo.note ? ` (${jhtCo.note})` : ""}`);

  const expWavgChain = (() => {
    // Ekspektasi dari RANTAI VERSI AKTUAL — aturan batas engine: bila validTo
    // sebuah versi == validFrom versi berikutnya (tengah malam), hari itu
    // milik versi BERIKUTNYA (validTo eksklusif); version terakhir sampai akhir
    // period. Ini replika partisi service (cursor inclusive-first).
    const sepStart = new Date("2026-09-01T00:00:00Z").getTime();
    const DAY = 86400000;
    const sepEndEx = new Date("2026-10-01T00:00:00Z").getTime();
    const sorted = [...rows1].sort((a, b) => new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime());
    let num = 0, den = 0;
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const from = Math.max(new Date(r.validFrom).getTime(), sepStart);
      const nextFrom = i + 1 < sorted.length ? new Date(sorted[i + 1].validFrom).getTime() : null;
      const rawTo = r.validTo ? new Date(r.validTo).getTime() : sepEndEx;
      const toEx = nextFrom != null && rawTo === nextFrom ? rawTo : (r.validTo ? rawTo + DAY : sepEndEx);
      const to = Math.min(toEx, sepEndEx);
      if (to <= from) continue;
      const days = Math.round((to - from) / DAY);
      const sal = Number(r.baseSalary ?? 0);
      if (sal > 0 && days > 0) { num += sal * days; den += days; console.log(`  versi ${String(r.validFrom).slice(0, 10)}.. = ${days} hari × ${sal} (${r.orgUnit?.name ?? "-"})`); }
    }
    return den > 0 ? num / den : 0;
  })();
  const expJhtChain = Math.round(expWavgChain * 0.037);
  const okBasic = basic.amount === newSalary;
  const okJht = jhtCo ? near(jhtCo.amount, expJhtChain) : false;
  console.log("--- EKSPEKTASI (dari rantai versi) ---");
  console.log(`BASIC (penuh versi period end) : ${newSalary} → ${okBasic ? "✅" : "❌"}`);
  console.log(`Basis BPJS wavg rantai         : ${Math.round(expWavgChain)}`);
  console.log(`JHT-CO 3.7% × wavg             : ${expJhtChain} → ${okJht ? "✅" : `❌ (dapat ${jhtCo?.amount ?? "-"})`}`);
  const ok = okBasic && okJht;

  // 9) ROLLBACK — kembali ke org ASLI (baris ter awal) + gaji baseline + recalc final
  const origRow = rows0.find((a) => !isE2eOrgRow(a)) ?? rows0[0];
  const backEff = new Date(Math.max(Date.now() + 86400000, actFrom.getTime() + 2 * 86400000)).toISOString().slice(0, 10);
  const rb = await patch(`/api/onevity/employee-detail?id=${emp.employeeId}`, {
    orgUnitId: origRow.orgUnitId,
    baseSalary: curSalary,
    effectiveDate: backEff,
    changeNote: "E2E — rollback uji prorate",
  });
  if (rb.status !== 200) die(`rollback ${rb.status}: ${JSON.stringify(rb.body).slice(0, 200)}`);
  const rec2 = await patch("/api/onevity/payroll-runs",
    run.status === "Confirmed"
      ? { id: run.id, action: "recalcEmployees", employeeIds: [emp.employeeId] }
      : { id: run.id, action: "calculate" });
  if (rec2.status !== 200) die(`recalc final ${rec2.status}`);
  console.log(`ROLLBACK OK (eff ${backEff}) + recalc final — karyawan kembali ke org asli dgn gaji baseline`);

  console.log(ok ? "=== E2E PASS — timeline ✓, BASIC period-end ✓, prorate wavg segmen ✓ ==="
    : "=== E2E FAIL ===");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
export {}
