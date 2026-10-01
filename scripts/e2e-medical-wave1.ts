// Fix 89 — Wave 1 Medical E2E (local dev):
// login owner MII → smoke guard → master provider → benefit type UNLIMITED +
// split asuransi → generate saldo (prorateFactor) → preview → submit klaim
// (providerId + lampiran kwitansi) → approve → settle (split jurnal) → storno
// (dokumen /REV + restore pool) → submit ulang → return → edit → re-submit.
// Jalankan: bun scripts/e2e-medical-wave1.ts  (server dev di :3000)
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

// 0) buka brankas uang bila terkonfigurasi (nilai uang riil di response)
async function unlockVaultIfNeeded() {
  const vst = await api("GET", "/api/rekankerja/money-vault");
  const vj = await vst.json().catch(() => ({}));
  if (vj?.configured) {
    const un = await api("POST", "/api/rekankerja/money-vault", { action: "unlock", password: "asmaree.007" });
    ok("buka Money Vault", un.status === 200, `status=${un.status}`);
    return un.status === 200;
  }
  console.log("  vault: legacy — nilai uang langsung riil");
  return false;
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

const vaultUnlocked = await unlockVaultIfNeeded();

// ===== 2) smoke guard: daftar klaim + W1-7 familyFor =====
const claimsRes = await api("GET", "/api/rekankerja/medical/claims");
const claimsJ = await claimsRes.json().catch(() => ({}));
ok("GET medical/claims", claimsRes.status === 200, `status=${claimsRes.status}, ${claimsJ?.claims?.length ?? 0} klaim`);

// karyawan aktif pertama (dari preview klaim seed yang sudah ada / employee-options)
const typesRes = await api("GET", "/api/rekankerja/medical/types");
const typesJ = await typesRes.json().catch(() => ({}));
const types: { id: string; code: string; name: string; limitRule: string; needReceipt: boolean; dependentEnabled: boolean; freqPeriod: string; freqValue: number; freqUnlimited: boolean; active: boolean }[] = typesJ?.types ?? [];
ok("GET medical/types", typesRes.status === 200 && types.length > 0, `status=${typesRes.status}, ${types.length} jenis`);

const optRes = await api("GET", "/api/rekankerja/employee-options");
const optJ = await optRes.json().catch(() => ({}));
const employees: { id: string; name: string; employeeNo?: string }[] = (optJ?.managers ?? []).map(
  (e: { id: string; name?: string; fullName?: string; employeeNo?: string }) => ({ id: e.id, name: e.name ?? e.fullName ?? "?", employeeNo: e.employeeNo }),
);
ok("GET employee-options", optRes.status === 200 && employees.length > 0, `status=${optRes.status}, ${employees.length} karyawan`);
if (employees.length === 0 || types.length === 0) process.exit(1);

// W1-7 — endpoint family registry (pakai karyawan pertama; boleh kosong)
const emp0 = employees[0]!;
const famRes = await api("GET", `/api/rekankerja/medical/providers?familyFor=${emp0.id}`);
const famJ = await famRes.json().catch(() => ({}));
ok("W1-7 GET providers?familyFor", famRes.status === 200 && Array.isArray(famJ?.family), `status=${famRes.status}, ${famJ?.family?.length ?? 0} anggota keluarga`);

// ===== 3) W1-6 — master provider baru (dedupe by code) =====
const provList = await api("GET", "/api/rekankerja/medical/providers");
const provJ = await provList.json().catch(() => ({}));
const providers: { id: string; code: string; name: string; active: boolean; kind: string }[] = provJ?.providers ?? [];
ok("GET medical/providers", provList.status === 200, `status=${provList.status}, ${providers.length} provider`);

let rs = providers.find((p) => p.code === "RS-W1E2E");
if (!rs) {
  const mk = await api("POST", "/api/rekankerja/medical/providers", {
    code: "RS-W1E2E", name: "RS E2E Wave1", kind: "HOSPITAL", city: "Jakarta", active: true,
  });
  const mkJ = await mk.json().catch(() => ({}));
  ok("W1-6 POST provider RS-W1E2E", mk.status === 201 && mkJ?.id, `status=${mk.status}`);
  rs = { id: String(mkJ?.id ?? ""), code: "RS-W1E2E", name: "RS E2E Wave1", active: true, kind: "HOSPITAL" };
} else {
  ok("W1-6 provider RS-W1E2E sudah ada (rerun)", true, rs.id);
}
if (!rs.id) process.exit(1);

// ===== 4) W1-1 — jenis benefit UNLIMITED (dedupe by code) =====
const YEAR = new Date().getFullYear();
let typeUnl = types.find((t) => t.code === "UNL-W1E2E");
if (!typeUnl) {
  const mk = await api("POST", "/api/rekankerja/medical/types", {
    code: "UNL-W1E2E", name: "E2E Wave1 Unlimited", limitRule: "UNLIMITED", limitValue: 0,
    freqUnlimited: true, freqPeriod: "YEAR", freqValue: 0,
    needReceipt: true, pctCompany: 100, pctInsurance: 0,
    dependentEnabled: false, unusedRule: "FORFEITED", active: true,
  });
  const mkJ = await mk.json().catch(() => ({}));
  ok("W1-1 POST jenis UNL-W1E2E", mk.status === 201 && mkJ?.id, `status=${mk.status}`);
  typeUnl = { id: String(mkJ?.id ?? ""), code: "UNL-W1E2E", name: "E2E Wave1 Unlimited", limitRule: "UNLIMITED", needReceipt: true, dependentEnabled: false, freqPeriod: "YEAR", freqValue: 0, freqUnlimited: true, active: true };
} else {
  ok("W1-1 jenis UNL-W1E2E sudah ada (rerun)", true, typeUnl.id);
}
if (!typeUnl.id) process.exit(1);

// pilih karyawan yang belum punya klaim UNL-W1E2E aktif (rerun-safe):
// preview per karyawan → pakai karyawan pertama dgn remainingForClaim wajar.
let emp: { id: string; name: string } | null = null;
let prev: { unlimited: boolean; remainingForClaim: number | null; prorateFactor: number | null; insurancePlan: { pctCompany: number; pctInsurance: number; insuranceCompany: string | null }; benefitAmount: number | null; remaining: number | null } | null = null;
for (const e of employees.slice(0, 15)) {
  const pvRes = await api("GET", `/api/rekankerja/medical/claims?preview=1&employeeId=${e.id}&typeId=${typeUnl.id}&year=${YEAR}`);
  if (pvRes.status !== 200) continue;
  const pv = (await pvRes.json().catch(() => ({})))?.preview;
  if (!pv) continue;
  const alreadyActive = (claimsJ?.claims ?? []).some(
    (c: { employeeId?: string; typeId?: string; state?: string }) =>
      c.employeeId === e.id && c.typeId === typeUnl!.id && ["Draft", "Submitted", "Approved", "Settled"].includes(c.state ?? ""),
  );
  if (alreadyActive) continue;
  emp = e;
  prev = pv;
  break;
}
if (!emp || !prev) {
  console.error("✗ tidak ada karyawan bebas klaim UNL-W1E2E — jalankan ulang setelah data demo bersih");
  process.exit(1);
}
ok("W1-1 preview UNLIMITED", prev.unlimited === true, `unlimited=${prev.unlimited}, plafon=${prev.benefitAmount}`);
ok("W1-3 preview insurancePlan", prev.insurancePlan && typeof prev.insurancePlan.pctCompany === "number", `company=${prev.insurancePlan.pctCompany}%, insurance=${prev.insurancePlan.pctInsurance}%`);
ok("W1-8 preview prorateFactor", prev.prorateFactor === null || (prev.prorateFactor > 0 && prev.prorateFactor <= 1), `faktor=${prev.prorateFactor}`);

// ===== 5) generate saldo tahun berjalan (snapshot prorateFactor W1-8) =====
const genRes = await api("POST", "/api/rekankerja/medical/balances", { year: YEAR });
const genJ = await genRes.json().catch(() => ({}));
ok("POST balances (generate tahun berjalan)", genRes.status === 201, `status=${genRes.status}, ${JSON.stringify(genJ).slice(0, 120)}`);

// ===== 6) W1-6 — submit klaim dgn providerId + lampiran kwitansi =====
const today = new Date().toISOString().slice(0, 10);
const stamp = Date.now().toString().slice(-6);
// draft attachment (PNG 1x1 valid)
const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const draftId = `draft:e2e-w1-${stamp}`;
const form = new FormData();
form.append("entityType", "MedicalClaim");
form.append("entityId", draftId);
form.append("file", new Blob([Buffer.from(pngB64, "base64")], { type: "image/png" }), `kwitansi-e2e-${stamp}.png`);
const upRes = await fetch(`${BASE}/api/rekankerja/attachments`, { method: "POST", headers: cookie ? { cookie } : {}, body: form });
const upJ = await upRes.json().catch(() => ({}));
ok("upload draft kwitansi", upRes.status === 200 || upRes.status === 201, `status=${upRes.status}`);

const bill = 250000;
const submitRes = await api("POST", "/api/rekankerja/medical/claims", {
  employeeId: emp.id, typeId: typeUnl.id, claimDate: today, submit: true,
  attachmentIds: [upJ?.id].filter(Boolean),
  note: "E2E wave1 — klaim Unlimited + provider",
  lines: [{
    treatedName: emp.name,
    treatment: "Konsultasi + lab (E2E)",
    treatmentDate: today,
    receiptNo: `E2E-W1-${stamp}`,
    providerId: rs.id,
    physician: "dr. E2E",
    billAmount: bill, reimburseAmount: 0, approvedAmount: bill,
  }],
});
const subJ = await submitRes.json().catch(() => ({}));
ok("submit klaim (provider + lampiran)", submitRes.status === 201 && subJ?.id, `status=${submitRes.status} doc=${subJ?.docNo} warnings=${JSON.stringify(subJ?.warnings ?? [])}`);
if (submitRes.status !== 201) {
  console.error(JSON.stringify(subJ));
  process.exit(1);
}
const claimId: string = subJ.id;

// guard: provider tidak dikenal → ditolak
const badProv = await api("POST", "/api/rekankerja/medical/claims", {
  employeeId: emp.id, typeId: typeUnl.id, claimDate: today, submit: true,
  lines: [{ treatedName: emp.name, receiptNo: `E2E-W1X-${stamp}`, providerId: "tidak-ada-xyz", billAmount: 1000, reimburseAmount: 0, approvedAmount: 1000 }],
});
ok("W1-6 guard provider tak dikenal ditolak", badProv.status === 400, `status=${badProv.status}`);

// guard: duplikasi kwitansi → ditolak (M-8)
const dupRes = await api("POST", "/api/rekankerja/medical/claims", {
  employeeId: emp.id, typeId: typeUnl.id, claimDate: today, submit: true,
  lines: [{ treatedName: emp.name, receiptNo: `E2E-W1-${stamp}`, billAmount: 1000, reimburseAmount: 0, approvedAmount: 1000 }],
});
ok("M-8 guard kwitansi dobel ditolak", dupRes.status === 400, `status=${dupRes.status}`);

// ===== 7) approve (loop semua jenjang chain berjenjang) → settle (W1-3 split jurnal) =====
let apprJ: { state?: string; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null } } | null = null;
let approved = false;
for (let i = 0; i < 6; i++) {
  const r = await api("PATCH", "/api/rekankerja/medical/claims", { id: claimId, action: "approve", note: `E2E approve jenjang ${i + 1}` });
  apprJ = await r.json().catch(() => ({}));
  if (r.status !== 200) {
    ok("approve klaim", false, `status=${r.status} ${JSON.stringify(apprJ).slice(0, 120)}`);
    break;
  }
  if (apprJ?.state === "Approved") {
    approved = true;
    break;
  }
}
ok("approve klaim (semua jenjang)", approved, `state=${apprJ?.state ?? "?"}${apprJ?.approval ? ` — terakhir jenjang ${apprJ.approval.currentLevel}/${apprJ.approval.totalLevels}` : ""}`);

