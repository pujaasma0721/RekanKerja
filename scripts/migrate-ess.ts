// Migrasi ESS (T7-ESS-BACKEND) ke tenant existing — idempoten:
//   1. DDL: tabel "Notification" (pusat notifikasi per AppUser) + kolom
//      AttendanceClockLog.latitude/longitude (geolocation clock via web)
//   2. Link AppUser.employeeId utk AppUser yang kosong (match email↔Employee.email
//      bila unik) — syarat requireEss() menemukan data karyawan aktor
//   3. Seed notifikasi demo (3 baris) utk AppUser MII hrd & agus — hanya bila
//      pengguna tsb belum punya notifikasi (idempoten)
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI: bun scripts/migrate-ess.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { pushNotification } from "@/rekankerja/shared/services/notification-service";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const BASE_URL =
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

/** DDL ESS (idempoten — IF NOT EXISTS di semua statement). */
async function applyEssDdl(schemaName: string): Promise<string[]> {
  const out: string[] = [];
  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS "Notification" (
          "id" TEXT NOT NULL,
          "appUserId" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "body" TEXT,
          "kind" TEXT,
          "link" TEXT,
          "readAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
      );`);
    out.push("tabel Notification");

    await c.query(`
      CREATE INDEX IF NOT EXISTS "Notification_appUserId_createdAt_idx"
      ON "Notification"("appUserId", "createdAt");`);
    out.push("index Notification(appUserId,createdAt)");

    // FK AppUser→Notification (cascade delete) — hanya bila constraint belum ada
    await c.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_appUserId_fkey') THEN
          ALTER TABLE "Notification"
            ADD CONSTRAINT "Notification_appUserId_fkey"
            FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;`);
    out.push("FK Notification→AppUser");

    await c.query(`
      ALTER TABLE "AttendanceClockLog"
        ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;`);
    out.push("kolom AttendanceClockLog.latitude/longitude");
  } finally {
    await c.end();
  }
  return out;
}

/** Isi AppUser.employeeId yang kosong via email↔Employee.email (bila unik). */
async function linkAppUserEmployees(schemaName: string): Promise<string[]> {
  const db = getTenantClient(schemaName);
  const report: string[] = [];
  try {
    const users = await db.appUser.findMany({
      where: { employeeId: null, email: { not: null } },
      select: { id: true, username: true, email: true },
    });
    for (const u of users) {
      const email = u.email?.trim();
      if (!email) continue;
      const matches = await db.employee.findMany({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, employeeNo: true, fullName: true },
      });
      if (matches.length === 1) {
        await db.appUser.update({
          where: { id: u.id },
          data: { employeeId: matches[0]!.id },
        });
        report.push(`${u.username} (${email}) → ${matches[0]!.employeeNo} ${matches[0]!.fullName}`);
      } else if (matches.length > 1) {
        report.push(`${u.username} (${email}) → AMBIGU (${matches.length} karyawan) — skip`);
      }
    }
  } finally {
    await db.$disconnect();
  }
  return report;
}

/** Notifikasi demo MII — 3 baris per AppUser demo, hanya bila belum ada. */
const DEMO_NOTIFICATIONS: Record<string, { title: string; body: string; kind: string; link: string }[]> = {
  MII000001: [
    {
      title: "Pengajuan cuti menunggu persetujuan Anda",
      body: "LR-2026-007 (Joko Ramadhan) menunggu keputusan jenjang 2/2 — Anda approver terakhir.",
      kind: "leave",
      link: "/ess/leave",
    },
    {
      title: "Slip gaji AGUSTUS 2026 tersedia",
      body: "Run PR-2026-08-SAL-01 telah dibayar — buka rincian gaji Anda di portal ESS.",
      kind: "payroll",
      link: "/ess/payslips",
    },
    {
      title: "Klaim medis MC-2026-002 diselesaikan",
      body: "Klaim Rawat Jalan Anda telah settle — nilai disetujui 1.750.000.",
      kind: "medical",
      link: "/ess/claims",
    },
  ],
  MII000006: [
    {
      title: "Perjalanan dinas TR-2026-003 diajukan",
      body: "Pengecekan gudang regional Karawang menunggu persetujuan atasan.",
      kind: "travel",
      link: "/ess/claims",
    },
    {
      title: "Slip gaji AGUSTUS 2026 tersedia",
      body: "Run PR-2026-08-SAL-01 telah dibayar — buka rincian gaji Anda di portal ESS.",
      kind: "payroll",
      link: "/ess/payslips",
    },
    {
      title: "Reminder clock-in portal ESS",
      body: "Lakukan clock-in/out setiap hari kerja melalui portal ESS — rekap hadir dihitung otomatis.",
      kind: "attendance",
      link: "/ess/attendance",
    },
  ],
};

async function seedDemoNotifications(schemaName: string): Promise<string[]> {
  if (schemaName !== SCHEMAS[0]) return []; // seed demo hanya di sandbox MII
  const db = getTenantClient(schemaName);
  const report: string[] = [];
  try {
    for (const [username, items] of Object.entries(DEMO_NOTIFICATIONS)) {
      const user = await db.appUser.findUnique({ where: { username } });
      if (!user) {
        report.push(`${username}: AppUser tidak ditemukan — skip`);
        continue;
      }
      const existing = await db.notification.count({ where: { appUserId: user.id } });
      if (existing > 0) {
        report.push(`${username}: sudah punya ${existing} notifikasi — skip`);
        continue;
      }
      for (const n of items) {
        await pushNotification(db, { appUserId: user.id, ...n });
      }
      report.push(`${username} (${user.fullName}): ${items.length} notifikasi demo dibuat`);
    }
  } finally {
    await db.$disconnect();
  }
  return report;
}

// ============ run ============

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  let ddlTotal = 0;
  for (const schema of list) {
  console.log(`\n[${schema}] migrasi ESS…`);
  const ddl = await applyEssDdl(schema);
  ddlTotal += ddl.length;
  console.log(`  DDL: ${ddl.join(" · ")}`);

  const linked = await linkAppUserEmployees(schema);
  if (linked.length === 0) {
    console.log("  link AppUser→employee: tidak ada yang perlu (semua AppUser ber-email sudah tertaut / tanpa email)");
  } else {
    for (const l of linked) console.log(`  link AppUser→employee: ${l}`);
  }

  const seeded = await seedDemoNotifications(schema);
  for (const s of seeded) console.log(`  notifikasi demo: ${s}`);
  }
  console.log(`\nDONE — ${ddlTotal} statement DDL diterapkan (idempoten) di ${list.length} tenant`);
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
