// SIMULASI UPGRADE REMOTE (throwaway — hapus setelah verifikasi).
// DB onevity_sim = replika kondisi remote (restore-demo@7987fe8: kolom uang
// Float, NIK plaintext, tanpa tabel wave-26/27/28). Jalankan pipeline parity
// IN-PROCESS dari kode TERKINI, lalu verifikasi hasil + bandingkan dengan DB
// lokal asli (target: "seperti lokal").
process.env.PLATFORM_DB_URL = "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity_sim";
process.env.TENANT_DB_BASE_URL = "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity_sim";

const { Client } = await import("pg");
const { runParityPipeline, checkParityGap } = await import("../src/onevity/shared/lib/parity-runner");
const { tenantCrypto } = await import("../src/onevity/shared/lib/field-crypto");

const SIM = "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity_sim";
const REAL = "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";
const MII = "tenant_pt_mitra_industri_internasional";

const t0 = Date.now();
const report = await runParityPipeline();
console.log("\n===== LAPORAN PARITY (SIM) =====");
for (const s of report.steps) {
  console.log(`${s.ok ? "OK " : "ERR"} ${s.label} ${(s.ms / 1000).toFixed(1)}s${s.error ? " — " + s.error : ""}`);
}
console.log(`pipeline ok=${report.ok} dalam ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const gap = await checkParityGap();
console.log("gap setelah pipeline:", JSON.stringify(gap));

// ============ VERIFIKASI HASIL ============
const q = async (url: string, sql: string, params: unknown[] = []) => {
  const c = new Client({ connectionString: url });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};
const one = async (url: string, sql: string, params: unknown[] = []) => (await q(url, sql, params))[0] ?? {};

console.log("\n===== VERIFIKASI STRUKTUR & DATA (sim vs lokal asli) =====");
const checks: [string, string, unknown[]][] = [
  ["Announcement", `SELECT COUNT(*)::int n FROM "${MII}"."Announcement"`, []],
  ["AnnouncementRead", `SELECT COUNT(*)::int n FROM "${MII}"."AnnouncementRead"`, []],
  ["Asset", `SELECT COUNT(*)::int n FROM "${MII}"."Asset"`, []],
  ["AssetAssignment", `SELECT COUNT(*)::int n FROM "${MII}"."AssetAssignment"`, []],
  ["ShiftSwapRequest", `SELECT COUNT(*)::int n FROM "${MII}"."ShiftSwapRequest"`, []],
  ["WaTemplate", `SELECT COUNT(*)::int n FROM "${MII}"."WaTemplate"`, []],
  ["LetterTemplate", `SELECT COUNT(*)::int n FROM "${MII}"."LetterTemplate"`, []],
  ["MinimumWage", `SELECT COUNT(*)::int n FROM "${MII}"."MinimumWage"`, []],
  ["HolidayDate", `SELECT COUNT(*)::int n FROM "${MII}"."HolidayDate"`, []],
  ["Notification", `SELECT COUNT(*)::int n FROM "${MII}"."Notification"`, []],
  ["EmployeeDocument-table", `SELECT COUNT(*)::int n FROM "${MII}"."EmployeeDocument"`, []],
  ["ApiKey-table", `SELECT COUNT(*)::int n FROM "${MII}"."ApiKey"`, []],
  ["PKWT terisi", `SELECT COUNT(*)::int n FROM "${MII}"."Employee" WHERE "contractStart" IS NOT NULL`, []],
  ["Struktur AS-WORKOFF", `SELECT COUNT(*)::int n FROM "${MII}"."ApprovalStructure" WHERE code='AS-WORKOFF-STD'`, []],
  ["Struktur AS-OT", `SELECT COUNT(*)::int n FROM "${MII}"."ApprovalStructure" WHERE code='AS-OT-STD'`, []],
  ["Struktur AS-TRVLCLAIM", `SELECT COUNT(*)::int n FROM "${MII}"."ApprovalStructure" WHERE code='AS-TRVLCLAIM-STD'`, []],
  ["EmailTemplate scheduler", `SELECT COUNT(*)::int n FROM "${MII}"."EmailTemplate" WHERE event LIKE 'scheduler.%'`, []],
  ["WorkLocation koordinat", `SELECT COUNT(*)::int n FROM "${MII}"."WorkLocation" WHERE "latitude" IS NOT NULL`, []],
];
for (const [label, sql, params] of checks) {
  const sim = await one(SIM, sql, params);
  const real = await one(REAL, sql, params);
  const match = sim.n === real.n ? "" : (real.n === undefined ? "" : `  ← LOKAL=${real.n}`);
  console.log(`${label}: sim=${sim.n}${match}`);
}

// bruto TEXT + terenkripsi
const bruto = await one(SIM, `SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='PayrollRunLine' AND column_name='bruto'`, [MII]);
console.log("bruto data_type (harus text):", bruto.data_type);
const enc = await q(SIM, `SELECT bruto FROM "${MII}"."PayrollRunLine" WHERE bruto IS NOT NULL LIMIT 2`);
console.log("bruto mentah (harus enc:v1:...):", enc.map((r) => String(r.bruto).slice(0, 24)));

// roundtrip dekripsi gaji identik dgn lokal asli
const tc = tenantCrypto(MII);
const simLine = await one(SIM, `SELECT id, bruto, net FROM "${MII}"."PayrollRunLine" ORDER BY "employeeId" LIMIT 1`);
if (simLine.bruto) {
  console.log("dekripsi bruto sim:", tc.decryptMoney(simLine.bruto), "| net:", tc.decryptMoney(simLine.net));
}
const realLine = await q(REAL, `SELECT bruto, net FROM "${MII}"."PayrollRunLine" ORDER BY "employeeId" LIMIT 1`);
if (realLine[0]?.bruto) {
  console.log("dekripsi bruto lokal:", tc.decryptMoney(realLine[0].bruto), "| net:", tc.decryptMoney(realLine[0].net));
}

// NIK terenkripsi + roundtrip
const nikEnc = await one(SIM, `SELECT "nationalId" FROM "${MII}"."Employee" WHERE "employeeNo"='MII00001'`);
console.log("NIK MII00001 (harus enc:v1:t:...):", String(nikEnc.nationalId).slice(0, 22), "→ dekripsi:", tc.decryptText(nikEnc.nationalId));

// run totals terenkripsi + dekripsi (paritas angka dgn lokal)
const simRun = await one(SIM, `SELECT "totalNet","totalBruto" FROM "${MII}"."PayrollRun" ORDER BY "startDate" DESC LIMIT 1`);
const realRun = await one(REAL, `SELECT "totalNet","totalBruto" FROM "${MII}"."PayrollRun" ORDER BY "startDate" DESC LIMIT 1`);
console.log("totalNet sim (dekripsi):", tc.decryptMoney(simRun.totalNet), "| lokal:", tc.decryptMoney(realRun.totalNet));
console.log("totalBruto sim (dekripsi):", tc.decryptMoney(simRun.totalBruto), "| lokal:", tc.decryptMoney(realRun.totalBruto));

// travel settlement terhitung ulang (b/c/totalSettlement) — bandingkan dgn lokal
const simClaim = await q(SIM, `SELECT "docNo", "payableEmployee", "payableCompany", "totalSettlement" FROM "${MII}"."TravelClaim" ORDER BY "docNo"`);
const realClaim = await q(REAL, `SELECT "docNo", "payableEmployee", "payableCompany", "totalSettlement" FROM "${MII}"."TravelClaim" ORDER BY "docNo"`);
let claimMatch = 0;
for (let i = 0; i < Math.min(simClaim.length, realClaim.length); i++) {
  if (simClaim[i].docNo === realClaim[i].docNo && Math.abs(simClaim[i].totalSettlement - realClaim[i].totalSettlement) < 0.01) claimMatch++;
}
console.log(`TravelClaim: ${simClaim.length} klaim sim vs ${realClaim.length} lokal — ${claimMatch} docNo+totalSettlement identik`);

// plaintext tersisa di kolom target enkripsi?
const leftovers = await one(SIM, `
  SELECT
    (SELECT COUNT(*)::int FROM "${MII}"."PayrollRun" WHERE "totalNet" IS NOT NULL AND "totalNet" NOT LIKE 'enc:v1%') +
    (SELECT COUNT(*)::int FROM "${MII}"."Employee" WHERE "nationalId" IS NOT NULL AND "nationalId" NOT LIKE 'enc:v1%') +
    (SELECT COUNT(*)::int FROM "${MII}"."EmployeePayrollProfile" WHERE npwp IS NOT NULL AND npwp NOT LIKE 'enc:v1%') AS n`);
console.log("plaintext tersisa di kolom terenkripsi (harus 0):", leftovers.n);
console.log("\nSELESAI — simulasi upgrade remote sukses bila semua baris di atas sesuai.");
