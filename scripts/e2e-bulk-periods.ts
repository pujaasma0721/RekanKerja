/**
 * E2E PROD — Pembuatan massal period payroll (12 bulan) + TA window user-defined.
 * Alur:
 *   1. Login (cookie session).
 *   2. POST bulk { year: 2027, startDay: 1, useTa: true, TA 26 bln lalu → 25 bln ini }.
 *   3. Verifikasi: 12 period dibuat, kode 2027-01..12, TA window sesuai pola.
 *   4. Uji TA window user-defined per period: PATCH taStartDate/taEndDate (urutan salah ditolak).
 *   5. Uji PATCH taStartDate: null (hapus jendela TA) + kembalikan.
 *   6. Idempoten: POST bulk lagi → 0 dibuat, 12 dilewati.
 *   7. Cleanup: hapus 12 period 2027 (hanya yang tanpa run — memang baru dibuat).
 * Usage: npx tsx scripts/e2e-bulk-periods.ts <base-url>
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const YEAR = 2027;

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
  let body: any = null;
  try { body = await res.json(); } catch { /* no body */ }
  return { status: res.status, body };
}

function iso(y: number, m: number, d: number): string {
  // m bisa 0 (Des tahun lalu) atau 13 (Jan tahun depan)
  const realY = y + Math.floor((m - 1) / 12);
  const realM = ((m - 1) % 12 + 12) % 12 + 1;
  return `${realY}-${String(realM).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

async function login(): Promise<void> {
  const email = process.env.E2E_EMAIL ?? "puja.asmara@sayone.com";
  const password = process.env.E2E_PASSWORD ?? "Asmaree.007";
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  storeCookies(res);
  const body = await res.json().catch(() => null);
  if (res.status !== 200) throw new Error(`login gagal: ${res.status} ${JSON.stringify(body)}`);
}

async function main(): Promise<void> {
  console.log(`E2E bulk periods → ${BASE} (tahun ${YEAR})`);
  await login();

  // 2) Bulk create
  const bulk = await api("/api/rekankerja/payroll-periods", {
    method: "POST",
    body: JSON.stringify({
      bulk: true, year: YEAR, startDay: 1, payType: "Monthly",
      useTa: true, taStartDay: 26, taStartMonthOffset: -1, taEndDay: 25, taEndMonthOffset: 0,
    }),
  });
  const created = bulk.body?.created ?? [];
  const skipped = bulk.body?.skipped ?? [];
  console.log(`POST bulk → ${bulk.status} · dibuat=${created.length} dilewati=${skipped.length}`);
  if (skipped.length) console.log(`  skipped: ${skipped.map((s: any) => s.month).join(", ")}`);
  if (bulk.status !== 201 || created.length !== 12) throw new Error(`bulk create gagal (status ${bulk.status}, dibuat ${created.length})`);

  // 3) Verifikasi via GET
  const list = await api("/api/rekankerja/payroll-periods");
  const periods: any[] = (list.body?.periods ?? []).filter((p: any) => p.sptYear === YEAR);
  console.log(`GET → period ${YEAR}: ${periods.length}`);
  let fail = 0;
  for (let m = 1; m <= 12; m++) {
    const p = periods.find((x) => x.sptMonth === m);
    if (!p) { console.log(`  ✗ ${m}/${YEAR} tidak ada`); fail++; continue; }
    const okCode = p.code === `${YEAR}-${String(m).padStart(2, "0")}`;
    const okStart = p.startDate.slice(0, 10) === iso(YEAR, m, 1);
    const okEnd = p.endDate.slice(0, 10) === iso(YEAR, m, lastDay(YEAR, m));
    const okTa = p.taStartDate?.slice(0, 10) === iso(YEAR, m - 1, 26) && p.taEndDate?.slice(0, 10) === iso(YEAR, m, 25);
    const ok = okCode && okStart && okEnd && okTa;
    if (!ok) fail++;
    console.log(`  ${ok ? "✓" : "✗"} ${p.code} ${p.startDate.slice(0, 10)}→${p.endDate.slice(0, 10)} · TA ${p.taStartDate?.slice(0, 10)}→${p.taEndDate?.slice(0, 10)}`);
  }
  if (fail) throw new Error(`${fail} period tidak sesuai pola`);

  // 4) TA window user-defined per period — urutan salah harus ditolak, benar diterima
  const jan = periods.find((p) => p.sptMonth === 1)!;
  const bad = await api("/api/rekankerja/payroll-periods", {
    method: "PATCH",
    body: JSON.stringify({ id: jan.id, taStartDate: iso(YEAR, 2, 1), taEndDate: iso(YEAR, 1, 28) }),
  });
  console.log(`PATCH TA terbalik → ${bad.status} (harus 400): ${bad.body?.error ?? ""}`);
  if (bad.status !== 400) throw new Error("validasi urutan TA tidak bekerja");

  // TA user-defined lintas bulan: 5 Jan → 4 Feb (TA period ≠ payroll period)
  const good = await api("/api/rekankerja/payroll-periods", {
    method: "PATCH",
    body: JSON.stringify({ id: jan.id, taStartDate: iso(YEAR, 1, 5), taEndDate: iso(YEAR, 2, 4) }),
  });
  console.log(`PATCH TA user-defined (5 Jan → 4 Feb) → ${good.status} (harus 200)`);
  if (good.status !== 200) throw new Error("PATCH TA user-defined gagal");
  if (good.body?.period?.taStartDate?.slice(0, 10) !== iso(YEAR, 1, 5)) throw new Error("TA start tidak tersimpan");
  if (good.body?.period?.taEndDate?.slice(0, 10) !== iso(YEAR, 2, 4)) throw new Error("TA end tidak tersimpan");

  // 5) Hapus jendela TA (null) lalu kembalikan pola awal
  const cleared = await api("/api/rekankerja/payroll-periods", {
    method: "PATCH",
    body: JSON.stringify({ id: jan.id, taStartDate: null, taEndDate: null }),
  });
  console.log(`PATCH TA null (hapus window) → ${cleared.status} · taStartDate=${cleared.body?.period?.taStartDate}`);
  if (cleared.status !== 200 || cleared.body?.period?.taStartDate !== null) throw new Error("hapus TA window gagal");

  const restore = await api("/api/rekankerja/payroll-periods", {
    method: "PATCH",
    body: JSON.stringify({ id: jan.id, taStartDate: iso(YEAR, 0, 26), taEndDate: iso(YEAR, 1, 25) }),
  });
  if (restore.status !== 200) throw new Error("restore TA window gagal");

  // 6) Idempoten: bulk ulang → 0 dibuat, 12 dilewati
  const again = await api("/api/rekankerja/payroll-periods", {
    method: "POST",
    body: JSON.stringify({ bulk: true, year: YEAR, startDay: 1, useTa: true, taStartDay: 26, taStartMonthOffset: -1, taEndDay: 25, taEndMonthOffset: 0 }),
  });
  const againCreated = again.body?.created?.length ?? -1;
  const againSkipped = again.body?.skipped?.length ?? -1;
  console.log(`POST bulk ulang → ${again.status} · dibuat=${againCreated} dilewati=${againSkipped}`);
  if (again.status !== 200 && again.status !== 201) throw new Error("idempotensi bulk gagal (status)");
  if (againCreated !== 0 || againSkipped !== 12) throw new Error("idempotensi bulk gagal");

  // 7) Cleanup — hapus 12 period uji (pasti tanpa run karena baru dibuat)
  const del = await api("/api/rekankerja/payroll-periods", { method: "DELETE", body: JSON.stringify({ ids: periods.map((p) => p.id) }) });
  console.log(`DELETE period uji → ${del.status} ${JSON.stringify(del.body ?? {})}`);

  console.log(fail === 0 ? "\nPASS" : "\nFAIL");
}

main().catch((e) => { console.error("E2E GAGAL:", e.message); process.exit(1); });

export {} // module scope — hindari bentrok deklarasi antar skrip E2E
