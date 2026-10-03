// Fix 93 — Wave 4 Medical E2E (local dev): G-3 piutang asuransi
//   W4-1 (G-3)  — siklus piutang asuransi (padanan oranHR "Paid By Insurance %"):
//                 settle → jurnal split 5106/piutang 13xx → kirim ke asuransi →
//                 terima pembayaran (jurnal kas/piutang, parsial→PAID) →
//                 atau hapus buku (jurnal beban/piutang) + guard + KPI.
// Jalankan: bun scripts/e2e-medical-wave4.ts  (server dev di :3000)
export {};
const BASE = "http://127.0.0.1:3000";
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
const todayISO = new Date().toISOString().slice(0, 10);

// kwitansi draf 1×1 px PNG — jenis demo needReceipt semua
const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
async function uploadDraftReceipt(tag: string): Promise<string | undefined> {
  const stamp = Date.now();
  const form = new FormData();
  form.append("entityType", "MedicalClaim");
  form.append("entityId", `draft:e2e-w4-${tag}-${stamp}`);
  form.append("file", new Blob([Buffer.from(pngB64, "base64")], { type: "image/png" }), `kwitansi-e2e-w4-${stamp}.png`);
  const res = await fetch(`${BASE}/api/rekankerja/attachments`, { method: "POST", headers: cookie ? { cookie } : {}, body: form });
  if (res.status !== 200 && res.status !== 201) return undefined;
  const j = await res.json().catch(() => ({}));
  return j?.id;
}

interface TypeRow {
  id: string; code: string; name: string; needReceipt: boolean; needLetter: boolean;
  limitRule: string; limitValue: number; wageCode: string | null;
  freqUnlimited: boolean; freqValue: number; freqPeriod: string;
  pctCompany: number; pctInsurance: number; insuranceCompany: string | null;
  unusedRule: string; cashWageCode: string | null; maxCarryOver: number;
  dependentEnabled: boolean; maxDependents: number; maxChildAge: number; depLimitRule: string;
  active: boolean;
}
async function getTypes(): Promise<TypeRow[]> {
  const r = await api("GET", "/api/rekankerja/medical/types");
  const j = await r.json().catch(() => ({}));
  return j?.types ?? [];
}
async function saveType(t: TypeRow, over: Partial<TypeRow>): Promise<number> {
  const r = await api("POST", "/api/rekankerja/medical/types", {
    id: t.id, code: t.code, name: t.name, needReceipt: t.needReceipt, needLetter: t.needLetter,
    limitRule: t.limitRule, limitValue: t.limitValue, wageCode: t.wageCode,
    freqUnlimited: t.freqUnlimited, freqValue: t.freqValue, freqPeriod: t.freqPeriod,
    pctCompany: over.pctCompany ?? t.pctCompany,
    pctInsurance: over.pctInsurance ?? t.pctInsurance,
    insuranceCompany: over.insuranceCompany ?? t.insuranceCompany ?? undefined,
    unusedRule: t.unusedRule, cashWageCode: t.cashWageCode, maxCarryOver: t.maxCarryOver,
    dependentEnabled: t.dependentEnabled, maxDependents: t.maxDependents,
    maxChildAge: t.maxChildAge, depLimitRule: t.depLimitRule, active: t.active,
  });
  return r.status;
}

/** submit + approve semua jenjang → settle → kembalikan { id, docNo, journalNo }. */
async function submitApproveSettle(input: {
  employeeId: string; typeId: string; bill: number; treatedName: string; tag: string;
}): Promise<{ status: number; id?: string; docNo?: string; journalNo?: string; error?: string }> {
  const att = await uploadDraftReceipt(input.tag);
  const r = await api("POST", "/api/rekankerja/medical/claims", {
    employeeId: input.employeeId, typeId: input.typeId, claimDate: todayISO, submit: true,
    attachmentIds: att ? [att] : [],
    lines: [{
      treatedName: input.treatedName, treatment: "E2E W4", treatmentDate: todayISO,
      receiptNo: `E2E-W4-${input.tag}-${Date.now()}`, billAmount: input.bill, approvedAmount: input.bill,
    }],
  });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 201) return { status: r.status, error: String(j?.error ?? "") };
  for (let i = 0; i < 6; i++) {
    const ra = await api("PATCH", "/api/rekankerja/medical/claims", { id: j.id, action: "approve", note: `E2E W4 jenjang ${i + 1}` });
    const ja = await ra.json().catch(() => ({}));
    if (ra.status !== 200) return { status: ra.status, id: j.id, docNo: j.docNo, error: String(ja?.error ?? "") };
    if (ja?.state === "Approved") break;
  }
  const rs = await api("PATCH", "/api/rekankerja/medical/claims", { id: j.id, action: "settle", note: "E2E W4 settle" });
  const js = await rs.json().catch(() => ({}));
  if (rs.status !== 200) return { status: rs.status, id: j.id, docNo: j.docNo, error: String(js?.error ?? "") };
  return { status: 200, id: j.id, docNo: j.docNo, journalNo: js?.journalNo };
}

