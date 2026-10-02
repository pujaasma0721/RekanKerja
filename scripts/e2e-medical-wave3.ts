// Fix 92 — Wave 3 Medical E2E (local dev): GAP fitur tersisa audit BPA-medical
//   W3-1 (G-2)  — surat rujukan wajib (needLetter) utk jenis tertentu: guard
//                 submit service + ESS + passthrough letterNo
//   W3-2 (G-10) — migrasi saldo awal eksplisit (PATCH initialUsed, pad
//                 InitialMedicalBenefit.jsp) + guard negatif
//   W3-3 (G-5)  — potong gaji bagian over-limit (overLimitDeduct → komponen
//                 MED_POT pada period payroll terbuka; storno membersihkan)
// Jalankan: bun scripts/e2e-medical-wave3.ts  (server dev di :3000)
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

// kwitansi draf 1×1 px PNG — perlu utk jenis needReceipt (semua jenis demo)
const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
async function uploadDraftReceipt(tag: string): Promise<string | undefined> {
  const stamp = Date.now();
  const form = new FormData();
  form.append("entityType", "MedicalClaim");
  form.append("entityId", `draft:e2e-w3-${tag}-${stamp}`);
  form.append("file", new Blob([Buffer.from(pngB64, "base64")], { type: "image/png" }), `kwitansi-e2e-w3-${stamp}.png`);
  const res = await fetch(`${BASE}/api/rekankerja/attachments`, { method: "POST", headers: cookie ? { cookie } : {}, body: form });
  if (res.status !== 200 && res.status !== 201) return undefined;
  const j = await res.json().catch(() => ({}));
  return j?.id;
}

/** submit klaim + lampiran kwitansi; approve semua jenjang → kembalikan id. */
async function submitAndApprove(input: {
  employeeId: string; typeId: string; bill: number; treatedName: string; tag: string;
  letterNo?: string;
}): Promise<{ status: number; id?: string; docNo?: string; error?: string }> {
  const att = await uploadDraftReceipt(input.tag);
  const r = await api("POST", "/api/rekankerja/medical/claims", {
    employeeId: input.employeeId, typeId: input.typeId, claimDate: todayISO, submit: true,
    letterNo: input.letterNo,
    attachmentIds: att ? [att] : [],
    lines: [{
      treatedName: input.treatedName, treatment: "E2E W3", treatmentDate: todayISO,
      receiptNo: `E2E-W3-${input.tag}-${Date.now()}`, billAmount: input.bill, approvedAmount: input.bill,
    }],
  });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 201) return { status: r.status, error: String(j?.error ?? "") };
  for (let i = 0; i < 6; i++) {
    const ra = await api("PATCH", "/api/rekankerja/medical/claims", { id: j.id, action: "approve", note: `E2E W3 jenjang ${i + 1}` });
    const ja = await ra.json().catch(() => ({}));
    if (ra.status !== 200) return { status: ra.status, id: j.id, docNo: j.docNo, error: String(ja?.error ?? "") };
    if (ja?.state === "Approved") return { status: 201, id: j.id, docNo: j.docNo };
  }
  return { status: 500, id: j.id, docNo: j.docNo, error: "approval chain tidak selesai" };
}

