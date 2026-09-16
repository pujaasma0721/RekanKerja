/**
 * Task 64m — E2E PROD: hubungkan OneVity SAYONE ke SMTP mail.sayone.my.id
 * Alur: login owner → PUT email-config (SMTP lokal) → POST tes kirim → GET verifikasi.
 * Idempoten: aman dijalankan ulang.
 * Usage: npx tsx scripts/e2e-smtp-connect.ts <base-url>
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const EMAIL = "puja.asmara@sayone.com";
const PASSWORD = "Asmaree.007";
const TEST_TO = "pujaas007@gmail.com";

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
  // 1. Login
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  console.log(`[1] login: ${login.status}`);
  if (login.status !== 200) { console.error(login.body); process.exit(1); }

  // 2. Simpan SMTP config SAYONE → mail.sayone.my.id
  const put = await api("/api/onevity/email-config", {
    method: "PUT",
    body: JSON.stringify({
      active: true,
      smtpHost: "mail.sayone.my.id",
      smtpPort: 587,
      smtpSecure: false, // STARTTLS (bukan implicit TLS 465)
      smtpUser: "notifikasi",
      smtpPassword: "OnevityMail2026!",
      fromEmail: "notifikasi@sayone.my.id",
      fromName: "OneVity Notifikasi (SAYONE)",
    }),
  });
  console.log(`[2] PUT email-config: ${put.status}`, put.status !== 200 ? put.body : "");
  if (put.status !== 200) process.exit(1);

  // 3. Tes kirim dari aplikasi (jalur notifikasi asli — nodemailer)
  const test = await api("/api/onevity/email-config", { method: "POST", body: JSON.stringify({ to: TEST_TO }) });
  console.log(`[3] POST test-kirim → ${TEST_TO}: ${test.status}`, JSON.stringify(test.body));

  // 4. Verifikasi state tersimpan + status tes terakhir
  const get = await api("/api/onevity/email-config");
  const cfg = get.body?.config ?? {};
  console.log(`[4] GET config: host=${cfg.smtpHost}:${cfg.smtpPort} from=${cfg.fromEmail} lastTestOk=${cfg.lastTestOk} msg=${cfg.lastTestMessage}`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); },
);

export {};
