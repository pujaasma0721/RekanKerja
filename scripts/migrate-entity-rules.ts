// Migrasi TASK 33 — ATURAN PARAMETER untuk Leave/Medical/Travel/Benefit
// (idempoten — pola sama dgn migrate-component-rules Task 32):
//   1. CREATE TABLE IF NOT EXISTS × 4: LeaveTypeRule, MedicalBenefitTypeRule,
//      TravelExpenseTypeRule, BenefitTypeRule (+ index + FK cascade).
//   2. Seed demo rule MII (insert-only per nama rule) — memperagakan beragam
//      parameter: masa kerja, status kepegawaian, religion, gender, office,
//      positionLevel, usia, status pernikahan.
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-entity-rules.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];
const SEED_SCHEMAS = new Set(["tenant_pt_mitra_industri_internasional"]);

const TABLES: { table: string; fk: string; fkCol: string; ref: string }[] = [
  { table: "LeaveTypeRule", fk: "LeaveTypeRule_leaveTypeId_fkey", fkCol: "leaveTypeId", ref: "LeaveType" },
  { table: "MedicalBenefitTypeRule", fk: "MedicalBenefitTypeRule_medicalBenefitTypeId_fkey", fkCol: "medicalBenefitTypeId", ref: "MedicalBenefitType" },
  { table: "TravelExpenseTypeRule", fk: "TravelExpenseTypeRule_travelExpenseTypeId_fkey", fkCol: "travelExpenseTypeId", ref: "TravelExpenseType" },
  { table: "BenefitTypeRule", fk: "BenefitTypeRule_benefitTypeId_fkey", fkCol: "benefitTypeId", ref: "BenefitType" },
];

const CREATE_DDL: Record<string, string> = {
  LeaveTypeRule: `CREATE TABLE IF NOT EXISTS "LeaveTypeRule" (
    "id" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetDays',
    "days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaveTypeRule_pkey" PRIMARY KEY ("id")
  )`,
  MedicalBenefitTypeRule: `CREATE TABLE IF NOT EXISTS "MedicalBenefitTypeRule" (
    "id" TEXT NOT NULL,
    "medicalBenefitTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetLimit',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MedicalBenefitTypeRule_pkey" PRIMARY KEY ("id")
  )`,
  TravelExpenseTypeRule: `CREATE TABLE IF NOT EXISTS "TravelExpenseTypeRule" (
    "id" TEXT NOT NULL,
    "travelExpenseTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetLimit',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TravelExpenseTypeRule_pkey" PRIMARY KEY ("id")
  )`,
  BenefitTypeRule: `CREATE TABLE IF NOT EXISTS "BenefitTypeRule" (
    "id" TEXT NOT NULL,
    "benefitTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetLimit',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BenefitTypeRule_pkey" PRIMARY KEY ("id")
  )`,
};

const VALUE_COL: Record<string, string> = {
  LeaveTypeRule: "days",
  MedicalBenefitTypeRule: "amount",
  TravelExpenseTypeRule: "amount",
  BenefitTypeRule: "amount",
};

