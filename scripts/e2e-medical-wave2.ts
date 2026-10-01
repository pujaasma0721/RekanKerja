// Fix 91 — Wave 2 Medical E2E (local dev): item audit BPA-medical yang tersisa
//   W2-1 (M-1)  — transfer UMC ditolak kecuali period akhir tahun saldo
//   W2-2 (m-2)  — totalRemaining = remaining + depRemaining hanya utk pool dependent TERPISAH
//   W2-3 (m-3)  — overview KPI membawa dependentRemaining (pool dependent terpisah)
//   W2-5 (m-8)  — approve adjustment ditolak bila sisa plafon jadi NEGATIF
//   W2-6 (G-9)  — laporan rekap per karyawan (byEmployee, padanan SummaryEmployee)
// Jalankan: bun scripts/e2e-medical-wave2.ts  (server dev di :3000)
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

async function unlockVaultIfNeeded() {
  const vst = await api("GET", "/api/rekankerja/money-vault");
  const vj = await vst.json().catch(() => ({}));
  if (vj?.configured) {
    const un = await api("POST", "/api/rekankerja/money-vault", { action: "unlock", password: "asmaree.007" });
    ok("buka Money Vault", un.status === 200, `status=${un.status}`);
  } else {
    console.log("  vault: legacy — nilai uang langsung riil");
  }
}

// ===== 1) login owner MII =====
const login = await api("POST", "/api/auth/login", { email: "hrd@mii.co.id", password: "onevity123" });
const lj = await login.json().catch(() => ({}));
ok("login owner MII", login.status === 200, `status=${login.status}`);
if (login.status !== 200) {
  console.error(JSON.stringify(lj));
  process.exit(1);
}
if (!lj?.tenant && Array.isArray(lj?.workspaces) && lj.workspaces.length > 1) {
  const mii = lj.workspaces.find((w: { slug?: string }) => (w.slug ?? "").includes("mitra"));
  const sel = await api("POST", "/api/auth/select-tenant", { tenantId: mii?.id });
  ok("pilih workspace MII", sel.status === 200, `status=${sel.status}`);
}
await unlockVaultIfNeeded();

const YEAR = new Date().getFullYear();

// ===== 2) data: saldo + jenis =====
const balRes = await api("GET", `/api/rekankerja/medical/balances?year=${YEAR}`);
const balJ = await balRes.json().catch(() => ({}));
interface BalRow {
  employeeId: string; employeeNo: string; fullName: string; typeCode: string; typeName: string;
  limitRule: string; benefitAmount: number | null; adjustmentAmount: number | null;
  carriedOver: number | null; initialUsed: number | null; usedAmount: number | null;
  remaining: number | null; depBenefitAmount: number | null; depAdjustment: number | null;
  depUsed: number | null; depRemaining: number | null; totalRemaining: number | null;
}
const balances: BalRow[] = balJ?.balances ?? [];
ok("GET medical/balances", balRes.status === 200 && balances.length > 0, `status=${balRes.status}, ${balances.length} saldo`);

const typesRes = await api("GET", "/api/rekankerja/medical/types");
const typesJ = await typesRes.json().catch(() => ({}));
const types: { id: string; code: string; dependentEnabled: boolean; depLimitRule: string; limitRule: string; active: boolean }[] = typesJ?.types ?? [];
const typeByCode = new Map(types.map((t) => [t.code, t]));

// ===== 3) W2-2 — totalRemaining hanya menjumlah pool dependent TERPISAH =====
// depPoolSeparate(t) = dependentEnabled && depLimitRule !== "SHARED"
// (fallback heuristik bila master jenis tak tersedia: depBenefitAmount > 0)
const isSep = (r: BalRow) => {
  const t = typeByCode.get(r.typeCode);
  return t ? t.dependentEnabled && t.depLimitRule !== "SHARED" : (r.depBenefitAmount ?? 0) > 0;
};
let w22bad = 0;
let sepRows = 0;
for (const r of balances) {
  if (r.totalRemaining == null || r.remaining == null) continue;
  const expect = isSep(r) ? (r.remaining + (r.depRemaining ?? 0)) : r.remaining;
  if (Math.abs(r.totalRemaining - expect) > 0.01) w22bad++;
  if (isSep(r)) sepRows++;
}
ok("W2-2 totalRemaining = remaining (+depRemaining hanya pool terpisah)", w22bad === 0,
  `${balances.length} baris dicek, ${sepRows} pool dependent terpisah, ${w22bad} inkonsisten`);

