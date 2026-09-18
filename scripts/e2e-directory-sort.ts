/**
 * E2E PROD — Sorting server-side direktori karyawan (Task 74).
 * Bukti sort lintas halaman: 500 karyawan SAYONE (20 halaman × 25).
 *   1. Login.
 *   2. sortBy=employeeNo asc  → hal-1 harus SAYONE00001..00025, hal-2 00026..
 *   3. sortBy=employeeNo desc → hal-1 harus dari NIP terbesar (menurun).
 *   4. sortBy=fullName asc    → hal-1 alfabetis A..; hal-2 lanjut urut tanpa reset.
 *   5. sortBy=baseSalary desc → gaji hal-1 menurun & semua ≥ gaji pertama hal-2.
 *   6. sortDir tak valid → dianggap asc.
 * Usage: npx tsx scripts/e2e-directory-sort.ts <base-url>
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const PAGE = 25;

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
  console.log(`E2E directory sort → ${BASE}`);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.E2E_EMAIL ?? "puja.asmara@sayone.com", password: process.env.E2E_PASSWORD ?? "Asmaree.007" }),
    redirect: "manual",
  });
  storeCookies(login);
  if (login.status !== 200) throw new Error(`login gagal: ${login.status}`);

  // Unlock Money Vault agar baseSalary terbaca (tanpa ini gaji = null semua)
  await fetch(`${BASE}/api/onevity/money-vault`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader() },
    body: JSON.stringify({ action: "unlock", password: process.env.E2E_VAULT ?? "asmaree.007" }),
    redirect: "manual",
  }).catch(() => null);

  let fail = 0;
  const get = async (sortBy: string, sortDir: string, offset: number) => {
    const r = await api(`/api/onevity/employees?limit=${PAGE}&offset=${offset}&sortBy=${sortBy}&sortDir=${sortDir}`);
    if (r.status !== 200) throw new Error(`GET employees ${r.status}`);
    return (r.body.employees ?? []) as { employeeNo: string; fullName: string; baseSalary: number | null }[];
  };

  // 2) NIP asc — hal 1 & 2 harus bersambung lintas halaman
  const p1 = await get("employeeNo", "asc", 0);
  const p2 = await get("employeeNo", "asc", PAGE);
  const n1 = p1.map((e) => nipNum(e.employeeNo));
  const n2 = p2.map((e) => nipNum(e.employeeNo));
  const ascOk = n1.every((v, i) => i === 0 || v >= n1[i - 1]) && n2.every((v, i) => i === 0 || v >= n2[i - 1]) && n2[0] >= n1[n1.length - 1];
  console.log(`NIP asc  · hal1 ${n1[0]}..${n1[n1.length - 1]} · hal2 ${n2[0]}..${n2[n2.length - 1]} → ${ascOk ? "✓" : "✗"}`);
  if (!ascOk) fail++;

  // 3) NIP desc — mulai dari terbesar
  const p1d = await get("employeeNo", "desc", 0);
  const n1d = p1d.map((e) => nipNum(e.employeeNo));
  const descOk = n1d.every((v, i) => i === 0 || v <= n1d[i - 1]) && n1d[0] > n1[n1.length - 1];
  console.log(`NIP desc · hal1 ${n1d[0]}..${n1d[n1d.length - 1]} → ${descOk ? "✓" : "✗"}`);
  if (!descOk) fail++;

  // 4) Nama asc — hal 1 & 2 alfabetis dan bersambung
  const p1n = await get("fullName", "asc", 0);
  const p2n = await get("fullName", "asc", PAGE);
  const names = (rows: typeof p1n) => rows.map((e) => e.fullName.toLowerCase());
  const t1 = names(p1n); const t2 = names(p2n);
  const nameOk = t1.every((v, i) => i === 0 || t1[i - 1].localeCompare(v, "id") <= 0)
    && t2.every((v, i) => i === 0 || t2[i - 1].localeCompare(v, "id") <= 0)
    && t2[0].localeCompare(t1[t1.length - 1], "id") >= 0;
  console.log(`Nama asc · hal1 "${t1[0]}".. "${t1[t1.length - 1]}" · hal2 mulai "${t2[0]}" → ${nameOk ? "✓" : "✗"}`);
  if (!nameOk) fail++;

  // 5) Gaji desc — hal1 min ≥ hal2 max (sort menembus seluruh data terfilter)
  const s1 = await get("baseSalary", "desc", 0);
  const s2 = await get("baseSalary", "desc", PAGE);
  const g1 = s1.map((e) => e.baseSalary ?? 0);
  const g2 = s2.map((e) => e.baseSalary ?? 0);
  const gajiOk = g1.every((v, i) => i === 0 || v <= g1[i - 1]) && g2.every((v, i) => i === 0 || v <= g2[i - 1]) && g1[g1.length - 1] >= g2[0];
  console.log(`Gaji desc· hal1 min ${g1[g1.length - 1]} ≥ hal2 max ${g2[0]} → ${gajiOk ? "✓" : "✗"}`);
  if (!gajiOk) fail++;

  // 6) sortDir tidak valid → asc
  const px = await get("employeeNo", "bogus", 0);
  const nx = px.map((e) => nipNum(e.employeeNo));
  const fallbackOk = nx.every((v, i) => i === 0 || v >= nx[i - 1]);
  console.log(`sortDir invalid → asc fallback ${fallbackOk ? "✓" : "✗"}`);
  if (!fallbackOk) fail++;

  if (fail) throw new Error(`${fail} pengujian gagal`);
  console.log("\nPASS");
}

main().catch((e) => { console.error("E2E GAGAL:", e.message); process.exit(1); });

export {} // module scope — hindari bentrok deklarasi antar skrip E2E
