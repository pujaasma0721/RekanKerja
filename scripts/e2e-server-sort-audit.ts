/**
 * E2E — sort server-side untuk tabel hasil audit besar (Task 76 lanjutan).
 * Verifikasi urutan benar lintas seluruh dataset per endpoint:
 *   activity-logs, email-logs, wa-logs, leave requests, TA overtime,
 *   TA workoffs, medical claims, travel requests, travel claims,
 *   payroll journals, personnel actions, offboarding.
 * Pemakaian: npx tsx scripts/e2e-server-sort-audit.ts <base-url>
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const jar = new Map<string, string>();

function storeCookies(res: Response): void {
  const list: string[] = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of list) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function api(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: cookieHeader() }, redirect: "manual" });
  storeCookies(res);
  let body: any = null;
  try { body = await res.json(); } catch { /* noop */ }
  return { status: res.status, body };
}

/** akses nested path "employee.fullName" */
const getPath = (o: any, path: string): string | number | null => {
  let cur = o;
  for (const seg of path.split(".")) {
    if (cur == null) return null;
    cur = cur[seg];
  }
  return cur == null ? null : cur;
};

/** monotonic check: null/undefined dianggap lolos (rule nulls-last tidak berlaku lintas endpoint).
 *  Toleran beda collation PG vs JS: pasangan dianggap pelanggaran hanya bila
 *  localeCompare(id) DAN code-unit compare SEPAKAT arahnya salah —
 *  (kasus tanda baca `[` vs huruf, kapitalisasi, dsb. beda antar collation). */
const cmpLocale = (a: string, b: string) => a.localeCompare(b, "id", { numeric: true });
const cmpCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const wrongPair = (a: string, b: string, dir: "asc" | "desc") =>
  dir === "asc" ? cmpLocale(a, b) > 0 && cmpCode(a, b) > 0 : cmpLocale(a, b) < 0 && cmpCode(a, b) < 0;
const isOkOrder = (arr: (string | number | null)[], dir: "asc" | "desc") =>
  arr.every((v, i) => i === 0 || v == null || arr[i - 1] == null || !wrongPair(String(arr[i - 1]), String(v), dir));
const isNonDecreasingNum = (arr: (number | null)[]) =>
  arr.every((v, i) => i === 0 || v == null || arr[i - 1] == null || (arr[i - 1] as number) <= v);
const isNonIncreasingNum = (arr: (number | null)[]) =>
  arr.every((v, i) => i === 0 || v == null || arr[i - 1] == null || (arr[i - 1] as number) >= v);

