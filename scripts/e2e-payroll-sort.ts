/**
 * E2E PROD — Sorting server-side profil payroll & run payroll (Task 75).
 *   Profil (500 karyawan aktif, 1 respons):
 *     1. sortBy=employeeNo asc → NIP menaik; sortBy=fullName desc → nama menurun.
 *     2. sortBy=salary desc    → gaji menurun (vault unlock), tanpa sortBy → urutan default.
 *     3. sortBy=ptkp           → kelompok status pajak tersusun alfabetis.
 *     4. sortBy tak dikenal    → fallback employeeNo asc.
 *   Runs:
 *     5. sortBy=runNo desc     → runNo menurun; sortBy=net asc → THP menaik (vault unlock).
 *     6. sortBy=period asc     → startDate periode menaik.
 * Usage: npx tsx scripts/e2e-payroll-sort.ts <base-url>
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";

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
async function api(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: cookieHeader() }, redirect: "manual" });
  storeCookies(res);
  let body: any = null;
  try { body = await res.json(); } catch { /* noop */ }
  return { status: res.status, body };
}
const nipNum = (nip: string) => Number(nip.replace(/\D/g, "")) || 0;

async function main(): Promise<void> {
  console.log(`E2E payroll sort → ${BASE}`);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.E2E_EMAIL ?? "puja.asmara@sayone.com", password: process.env.E2E_PASSWORD ?? "Asmaree.007" }),
    redirect: "manual",
  });
  storeCookies(login);
  if (login.status !== 200) throw new Error(`login gagal: ${login.status}`);
  // vault unlock — gaji & THP terbaca
  await fetch(`${BASE}/api/onevity/money-vault`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader() },
    body: JSON.stringify({ action: "unlock", password: process.env.E2E_VAULT ?? "asmaree.007" }),
    redirect: "manual",
  }).catch(() => null);

  let fail = 0;
  const profiles = async (qs: string) => {
    const r = await api(`/api/onevity/payroll-profiles${qs}`);
    if (r.status !== 200) throw new Error(`profiles ${r.status}`);
    return (r.body.employees ?? []) as { employeeNo: string; fullName: string; baseSalary: number; profile: { taxStatus: string } | null }[];
  };

  // 1) NIP asc & nama desc
  const pAsc = await profiles("?sortBy=employeeNo&sortDir=asc");
  const nAsc = pAsc.map((e) => nipNum(e.employeeNo));
  const ok1 = nAsc.every((v, i) => i === 0 || v >= nAsc[i - 1]);
  console.log(`Profil NIP asc  (${pAsc.length} rows) → ${ok1 ? "✓" : "✗"}`);
  if (!ok1) fail++;

  const pDesc = await profiles("?sortBy=fullName&sortDir=desc");
  const namesD = pDesc.map((e) => e.fullName.toLowerCase());
  const ok2 = namesD.every((v, i) => i === 0 || namesD[i - 1].localeCompare(v, "id") >= 0);
  console.log(`Profil nama desc ("${namesD[0]}" → "${namesD[namesD.length - 1]}") → ${ok2 ? "✓" : "✗"}`);
  if (!ok2) fail++;

  // 2) Gaji desc — gaji menurun penuh
  const pSal = await profiles("?sortBy=salary&sortDir=desc");
  const sal = pSal.map((e) => e.baseSalary ?? 0);
  const ok3 = sal.every((v, i) => i === 0 || v <= sal[i - 1]) && sal[0] > sal[sal.length - 1];
  console.log(`Profil gaji desc (${sal[0]} → ${sal[sal.length - 1]}) → ${ok3 ? "✓" : "✗"}`);
  if (!ok3) fail++;

  // 3) PTKP asc — kolom profil nested tersusun
  const pPtkp = await profiles("?sortBy=ptkp&sortDir=asc");
  const ptkp = pPtkp.map((e) => e.profile?.taxStatus ?? "");
  const ok4 = ptkp.every((v, i) => i === 0 || ptkp[i - 1].localeCompare(v, "id") <= 0);
  console.log(`Profil PTKP asc (${ptkp[0]}..${ptkp[ptkp.length - 1]}) → ${ok4 ? "✓" : "✗"}`);
  if (!ok4) fail++;

  // 4) sortBy tak dikenal → fallback NIP asc
  const pX = await profiles("?sortBy=hack&sortDir=desc");
  const nX = pX.map((e) => nipNum(e.employeeNo));
  const ok5 = nX.every((v, i) => i === 0 || v >= nX[i - 1]);
  console.log(`Profil sortBy invalid → fallback asc → ${ok5 ? "✓" : "✗"}`);
  if (!ok5) fail++;

  // 5-6) Runs
  const runs = async (qs: string) => {
    const r = await api(`/api/onevity/payroll-runs${qs}`);
    if (r.status !== 200) throw new Error(`runs ${r.status}`);
    return (r.body.runs ?? []) as { runNo: string; totalNet: number; period: { startDate: string } }[];
  };
  const rDesc = await runs("?sortBy=runNo&sortDir=desc");
  const ok6 = rDesc.every((v, i) => i === 0 || v.runNo <= rDesc[i - 1].runNo);
  console.log(`Run runNo desc (${rDesc[0]?.runNo} → ${rDesc[rDesc.length - 1]?.runNo}) → ${ok6 ? "✓" : "✗"}`);
  if (!ok6) fail++;

  const rNet = await runs("?sortBy=net&sortDir=asc");
  const nets = rNet.map((r) => r.totalNet ?? 0);
  const ok7 = nets.every((v, i) => i === 0 || v >= nets[i - 1]);
  console.log(`Run THP asc (${nets[0]} → ${nets[nets.length - 1]}) → ${ok7 ? "✓" : "✗"}`);
  if (!ok7) fail++;

  const rPeriod = await runs("?sortBy=period&sortDir=asc");
  const ds = rPeriod.map((r) => r.period.startDate);
  const ok8 = ds.every((v, i) => i === 0 || ds[i - 1] <= v);
  console.log(`Run periode asc (${ds[0]} → ${ds[ds.length - 1]}) → ${ok8 ? "✓" : "✗"}`);
  if (!ok8) fail++;

  if (fail) throw new Error(`${fail} pengujian gagal`);
  console.log("\nPASS");
}

main().catch((e) => { console.error("E2E GAGAL:", e.message); process.exit(1); });
export {} // module scope — hindari bentrok deklarasi antar skrip E2E
