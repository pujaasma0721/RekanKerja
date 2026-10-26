// SUITE 06 — TENANT BENCHMARK 5.000 KARYAWAN di PG LIVE (:5432) ================
// Landasan uji page-load "query besar-besar" (lanjutan QA-SCALING-100T/FIX).
//
// Mengapa TIDAK pakai bench PG 5433: data bench memakai ciphertext PALSU
// (enc:v1:n:<plain>:<hex>) — decryptJson app akan THROW (GCM tag mismatch)
// pada halaman payroll/employee-detail. Skrip ini menanam dataset SETARA
// (5.000 karyawan, presensi 30 hari, payroll 3 periode × 8 item/line ≈ 597k
// baris) TETAPI dengan enkripsi field ASLI via tenantCrypto — halaman app
// nyata bisa dibuka & diukur latensinya.
//
// Juga mendaftarkan tenant di platform registry (public."Tenant"/"User"/
// "UserTenant") TANPA provisioning (schema sudah ditanam manual di sini).
//
// Idempoten: schema lengkap / Employee >= target / baris platform ada → fase
// terkait di-skip. Jalankan: bun scripts/qa/06-bigtenant-seed.ts
import { Client } from "pg";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { readEnvVar } from "./helpers";
import { tenantCrypto } from "@/rekankerja/shared/lib/field-crypto";

export {};

const SCHEMA = "tenant_bench_101";
const TARGET_EMP = Number(process.env.BIGTENANT_EMP ?? 5000);
const ATT_DAYS = 30;
const PERIODS = 3;
const ITEMS_PER_LINE = 8;
const DDL_PATH = path.resolve(process.cwd(), "prisma/tenant-ddl.sql");
const BASE_URL =
  readEnvVar("TENANT_DB_BASE_URL") ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja";

// Identitas platform tenant benchmark (login: user42 = AppUser e42 di ESS)
const PLATFORM = {
  tenantName: "Benchmark Indonesia (5.000 Karyawan)",
  slug: "bench101",
  companyCode: "BCH101",
  plan: "enterprise",
  adminEmail: "user42@bench101.test", // cocok AppUser#user42 (employeeId e42) → ESS ikut teruji
  adminName: "User Benchmark 42",
  adminPassword: "Bench101!",
};

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

// RNG deterministik + nama (identik bench-100t → angka sebanding)
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FIRST = ["Budi", "Siti", "Agus", "Rina", "Dewi", "Joko", "Sri", "Andi", "Putri", "Rizky", "Ani", "Bambang", "Fitri", "Hendra", "Wulan", "Taufik", "Nur", "Dwi", "Eko", "Yuni", "Ayu", "Fajar", "Indah", "Krisna", "Lestari", "Mega", "Nanda", "Oki", "Pras", "Ratna"];
const LAST = ["Santoso", "Wijaya", "Kusuma", "Pratama", "Saputra", "Hidayat", "Nugroho", "Ramadhani", "Sutanto", "Halim", "Permata", "Gunawan", "Siregar", "Lubis", "Anggraini", "Firmansyah", "Maulana", "Puspita", "Safitri", "Wibowo"];

function insertMany(c: Client, table: string, cols: string[], rows: unknown[][], chunk = 400): Promise<unknown> {
  let done = Promise.resolve();
  for (let off = 0; off < rows.length; off += chunk) {
    const part = rows.slice(off, off + chunk);
    const values: unknown[] = [];
    const tuples = part.map((r) => {
      const ph = r.map((v) => {
        values.push(v);
        return `$${values.length}`;
      });
      return `(${ph.join(",")})`;
    });
    const sql = `INSERT INTO "${table}"(${cols.map((x) => `"${x}"`).join(",")}) VALUES ${tuples.join(",")}`;
    done = done.then(() => c.query(sql, values));
  }
  return done;
}