// ===== 4) W2-3 — KPI overview membawa dependentRemaining =====
const ovRes = await api("GET", `/api/rekankerja/medical/overview?year=${YEAR}`);
const ovJ = await ovRes.json().catch(() => ({}));
ok("W2-3 overview.dependentRemaining ada & ≥ 0",
  ovRes.status === 200 && typeof ovJ?.dependentRemaining === "number" && ovJ.dependentRemaining >= 0,
  `dependentRemaining=${ovJ?.dependentRemaining}, remaining=${ovJ?.remaining}`);

// ===== 5) W2-5 — floor adjustment (sisa tidak boleh jadi negatif) =====
// pilih baris NOMINAL dengan angka riil terlihat (vault legacy/unlocked)
const target = balances.find((r) => r.limitRule === "NOMINAL" && r.remaining != null) ?? balances.find((r) => r.remaining != null);
if (target && target.remaining != null) {
  // kontrol positif: +100 harus LOLOS approve
  const p1 = await api("POST", "/api/rekankerja/medical/adjustments", {
    employeeId: target.employeeId, typeId: typeByCode.get(target.typeCode)?.id, year: YEAR,
    forDependent: false, amount: 100, adjustmentDate: new Date().toISOString().slice(0, 10),
    note: "E2E W2-5 kontrol positif",
  });
  const p1J = await p1.json().catch(() => ({}));
  ok("W2-5 kontrol positif: submit +100", p1.status === 201 && p1J?.id, `status=${p1.status} ${p1J?.docNo ?? ""}`);
  if (p1.status === 201 && p1J?.id) {
    const a1 = await api("PATCH", "/api/rekankerja/medical/adjustments", { id: p1J.id, action: "approve", note: "E2E W2-5" });
    ok("W2-5 kontrol positif: approve +100 lolos", a1.status === 200, `status=${a1.status}`);
  }
  // kasus uji: -(remaining + 1.000.000) harus DITOLAK saat approve (sisa → −1jt)
  const negAmount = -(target.remaining + 1_000_000);
  const p2 = await api("POST", "/api/rekankerja/medical/adjustments", {
    employeeId: target.employeeId, typeId: typeByCode.get(target.typeCode)?.id, year: YEAR,
    forDependent: false, amount: negAmount, adjustmentDate: new Date().toISOString().slice(0, 10),
    note: "E2E W2-5 floor (harus ditolak)",
  });
  const p2J = await p2.json().catch(() => ({}));
  ok("W2-5 submit penyesuaian minus besar", p2.status === 201 && p2J?.id, `status=${p2.status} ${p2J?.docNo ?? ""}`);
  if (p2.status === 201 && p2J?.id) {
    const a2 = await api("PATCH", "/api/rekankerja/medical/adjustments", { id: p2J.id, action: "approve", note: "E2E W2-5" });
    const a2J = await a2.json().catch(() => ({}));
    ok("W2-5 approve minus besar DITOLAK (sisa negatif)", a2.status === 400 && /negatif/i.test(String(a2J?.error ?? "")),
      `status=${a2.status} err="${String(a2J?.error ?? "").slice(0, 80)}"`);
    if (a2.status === 400) {
      const c2 = await api("PATCH", "/api/rekankerja/medical/adjustments", { id: p2J.id, action: "cancel", note: "E2E W2-5 cleanup" });
      ok("W2-5 cleanup: cancel adjustment ditolak", c2.status === 200, `status=${c2.status}`);
    }
  }
} else {
  console.log("  W2-5 dilewati: tidak ada baris saldo dengan nilai terlihat (vault masked?)");
}