interface BalRow {
  employeeId: string; employeeNo: string; fullName: string; typeCode: string; typeName: string;
  limitRule: string; benefitAmount: number | null; adjustmentAmount: number | null;
  carriedOver: number | null; initialUsed: number | null; usedAmount: number | null;
  remaining: number | null; depBenefitAmount: number | null; depAdjustment: number | null;
  depUsed: number | null; depRemaining: number | null;
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

const balRes = await api("GET", `/api/rekankerja/medical/balances?year=${YEAR}`);
const balJ = await balRes.json().catch(() => ({}));
const balances0: BalRow[] = balJ?.balances ?? [];
ok("GET medical/balances", balRes.status === 200 && balances0.length > 0, `status=${balRes.status}, ${balances0.length} saldo`);

const typesRes = await api("GET", "/api/rekankerja/medical/types");
const typesJ = await typesRes.json().catch(() => ({}));
const types: TypeRow[] = typesJ?.types ?? [];
const typeByCode = new Map(types.map((t) => [t.code, t]));
ok("GET medical/types (needLetter field ada)", typesRes.status === 200 && types.length > 0 && types.every((t) => typeof t.needLetter === "boolean"), `${types.length} jenis`);

async function refreshBalances(): Promise<BalRow[]> {
  const r = await api("GET", `/api/rekankerja/medical/balances?year=${YEAR}`);
  const j = await r.json().catch(() => ({}));
  return j?.balances ?? [];
}

// =====================================================================
// W3-2 (G-10) — migrasi saldo awal eksplisit (PATCH initialUsed)
// =====================================================================
console.log("\n== W3-2 (G-10): migrasi saldo awal eksplisit ==");
{
  const row = balances0.find((b) => b.limitRule === "NOMINAL" && (b.remaining ?? 0) > 1_000_000)
    ?? balances0.find((b) => (b.remaining ?? 0) > 100_000);
  if (!row) {
    ok("G-10: ada baris saldo utk uji", false, "tidak ada baris bersisa");
  } else {
    const typeId = typeByCode.get(row.typeCode)?.id ?? "";
    ok("G-10: baris target siap", !!typeId, `${row.employeeNo} ${row.typeCode} sisa ${row.remaining}`);
    // (a) input migrasi valid — +500.000 terpakai pra-sistem
    const p1 = await api("PATCH", "/api/rekankerja/medical/balances", {
      employeeId: row.employeeId, typeId, year: YEAR, initialUsed: 500_000,
    });
    const j1 = await p1.json().catch(() => ({}));
    const after1 = (await refreshBalances()).find((b) => b.employeeId === row.employeeId && b.typeCode === row.typeCode);
    ok("G-10: PATCH initialUsed +500rb → 200", p1.status === 200, `status=${p1.status}`);
    ok("G-10: sisa berkurang tepat 500rb", !!after1 && Math.abs((after1.remaining ?? 0) - ((row.remaining ?? 0) - 500_000)) < 1,
      `sebelum ${row.remaining} → sesudah ${after1?.remaining}`);
    // (b) nilai negatif ditolak
    const p2 = await api("PATCH", "/api/rekankerja/medical/balances", {
      employeeId: row.employeeId, typeId, year: YEAR, initialUsed: -100,
    });
    ok("G-10: initialUsed negatif → 400", p2.status === 400, `status=${p2.status}`);
    // (c) nilai raksasa → sisa negatif ditolak (floor W2-5 semangat)
    const p3 = await api("PATCH", "/api/rekankerja/medical/balances", {
      employeeId: row.employeeId, typeId, year: YEAR, initialUsed: 1_000_000_000_000,
    });
    const j3 = await p3.json().catch(() => ({}));
    ok("G-10: sisa negatif ditolak → 400", p3.status === 400 && /negatif/i.test(String(j3?.error ?? "")), `status=${p3.status} err=${String(j3?.error ?? "").slice(0, 60)}`);
    // (d) tahun tanpa saldo ditolak
    const p4 = await api("PATCH", "/api/rekankerja/medical/balances", {
      employeeId: row.employeeId, typeId, year: YEAR + 5, initialUsed: 1,
    });
    ok("G-10: tahun tanpa saldo → 400", p4.status === 400, `status=${p4.status}`);
    // cleanup — kembalikan 0
    const p5 = await api("PATCH", "/api/rekankerja/medical/balances", {
      employeeId: row.employeeId, typeId, year: YEAR, initialUsed: 0,
    });
    ok("G-10: cleanup initialUsed → 0", p5.status === 200, `status=${p5.status}`);
  }
}

// =====================================================================
// W3-1 (G-2) — surat rujukan wajib (needLetter)
// =====================================================================
console.log("\n== W3-1 (G-2): validasi surat rujukan ==");
let letterType: TypeRow | undefined;
{
  letterType = typeByCode.get("RAWAT_INAP") ?? types.find((t) => t.active && t.limitRule === "NOMINAL");
  if (!letterType) {
    ok("G-2: ada jenis utk uji needLetter", false);
  } else {
    // aktifkan needLetter (echo seluruh field master — upsert penuh)
    const upd = await api("POST", "/api/rekankerja/medical/types", {
      id: letterType.id, code: letterType.code, name: letterType.name,
      description: letterType.name, needReceipt: letterType.needReceipt, needLetter: true,
      limitRule: letterType.limitRule, limitValue: letterType.limitValue, wageCode: letterType.wageCode ?? undefined,
      freqUnlimited: letterType.freqUnlimited, freqValue: letterType.freqValue, freqPeriod: letterType.freqPeriod,
      pctCompany: letterType.pctCompany, pctInsurance: letterType.pctInsurance, insuranceCompany: letterType.insuranceCompany ?? undefined,
      unusedRule: letterType.unusedRule, cashWageCode: letterType.cashWageCode ?? undefined, maxCarryOver: letterType.maxCarryOver,
      dependentEnabled: letterType.dependentEnabled, maxDependents: letterType.maxDependents,
      maxChildAge: letterType.maxChildAge, depLimitRule: letterType.depLimitRule, active: letterType.active,
    });
    ok("G-2: aktifkan needLetter pada jenis", upd.status === 200 || upd.status === 201, `${letterType.code} status=${upd.status}`);
    const chk = (await (await api("GET", "/api/rekankerja/medical/types")).json())?.types?.find((t: TypeRow) => t.id === letterType?.id);
    ok("G-2: master membaca needLetter=true", chk?.needLetter === true);

    const cand = balances0.filter((b) => b.typeCode === letterType?.code && (b.remaining ?? 0) > 150_000);
    const row = cand[0];
    if (!row) {
      ok("G-2: ada saldo jenis target", false, "tidak ada baris bersisa utk jenis ini");
    } else {
      // (a) tanpa letterNo → 400 "surat rujukan" (lampiran diunggah dulu agar
      // guard kwitansi T16 lewat — target error-nya guard surat rujukan)
      const attA = await uploadDraftReceipt("g2a");
      const r1 = await api("POST", "/api/rekankerja/medical/claims", {
        employeeId: row.employeeId, typeId: letterType.id, claimDate: todayISO, submit: true,
        attachmentIds: attA ? [attA] : [],
        lines: [{
          treatedName: row.fullName, treatment: "Konsultasi E2E W3", treatmentDate: todayISO,
          receiptNo: `E2E-W3A-${Date.now()}`, billAmount: 150_000, approvedAmount: 150_000,
        }],
      });
      const j1 = await r1.json().catch(() => ({}));
      ok("G-2: submit tanpa surat rujukan → 400", r1.status === 400 && /surat rujukan/i.test(String(j1?.error ?? "")), `status=${r1.status} err=${String(j1?.error ?? "").slice(0, 70)}`);
      // (b) dengan letterNo → 201
      const attB = await uploadDraftReceipt("g2b");
      const r2 = await api("POST", "/api/rekankerja/medical/claims", {
        employeeId: row.employeeId, typeId: letterType.id, claimDate: todayISO, submit: true,
        letterNo: `RS-E2E-W3-${Date.now()}`,
        attachmentIds: attB ? [attB] : [],
        lines: [{
          treatedName: row.fullName, treatment: "Konsultasi E2E W3", treatmentDate: todayISO,
          receiptNo: `E2E-W3B-${Date.now()}`, billAmount: 150_000, approvedAmount: 150_000,
        }],
      });
      const j2 = await r2.json().catch(() => ({}));
      ok("G-2: submit dgn surat rujukan → 201", r2.status === 201, `status=${r2.status} doc=${j2?.docNo ?? "-"}`);
      // cleanup — batalkan klaim (Submitted → cancel)
      if (j2?.id) {
        const cx = await api("PATCH", "/api/rekankerja/medical/claims", { id: j2.id, action: "cancel", note: "cleanup E2E wave3" });
        ok("G-2: cleanup klaim uji dibatalkan", cx.status === 200, `status=${cx.status}`);
      }
    }

    // (c) ESS — form GET membawa needLetter & POST tanpa letter ditolak 400
    const essGet = await api("GET", "/api/rekankerja/ess/claims/medical");
    if (essGet.status === 200) {
      const essJ = await essGet.json().catch(() => ({}));
      const essType = (essJ?.types ?? []).find((t: { typeId: string }) => t.typeId === letterType?.id);
      ok("G-2: ESS GET membawa needLetter", !!essType && essType.needLetter === true);
      const essPost = await api("POST", "/api/rekankerja/ess/claims/medical", {
        typeId: letterType.id, claimDate: todayISO,
        lines: [{ treatedName: "E2E ESS", billAmount: 100_000 }],
      });
      const essJ2 = await essPost.json().catch(() => ({}));
      ok("G-2: ESS submit tanpa surat rujukan → 400", essPost.status === 400 && /surat rujukan/i.test(String(essJ2?.error ?? "")), `status=${essPost.status}`);
    } else {
      console.log(`  ESS dilewati (akun owner tidak tertaut karyawan — status=${essGet.status})`);
    }

    // pulihkan master — needLetter=false
    const restore = await api("POST", "/api/rekankerja/medical/types", {
      id: letterType.id, code: letterType.code, name: letterType.name,
      description: letterType.name, needReceipt: letterType.needReceipt, needLetter: false,
      limitRule: letterType.limitRule, limitValue: letterType.limitValue, wageCode: letterType.wageCode ?? undefined,
      freqUnlimited: letterType.freqUnlimited, freqValue: letterType.freqValue, freqPeriod: letterType.freqPeriod,
      pctCompany: letterType.pctCompany, pctInsurance: letterType.pctInsurance, insuranceCompany: letterType.insuranceCompany ?? undefined,
      unusedRule: letterType.unusedRule, cashWageCode: letterType.cashWageCode ?? undefined, maxCarryOver: letterType.maxCarryOver,
      dependentEnabled: letterType.dependentEnabled, maxDependents: letterType.maxDependents,
      maxChildAge: letterType.maxChildAge, depLimitRule: letterType.depLimitRule, active: letterType.active,
    });
    ok("G-2: pulihkan needLetter=false", restore.status === 200 || restore.status === 201, `status=${restore.status}`);
  }
}

// =====================================================================
// W3-3 (G-5) — potong gaji bagian over-limit
// =====================================================================
console.log("\n== W3-3 (G-5): potong gaji over-limit ==");
{
  // pilih karyawan+jenis NOMINAL bersisa (hindari jenis yang dipakai G-2 di atas)
  const cands = balances0.filter((b) =>
    b.limitRule === "NOMINAL" && (b.remaining ?? 0) > 3_000_000 && b.typeCode !== letterType?.code,
  );
  let done = false;
  for (const row of cands.slice(0, 6)) {
    if (done) break;
    const typeId = typeByCode.get(row.typeCode)?.id ?? "";
    if (!typeId) continue;
    const A = 2_000_000; // total approved klaim (dalam plafon saat submit)
    // submit + lampiran kwitansi + approve SEMUA jenjang (plafon masih utuh)
    const sub = await submitAndApprove({ employeeId: row.employeeId, typeId, bill: A, treatedName: row.fullName, tag: "g5" });
    if (sub.status !== 201 || !sub.id) {
      console.log(`  skip ${row.employeeNo}/${row.typeCode}: submit/approve ${sub.status} ${String(sub.error ?? "").slice(0, 90)}`);
      continue;
    }
    done = true;
    ok("G-5: klaim dalam plafon approve penuh → Approved", sub.status === 201, `${sub.docNo} A=${A.toLocaleString("id-ID")}`);

    // kecilkan plafon via adjustment negatif — sisa tinggal Rp 1
    const shrink = (row.remaining ?? 0) - 1;
    const rAdj = await api("POST", "/api/rekankerja/medical/adjustments", {
      employeeId: row.employeeId, typeId, year: YEAR, amount: -shrink, adjustmentDate: todayISO,
      note: "E2E W3 — kecilkan plafon utk uji over-limit",
    });
    const jAdj = await rAdj.json().catch(() => ({}));
    ok("G-5: adjustment negatif dibuat", rAdj.status === 201, `status=${rAdj.status} doc=${jAdj?.docNo ?? "-"}`);
    const rAp = await api("PATCH", "/api/rekankerja/medical/adjustments", { id: jAdj?.id, action: "approve", note: "E2E W3" });
    ok("G-5: adjustment di-approve", rAp.status === 200, `status=${rAp.status}`);

    // (a) settle tanpa potongan → 400 (guard K-1 settle tetap aktif bila flag off)
    const rAn = await api("PATCH", "/api/rekankerja/medical/claims", { id: sub.id, action: "settle" });
    const jAn = await rAn.json().catch(() => ({}));
    ok("G-5: settle over-limit tanpa potongan → 400", rAn.status === 400 && /Settle ditolak/i.test(String(jAn?.error ?? "")), `status=${rAn.status} err=${String(jAn?.error ?? "").slice(0, 60)}`);

    // (b) settle dengan overLimitDeduct → 200 + potongan MED_POT
    const rSt = await api("PATCH", "/api/rekankerja/medical/claims", {
      id: sub.id, action: "settle", overLimitDeduct: true, note: "E2E W3 — over-limit dipotong gaji",
    });
    const jSt = await rSt.json().catch(() => ({}));
    const expectOver = A - 1; // available ≈ Rp 1 (tanpa reservasi lain)
    ok("G-5: settle dgn potongan → 200", rSt.status === 200, `status=${rSt.status} state=${jSt?.state}`);
    ok("G-5: overLimitDeducted ≈ over riil", typeof jSt?.overLimitDeducted === "number" && jSt.overLimitDeducted > 0 && jSt.overLimitDeducted <= A,
      `deducted=${jSt?.overLimitDeducted} (harusnya ~${expectOver})`);
    ok("G-5: period potongan tercatat", typeof jSt?.deductPeriodName === "string" && jSt.deductPeriodName.length > 0, `period=${jSt?.deductPeriodName}`);

    // (c) storno — potongan MED_POT ikut dihapus (removedDeductions = 1)
    const rRev = await api("PATCH", "/api/rekankerja/medical/claims", {
      id: sub.id, action: "storno", note: "E2E W3 — storno uji potongan",
    });
    const jRev = await rRev.json().catch(() => ({}));
    ok("G-5: storno → 200", rRev.status === 200, `status=${rRev.status} reversal=${jRev?.reversalOf ?? "-"}`);
    ok("G-5: potongan gaji terkait dihapus (removedDeductions=1)", jRev?.removedDeductions === 1, `removed=${jRev?.removedDeductions}`);

    // cleanup — kembalikan plafon (adjustment positif setara)
    const rAdj2 = await api("POST", "/api/rekankerja/medical/adjustments", {
      employeeId: row.employeeId, typeId, year: YEAR, amount: shrink, adjustmentDate: todayISO,
      note: "E2E W3 — pulihkan plafon",
    });
    const jAdj2 = await rAdj2.json().catch(() => ({}));
    const rAp2 = await api("PATCH", "/api/rekankerja/medical/adjustments", { id: jAdj2?.id, action: "approve", note: "E2E W3" });
    ok("G-5: cleanup plafon dipulihkan", rAdj2.status === 201 && rAp2.status === 200, `status=${rAdj2.status}/${rAp2.status}`);
  }
  if (!done) ok("G-5: kandidat over-limit diuji", false, "tidak ada baris kandidat yang lolos submit");
}

// ===== selesai =====
console.log("\n========================================");
if (failures.length === 0) {
  console.log("SEMUA ASSERTION WAVE 3 LULUS ✓");
} else {
  console.log(`GAGAL ${failures.length}: ${failures.join(" | ")}`);
  process.exit(1);
}