let fail = 0;
function check(name: string, rows: any[], key: string, dir: "asc" | "desc", numeric = false): void {
  if (!Array.isArray(rows) || rows.length === 0) { console.log(`${name}: TANPA DATA di prod (skip)`); return; }
  const vals = rows.map((r) => getPath(r, key));
  const ok = numeric
    ? (dir === "asc" ? isNonDecreasingNum(vals as (number | null)[]) : isNonIncreasingNum(vals as (number | null)[]))
    : isOkOrder(vals, dir);
  const first = String(vals[0] ?? "—"), last = String(vals[vals.length - 1] ?? "—");
  console.log(`${name} (${rows.length} rows) ${dir} → ${ok ? "✓" : "✗"} [${first} … ${last}]`);
  if (!ok) {
    fail++;
    // debug: tampilkan pasangan pertama yang melanggar
    for (let i = 1; i < vals.length; i++) {
      const a = vals[i - 1], b = vals[i];
      if (a == null || b == null) continue;
      if (wrongPair(String(a), String(b), dir)) {
        console.log(`   pelanggaran @${i}: prev="${a}" cur="${b}"`);
        break;
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(`E2E server-side sort audit → ${BASE}`);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.E2E_EMAIL ?? "puja.asmara@sayone.com", password: process.env.E2E_PASSWORD ?? "Asmaree.007" }),
    redirect: "manual",
  });
  storeCookies(login);
  if (login.status !== 200) throw new Error(`login gagal: ${login.status}`);

  // 1) Activity Log — waktu desc & actor asc
  const al = await api("/api/rekankerja/activity-logs?sortBy=time&sortDir=desc&limit=500");
  check("ActivityLog createdAt desc", al.body?.logs ?? [], "createdAt", "desc");
  const al2 = await api("/api/rekankerja/activity-logs?sortBy=action&sortDir=asc&limit=500");
  check("ActivityLog action asc", al2.body?.logs ?? [], "action", "asc");

  // 2) Email Log — toEmail asc & subject desc
  const el = await api("/api/rekankerja/email-logs?sortBy=toEmail&sortDir=asc&limit=500");
  check("EmailLog toEmail asc", el.body?.logs ?? [], "toEmail", "asc");
  const el2 = await api("/api/rekankerja/email-logs?sortBy=subject&sortDir=desc&limit=500");
  check("EmailLog subject desc", el2.body?.logs ?? [], "subject", "desc");

  // 3) WA Log — toPhone asc
  const wl = await api("/api/rekankerja/wa-logs?sortBy=toPhone&sortDir=asc&limit=500");
  check("WaLog toPhone asc", wl.body?.logs ?? [], "toPhone", "asc");

  // 4) Leave requests — employee asc & workingDays desc (numeric)
  const lv = await api("/api/rekankerja/leave/requests?status=all&sortBy=employee&sortDir=asc");
  check("Leave employee asc", lv.body?.requests ?? [], "fullName", "asc");
  const lv2 = await api("/api/rekankerja/leave/requests?status=all&sortBy=workingDays&sortDir=desc");
  check("Leave workingDays desc", lv2.body?.requests ?? [], "workingDays", "desc", true);

  // 5) TA Overtime — employee asc & planMinutes desc
  const ot = await api("/api/rekankerja/attendance/overtime?sortBy=employee&sortDir=asc");
  check("Overtime employee asc", ot.body?.orders ?? [], "fullName", "asc");
  const ot2 = await api("/api/rekankerja/attendance/overtime?sortBy=plan&sortDir=desc");
  check("Overtime planMinutes desc", ot2.body?.orders ?? [], "planMinutes", "desc", true);

  // 6) TA Workoffs — employee asc & date desc
  const wo = await api("/api/rekankerja/attendance/workoffs?sortBy=employee&sortDir=asc");
  check("WorkOff employee asc", wo.body?.permits ?? [], "fullName", "asc");
  const wo2 = await api("/api/rekankerja/attendance/workoffs?sortBy=date&sortDir=desc");
  check("WorkOff dateFrom desc", wo2.body?.permits ?? [], "dateFrom", "desc");

  // 7) Medical claims — employee asc & date desc
  const mc = await api("/api/rekankerja/medical/claims?sortBy=employee&sortDir=asc");
  check("MedicalClaim employee asc", mc.body?.claims ?? [], "fullName", "asc");
  const mc2 = await api("/api/rekankerja/medical/claims?sortBy=date&sortDir=desc");
  check("MedicalClaim claimDate desc", mc2.body?.claims ?? [], "claimDate", "desc");

  // 8) Travel requests — doc desc & employee asc
  const tr = await api("/api/rekankerja/travel/requests?status=all&sortBy=doc&sortDir=desc");
  check("TravelReq docNo desc", tr.body?.requests ?? [], "docNo", "desc");
  const tr2 = await api("/api/rekankerja/travel/requests?status=all&sortBy=employee&sortDir=asc");
  check("TravelReq employee asc", tr2.body?.requests ?? [], "fullName", "asc");

  // 9) Travel claims — doc desc & total settlement desc (numeric, terenkripsi)
  const tc = await api("/api/rekankerja/travel/claims?status=all&sortBy=doc&sortDir=desc");
  check("TravelClaim docNo desc", tc.body?.claims ?? [], "docNo", "desc");
  const tc2 = await api("/api/rekankerja/travel/claims?status=all&sortBy=total&sortDir=desc");
  check("TravelClaim totalSettlement desc", tc2.body?.claims ?? [], "totalSettlement", "desc", true);

  // 10) Payroll journals — journalNo desc & runNo asc
  const pj = await api("/api/rekankerja/payroll-journals?sortBy=journal&sortDir=desc");
  check("PayrollJournal journalNo desc", pj.body?.journals ?? [], "journalNo", "desc");
  const pj2 = await api("/api/rekankerja/payroll-journals?sortBy=run&sortDir=asc");
  check("PayrollJournal runNo asc", pj2.body?.journals ?? [], "runNo", "asc");

  // 11) Personnel actions — doc desc & employee asc
  const pa = await api("/api/rekankerja/personnel-actions?sortBy=doc&sortDir=desc");
  check("PA docNo desc", pa.body?.actions ?? [], "docNo", "desc");
  const pa2 = await api("/api/rekankerja/personnel-actions?sortBy=employee&sortDir=asc");
  check("PA employee asc", pa2.body?.actions ?? [], "employee.fullName", "asc");

  // 12) Offboarding — employee asc & lastDay desc
  const ob = await api("/api/rekankerja/offboarding?sortBy=employee&sortDir=asc");
  check("Offboarding employee asc", ob.body?.offboardings ?? [], "employee.fullName", "asc");
  const ob2 = await api("/api/rekankerja/offboarding?sortBy=lastDay&sortDir=desc");
  check("Offboarding lastDay desc", ob2.body?.offboardings ?? [], "lastDay", "desc");

  if (fail > 0) throw new Error(`${fail} pengujian gagal`);
  console.log("\nPASS");
}

main().catch((e) => { console.error("E2E GAGAL:", e.message); process.exit(1); });
export {} // module scope — hindari bentrok deklarasi antar skrip E2E