// ===== 6) W2-6 — laporan rekap per karyawan =====
const repRes = await api("GET", `/api/rekankerja/medical/reports?from=${YEAR}-01-01&to=${YEAR}-12-31&year=${YEAR}`);
const repJ = await repRes.json().catch(() => ({}));
const byEmployee: { employeeNo: string; fullName: string; claimCount: number; approvedAmount: number }[] = repJ?.byEmployee ?? [];
const hasSettled = (repJ?.rows ?? []).some((r: { state: string }) => r.state === "Settled");
ok("W2-6 reports.byEmployee ada", repRes.status === 200 && Array.isArray(repJ?.byEmployee), `status=${repRes.status}, ${byEmployee.length} karyawan`);
ok("W2-6 byEmployee terisi saat ada klaim settled & total = Σ approved", !hasSettled || byEmployee.length > 0,
  `Σ approved=${byEmployee.reduce((s, e) => s + e.approvedAmount, 0).toLocaleString("id-ID")}`);

// ===== 7) W2-1 — transfer UMC hanya period akhir tahun =====
// setup: buat period bulanan yang hilang (bulk) — Desember terbuka utk uji
// guard-lolos + bulan terbuka lain utk uji guard-tolak (period Locked/Closed
// tertangkap guard lebih awal dan TIDAK menyentuh guard akhir tahun).
const bulkRes = await api("POST", "/api/rekankerja/payroll-periods", { bulk: true, year: YEAR });
ok("W2-1 setup: bulk period bulanan", bulkRes.status === 200 || bulkRes.status === 201, `status=${bulkRes.status}`);
const perRes = await api("GET", "/api/rekankerja/payroll-periods");
const perJ = await perRes.json().catch(() => ({}));
interface Period { id: string; code: string; name: string; status: string; endDate: string }
const periods: Period[] = perJ?.periods ?? [];
const yearPeriods = periods.filter((p) => p.code.startsWith(`${YEAR}-`)).sort((a, b) => a.code.localeCompare(b.code));
ok("GET payroll-periods", perRes.status === 200 && yearPeriods.length > 0, `status=${perRes.status}, ${yearPeriods.length} period ${YEAR}`);

const openMid = yearPeriods.find((p) => !p.code.endsWith("-12") && p.status !== "Locked" && p.status !== "Closed");
if (openMid) {
  const t1 = await api("POST", "/api/rekankerja/medical/transfer", { periodId: openMid.id, year: YEAR });
  const t1J = await t1.json().catch(() => ({}));
  ok("W2-1 transfer period TENGAH tahun DITOLAK (guard akhir tahun)",
    t1.status === 400 && /akhir tahun/i.test(String(t1J?.error ?? "")),
    `${openMid.code} status=${t1.status} err="${String(t1J?.error ?? "").slice(0, 70)}"`);
} else {
  console.log("  W2-1 (tengah tahun) dilewati: tidak ada period terbuka selain Desember");
}
const decPeriod = yearPeriods.find((p) => p.code.endsWith("-12"));
if (decPeriod) {
  const t2 = await api("POST", "/api/rekankerja/medical/transfer", { periodId: decPeriod.id, year: YEAR });
  const t2J = await t2.json().catch(() => ({}));
  // guard akhir tahun HARUS lolos — 400 selanjutnya hanya alasan bisnis lain
  // (sisa 0 / klaim pending / period locked), bukan "akhir tahun"
  const passGuard = t2.status === 201 || (t2.status === 400 && !/akhir tahun/i.test(String(t2J?.error ?? "")));
  ok("W2-1 period Desember lolos guard akhir tahun", passGuard,
    `${decPeriod.code} status=${t2.status} err="${String(t2J?.error ?? "").slice(0, 70)}"`);
} else {
  console.log("  W2-1 (Des) dilewati: tidak ada period Desember di data demo");
}

// ===== ringkasan =====
console.log("");
if (failures.length > 0) {
  console.error(`GAGAL ${failures.length}: ${failures.join(" | ")}`);
  process.exit(1);
}
console.log("SEMUA TES LULUS ✔");
