// Uji E2E P2.5 (Benefits administration grup — DEVELOPMENT-PLAN-BENCHMARK.md
// §2 D-BM20 + §4 P2.5, §5 gap-5) — di atas data demo MII:
//   (0) SETUP: login HR owner; provider INSURANCE aktif (ASR-AIA); karyawan
//       MII00005 Joko Susilo + 1 family dependen (fixture via API family).
//   (1) UPSERT polis (premi 5.000.000, porsi perusahaan 80%, 1 tahun) → 201;
//       raw premiumMonthly di DB TERENKRIPSI (enc:…); duplikat provider+no →
//       409; provider HOSPITAL → 400.
//   (2) ENROLL karyawan + dependen → 2 membership; duplikat → 409; dependen
//       milik karyawan lain → 400.
//   (3) LAPORAN PREMI: ?report=<id> → rows 2 (premi/anggota 2,5jt; porsi
//       perusahaan 2jt; porsi karyawan 0,5jt) + rekap 1 polis; ?list →
//       premiumMonthly tampil (vault terbuka) + member aktif 2; export=xlsx
//       200 XLSX valid.
//   (4) TERMINASI HOOK: terminatePolicyMemberships (unit — pola hook PA)
//       → membership tertutup + ActivityLog; re-enroll utk job test.
//   (5) JOB jobPolicyMemberExpiry: karyawan Resigned + membership terbuka →
//       tertutup otomatis; employee direstore.
//   (6) RENEWAL H-30: periodEnd = H+20 → jobPolicyRenewalReminders → EmailLog
//       "policy.renewal.reminder" + ActivityLog Reminder + Notification
//       Admin/HR + run ke-2 DEDUPE (tidak dobel).
// CLEANUP: membership + polis + family uji dihapus; employee direstore;
//       ActivityLog/EmailLog/Notification DIPERTAHANKAN (pola B8).
// Jalankan: bun scripts/e2e-p25-benefits.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { jobPolicyMemberExpiry, jobPolicyRenewalReminders } from "@/rekankerja/medical/services/policy-jobs";
import { terminatePolicyMemberships } from "@/rekankerja/medical/services/policy-service";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const POL_API = "/api/rekankerja/medical/insurance-policies";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${BASE}${path}`, {
          method,
          headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
        });
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) this.cookie = setCookie.split(";")[0];
        const text = await res.text();
        let json: any = {};
        try { json = JSON.parse(text); } catch { /* keep */ }
        return { status: res.status, json, text };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
}

function iso(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const hr = new Sesi();
  const t0 = new Date();
  const rnd = String(Date.now()).slice(-6);

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login + provider INSURANCE + karyawan + family fixture");
  const login = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(login.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${login.status}`);

  const provider = await db.medicalProvider.findFirst({ where: { kind: "INSURANCE", active: true } });
  ok(!!provider, "provider INSURANCE aktif ditemukan", provider?.code ?? "—");
  const hospital = await db.medicalProvider.findFirst({ where: { kind: "HOSPITAL" } });
  const emp = await db.employee.findFirst({ where: { employeeNo: "MII00005", status: "Active" } });
  ok(!!emp, "karyawan MII00005 aktif", emp?.fullName ?? "—");
  const otherEmp = await db.employee.findFirst({ where: { status: "Active", id: { not: emp?.id } } });
  if (!provider || !emp || !otherEmp) {
    console.log(`\nHASIL: ${pass}/${pass + fail} — fixture tidak tersedia, hentikan.`);
    process.exit(1);
  }

  const FAM_NAME = `E2E P25 Pasangan ${rnd}`;
  const mkFam = await hr.api("POST", "/api/rekankerja/family", {
    employeeId: emp.id, relation: "Spouse", name: FAM_NAME, gender: "F",
    birthDate: "1991-03-14", isDependent: true,
  });
  ok(mkFam.status === 201, "family dependen fixture dibuat (API family)", `HTTP ${mkFam.status}`);
  const famId: string | undefined = mkFam.json?.family?.id ?? mkFam.json?.id;
  ok(!!famId, "id family fixture didapat");
  const otherFam = await db.employeeFamily.findFirst({ where: { employeeId: otherEmp.id }, select: { id: true } });
  if (!famId) {
    console.log(`\nHASIL: ${pass}/${pass + fail} — fixture family gagal, hentikan.`);
    process.exit(1);
  }

  // ================= (1) UPSERT POLIS =================
  console.log("\n[(1)] UPSERT polis — premi terenkripsi at-rest + guard duplikat/kind");
  const POLICY_NO = `E2E-P25-${rnd}`;
  const c1 = await hr.api("POST", POL_API, {
    action: "upsert",
    providerId: provider.id, policyNo: POLICY_NO,
    periodStart: iso(0), periodEnd: iso(365),
    premiumMonthly: 5_000_000, pctCompany: 80, note: "e2e p25 polis uji",
  });
  ok(c1.status === 201, "create polis → 201", `HTTP ${c1.status}`);
  const policyId: string | undefined = c1.json?.id;
  ok(!!policyId, "id polis didapat", policyId?.slice(-6) ?? "?");
  const rawPol = await db.insurancePolicy.findUnique({ where: { id: policyId } });
  ok(!!rawPol?.premiumMonthly?.startsWith("enc:"), "premiumMonthly RAW di DB TERENKRIPSI (enc:…)", (rawPol?.premiumMonthly ?? "").slice(0, 16));
  ok(rawPol?.status === "Active" && rawPol?.pctCompany === 80, "status Active + pctCompany 80");
  const dup = await hr.api("POST", POL_API, {
    action: "upsert", providerId: provider.id, policyNo: POLICY_NO,
    periodStart: iso(0), periodEnd: iso(365), premiumMonthly: 1_000_000, pctCompany: 100,
  });
  ok(dup.status === 409, "duplikat provider+policyNo → 409", `HTTP ${dup.status}`);
  if (hospital) {
    const wrongKind = await hr.api("POST", POL_API, {
      action: "upsert", providerId: hospital.id, policyNo: `E2E-P25-H-${rnd}`,
      periodStart: iso(0), periodEnd: iso(365), premiumMonthly: 1, pctCompany: 100,
    });
    ok(wrongKind.status === 400, "provider HOSPITAL ditolak → 400", `HTTP ${wrongKind.status}`);
  }

  // ================= (2) ENROLL =================
  console.log("\n[(2)] ENROLL — karyawan + dependen + guard");
  const e1 = await hr.api("POST", POL_API, { action: "enroll", policyId, employeeId: emp.id, effectiveFrom: iso(0) });
  ok(e1.status === 201, "enroll karyawan → 201", `HTTP ${e1.status}`);
  const e2 = await hr.api("POST", POL_API, { action: "enroll", policyId, employeeId: emp.id, dependentId: famId, effectiveFrom: iso(0) });
  ok(e2.status === 201, "enroll dependen (family) → 201", `HTTP ${e2.status}`);
  const dupEnroll = await hr.api("POST", POL_API, { action: "enroll", policyId, employeeId: emp.id, effectiveFrom: iso(0) });
  ok(dupEnroll.status === 409, "enroll duplikat (karyawan sama, tanggal sama) → 409", `HTTP ${dupEnroll.status}`);
  if (otherFam) {
    const wrongDep = await hr.api("POST", POL_API, { action: "enroll", policyId, employeeId: emp.id, dependentId: otherFam.id, effectiveFrom: iso(0) });
    ok(wrongDep.status === 400, "dependen milik karyawan lain → 400", `HTTP ${wrongDep.status}`);
  }
  const memberCount = await db.policyMember.count({ where: { policyId } });
  ok(memberCount === 2, "2 membership (karyawan + dependen)", `${memberCount}`);

  // ================= (3) LAPORAN PREMI =================
  console.log("\n[(3)] LAPORAN PREMI — split porsi + export XLSX (vault)");
  const rep = await hr.api("GET", `${POL_API}?report=${policyId}`);
  ok(rep.status === 200, "GET ?report → 200", `HTTP ${rep.status}`);
  const rows: any[] = rep.json?.rows ?? [];
  const rekap: any[] = rep.json?.rekap ?? [];
  ok(rows.length === 2, "rows premi = 2 anggota", `${rows.length}`);
  ok(rows.every((r) => r.premiumPerMember === 2_500_000), "premi per anggota = 2.500.000 (5jt / 2)", JSON.stringify(rows[0]?.premiumPerMember));
  ok(rows.every((r) => r.companyShare === 2_000_000 && r.employeeShare === 500_000), "porsi perusahaan 2jt (80%) + karyawan 0,5jt");
  ok(rekap.length === 1 && rekap[0]?.totalCompany === 4_000_000 && rekap[0]?.totalEmployee === 1_000_000, "rekap: total perusahaan 4jt + karyawan 1jt");
  const lst = await hr.api("GET", `${POL_API}?list`);
  const pol = (lst.json?.policies ?? []).find((p: any) => p.id === policyId);
  ok(!!pol, "?list memuat polis uji");
  ok(pol?.premiumMonthly === 5_000_000 && pol?.premiumMasked === false, "premiumMonthly tampil via vault (5jt, tidak ter-mask)", `${pol?.premiumMonthly}`);
  ok(pol?.status === "Active", "status Active di register");
  const x1 = await fetch(`${BASE}${POL_API}?report=${policyId}&export=xlsx`, { headers: { cookie: hr.cookie } });
  ok(x1.status === 200, "export XLSX laporan premi → 200", `HTTP ${x1.status}`);
  ok((x1.headers.get("content-type") ?? "").includes("spreadsheetml"), "content-type XLSX");
  const buf = Buffer.from(await x1.arrayBuffer());
  ok(buf.length > 4_000, "buffer XLSX wajar", `${buf.length} B`);
  const det = await hr.api("GET", `${POL_API}?detail=${policyId}`);
  ok(det.status === 200 && (det.json?.members ?? []).length === 2, "GET ?detail → policy + members 2", `HTTP ${det.status}`);
  const actPol = await db.activityLog.count({ where: { entity: "InsurancePolicy", createdAt: { gte: t0 } } });
  ok(actPol >= 1, "ActivityLog polis tercatat", `${actPol} baris`);
  const actMem = await db.activityLog.count({ where: { entity: "PolicyMember" } });
  ok(actMem >= 2, "ActivityLog enrollment tercatat", `${actMem} baris`);

  // ================= (4) TERMINASI HOOK (unit — pola hook PA) =================
  console.log("\n[(4)] HOOK TERMINASI — terminatePolicyMemberships (dipanggil PA process)");
  const r4 = await terminatePolicyMemberships(db, { employeeId: emp.id, effectiveDate: new Date(), actorName: "e2e-p25" });
  ok(r4 === 2, "kedua membership karyawan tertutup (return = jumlah baris)", `${r4}`);
  const openAfter4 = await db.policyMember.count({ where: { policyId, employeeId: emp.id, effectiveTo: null } });
  ok(openAfter4 === 0, "tidak ada membership terbuka lagi utk karyawan", `${openAfter4}`);
  // re-enroll mulai BESOK (guard service: effectiveTo >= effectiveFrom dianggap
  // masih aktif — terminasi hari ini menutup effectiveTo=hari ini).
  const e5 = await hr.api("POST", POL_API, { action: "enroll", policyId, employeeId: emp.id, effectiveFrom: iso(1) });
  ok(e5.status === 201, "re-enroll membership terbuka utk job test (efektif H+1)", `HTTP ${e5.status}`);

  // ================= (5) JOB EXPIRY — karyawan Resigned =================
  console.log("\n[(5)] JOB policy-member-expiry — sweep karyawan keluar");
  await db.employee.update({ where: { id: emp.id }, data: { status: "Resigned", endDate: new Date(Date.now() - 86_400_000) } });
  const r5 = await jobPolicyMemberExpiry(db);
  const openAfter5 = await db.policyMember.count({ where: { policyId, employeeId: emp.id, effectiveTo: null } });
  ok(openAfter5 === 0 && r5.membershipsClosed >= 1, "job menutup membership karyawan Resigned", `closed=${r5.membershipsClosed} sisa=${openAfter5}`);
  await db.employee.update({ where: { id: emp.id }, data: { status: "Active", endDate: null } });
  const empRestored = await db.employee.findUnique({ where: { id: emp.id }, select: { status: true, endDate: true } });
  ok(empRestored?.status === "Active" && empRestored?.endDate === null, "employee fixture direstore Active");

  // ================= (6) RENEWAL H-30 =================
  console.log("\n[(6)] JOB policy-renewal-reminder — H-30 + dedupe");
  await db.insurancePolicy.update({ where: { id: policyId }, data: { periodEnd: new Date(Date.now() + 20 * 86_400_000) } });
  const r6 = await jobPolicyRenewalReminders(db);
  ok(r6.reminded >= 1 && r6.emailed >= 1, "run 1: polis teringatkan + email terkirim", JSON.stringify(r6));
  const em1 = await (async () => {
    const t = Date.now();
    for (;;) {
      const n = await db.emailLog.count({ where: { event: "policy.renewal.reminder", createdAt: { gte: t0 } } });
      if (n >= 1) return n;
      if (Date.now() - t > 8_000) return n;
      await new Promise((r2) => setTimeout(r2, 500));
    }
  })();
  ok(em1 >= 1, "EmailLog policy.renewal.reminder tertulis (await path, poll)", `${em1} baris`);
  const remLog = await db.activityLog.count({ where: { action: "Reminder", entity: "Scheduler", entityId: `reminder:policy-renewal:${policyId}:30` } });
  ok(remLog === 1, "klaim dedupe H-30 polis UJI tertanam tepat 1", `${remLog}`);
  const r6b = await jobPolicyRenewalReminders(db);
  ok(r6b.reminded === 0, "run 2: DEDUPE (tidak dobel)", JSON.stringify(r6b));
  const remLog2 = await db.activityLog.count({ where: { action: "Reminder", entity: "Scheduler", entityId: `reminder:policy-renewal:${policyId}:30` } });
  ok(remLog2 === 1, "klaim dedupe tetap 1 setelah run ke-2", `${remLog2}`);

  // ================= (7) CLEANUP =================
  console.log("\n[(7)] CLEANUP — membership + polis + family uji (audit trail dipertahankan)");
  const keepEmail = await db.emailLog.count({ where: { event: "policy.renewal.reminder", createdAt: { gte: t0 } } });
  await db.policyMember.deleteMany({ where: { policyId } });
  await db.insurancePolicy.delete({ where: { id: policyId } });
  if (famId) await db.employeeFamily.delete({ where: { id: famId } }).catch(() => { /* sudah */ });
  const polLeft = await db.insurancePolicy.count({ where: { id: policyId } });
  const memLeft = await db.policyMember.count({ where: { policyId } });
  const famLeft = await db.employeeFamily.count({ where: { name: FAM_NAME } });
  ok(polLeft === 0 && memLeft === 0 && famLeft === 0, "polis + membership + family uji bersih", `pol=${polLeft} mem=${memLeft} fam=${famLeft}`);
  const keepEmail2 = await db.emailLog.count({ where: { event: "policy.renewal.reminder", createdAt: { gte: t0 } } });
  ok(keepEmail2 === keepEmail, "EmailLog DIPERTAHANKAN (pola B8)", `${keepEmail2} baris`);
  const actKeep = await db.activityLog.count({ where: { entity: { in: ["InsurancePolicy", "PolicyMember"] } } });
  ok(actKeep >= 4, "ActivityLog polis/membership DIPERTAHANKAN", `${actKeep} baris`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "ADA YANG GAGAL ✗"} — mulai ${t0.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
