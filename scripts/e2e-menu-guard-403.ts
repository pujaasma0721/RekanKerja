/**
 * Task 79 — E2E guard hak aksi menu (requireMenuAction).
 * Alur:
 *  1. Login OWNER → buat AppUser uji (role "HR Staff" → bukan VIEWER/super admin)
 *  2. Set konfigurasi menu CUSTOM: hanya hr:directory (6 menu target TIDAK diberikan)
 *  3. Login user uji → POST ke 8 endpoint mutasi → harus 403 semua
 *  4. Kontrol positif: GET position-levels (read, requireTenant) → 200,
 *     GET employees (hr:directory diberikan) → 200
 *  5. Cleanup: hapus konfigurasi menu + AppUser uji (akun platform dihapus via DB terpisah)
 * Pakai: npx tsx scripts/e2e-menu-guard-403.ts <base> <email-owner> <pass-owner>
 */
const BASE = process.argv[2] ?? "https://sayone.sayone.my.id";
const OWNER_EMAIL = process.argv[3];
const OWNER_PASS = process.argv[4];
if (!OWNER_EMAIL || !OWNER_PASS) { console.error("usage: tsx e2e-menu-guard-403.ts <base> <owner-email> <owner-pass>"); process.exit(2); }

const EMAIL = "audit-task79@sayone.test";
const PASS = "Aud!t2026#Xq7m";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function jarOf(res: Response): string {
  const anyH = res.headers as unknown as { getSetCookie?: () => string[] };
  return (anyH.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function post(path: string, cookie: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

async function main(): Promise<void> {
  // 1. login owner
  const rOwner = await post("/api/auth/login", "", { email: OWNER_EMAIL, password: OWNER_PASS });
  const owner = jarOf(rOwner);
  if (!owner) { console.error("login owner gagal"); process.exit(1); }

  // 2. buat AppUser uji
  const rCreate = await post("/api/onevity/app-users", owner, {
    username: "audittask79", fullName: "Audit Task 79", email: EMAIL, password: PASS, role: "HR Staff",
  });
  const created = (await rCreate.json()) as { user?: { id?: string }; id?: string; error?: string };
  const uid = created.user?.id ?? created.id;
  if (rCreate.status !== 201 || !uid) {
    // mungkin sudah ada dari run sebelumnya — cari via GET
    const rList = await fetch(`${BASE}/api/onevity/app-users`, { headers: { cookie: owner } });
    const list = (await rList.json()) as { users?: { id: string; email: string | null }[] };
    const found = (list.users ?? []).find((u) => u.email === EMAIL);
    if (!found) { check("buat AppUser uji", false, JSON.stringify(created)); process.exit(1); }
    check("AppUser uji sudah ada (reuse)", true, found.id);
    await cleanupAndRun(owner, found.id);
    return;
  }
  check("buat AppUser uji (role HR Staff)", true, uid);
  await cleanupAndRun(owner, uid);
}

async function cleanupAndRun(owner: string, uid: string): Promise<void> {
  try {
    // 3. konfigurasi menu CUSTOM — hanya hr:directory
    const rCfg = await post("/api/onevity/user-menu-access", owner, {
      appUserId: uid, mode: "CUSTOM",
      menus: { "hr:directory": { view: true, create: true, update: true, delete: true, ops: {} } },
    });
    check("set menu CUSTOM (hanya hr:directory)", rCfg.status === 201, `status ${rCfg.status}`);

    // 4. login user uji
    const rU = await post("/api/auth/login", "", { email: EMAIL, password: PASS });
    const ujar = jarOf(rU);
    check("login user uji", rU.status === 200 && !!ujar, `status ${rU.status}`);

    // 5. delapan endpoint mutasi → 403
    const targets: [string, string][] = [
      ["/api/onevity/payroll-periods", "settings payroll:periods (create)"],
      ["/api/onevity/payroll-rapel", "payroll:transactions (create)"],
      ["/api/onevity/leave/mass", "leave:leave-mass (create)"],
      ["/api/onevity/attendance/clocking", "attendance:clocking (create)"],
      ["/api/onevity/position-levels", "hr:levels (create)"],
      ["/api/onevity/approval-structures", "settings:approval (create)"],
      ["/api/onevity/approval-templates", "settings:approval (create)"],
      ["/api/onevity/temporary-approvers", "settings:approval (create)"],
    ];
    for (const [path, label] of targets) {
      const res = await post(path, ujar, {});
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      check(`403 ${label}`, res.status === 403, `${res.status} ${j.error ?? ""}`.trim());
    }

    // PATCH & DELETE spot-check (periods PATCH, position-levels DELETE)
    const rPatch = await fetch(`${BASE}/api/onevity/payroll-periods`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie: ujar }, body: JSON.stringify({}),
    });
    check("403 payroll:periods (update)", rPatch.status === 403, `status ${rPatch.status}`);
    const rDel = await fetch(`${BASE}/api/onevity/position-levels?id=00000000-0000-0000-0000-000000000000`, {
      method: "DELETE", headers: { cookie: ujar },
    });
    check("403 hr:levels (delete)", rDel.status === 403, `status ${rDel.status}`);

    // 6. kontrol positif — read tetap jalan
    const rRead = await fetch(`${BASE}/api/onevity/position-levels`, { headers: { cookie: ujar } });
    check("200 GET position-levels (read tanpa guard menu)", rRead.status === 200, `status ${rRead.status}`);
    const rEmp = await fetch(`${BASE}/api/onevity/employees?pageSize=1`, { headers: { cookie: ujar } });
    check("200 GET employees (hr:directory diberikan)", rEmp.status === 200, `status ${rEmp.status}`);
  } finally {
    // 7. cleanup via API
    const rDelCfg = await fetch(`${BASE}/api/onevity/user-menu-access?userId=${uid}`, { method: "DELETE", headers: { cookie: owner } });
    check("cleanup: hapus konfigurasi menu", rDelCfg.status === 200, `status ${rDelCfg.status}`);
    const rDelUser = await fetch(`${BASE}/api/onevity/app-users?id=${uid}`, { method: "DELETE", headers: { cookie: owner } });
    check("cleanup: hapus AppUser uji", rDelUser.status === 200, `status ${rDelUser.status}`);
    console.log(`NOTE akun platform User (email=${EMAIL}) dihapus terpisah via DB bila perlu.`);
  }

  console.log(failures === 0 ? "\nSEMUA PASS" : `\n${failures} GAGAL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {}; // jadikan module — hindari collision global-scope antar skrip
