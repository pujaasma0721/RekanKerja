/**
 * Task 65 — E2E checklist onboarding/offboarding (prod .15):
 * 1. Login owner SAYONE → cookie session
 * 2. GET daftar karyawan → ambil satu karyawan aktif
 * 3. POST /api/rekankerja/onboarding → proses + email per bagian
 * 4. GET detail → viewer.allowedDepts (koordinator = null)
 * 5. POST task centang sebagai koordinator (simulasi IT menandai Done)
 * 6. GET /api/public/checklist?token — ambil token dari EmailLog (link)
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const EMAIL = process.argv[3] ?? "puja.asmara@sayone.com";
const PASSWORD = process.argv[4] ?? "Asmaree.007";

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
  if (login.status !== 200) throw new Error(`login gagal: ${login.status} ${JSON.stringify(login.body)}`);
  const tenantId = login.body.user?.tenants?.[0]?.tenantId ?? login.body.tenants?.[0]?.tenantId;
  console.log("login OK; tenants:", JSON.stringify(login.body.user?.tenants ?? login.body.tenants ?? []).slice(0, 200));
  // pilih tenant SAYONE bila ada endpoint switch; coba GET me
  const me = await api("/api/auth/me");
  console.log("me:", me.status, JSON.stringify(me.body).slice(0, 300));

  // 2. daftar karyawan (ambil 3 pertama)
  const emps = await api("/api/rekankerja/employees?pageSize=5");
  if (emps.status !== 200) throw new Error(`employees gagal: ${emps.status} ${JSON.stringify(emps.body).slice(0, 200)}`);
  const list = emps.body.employees ?? emps.body.data ?? [];
  console.log("karyawan:", list.length, "pertama:", list[0]?.fullName, list[0]?.employeeNo);

  // 3. buat proses onboarding utk karyawan pertama
  const emp = list[0];
  const create = await api("/api/rekankerja/onboarding", { method: "POST", body: JSON.stringify({ employeeId: emp.id, note: "E2E Task 65" }) });
  console.log("create onboarding:", create.status, JSON.stringify(create.body).slice(0, 400));
  if (create.status === 400 && String(create.body.error ?? "").includes("sudah berjalan")) {
    console.log("(proses sudah ada — lanjut verifikasi daftar)");
  }

  // 4. daftar proses
  const rows = await api("/api/rekankerja/onboarding");
  const first = rows.body.onboardings?.[0];
  console.log("daftar:", rows.status, first ? `${first.employee.fullName} ${first.taskStats.done}/${first.taskStats.total} ${first.status}` : "kosong");

  if (first) {
    // 5. detail + viewer meta
    const detail = await api(`/api/rekankerja/onboarding/${first.id}`);
    console.log("detail:", detail.status, "viewer:", JSON.stringify(detail.body.viewer), "tasks:", detail.body.onboarding?.tasks?.length);
  }
}

main().catch((e) => { console.error("E2E GAGAL:", e.message); process.exit(1); });

export {}; // module scope — hindari tabrakan deklarasi global antar-skrip E2E