// set split asuransi 60/40 utk verifikasi jurnal — ubah jenis benefit
const setIns = await api("POST", "/api/rekankerja/medical/types", {
  id: typeUnl.id, code: "UNL-W1E2E", name: "E2E Wave1 Unlimited", limitRule: "UNLIMITED", limitValue: 0,
  freqUnlimited: true, freqPeriod: "YEAR", freqValue: 0,
  needReceipt: true, pctCompany: 60, pctInsurance: 40, insuranceCompany: "Asuransi E2E Sehat",
  dependentEnabled: false, unusedRule: "FORFEITED", active: true,
});
ok("W1-3 set split 60/40 + nama asuransi", setIns.status === 200, `status=${setIns.status}`);

const settleRes = await api("PATCH", "/api/rekankerja/medical/claims", { id: claimId, action: "settle", note: "E2E settle" });
const setJ = await settleRes.json().catch(() => ({}));
ok("settle klaim", settleRes.status === 200 && setJ?.state === "Settled", `status=${setRes2(settleRes)} state=${setJ?.state}`);
function setRes2(r: Response) { return r.status; }
ok("W1-3 settle split jurnal ≥2 baris", (setJ?.journalLines ?? 0) >= 2, `journal=${setJ?.journalNo ?? "-"}, ${setJ?.journalLines} baris (60% 5106 + 40% piutang asuransi)`);