interface JLine { accountCode: string; position: string; amount: number | null; memo: string | null }
/** GET payroll-journals?id= memakai ID internal — resolve journalNo → id via list. */
async function journalLines(journalNo: string | null | undefined): Promise<JLine[]> {
  if (!journalNo) return [];
  const rl = await api("GET", "/api/rekankerja/payroll-journals");
  if (rl.status !== 200) return [];
  const jl = await rl.json().catch(() => ({}));
  const jid = (jl?.journals ?? []).find((x: { journalNo: string }) => x.journalNo === journalNo)?.id;
  if (!jid) return [];
  const r = await api("GET", `/api/rekankerja/payroll-journals?id=${encodeURIComponent(jid)}`);
  if (r.status !== 200) return [];
  const j = await r.json().catch(() => ({}));
  return (j?.journal?.lines ?? []) as JLine[];
}

async function getIns() {
  const r = await api("GET", "/api/rekankerja/medical/insurance");
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

// ===== 2) data: jenis + saldo kandidat =====
const types0 = await getTypes();
const balances0 = (await (async () => {
  const r = await api("GET", `/api/rekankerja/medical/balances?year=${YEAR}`);
  const j = await r.json().catch(() => ({}));
  return (j?.balances ?? []) as { employeeId: string; employeeNo: string; fullName: string; typeCode: string; remaining: number | null }[];
})());
ok("GET types + balances", types0.length > 0 && balances0.length > 0, `${types0.length} jenis, ${balances0.length} saldo`);

// jenis kandidat = jenis aktif non-UNLIMITED yang punya saldo karyawan ≥ NEED
// (jenis & saldo HARUS konsisten — plafon dicek per jenis di submit).
const NEED = 600_000;
const row = balances0.find((b) => {
  if ((b.remaining ?? 0) < NEED) return false;
  const t = types0.find((x) => x.code === b.typeCode);
  return !!t && t.active && t.limitRule !== "UNLIMITED";
});
const pick = row ? types0.find((t) => t.code === row.typeCode) : undefined;
if (!row || !pick) { ok("kandidat jenis+saldo", false, `butuh saldo ≥ ${NEED.toLocaleString("id-ID")} pada jenis aktif non-UNLIMITED`); process.exit(1); }
ok("kandidat jenis+saldo", true, `${row.employeeNo} ${row.fullName} ${pick.code} sisa ${row.remaining?.toLocaleString("id-ID")}`);
const orig = { pctCompany: pick.pctCompany, pctInsurance: pick.pctInsurance, insuranceCompany: pick.insuranceCompany };
const rSet = await saveType(pick, { pctCompany: 40, pctInsurance: 60, insuranceCompany: "Asuransi E2E" });
ok("set jenis 60/40 Asuransi E2E", rSet === 200, `status=${rSet} ${pick.code}`);
const types = await getTypes();
const tgt = types.find((t) => t.id === pick.id);
ok("kebijakan terbaca (pctInsurance 60)", !!tgt && tgt.pctInsurance === 60 && tgt.insuranceCompany === "Asuransi E2E",
  tgt ? `${tgt.code} ${tgt.pctCompany}/${tgt.pctInsurance}%` : "-");

// ===== 3) klaim A: settle → jurnal split → kirim → terima parsial → lunas =====
const BILL_A = 500_000; // piutang 300rb, beban 200rb
const A = await submitApproveSettle({ employeeId: row.employeeId, typeId: tgt!.id, bill: BILL_A, treatedName: row.fullName, tag: "a" });
ok("A: submit+approve+settle", A.status === 200 && !!A.journalNo, `${A.docNo ?? A.error} jurnal=${A.journalNo ?? "-"}`);
const jlA = await journalLines(A.journalNo);
const insDebitA = jlA.filter((l) => l.accountCode.startsWith("13") && l.position === "Debit").reduce((s, l) => s + (l.amount ?? 0), 0);
const expDebitA = jlA.filter((l) => l.accountCode === "5106").reduce((s, l) => s + (l.amount ?? 0), 0);
const cashCreditA = jlA.filter((l) => l.accountCode === "1101" && l.position === "Credit").reduce((s, l) => s + (l.amount ?? 0), 0);
ok("A: jurnal settle split 300rb piutang + 200rb beban + 500rb kas",
  Math.round(insDebitA) === 300_000 && Math.round(expDebitA) === 200_000 && Math.round(cashCreditA) === 500_000,
  `piutang=${insDebitA} beban=${expDebitA} kas=${cashCreditA}`);

const insA0 = (await getIns()).j?.rows?.find((r: { docNo?: string }) => r.docNo === A.docNo);
ok("A: muncul di piutang (NONE, 300rb)", !!insA0 && insA0.insState === "NONE" && Math.round(insA0.insAmount) === 300_000,
  insA0 ? `${insA0.insState} insAmount=${insA0.insAmount}` : "tidak ditemukan");

// KPI sebelum siklus piutang A
const ov0 = await api("GET", `/api/rekankerja/medical/overview?year=${YEAR}`);
const ov0J = await ov0.json().catch(() => ({}));
ok("overview.insOutstanding == 300rb (A belum kirim)", ov0.status === 200 && Math.round(ov0J?.insOutstanding ?? -1) === 300_000,
  `insOutstanding=${ov0J?.insOutstanding}`);

// guard: paid sebelum submit → 400
const g1 = await api("POST", "/api/rekankerja/medical/insurance", { id: A.id, action: "paid" });
ok("A: paid sebelum submit → 400", g1.status === 400, `err=${String((await g1.json().catch(() => ({})))?.error ?? "").slice(0, 70)}`);

const s1 = await api("POST", "/api/rekankerja/medical/insurance", { id: A.id, action: "submit", insRefNo: "INS-E2E-001", note: "E2E W4 kirim" });
ok("A: kirim ke asuransi → SUBMITTED", s1.status === 200, `status=${s1.status}`);
const s1dup = await api("POST", "/api/rekankerja/medical/insurance", { id: A.id, action: "submit" });
ok("A: kirim ulang → 400", s1dup.status === 400, `err=${String((await s1dup.json().catch(() => ({})))?.error ?? "").slice(0, 60)}`);

// terima parsial 100rb → tetap SUBMITTED, jurnal kas/piutang
const p1 = await api("POST", "/api/rekankerja/medical/insurance", { id: A.id, action: "paid", paidAmount: 100_000, note: "cicilan 1" });
const p1J = await p1.json().catch(() => ({}));
ok("A: terima parsial 100rb → SUBMITTED sisa 200rb", p1.status === 200 && p1J?.insState === "SUBMITTED" && Math.round(p1J?.outstanding ?? -1) === 200_000,
  `outstanding=${p1J?.outstanding} jurnal=${p1J?.journalNo ?? "-"}`);
const jlP1 = await journalLines(p1J?.journalNo);
const cashDebitP1 = jlP1.filter((l) => l.accountCode === "1101" && l.position === "Debit").reduce((s, l) => s + (l.amount ?? 0), 0);
const insCreditP1 = jlP1.filter((l) => l.accountCode.startsWith("13") && l.position === "Credit").reduce((s, l) => s + (l.amount ?? 0), 0);
ok("A: jurnal pelunasan parsial Debit kas 100rb / Credit piutang 100rb",
  Math.round(cashDebitP1) === 100_000 && Math.round(insCreditP1) === 100_000, `kas=${cashDebitP1} piutang=${insCreditP1}`);

// pelunasan → PAID
const p2 = await api("POST", "/api/rekankerja/medical/insurance", { id: A.id, action: "paid" });
const p2J = await p2.json().catch(() => ({}));
ok("A: pelunasan (default sisa) → PAID outstanding 0", p2.status === 200 && p2J?.insState === "PAID" && Math.round(p2J?.outstanding ?? -1) === 0,
  `insPaid=${p2J?.insPaidAmount} jurnal=${p2J?.journalNo ?? "-"}`);
const g2 = await api("POST", "/api/rekankerja/medical/insurance", { id: A.id, action: "paid" });
ok("A: paid setelah PAID → 400", g2.status === 400, `err=${String((await g2.json().catch(() => ({})))?.error ?? "").slice(0, 60)}`);

// ===== 4) klaim B: submit → hapus buku (writeoff) =====
const BILL_B = 400_000; // piutang 240rb
const B = await submitApproveSettle({ employeeId: row.employeeId, typeId: tgt!.id, bill: BILL_B, treatedName: row.fullName, tag: "b" });
ok("B: submit+approve+settle", B.status === 200 && !!B.journalNo, `${B.docNo ?? B.error}`);
const sb = await api("POST", "/api/rekankerja/medical/insurance", { id: B.id, action: "submit", insRefNo: "INS-E2E-002" });
ok("B: kirim ke asuransi", sb.status === 200, `status=${sb.status}`);
const wo = await api("POST", "/api/rekankerja/medical/insurance", { id: B.id, action: "writeoff" });
ok("B: hapus buku tanpa alasan → 400", wo.status === 400, `err=${String((await wo.json().catch(() => ({})))?.error ?? "").slice(0, 60)}`);
const wo2 = await api("POST", "/api/rekankerja/medical/insurance", { id: B.id, action: "writeoff", note: "E2E W4 — klaim ditolak asuransi" });
const wo2J = await wo2.json().catch(() => ({}));
ok("B: hapus buku → WRITTEN_OFF outstanding 0", wo2.status === 200 && wo2J?.insState === "WRITTEN_OFF" && Math.round(wo2J?.outstanding ?? -1) === 0,
  `jurnal=${wo2J?.journalNo ?? "-"}`);
const jlWo = await journalLines(wo2J?.journalNo);
const expDebitWo = jlWo.filter((l) => l.accountCode === "5106" && l.position === "Debit").reduce((s, l) => s + (l.amount ?? 0), 0);
const insCreditWo = jlWo.filter((l) => l.accountCode.startsWith("13") && l.position === "Credit").reduce((s, l) => s + (l.amount ?? 0), 0);
ok("B: jurnal hapus buku Debit 5106 240rb / Credit piutang 240rb",
  Math.round(expDebitWo) === 240_000 && Math.round(insCreditWo) === 240_000, `beban=${expDebitWo} piutang=${insCreditWo}`);

// guard: storno klaim dgn piutang final → 400 (W4)
const gst = await api("PATCH", "/api/rekankerja/medical/claims", { id: B.id, action: "storno", note: "E2E W4 — harus ditolak" });
ok("B: storno klaim piutang WRITTEN_OFF → 400", gst.status === 400,
  `err=${String((await gst.json().catch(() => ({})))?.error ?? "").slice(0, 70)}`);

// ===== 5) guard klaim belum disettle =====
const attD = await uploadDraftReceipt("d");
const rd = await api("POST", "/api/rekankerja/medical/claims", {
  employeeId: row.employeeId, typeId: tgt!.id, claimDate: todayISO, submit: false,
  attachmentIds: attD ? [attD] : [],
  lines: [{ treatedName: row.fullName, treatment: "E2E W4", treatmentDate: todayISO, receiptNo: `E2E-W4-D-${Date.now()}`, billAmount: 50_000, approvedAmount: 50_000 }],
});
const rdJ = await rd.json().catch(() => ({}));
if (rd.status === 201 && rdJ?.id) {
  const gd = await api("POST", "/api/rekankerja/medical/insurance", { id: rdJ.id, action: "submit" });
  ok("D: piutang klaim belum disettle → 400", gd.status === 400, `err=${String((await gd.json().catch(() => ({})))?.error ?? "").slice(0, 60)}`);
  await api("PATCH", "/api/rekankerja/medical/claims", { id: rdJ.id, action: "cancel", note: "E2E W4 cleanup" });
} else {
  ok("D: buat klaim draft", false, `status=${rd.status}`);
}

// ===== 6) KPI akhir & rekap per asuransi =====
const insF = await getIns();
ok("rekap byInsurer 'Asuransi E2E' ada", insF.status === 200 && (insF.j?.byInsurer ?? []).some((b: { insurer: string }) => b.insurer === "Asuransi E2E"),
  `${(insF.j?.rows ?? []).length} baris piutang, total ${insF.j?.totalOutstanding}`);
const ovF = await api("GET", `/api/rekankerja/medical/overview?year=${YEAR}`);
const ovFJ = await ovF.json().catch(() => ({}));
ok("overview.insOutstanding == 0 (semua lunas/hapus buku)", ovF.status === 200 && Math.round(ovFJ?.insOutstanding ?? -1) === 0,
  `insOutstanding=${ovFJ?.insOutstanding}`);

// ===== 7) restore kebijakan jenis =====
const rRes = await saveType(tgt!, orig);
ok("restore kebijakan jenis", rRes === 200, `status=${rRes} pct=${orig.pctCompany}/${orig.pctInsurance}`);

// ===== ringkasan =====
console.log(`\n${failures.length === 0 ? "SEMUA ASSERTION WAVE 4 LULUS ✓" : `${failures.length} GAGAL ✗`}`);
process.exit(failures.length === 0 ? 0 : 1);