async function main() {
  if (!existsSync(DDL_PATH)) throw new Error(`DDL tidak ditemukan: ${DDL_PATH}`);
  const ddl = readFileSync(DDL_PATH, "utf8");
  // Jumlah tabel HARUS dihitung dari NAMA TABEL deklarasi (bukan frekuensi string
  // "CREATE TABLE " — 6 kemunculan ada di baris komentar ALTER, dan pola IF NOT
  // EXISTS membuat hitungan polos meleset) → 222 = tabel aktual schema tenant.
  const expectTables = new Set(
    (ddl.match(/CREATE TABLE (IF NOT EXISTS )?"[A-Za-z0-9_]+"/g) ?? []).map((m) =>
      m.match(/"([A-Za-z0-9_]+)"/)![1],
    ),
  ).size;

  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  const tc = tenantCrypto(SCHEMA); // kunci v1 legacy — TANPA MoneyVault → konsisten dgn app

  // ---- 1. pastikan schema + DDL ----
  const cnt = await c.query(`SELECT COUNT(*)::int c FROM information_schema.tables WHERE table_schema=$1`, [SCHEMA]);
  if (cnt.rows[0].c < expectTables) {
    if (cnt.rows[0].c > 0) await c.query(`DROP SCHEMA "${SCHEMA}" CASCADE`);
    log(`[ddl] membuat schema ${SCHEMA} (${expectTables} tabel) …`);
    await c.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await c.query(`SET search_path TO "${SCHEMA}"`);
    await c.query(`SET search_path TO "${SCHEMA}";\n${ddl}`);
  } else {
    await c.query(`SET search_path TO "${SCHEMA}"`);
    log(`[ddl] schema ${SCHEMA} sudah lengkap`);
  }

  // ---- 2. seed data ----
  const empCount = await c
    .query(`SELECT COUNT(*)::int c FROM "${SCHEMA}"."Employee"`)
    .then((r) => r.rows[0].c)
    .catch(() => -1);
  if (empCount >= TARGET_EMP) {
    log(`[seed] sudah ${empCount} karyawan → skip`);
  } else {
    const t0 = performance.now();
    const now = new Date();
    const rnd = mulberry32(1000 + 101);
    const code = "BCH101";
    const rows: number[] = [];

    // master penempatan
    await insertMany(c, "Company", ["id", "code", "name"], [["c1", code, "PT Benchmark Indonesia"]]); rows.push(1);
    await insertMany(c, "CompanyOffice", ["id", "code", "name", "companyId", "city"], [
      ["of1", "HO", "Kantor Pusat", "c1", "Jakarta"],
      ["of2", "BR", "Cabang", "c1", "Surabaya"],
    ]); rows.push(2);
    await insertMany(c, "WorkLocation", ["id", "code", "name", "companyId"], [["wl1", "WL1", "Lokasi A", "c1"], ["wl2", "WL2", "Lokasi B", "c1"]]); rows.push(2);
    await insertMany(c, "OrgUnit", ["id", "code", "name", "companyId"],
      ["ROOT", "OPS", "FIN", "HRD", "SLS"].map((x, k) => [`ou${k + 1}`, `${x}-101`, `Unit ${x}`, "c1"])); rows.push(5);
    await insertMany(c, "Job", ["id", "code", "title"], ["Staff", "Supervisor", "Manager", "Senior Manager", "General Manager"].map((x, k) => [`jb${k + 1}`, `J${k + 1}`, x])); rows.push(5);
    await insertMany(c, "Grade", ["id", "code", "name"], [1, 2, 3].map((k) => [`gr${k}`, `G${k}`, `Grade ${k}`])); rows.push(3);
    await insertMany(c, "PositionLevel", ["id", "code", "name"], [1, 2, 3].map((k) => [`pl${k}`, `PL${k}`, `Level ${k}`])); rows.push(3);
    await insertMany(c, "Position", ["id", "code", "title"],
      Array.from({ length: 10 }, (_, k) => [`ps${k + 1}`, `PS${k + 1}`, `Posisi ${k + 1}`])); rows.push(10);
    await insertMany(c, "ProcessType", ["id", "code", "name"], [["ptSAL", "SAL", "Gaji Bulanan"], ["ptTHR", "THR", "Tunjangan Hari Raya"]]); rows.push(2);
    // PayrollRegulation kanonik — TANPA baris ini parity gap permanen terdeteksi
    // ("tenant dengan jkpEmployeeRate ≠ 0") dan parity runner menjalankan seluruh
    // migrasi di SETIAP boot. Nilai = state kanonik migrate-jkp (0% pekerja).
    await insertMany(c, "PayrollRegulation",
      ["id", "code", "name", "validFrom", "biayaJabatanRate", "biayaJabatanCapMonthly", "jhtEmployeeRate", "jhtCompanyRate", "jpEmployeeRate", "jpCompanyRate", "jpSalaryCap", "jkkRate", "jkmRate", "jpkCompanyRate", "jpkEmployeeRate", "jpkSalaryCap", "jkpEmployeeRate", "jkpCompanyRate", "jkpSalaryCap", "nonNpwpSurcharge", "useTer", "active"],
      [["bench101-reg", "REG-2026-HPP", "Regulasi UU HPP & BPJS 2026", new Date("2026-01-01"), 0.05, 500000, 0.02, 0.037, 0.01, 0.02, 10547400, 0.0024, 0.003, 0.04, 0.01, 12000000, 0, 0.0014, 5000000, 0.2, false, true]]); rows.push(1);

    // karyawan + assignment + app user — ENKRIPSI ASLI (v1 legacy, konsisten app)
    const emp: unknown[][] = [];
    const asg: unknown[][] = [];
    const usr: unknown[][] = [];
    for (let n = 1; n <= TARGET_EMP; n++) {
      const eid = `e${n}`;
      const name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
      const join = new Date(2015 + Math.floor(rnd() * 10), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27));
      emp.push([
        eid,
        `${code}-${String(n).padStart(4, "0")}`,
        name,
        rnd() < 0.52 ? "M" : "F",
        `user${n}@bench101.test`,
        "08" + Math.floor(rnd() * 1e10).toString().padStart(10, "0"),
        tc.encryptText(String(Math.floor(rnd() * 1e16)).padStart(16, "0")), // NIK 16 digit — enc asli
        tc.encryptText(String(Math.floor(rnd() * 1e10)).padStart(10, "0")), // rekening — enc asli
        "c1",
        join,
        "Active",
        `ou${1 + Math.floor(rnd() * 5)}`,
        `ps${1 + Math.floor(rnd() * 10)}`,
        `gr${1 + Math.floor(rnd() * 3)}`,
        `pl${1 + Math.floor(rnd() * 3)}`,
        rnd() < 0.8 ? "of1" : "of2",
        rnd() < 0.8 ? "wl1" : "wl2",
        now,
      ]);
      asg.push([
        eid + "a1",
        eid,
        `ou${1 + Math.floor(rnd() * 5)}`,
        `ps${1 + Math.floor(rnd() * 10)}`,
        `gr${1 + Math.floor(rnd() * 3)}`,
        "Permanent",
        "Regular",
        tc.encryptMoney(5_000_000 + Math.floor(rnd() * 25_000_000)), // baseSalary enc asli
        join,
        null,
        "Initial",
        now,
      ]);
      usr.push([`u${n}`, `user${n}`, name, `user${n}@bench101.test`, "HR Staff", eid, true]);
    }
    await insertMany(c, "Employee", ["id", "employeeNo", "fullName", "gender", "email", "phone", "nationalId", "bankAccount", "companyId", "joinDate", "status", "orgUnitId", "positionId", "gradeId", "positionLevelId", "companyOfficeId", "workLocationId", "updatedAt"], emp);
    await insertMany(c, "EmployeeAssignment", ["id", "employeeId", "orgUnitId", "positionId", "gradeId", "employmentStatus", "workShift", "baseSalary", "validFrom", "validTo", "changeReason", "updatedAt"], asg);
    await insertMany(c, "AppUser", ["id", "username", "fullName", "email", "role", "employeeId", "active"], usr);
    rows.push(emp.length, asg.length, usr.length);
    log(`[seed] master + ${TARGET_EMP} karyawan/assignment/appuser selesai`);

    // notifikasi ESS (3/user)
    const notif: unknown[][] = [];
    for (let n = 1; n <= TARGET_EMP; n++)
      for (let k = 0; k < 3; k++)
        notif.push([`n${n}_${k}`, `u${n}`, "Pengumuman", `Isi notifikasi ${k + 1} untuk benchmark`, "payroll", "/ess", new Date(now.getTime() - Math.floor(rnd() * 30) * 86400_000)]);
    await insertMany(c, "Notification", ["id", "appUserId", "title", "body", "kind", "link", "createdAt"], notif);
    rows.push(notif.length);
    log(`[seed] ${notif.length} notifikasi selesai`);

    // payroll: 3 periode × (run × 5000 line × 8 item) — jumlah uang enc asli
    const prd: unknown[][] = [];
    const runs: unknown[][] = [];
    const lines: unknown[][] = [];
    const items: unknown[][] = [];
    for (let p = 0; p < PERIODS; p++) {
      const start = new Date(now.getFullYear(), now.getMonth() - (PERIODS - 1 - p), 1);
      const end = new Date(now.getFullYear(), start.getMonth() + 1, 0);
      const pid = `pd${p}`;
      prd.push([pid, `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`, `Periode ${start.toLocaleString("id", { month: "long" })} ${start.getFullYear()}`, start, end, start.getMonth() + 1, start.getFullYear()]);
      const rid = `run${p}`;
      const totBruto = 5_500_000_000 + Math.floor(rnd() * 3_000_000_000);
      runs.push([
        rid,
        `PR-${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-SAL-01`,
        pid,
        "ptSAL",
        1,
        "Confirmed",
        TARGET_EMP,
        tc.encryptMoney(totBruto),
        tc.encryptMoney(Math.floor(totBruto * 0.1)),
        tc.encryptMoney(Math.floor(totBruto * 0.02)),
        tc.encryptMoney(Math.floor(totBruto * 0.88)),
        now,
        now,
      ]);
      for (let n = 1; n <= TARGET_EMP; n++) {
        const lid = `l${p}_${n}`;
        const empRow = emp[n - 1];
        const bruto = 6_000_000 + Math.floor(rnd() * 24_000_000);
        const ded = Math.floor(bruto * 0.09);
        const tax = Math.floor(bruto * 0.05);
        lines.push([
          lid,
          rid,
          `e${n}`,
          empRow[1] as string,
          empRow[2] as string,
          "Unit " + ["ROOT", "OPS", "FIN", "HRD", "SLS"][n % 5],
          "TK/0",
          54_000_000,
          tc.encryptMoney(bruto),
          tc.encryptMoney(ded),
          tc.encryptMoney(tax),
          tc.encryptMoney(Math.floor(bruto * 0.01)),
          tc.encryptMoney(bruto - ded - tax),
          false,
        ]);
        for (let k = 0; k < ITEMS_PER_LINE; k++) {
          const comps = [["GP", "Gaji Pokok", "Earning"], ["TJ", "Tunjangan Jabatan", "Earning"], ["TM", "Tunjangan Makan", "Earning"], ["TR", "Tunjangan Transport", "Earning"], ["BPJS-JK", "BPJS Jaminan Kekerjaan", "Deduction"], ["BPJS-KS", "BPJS Kesehatan", "Deduction"], ["PPh21", "PPh 21", "Deduction"], ["INFO", "Informasi Karyawan", "Informational"]];
          items.push([`${lid}_i${k}`, lid, comps[k][0], comps[k][1], comps[k][2], comps[k][2], "Gross", tc.encryptMoney(Math.floor(bruto * (0.05 + rnd() * 0.3)))]);
        }
      }
    }
    await insertMany(c, "PayrollPeriod", ["id", "code", "name", "startDate", "endDate", "sptMonth", "sptYear"], prd);
    await insertMany(c, "PayrollRun", ["id", "runNo", "periodId", "processTypeId", "sequence", "status", "employeeCount", "totalBruto", "totalDeduction", "totalTax", "totalNet", "calculatedAt", "confirmedAt"], runs);
    await insertMany(c, "PayrollRunLine", ["id", "runId", "employeeId", "employeeNo", "employeeName", "orgUnitName", "ptkpStatus", "ptkpValue", "bruto", "deduction", "taxRegular", "taxIrregular", "net", "umkWarning"], lines);
    await insertMany(c, "PayrollRunItem", ["id", "lineId", "code", "name", "wageType", "type", "incomeTaxMethod", "amount"], items);
    rows.push(prd.length, runs.length, lines.length, items.length);
    log(`[seed] payroll ${runs.length} run / ${lines.length} line / ${items.length} item selesai`);

    // presensi 30 hari + clock log
    const daily: unknown[][] = [];
    const clocks: unknown[][] = [];
    for (let n = 1; n <= TARGET_EMP; n++) {
      const eid = `e${n}`;
      for (let d = 0; d < ATT_DAYS; d++) {
        const date = new Date(now.getTime() - d * 86400_000);
        date.setHours(0, 0, 0, 0);
        const r = rnd();
        const status = r < 0.9 ? "Present" : r < 0.94 ? "Late" : r < 0.96 ? "Absent" : "OnLeave";
        const present = status === "Present" || status === "Late";
        const late = status === "Late" ? 15 + Math.floor(rnd() * 45) : 0;
        const checkIn = present ? new Date(date.getTime() + (8 * 60 + late) * 60_000) : null;
        const checkOut = present ? new Date(date.getTime() + 17 * 60 * 60_000 + Math.floor(rnd() * 120) * 60_000) : null;
        daily.push([`d${n}_${d}`, eid, date, null, "Calculated", status, present ? 1 : 0, checkIn, checkOut, late, 0, present ? 480 - Math.floor(late / 60) : 0, present ? 480 : 0, status === "OnLeave", false, null, null, now]);
        if (present) {
          clocks.push([`cl${n}_${d}_i`, eid, checkIn, "IN", "Mobile", -6.2 + rnd() * 0.1, 106.8 + rnd() * 0.1, `dev-101-${n}`]);
          clocks.push([`cl${n}_${d}_o`, eid, checkOut, "OUT", "Mobile", -6.2 + rnd() * 0.1, 106.8 + rnd() * 0.1, `dev-101-${n}`]);
        }
      }
    }
    await insertMany(c, "AttendanceDaily", ["id", "employeeId", "workDate", "dayTypeId", "state", "status", "presence", "checkIn", "checkOut", "lateMinutes", "earlyMinutes", "workMinutes", "normalMinutes", "paidFlag", "revised", "revisedBy", "notes", "updatedAt"], daily);
    await insertMany(c, "AttendanceClockLog", ["id", "employeeId", "timestamp", "direction", "source", "latitude", "longitude", "deviceId"], clocks);
    rows.push(daily.length, clocks.length);
    log(`[seed] presensi ${daily.length} daily + ${clocks.length} clock selesai`);

    const totalRows = rows.reduce((a, b) => a + b, 0);
    log(`[seed] TOTAL ${totalRows.toLocaleString("id")} baris dalam ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  }

  // ---- 3. ANALYZE ----
  log("[analyze] …");
  await c.query("ANALYZE");

  // ---- 4. registrasi platform (idempoten; search_path sesi masih = schema tenant → kualifikasi public.) ----
  const tid = `c${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
  const uid = `c${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
  const utid = `c${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
  await c.query(
    `INSERT INTO "public"."Tenant"("id","name","companyCode","slug","schemaName","plan","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',now(),now())
     ON CONFLICT ("slug") DO UPDATE SET "status"='ACTIVE', "updatedAt"=now()`,
    [tid, PLATFORM.tenantName, PLATFORM.companyCode, PLATFORM.slug, SCHEMA, PLATFORM.plan],
  );
  await c.query(
    `INSERT INTO "public"."User"("id","email","name","passwordHash","isSuperadmin","failedAttempts","sessionVersion","totpEnabled","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,false,0,0,false,now(),now())
     ON CONFLICT ("email") DO UPDATE SET "passwordHash"=EXCLUDED."passwordHash", "updatedAt"=now()`,
    [uid, PLATFORM.adminEmail, PLATFORM.adminName, hashPassword(PLATFORM.adminPassword)],
  );
  await c.query(
    `INSERT INTO "public"."UserTenant"("id","userId","tenantId","role","createdAt")
     SELECT $1, u."id", t."id", 'OWNER', now()
     FROM "public"."User" u, "public"."Tenant" t
     WHERE u."email"=$2 AND t."schemaName"=$3
     ON CONFLICT ("userId","tenantId") DO UPDATE SET "role"='OWNER'`,
    [utid, PLATFORM.adminEmail, SCHEMA],
  );

  // ringkasan
  const size = await c.query(
    `SELECT pg_size_pretty(SUM(pg_total_relation_size(c.oid))) s FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1`,
    [SCHEMA],
  );
  const rel = await c.query(
    `SELECT COUNT(*)::int c FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1`,
    [SCHEMA],
  );
  const finalEmp = await c.query(`SELECT COUNT(*)::int c FROM "${SCHEMA}"."Employee"`);
  await c.end();

  console.log("\n=== TENANT BENCHMARK SIAP ===");
  console.log(`schema        : ${SCHEMA} (${rel.rows[0].c} relasi, size ${size.rows[0].s})`);
  console.log(`karyawan      : ${finalEmp.rows[0].c}`);
  console.log(`login         : ${PLATFORM.adminEmail} / ${PLATFORM.adminPassword} (slug ${PLATFORM.slug}, role OWNER)`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
