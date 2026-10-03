// Migrasi Task 100 F1 (impl-C) — kolom & tabel advance modul Attendance:
//   1. AttendanceClockLog += selfieUrl TEXT / deviceId TEXT / faceVerified
//      BOOLEAN / anomalyNotes TEXT — bukti selfie + verifikasi identitas
//      saat clock ESS (G13/G22/G30) + flag anomali utk deteksi G27.
//   2. AttendanceRule += selfieMode/faceVerifyMode (off|warn|required|strict),
//      geofenceMultiSite (G18), otCapMode/otCapDayHours/otCapWeekHours (G14 —
//      PP35 | KEPMEN102 | CUSTOM), fatigueMaxConsecutiveNights /
//      fatigueMinRestHours (G23), deviceApiKey (G16), burnoutOtHoursMonthly (G29).
//   3. Employee += selfieRefUrl TEXT — foto referensi wajah pertama (G30).
//   4. Tabel BARU OpenShiftPost + OpenShiftClaim (G26 — open shift marketplace)
//      + index (workDate, status) + unique (postId, employeeId).
// Idempoten — ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS, tanpa drop.
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping)
// ATAU CLI: bun run scripts/migrate-attendance-advance.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const DEMO_SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? DEMO_SCHEMAS;
  let migrated = 0;
  let skipped = 0;
  for (const schema of list) {
    const c = new Client({
      connectionString:
        process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      // Tabel inti hilang (instalasi pra-attendance) → skip, bukan error.
      const hasRule = await c.query(`SELECT to_regclass('"AttendanceRule"') IS NOT NULL AS ok`);
      if (!hasRule.rows[0]?.ok) {
        skipped += 1;
        console.log(`[${schema}] tanpa tabel AttendanceRule — skip`);
        continue;
      }

      // 1) AttendanceClockLog — bukti selfie + flag anomali (G13/G22/G30/G27).
      await c.query(`ALTER TABLE "AttendanceClockLog" ADD COLUMN IF NOT EXISTS "selfieUrl" TEXT`);
      await c.query(`ALTER TABLE "AttendanceClockLog" ADD COLUMN IF NOT EXISTS "deviceId" TEXT`);
      await c.query(`ALTER TABLE "AttendanceClockLog" ADD COLUMN IF NOT EXISTS "faceVerified" BOOLEAN`);
      await c.query(`ALTER TABLE "AttendanceClockLog" ADD COLUMN IF NOT EXISTS "anomalyNotes" TEXT`);

      // 2) AttendanceRule — mode verifikasi + cap lembur konfiguratif + fatigue
      //    + device key + ambang burnout (kolom NULL dianggap preset PP35).
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "selfieMode" TEXT NOT NULL DEFAULT 'off'`);
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "faceVerifyMode" TEXT NOT NULL DEFAULT 'off'`);
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "geofenceMultiSite" BOOLEAN NOT NULL DEFAULT false`);
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "otCapMode" TEXT NOT NULL DEFAULT 'PP35'`);
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "otCapDayHours" INTEGER`);
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "otCapWeekHours" INTEGER`);
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "fatigueMaxConsecutiveNights" INTEGER NOT NULL DEFAULT 4`);
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "fatigueMinRestHours" INTEGER NOT NULL DEFAULT 12`);
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "deviceApiKey" TEXT`);
      await c.query(`ALTER TABLE "AttendanceRule" ADD COLUMN IF NOT EXISTS "burnoutOtHoursMonthly" INTEGER NOT NULL DEFAULT 40`);

      // 3) Employee — foto referensi wajah (selfie pertama jadi acuan VLM).
      await c.query(`ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "selfieRefUrl" TEXT`);

      // 4) OpenShiftPost + OpenShiftClaim (G26) — CREATE IF NOT EXISTS.
      await c.query(`
        CREATE TABLE IF NOT EXISTS "OpenShiftPost" (
            "id" TEXT NOT NULL,
            "workDate" TIMESTAMP(3) NOT NULL,
            "scheduleId" TEXT NOT NULL,
            "dayTypeId" TEXT NOT NULL,
            "orgUnitName" TEXT,
            "slots" INTEGER NOT NULL DEFAULT 1,
            "filled" INTEGER NOT NULL DEFAULT 0,
            "status" TEXT NOT NULL DEFAULT 'Open',
            "notes" TEXT,
            "createdBy" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT "OpenShiftPost_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE INDEX IF NOT EXISTS "OpenShiftPost_workDate_idx" ON "OpenShiftPost"("workDate")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "OpenShiftPost_status_idx" ON "OpenShiftPost"("status")`);

      await c.query(`
        CREATE TABLE IF NOT EXISTS "OpenShiftClaim" (
            "id" TEXT NOT NULL,
            "postId" TEXT NOT NULL,
            "employeeId" TEXT NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'Pending',
            "decidedBy" TEXT,
            "decidedAt" TIMESTAMP(3),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT "OpenShiftClaim_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "OpenShiftClaim_postId_employeeId_key" ON "OpenShiftClaim"("postId", "employeeId")`);
      await c.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpenShiftClaim_postId_fkey') THEN
          ALTER TABLE "OpenShiftClaim" ADD CONSTRAINT "OpenShiftClaim_postId_fkey"
            FOREIGN KEY ("postId") REFERENCES "OpenShiftPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$`);
      await c.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpenShiftClaim_employeeId_fkey') THEN
          ALTER TABLE "OpenShiftClaim" ADD CONSTRAINT "OpenShiftClaim_employeeId_fkey"
            FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$`);

      migrated += 1;
      console.log(`[${schema}] attendance-advance OK — selfie/face/otCap/fatigue/deviceKey/burnout + OpenShiftPost/Claim siap`);
    } catch (e) {
      console.error(`[${schema}] GAGAL:`, e instanceof Error ? e.message : e);
      throw e;
    } finally {
      await c.end();
    }
  }
  console.log(`attendance-advance selesai: ${migrated} schema dimigrasi, ${skipped} dilewati`);
}

// CLI langsung: bun run scripts/migrate-attendance-advance.ts
if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
