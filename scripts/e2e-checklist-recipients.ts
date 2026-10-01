/**
 * Task 65 lanjutan — isi penerima email checklist per bagian (SAYONE) via API:
 * 1. Login owner SAYONE
 * 2. PUT /api/rekankerja/checklist-recipients × 6 bagian → email Gmail test
 * 3. GET untuk verifikasi
 * 4. PATCH /api/rekankerja/onboarding/[id] {action:"resendEmail"} → kirim ulang
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const EMAIL = process.argv[3] ?? "puja.asmara@sayone.com";
const PASSWORD = process.argv[4] ?? "Asmaree.007";
const TARGET = process.argv[5] ?? "pujaas007@gmail.com";

const DEPTS = ["Supervisor", "IT", "GA", "Finance", "HR", "Payroll"];

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
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  // 1. login
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (login.status !== 200) throw new Error(`login gagal: ${login.status} ${JSON.stringify(login.body).slice(0, 200)}`);
  console.log("1. login OK");

  // 2. isi penerima per bagian
  for (const dept of DEPTS) {
    const put = await api("/api/rekankerja/checklist-recipients", {
      method: "PUT",
      body: JSON.stringify({ dept, emails: [TARGET] }),
    });
    console.log(`2. PUT ${dept} →`, put.status, put.status !== 200 ? JSON.stringify(put.body).slice(0, 160) : "OK");
  }

  // 3. verifikasi
  const get = await api("/api/rekankerja/checklist-recipients");
  if (get.status !== 200) throw new Error(`GET recipients gagal: ${get.status}`);
  for (const d of get.body.departments ?? []) {
    console.log(`3. ${d.dept.padEnd(11)} → ${d.emails.length > 0 ? d.emails.join(", ") : "(kosong — fallback Admin/HR)"}`);
  }

  // 4. kirim ulang email checklist onboarding (proses Open pertama)
  const rows = await api("/api/rekankerja/onboarding");
  const first = (rows.body.onboardings ?? []).find((o: any) => o.status === "Open") ?? rows.body.onboardings?.[0];
  if (!first) throw new Error("tidak ada proses onboarding untuk resend");
  console.log(`4. resend email checklist: ${first.employee.fullName} (${first.id.slice(0, 8)}…)`);
  const resend = await api(`/api/rekankerja/onboarding/${first.id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "resendEmail" }),
  });
  console.log("   resend →", resend.status, JSON.stringify(resend.body).slice(0, 200));
  if (resend.status !== 200) throw new Error("resend gagal");
  console.log(`\nSELESAI — email checklist dikirim ulang ke ${resend.body.sent} bagian (cek ${TARGET}).`);
}

main().catch((e) => { console.error("E2E GAGAL:", e.message); process.exit(1); });

export {}; // module scope — hindari tabrakan deklarasi global antar-skrip E2E
