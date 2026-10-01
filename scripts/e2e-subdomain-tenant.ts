/**
 * Task 78 — E2E subdomain tenant: login di <slug>.<base> → auto-select
 * workspace tenant host, isolasi lintas-tenant, proteksi select-tenant.
 * Pemakaian: npx tsx scripts/e2e-subdomain-tenant.ts <base-url> <email> <password>
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const EMAIL = process.argv[3] ?? "";
const PASSWORD = process.argv[4] ?? "";

interface LoginResp {
  mfaRequired?: boolean;
  mfaToken?: string;
  error?: string;
  host?: boolean;
  noWorkspaces?: boolean;
  tenant?: { id: string; slug: string; name: string } | null;
  workspaces?: Array<{ id: string; slug: string; name: string }>;
}
interface MeResp {
  tenant?: { id: string; slug: string } | null;
  workspaces?: Array<{ id: string; slug: string }>;
  error?: string;
}

function cookieOf(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/rekankerja_session=[^;]+/);
  return m ? m[0] : null;
}

async function j(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as unknown;
  return { res, data };
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  // ---- 1. host-workspace info ----
  const hw = await j(`${BASE}/api/auth/host-workspace`);
  const hwData = hw.data as { isTenantHost: boolean; exists: boolean; slug: string | null };
  check("host-workspace mengenali subdomain", hwData.isTenantHost === true && hwData.exists === true, JSON.stringify(hwData));
  const slug = hwData.slug ?? "";

  // ---- 2. login via subdomain → auto-select tenant host ----
  const login = await j(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginData = login.data as LoginResp;
  const cookie = cookieOf(login.res);
  check("login via subdomain sukses (cookie sesi di-set)", login.res.ok && !!cookie, JSON.stringify({ status: login.res.status, error: loginData.error }));
  check("workspace aktif = tenant host", loginData.tenant?.slug === slug, `tenant=${loginData.tenant?.slug ?? "null"} host=${slug}`);

  // ---- 3. me → konteks tenant host konsisten ----
  const me = await j(`${BASE}/api/auth/me`, { headers: { cookie: cookie ?? "" } });
  const meData = me.data as MeResp;
  check("me memakai tenant host (bukan tid cookie lain)", me.res.ok && meData.tenant?.slug === slug, JSON.stringify({ status: me.res.status, tenant: meData.tenant?.slug ?? meData.error }));

  // ---- 4. select-tenant workspace lain di subdomain → 403 ----
  const other = meData.workspaces?.find((w) => w.slug !== slug) ?? null;
  if (other) {
    const sel = await j(`${BASE}/api/auth/select-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookie ?? "" },
      body: JSON.stringify({ tenantId: other.id }),
    });
    check("pilih workspace lain di subdomain ditolak 403", sel.res.status === 403, `status=${sel.res.status}`);
  } else {
    console.log("SKIP  uji select-tenant (user hanya anggota 1 workspace)");
  }

  // ---- 5. login di HOST UTAMA → TIDAK auto-select subdomain ----
  const mainBase = BASE.replace(`https://${slug}.`, "https://");
  const loginMain = await j(`${mainBase}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const mainData = loginMain.data as LoginResp;
  check("login di host utama tidak auto-select subdomain", mainData.tenant == null || mainData.tenant.slug !== slug, `tenant=${mainData.tenant?.slug ?? "null"}`);

  console.log(`\n${fail === 0 ? "✅ SEMUA PASS" : "❌ ADA GAGAL"} — ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});

export {};
