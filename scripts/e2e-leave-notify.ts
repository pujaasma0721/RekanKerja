/**
 * Task 64m-b — E2E PROD: trigger notifikasi EMAIL asli via pengajuan cuti.
 * Alur: login ESS (SAYONE00001 Viewer) → ambil jenis cuti+saldo → submit cuti
 * 1 hari → notifikasi email otomatis ke approver (Task 34, fire-and-forget)
 * → verifikasi via log Postfix di server (dilakukan terpisah via SSH).
 * Usage: npx tsx scripts/e2e-leave-notify.ts <base-url>
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const EMAIL = "sayone.ess.test@sayone.com";
const PASSWORD = "Asmaree.007";

const jar = new Map<string, string>();
function storeCookies(res: Response): void {
  const list = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
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

async function main(): Promise<void> {
  // 1. Login akun ESS karyawan
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  console.log(`[1] login ESS: ${login.status}`);
  if (login.status !== 200) { console.error(login.body); process.exit(1); }

  // 2. Jenis cuti + saldo
  const leave = await api("/api/onevity/ess/leave");
  console.log(`[2] GET ess/leave: ${leave.status}`);
  if (leave.status !== 200) { console.error(JSON.stringify(leave.body).slice(0, 300)); process.exit(1); }
  const types: any[] = leave.body.balances ?? leave.body.types ?? leave.body.leaveTypes ?? [];
  const t = types.find((x) => Number(x.available ?? 0) > 0);
  if (!t) { console.error("tidak ada jenis cuti dgn saldo"); process.exit(1); }
  console.log(`    jenis dipilih: ${t.name ?? t.typeName ?? t.id} (saldo ${t.balance ?? "?"})`);

  // 3. Submit cuti 1 hari, 14 hari ke depan (hindari tabrakan dgn pengajuan lama)
  const d = new Date(Date.now() + 14 * 864e5);
  const iso = d.toISOString().slice(0, 10);
  const req = await api("/api/onevity/ess/leave", {
    method: "POST",
    body: JSON.stringify({ typeId: t.typeId ?? t.id, dateFrom: iso, dateTo: iso, halfDay: false, reason: "E2E tes notifikasi email (mail server .15)" }),
  });
  console.log(`[3] POST ess/leave (cuti ${iso}): ${req.status}`);
  console.log(`    ${JSON.stringify(req.body).slice(0, 260)}`);
  if (req.status !== 200 && req.status !== 201) process.exit(1);
  console.log("[4] notifikasi email dikirim fire-and-forget — verifikasi via EmailLog & postfix log di server");
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); },
);

export {};
