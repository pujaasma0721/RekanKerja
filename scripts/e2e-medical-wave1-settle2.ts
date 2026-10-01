// E2E siklus 2 — verifikasi split jurnal 60/40 dengan akun piutang ada:
//   1. POST akun 1301 Piutang Asuransi (payroll:accounting create)
//   2. submit + approve + settle klaim UNL-W1E2E (tanpa storno)
//   3. assert jurnal settle = 3 baris (Debit 5106 60% + Debit 1301 40% + Credit 1101 100%)
// Jalankan: bun scripts/e2e-medical-wave1-settle2.ts (server dev :3000)
export {};
const BASE = "http://localhost:3000";
let cookie = "";
const failures: string[] = [];
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures.push(name);
};

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res;
}

// login
const login = await api("POST", "/api/auth/login", { email: "hrd@mii.co.id", password: "onevity123" });
ok("login", login.status === 200, `status=${login.status}`);
const lj = await login.json().catch(() => ({}));
if (!lj?.tenant && Array.isArray(lj?.workspaces) && lj.workspaces.length > 1) {
  await api("POST", "/api/auth/select-tenant", { tenantId: lj.workspaces.find((w: { slug?: string }) => (w.slug ?? "").includes("mitra"))?.id });
}

// 1) akun piutang 1301 (dedupe — cari dulu)
const accList = await api("GET", "/api/rekankerja/accounts");
const accJ = await accList.json().catch(() => ({}));
const allAcc: { code: string; name: string }[] = accJ?.accounts ?? accJ?.items ?? [];
let acc1301 = allAcc.find((a) => a.code === "1301");
if (!acc1301) {
  const mk = await api("POST", "/api/rekankerja/accounts", { kind: "account", code: "1301", name: "Piutang Asuransi" });
  ok("POST akun 1301 Piutang Asuransi", mk.status === 201 || mk.status === 200, `status=${mk.status}`);
} else {
  ok("akun 1301 sudah ada (rerun)", true, acc1301.name);
}

// 2) submit + approve + settle klaim UNL-W1E2E (karyawan bebas klaim)
const YEAR = new Date().getFullYear();
const typesRes = await api("GET", "/api/rekankerja/medical/types");
const typeUnl = ((await typesRes.json().catch(() => ({})))?.types ?? []).find((t: { code: string }) => t.code === "UNL-W1E2E");
const claimsRes = await api("GET", "/api/rekankerja/medical/claims");
const existingClaims = (await claimsRes.json().catch(() => ({})))?.claims ?? [];
const optRes = await api("GET", "/api/rekankerja/employee-options");
const employees = (await optRes.json().catch(() => ({})))?.managers ?? [];

let emp: { id: string; fullName?: string; name?: string } | null = null;
for (const e of employees) {
  const active = existingClaims.some(
    (c: { employeeId?: string; state?: string }) => c.employeeId === e.id && ["Submitted", "Approved"].includes(c.state ?? ""),
  );
  if (!active) {
    emp = e;
    break;
  }
}
if (!emp) {
  console.error("✗ tidak ada karyawan bebas klaim Submitted/Approved");
  process.exit(1);
}
const provList = await api("GET", "/api/rekankerja/medical/providers");
const rs = ((await provList.json().catch(() => ({})))?.providers ?? []).find((p: { code: string }) => p.code === "RS-W1E2E");
const stamp = Date.now().toString().slice(-6);
const today = new Date().toISOString().slice(0, 10);

const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const draftId = `draft:e2e-w1c-${stamp}`;
const form = new FormData();
form.append("entityType", "MedicalClaim");
form.append("entityId", draftId);
form.append("file", new Blob([Buffer.from(pngB64, "base64")], { type: "image/png" }), `kwitansi-c-${stamp}.png`);
const upRes = await fetch(`${BASE}/api/rekankerja/attachments`, { method: "POST", headers: cookie ? { cookie } : {}, body: form });
const upJ = await upRes.json().catch(() => ({}));

const submit = await api("POST", "/api/rekankerja/medical/claims", {
  employeeId: emp.id, typeId: typeUnl.id, claimDate: today, submit: true,
  attachmentIds: [upJ?.id].filter(Boolean),
  lines: [{ treatedName: emp.fullName ?? emp.name ?? "?", receiptNo: `E2E-W1C-${stamp}`, providerId: rs?.id, billAmount: 200000, reimburseAmount: 0, approvedAmount: 200000 }],
});
const subJ = await submit.json().catch(() => ({}));
if (submit.status !== 201) {
  console.error("✗ submit gagal:", JSON.stringify(subJ).slice(0, 200));
  process.exit(1);
}
ok("submit klaim siklus-2", true, `doc=${subJ.docNo}`);

// approve loop
let state = "";
for (let i = 0; i < 6; i++) {
  const r = await api("PATCH", "/api/rekankerja/medical/claims", { id: subJ.id, action: "approve" });
  const j = await r.json().catch(() => ({}));
  state = j?.state ?? "";
  if (state === "Approved") break;
  if (r.status !== 200) {
    ok("approve", false, `status=${r.status} ${JSON.stringify(j).slice(0, 120)}`);
    process.exit(1);
  }
}
ok("approve (semua jenjang)", state === "Approved", `state=${state}`);

// settle
const settle = await api("PATCH", "/api/rekankerja/medical/claims", { id: subJ.id, action: "settle" });
const setJ = await settle.json().catch(() => ({}));
ok("settle klaim", settle.status === 200 && setJ?.state === "Settled", `status=${settle.status} journal=${setJ?.journalNo ?? "-"} lines=${setJ?.journalLines}`);

// 3) verifikasi split jurnal via GET payroll-journals
const jn = setJ?.journalNo ?? "";
const jr = await api("GET", `/api/rekankerja/payroll-journals?journalNo=${jn}`);
const jrJ = await jr.json().catch(() => ({}));
const journals = jrJ?.journals ?? jrJ?.items ?? [];
const journal = journals[0];
if (!journal) {
  ok("baca jurnal", false, `journalNo=${jn} status=${jr.status} body=${JSON.stringify(jrJ).slice(0, 100)}`);
} else {
  const lines: { position: string; accountCode: string; amount: string | number | null }[] = journal.lines ?? [];
  const amountOf = (l: { amount: string | number | null }) =>
    typeof l.amount === "number" ? l.amount : Number(String(l.amount ?? "").replace(/[^\d.]/g, "")) || 0;
  const d5106 = lines.filter((l) => l.position === "Debit" && l.accountCode === "5106").reduce((s, l) => s + amountOf(l), 0);
  const d1301 = lines.filter((l) => l.position === "Debit" && l.accountCode === "1301").reduce((s, l) => s + amountOf(l), 0);
  const credit1101 = lines.filter((l) => l.position === "Credit" && l.accountCode === "1101").reduce((s, l) => s + amountOf(l), 0);
  ok("jurnal 3 baris", lines.length === 3, `${lines.length} baris`);
  ok("Debit 5106 = 60% (120.000)", d5106 === 120000, `Rp ${d5106.toLocaleString("id-ID")}`);
  ok("Debit 1301 = 40% (80.000) — piutang asuransi", d1301 === 80000, `Rp ${d1301.toLocaleString("id-ID")}`);
  ok("Credit 1101 = 100% (200.000)", credit1101 === 200000, `Rp ${credit1101.toLocaleString("id-ID")}`);
}

console.log(failures.length === 0 ? "\nSPLIT JURNAL 60/40 TERVERIFIKASI ✔" : `\nGAGAL: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