// guard storno TANPA alasan → ditolak
const noNote = await api("PATCH", "/api/rekankerja/medical/claims", { id: claimId, action: "storno" });
ok("W1-4 guard storno tanpa alasan ditolak", noNote.status === 400, `status=${noNote.status}`);

// ===== 8) W1-4 — storno klaim Settled =====
const storRes = await api("PATCH", "/api/rekankerja/medical/claims", { id: claimId, action: "storno", note: "E2E storno — koreksi kwitansi ganda" });
const storJ = await storRes.json().catch(() => ({}));
ok("W1-4 storno klaim settled", storRes.status === 200 && storJ?.reversalOf, `status=${storRes.status} doc=${storJ?.docNo} reversalOf=${storJ?.reversalOf ?? "-"}`);

// idempoten: storno kedua ditolak
const stor2 = await api("PATCH", "/api/rekankerja/medical/claims", { id: claimId, action: "storno", note: "coba dua kali" });
ok("W1-4 storno ganda ditolak (reversalOfId unique)", stor2.status === 400, `status=${stor2.status}`);

// ===== 9) W1-5 — submit (dgn lampiran) → return → edit → re-submit =====
const stamp2 = Date.now().toString().slice(-6);
const draftId2 = `draft:e2e-w1b-${stamp2}`;
const form2 = new FormData();
form2.append("entityType", "MedicalClaim");
form2.append("entityId", draftId2);
form2.append("file", new Blob([Buffer.from(pngB64, "base64")], { type: "image/png" }), `kwitansi-e2e-b-${stamp2}.png`);
const up2Res = await fetch(`${BASE}/api/rekankerja/attachments`, { method: "POST", headers: cookie ? { cookie } : {}, body: form2 });
const up2J = await up2Res.json().catch(() => ({}));
ok("upload draft kwitansi ke-2", up2Res.status === 200 || up2Res.status === 201, `status=${up2Res.status}`);
const c2 = await api("POST", "/api/rekankerja/medical/claims", {
  employeeId: emp.id, typeId: typeUnl.id, claimDate: today, submit: true,
  attachmentIds: [up2J?.id].filter(Boolean),
  lines: [{ treatedName: emp.name, treatment: "Rawat jalan tahap 2", treatmentDate: today, receiptNo: `E2E-W1B-${stamp2}`, providerId: rs.id, billAmount: 150000, reimburseAmount: 0, approvedAmount: 150000 }],
});
const c2J = await c2.json().catch(() => ({}));
ok("submit klaim ke-2 (untuk uji return/edit)", c2.status === 201 && c2J?.id, `doc=${c2J?.docNo}`);