/** [masterTable, masterCode, ruleName, priority, conditionsJSON, actionType, value, notes] */
const RULE_SEED: [string, string, string, number, string, string, number, string][] = [
  // ---- LEAVE (Cuti Tahunan 12 hari & religius) ----
  ["LeaveType", "CT-THN", "Cuti Tahunan — loyalitas masa kerja ≥ 10 tahun", 10,
    JSON.stringify([{ param: "tenureYears", op: "gte", values: ["10"] }]),
    "AddDays", 2, "Tambahan 2 hari utk karyawan dengan masa kerja sepuluh tahun+."],
  ["LeaveType", "CT-THN", "Cuti Tahunan — masa kerja < 1 tahun (prorata kebijakan)", 20,
    JSON.stringify([{ param: "tenureYears", op: "lt", values: ["1"] }]),
    "SetDays", 6, "Karyawan baru di tahun pertama menerima paket cuti terbatas sampai anniversary pertama."],
  ["LeaveType", "CT-HAJI", "Cuti Haji — hanya karyawan Muslim", 10,
    JSON.stringify([{ param: "religion", op: "not_in", values: ["Islam"] }]),
    "SetDays", 0, "Cuti ibadah haji hanya berlaku bagi karyawan beragama Islam."],
  ["LeaveType", "CT-LAHIR", "Cuti Kelahiran Anak — tambahan ibu melahirkan", 10,
    JSON.stringify([{ param: "gender", op: "in", values: ["F"] }]),
    "AddDays", 1, "Karyawan perempuan menerima 1 hari tambahan pemulihan (kebijakan internal di atas UU)."],
  // ---- MEDICAL (plafon) ----
  ["MedicalBenefitType", "RAWAT_INAP", "Rawat Inap — kelas VIP manajemen senior (SM ke atas)", 10,
    JSON.stringify([{ param: "positionLevel", op: "in", values: ["PL6", "PL7", "PL8"] }]),
    "Multiply", 1.5, "Plafon rawat inap manajemen senior = 1,5 × plafon dasar (kelas VIP)."],
  ["MedicalBenefitType", "RAWAT_JALAN", "Rawat Jalan — karyawan pabrik Pulogadung", 20,
    JSON.stringify([{ param: "office", op: "in", values: ["OFF-PLG"] }]),
    "AddLimit", 5000000, "Tambahan plafon rawat jalan karyawan pabrik (lingkungan kerja fisik)."],
  ["MedicalBenefitType", "KACAMATA", "Kacamata — hanya karyawan Permanent", 10,
    JSON.stringify([{ param: "employmentStatus", op: "in", values: ["Contract", "Probation", "Outsourcing"] }]),
    "SetLimit", 0, "Ganti kacamata hanya utk karyawan tetap."],
  ["MedicalBenefitType", "PERSALINAN", "Persalinan — hanya karyawan perempuan", 10,
    JSON.stringify([{ param: "gender", op: "in", values: ["M"] }]),
    "SetLimit", 0, "Plafon persalinan hanya utk karyawan perempuan (suami mengikuti manfaat keluarga terpisah)."],
  // ---- TRAVEL (limit jenis biaya) ----
  ["TravelExpenseType", "L-HOTEL", "Hotel — manajemen senior (SM ke atas)", 10,
    JSON.stringify([{ param: "positionLevel", op: "in", values: ["PL6", "PL7", "PL8"] }]),
    "SetLimit", 3500000, "Senior Manager ke atas: kelas hotel lebih tinggi."],
  ["TravelExpenseType", "L-HOTEL", "Hotel — kantor cabang Surabaya", 20,
    JSON.stringify([{ param: "office", op: "in", values: ["OFF-SBY"] }]),
    "AddLimit", 300000, "Penyesuaian tarif hotel kota Surabaya."],
  ["TravelExpenseType", "E-RESTAURANT", "Entertainment restoran — Supervisor ke atas", 10,
    JSON.stringify([{ param: "positionLevel", op: "in", values: ["PL3", "PL4", "PL5", "PL6", "PL7", "PL8"] }]),
    "SetLimit", 2500000, "Hiburan relasi bisnis hanya utk level Supervisor+."],
  ["TravelExpenseType", "L-POCKET", "Uang saku — loyalitas masa kerja ≥ 5 tahun", 10,
    JSON.stringify([{ param: "tenureYears", op: "gte", values: ["5"] }]),
    "AddLimit", 100000, "Tambahan uang saku harian perjalanan dinas bagi karyawan 5 tahun+."],
  // ---- BENEFIT P5 (limit klaim) ----
  ["BenefitType", "MEDICAL", "Reimburse Medis — Supervisor ke atas", 10,
    JSON.stringify([{ param: "positionLevel", op: "in", values: ["PL3", "PL4", "PL5", "PL6", "PL7", "PL8"] }]),
    "SetLimit", 3500000, "Limit reimburse medis lebih besar utk level supervisi ke atas."],
  ["BenefitType", "GLASSES", "Ganti Kacamata — masa kerja ≥ 3 tahun", 10,
    JSON.stringify([{ param: "tenureYears", op: "gte", values: ["3"] }]),
    "SetLimit", 2500000, "Karyawan 3 tahun+ berhak lensa/frame lebih baik."],
  ["BenefitType", "SPORT", "Fasilitas Olahraga — usia < 40 tahun", 10,
    JSON.stringify([{ param: "ageYears", op: "lt", values: ["40"] }]),
    "AddLimit", 250000, "Program wellness tambahan usia produktif."],
  ["BenefitType", "WEDDING", "Bantuan Pernikahan — hanya yang belum menikah", 10,
    JSON.stringify([{ param: "maritalStatus", op: "not_in", values: ["Belum Menikah"] }]),
    "SetLimit", 0, "Bantuan pernikahan hanya utk karyawan berstatus Belum Menikah."],
];

const TABLE_BY_MASTER: Record<string, string> = {
  LeaveType: "LeaveTypeRule",
  MedicalBenefitType: "MedicalBenefitTypeRule",
  TravelExpenseType: "TravelExpenseTypeRule",
  BenefitType: "BenefitTypeRule",
};

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  for (const schema of list) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      console.log(`\n[${schema}] migrasi task-33 (4 tabel rule leave/medical/travel/benefit)…`);

      // ---- 1. DDL idempoten ----
      for (const t of TABLES) {
        await c.query(CREATE_DDL[t.table]);
        await c.query(`CREATE INDEX IF NOT EXISTS "${t.table}_${t.fkCol}_idx" ON "${t.table}"("${t.fkCol}")`);
        const fk = await c.query(
          `SELECT 1 FROM pg_constraint WHERE conname = $1 AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)`,
          [t.fk, schema],
        );
        if ((fk.rowCount ?? 0) === 0) {
          await c.query(
            `ALTER TABLE "${t.table}" ADD CONSTRAINT "${t.fk}" FOREIGN KEY ("${t.fkCol}") REFERENCES "${t.ref}"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
          );
        }
      }

      // ---- 2. seed demo (insert-only; hanya MII) ----
      let inserted = 0;
      if (SEED_SCHEMAS.has(schema)) {
        for (const [masterTable, masterCode, name, priority, conditions, actionType, value, notes] of RULE_SEED) {
          const ruleTable = TABLE_BY_MASTER[masterTable];
          const valueCol = VALUE_COL[ruleTable];
          const fkCol = TABLES.find((t) => t.table === ruleTable)!.fkCol;
          const master = await c.query(`SELECT id FROM "${masterTable}" WHERE code = $1`, [masterCode]);
          if ((master.rowCount ?? 0) === 0) { console.log(`[${schema}] skip ${masterCode}: master tidak ada`); continue; }
          const exists = await c.query(
            `SELECT 1 FROM "${ruleTable}" WHERE "${fkCol}" = $1 AND name = $2`,
            [master.rows[0].id, name],
          );
          if ((exists.rowCount ?? 0) > 0) continue;
          await c.query(
            `INSERT INTO "${ruleTable}" ("id", "${fkCol}", "name", "priority", "conditions", "actionType", "${valueCol}", "notes", "active", "createdAt")
             VALUES (concat('etr_', replace(gen_random_uuid()::text, '-', '')), $1, $2, $3, $4, $5, $6, $7, true, CURRENT_TIMESTAMP)`,
            [master.rows[0].id, name, priority, conditions, actionType, value, notes.trim()],
          );
          inserted++;
        }
      }
      console.log(`[${schema}] seed rule: ${inserted} baru dimasukkan (sisanya sudah ada)`);
    } finally {
      await c.end();
    }
  }
  console.log("\n[migrate-entity-rules] selesai — semua tenant paritas task-33.");
}

// CLI: bun run scripts/migrate-entity-rules.ts
if (process.argv[1] && process.argv[1].endsWith("migrate-entity-rules.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