const retRes = await api("PATCH", "/api/rekankerja/medical/claims", { id: c2J.id, action: "return", note: "E2E — kwitansi kurang jelas" });
const retJ = await retRes.json().catch(() => ({}));
ok("return ke pemohon", retRes.status === 200 && retJ?.state === "Returned", `state=${retJ?.state}`);

const editRes = await api("PATCH", "/api/rekankerja/medical/claims", {
  id: c2J.id, action: "edit", claimDate: today, note: "E2E — data diperbaiki",
  lines: [{ treatedName: emp.name, treatment: "Rawat jalan tahap 2 (revisi)", treatmentDate: today, receiptNo: `E2E-W1B2-${stamp2}`, providerId: rs.id, physician: "dr. E2E Revisi", billAmount: 175000, reimburseAmount: 0, approvedAmount: 175000 }],
});
const editJ = await editRes.json().catch(() => ({}));
ok("W1-5 edit klaim Returned", editRes.status === 200, `status=${editRes.status} ${JSON.stringify(editJ).slice(0, 100)}`);

const resubRes = await api("PATCH", "/api/rekankerja/medical/claims", { id: c2J.id, action: "submit", note: "E2E re-submit" });
const resubJ = await resubRes.json().catch(() => ({}));
ok("re-submit pasca edit", resubRes.status === 200 && resubJ?.state === "Submitted", `state=${resubJ?.state}`);

// bersih-bersih: cancel klaim ke-2 agar rerun berikutnya bebas
const cancRes = await api("PATCH", "/api/rekankerja/medical/claims", { id: c2J.id, action: "cancel", note: "E2E cleanup" });
ok("cleanup cancel klaim ke-2", cancRes.status === 200, `status=${cancRes.status}`);

// kunci kembali vault bila tadi dibuka — best effort
if (vaultUnlocked) await api("POST", "/api/rekankerja/money-vault", { action: "lock" }).catch(() => {});

console.log(failures.length === 0 ? "\nSEMUA TES LULUS ✔" : `\nGAGAL: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
