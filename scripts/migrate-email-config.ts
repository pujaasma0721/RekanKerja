// Migrasi KONFIGURASI EMAIL (Task 34) ke tenant existing:
//   1. DDL idempoten tenant: tabel EmailConfig + EmailTemplate + EmailLog
//   2. seed config default (satu baris aktif bila belum ada)
//   3. seed template default per event (bila belum ada — idempoten)
// Jalankan: bun run scripts/migrate-email-config.ts (idempoten)
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const DDL = `
CREATE TABLE IF NOT EXISTS "EmailConfig" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT NOT NULL DEFAULT '',
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT NOT NULL DEFAULT '',
    "smtpPassword" TEXT NOT NULL DEFAULT '',
    "fromEmail" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL DEFAULT 'RekanKerja HRIS',
    "lastTestOk" BOOLEAN,
    "lastTestAt" TIMESTAMP(3),
    "lastTestMessage" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailConfig_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "EmailTemplate" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmployee" BOOLEAN NOT NULL DEFAULT true,
    "notifyApprover" BOOLEAN NOT NULL DEFAULT true,
    "notifyHrd" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmailTemplate_event_key" ON "EmailTemplate"("event");
CREATE TABLE IF NOT EXISTS "EmailLog" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");
CREATE INDEX IF NOT EXISTS "EmailLog_event_idx" ON "EmailLog"("event");
`;

// Template default Bahasa Indonesia — placeholder {{nama}} {{docNo}} dst.
export const DEFAULT_TEMPLATES: { event: string; label: string; notifyEmployee: boolean; notifyApprover: boolean; notifyHrd: boolean; subject: string; body: string }[] = [
  {
    event: "leave.submitted", label: "Cuti — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Permintaan Cuti {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan cuti {{jenisCuti}} ({{docNo}}):\n- Periode: {{periode}}\n- Jumlah hari: {{jumlahHari}}\n- Alasan: {{alasan}}\n\nSilakan buka RekanKerja HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "leave.approved", label: "Cuti — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Permintaan Cuti {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nPermintaan cuti Anda ({{docNo}}) telah DISSETUJUI.\n- Jenis: {{jenisCuti}}\n- Periode: {{periode}}\n- Jumlah hari: {{jumlahHari}}\n- Catatan approver: {{catatan}}\n\nSelamat beristirahat!\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "leave.rejected", label: "Cuti — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Cuti {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, permintaan cuti Anda ({{docNo}}) DITOLAK.\n- Jenis: {{jenisCuti}}\n- Periode: {{periode}}\n- Alasan penolakan: {{catatan}}\n\nSilakan hubungi HRD atau ajukan kembali bila diperlukan.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.submitted", label: "Travel — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Permintaan Perjalanan Dinas {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan perjalanan dinas ({{docNo}}):\n- Tujuan: {{tujuan}}\n- Periode: {{periode}}\n- Estimasi biaya: {{biaya}}\n\nSilakan buka RekanKerja HRIS untuk menyetujui atau menolak.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.approved", label: "Travel — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Travel {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nPermintaan perjalanan dinas Anda ({{docNo}}) telah DISSETUJUI.\n- Tujuan: {{tujuan}}\n- Periode: {{periode}}\n- Catatan: {{catatan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.rejected", label: "Travel — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Travel {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, permintaan perjalanan dinas Anda ({{docNo}}) DITOLAK.\n- Alasan: {{catatan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.claim.submitted", label: "Klaim Travel — Diajukan", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Klaim Settlement {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan klaim settlement perjalanan ({{docNo}}):\n- Total klaim: {{jumlah}}\n- Periode: {{periode}}\n\nSilakan buka RekanKerja HRIS untuk memproses klaim ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.claim.approved", label: "Klaim Travel — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Settlement {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nKlaim settlement Anda ({{docNo}}) telah DISSETUJUI — total {{jumlah}}.\nPembayaran akan diproses sesuai metode settlement.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.claim.rejected", label: "Klaim Travel — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Settlement {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, klaim settlement Anda ({{docNo}}) DITOLAK.\n- Alasan: {{catatan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.submitted", label: "Klaim Medis — Diajukan", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Klaim Medis {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan klaim medis ({{docNo}}):\n- Jenis benefit: {{jenis}}\n- Total klaim: {{jumlah}}\n\nSilakan buka RekanKerja HRIS untuk memproses klaim ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.approved", label: "Klaim Medis — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Medis {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nKlaim medis Anda ({{docNo}}) telah DISSETUJUI — total {{jumlah}}.\nSettlement akan diproses oleh tim HR/Medical.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.rejected", label: "Klaim Medis — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Medis {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, klaim medis Anda ({{docNo}}) DITOLAK.\n- Alasan: {{catatan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.settled", label: "Klaim Medis — Settled", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Medis {{docNo}} telah Dibayarkan",
    body: "Halo {{nama}},\n\nKlaim medis Anda ({{docNo}}) telah diselesaikan & dibayarkan — total {{jumlah}}.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "payroll.run.confirmed", label: "Payroll — Run Dikonfirmasi", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "Run Payroll {{runNo}} FINAL ({{jumlah}} karyawan, total {{total}})",
    body: "Run payroll {{runNo}} periode {{periode}} telah dikonfirmasi:\n- Karyawan: {{jumlah}}\n- Total bruto: {{total}}\n- Jurnal telah diposting.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "payroll.run.paid", label: "Payroll — Run Ditandai Dibayar", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "Run Payroll {{runNo}} DIBAYARKAN",
    body: "Run payroll {{runNo}} periode {{periode}} telah ditandai dibayarkan (total {{total}}).\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.submitted", label: "Personnel Action — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Personnel Action {{docNo}} — {{nama}} ({{jenisAksi}})",
    body: "Halo {{approver}},\n\n{{nama}} mengajukan Personnel Action {{jenisAksi}} ({{docNo}}):\n- Tanggal efektif: {{tanggalEfektif}}\n- Alasan: {{alasan}}\n- Menunggu persetujuan: {{layer}}\n\nSilakan buka RekanKerja HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.approved", label: "Personnel Action — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Personnel Action {{docNo}} ({{jenisAksi}}) DISSETUJUI",
    body: "Halo {{nama}},\n\nPengajuan Personnel Action {{jenisAksi}} ({{docNo}}) telah DISSETUJUI.\n- Tanggal efektif: {{tanggalEfektif}}\n- Catatan approver: {{catatan}}\n\nPerubahan akan diterapkan setelah dokumen diproses oleh tim HR.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.rejected", label: "Personnel Action — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Personnel Action {{docNo}} ({{jenisAksi}}) DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, pengajuan Personnel Action {{jenisAksi}} ({{docNo}}) DITOLAK.\n- Tanggal efektif: {{tanggalEfektif}}\n- Alasan penolakan: {{catatan}}\n\nSilakan hubungi HRD untuk informasi lebih lanjut atau ajukan kembali bila diperlukan.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.processed", label: "Personnel Action — Diproses", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Personnel Action {{docNo}} ({{jenisAksi}}) TELAH DIPROSES",
    body: "Halo {{nama}},\n\nPersonnel Action {{jenisAksi}} ({{docNo}}) telah DIPROSES dan perubahan sudah diterapkan pada data kepegawaian Anda.\n- Tanggal efektif: {{tanggalEfektif}}\n- Alasan: {{alasan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "user.created", label: "Pengguna Baru Dibuat", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Akun RekanKerja HRIS Anda telah dibuat",
    body: "Halo {{nama}},\n\nAkun Anda untuk aplikasi RekanKerja HRIS telah dibuat:\n- Email login: {{email}}\n- Kata sandi sementara: {{password}}\n\nSegera login dan ganti kata sandi Anda. Kata sandi sementara hanya ditampilkan sekali.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "overtime.submitted", label: "Lembur — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Perintah Lembur {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan perintah lembur ({{docNo}}):\n- Tanggal: {{tanggal}}\n- Rencana jam: {{jumlahJam}} jam\n- Alasan: {{alasan}}\n\nMaksimal lembur 4 jam/hari sesuai PP 35/2021.\nSilakan buka RekanKerja HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  // ============ T14-SCHED: template pengingat scheduler latar belakang ============
  {
    event: "scheduler.contract-expiry", label: "Scheduler — Kontrak/Probation Segera Berakhir", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[Pengingat Scheduler] {{jenis}} {{nama}} ({{employeeNo}}) berakhir {{date}}",
    body: "Halo Tim HR,\n\nPengingat otomatis scheduler RekanKerja:\n- Karyawan: {{nama}} ({{employeeNo}})\n- Jenis: {{jenis}}\n- Tanggal berakhir: {{date}}\n- Sisa waktu: {{days}} hari\n\nMohon tindak lanjut perpanjangan kontrak / evaluasi probation karyawan ini.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "scheduler.doc-expiry", label: "Scheduler — Dokumen Karyawan Kedaluwarsa", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "[Pengingat Scheduler] Dokumen {{docType}} {{nama}} kedaluwarsa {{date}}",
    body: "Halo,\n\nDokumen karyawan berikut akan segera / telah kedaluwarsa:\n- Karyawan: {{nama}} ({{employeeNo}})\n- Dokumen: {{docType}} {{docNo}}\n- Tanggal kedaluwarsa: {{date}}\n- Sisa waktu: {{days}} hari\n\nMohon pembaruan dokumen sebelum tanggal tersebut.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "scheduler.approval-sla", label: "Scheduler — Persetujuan Melewati SLA", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[SLA] {{jenis}} {{docNo}} menunggu {{days}} hari",
    body: "Halo {{approver}},\n\nPersetujuan berikut menunggu lebih dari 3 hari (SLA terlampaui):\n- Dokumen: {{jenis}} {{docNo}}\n- Pemohon: {{nama}}\n- Jenjang menunggu: {{layer}}\n- Lama menunggu: {{days}} hari\n\nMohon tindak lanjut segera di RekanKerja HRIS.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "scheduler.payroll-reminder", label: "Scheduler — Payroll D-3", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[D-{{days}}] Payroll periode {{periode}} gajian {{date}}",
    body: "Halo Tim HR,\n\nPeriode payroll {{periode}} ({{code}}) dijadwalkan gajian pada {{date}} — {{days}} hari lagi — dan belum ada run yang dikonfirmasi.\n\nMohon mulai proses payroll agar pembayaran tepat waktu.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  // ============ Task 65: checklist onboarding/offboarding per bagian ============
  {
    event: "onboarding.checklist", label: "Onboarding — Checklist Bagian Baru", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "[Checklist Onboarding] Tugas bagian {{bagian}} untuk {{nama}} ({{employeeNo}})",
    body: "Halo Tim {{bagian}},\n\nKaryawan baru berikut memerlukan penyiapan dari bagian Anda:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n- Mulai kerja: {{tanggal}}\n\nTugas bagian {{bagian}}:\n{{daftarTugas}}\n\nCentang status tugas Anda melalui tautan berikut (tanpa login, khusus bagian {{bagian}}):\n{{link}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "onboarding.completed", label: "Onboarding — Checklist Selesai", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[Selesai] Checklist onboarding {{nama}} ({{employeeNo}})",
    body: "Halo Tim HR,\n\nSeluruh checklist onboarding untuk karyawan berikut telah selesai:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "offboarding.checklist", label: "Offboarding — Checklist Bagian Baru", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "[Checklist Offboarding] Tugas bagian {{bagian}} untuk {{nama}} ({{employeeNo}})",
    body: "Halo Tim {{bagian}},\n\nKaryawan berikut akan keluar dan memerlukan clearance dari bagian Anda:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n- Hari terakhir: {{tanggal}}\n\nTugas bagian {{bagian}}:\n{{daftarTugas}}\n\nCentang status clearance Anda melalui tautan berikut (tanpa login, khusus bagian {{bagian}}):\n{{link}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "offboarding.completed", label: "Offboarding — Checklist Selesai", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[Selesai] Checklist offboarding {{nama}} ({{employeeNo}})",
    body: "Halo Tim HR,\n\nSeluruh checklist offboarding/clearance untuk karyawan berikut telah tuntas:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
];

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  const client = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await client.connect();

  for (const schema of list) {
    // guard: schema tenant belum di-provision → skip (bukan error — mis. environment parsial)
    const exists = await client.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [schema]);
    if ((exists.rowCount ?? 0) === 0) {
      console.log(`[${schema}] schema belum ada — skip (jalankan provision tenant dulu)`);
      continue;
    }
    console.log(`[${schema}] migrasi konfigurasi email…`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(DDL);

    // seed config default (satu baris aktif bila belum ada)
    const cfg = await client.query(`SELECT 1 FROM "EmailConfig" WHERE "active" = true LIMIT 1`);
    if ((cfg.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO "EmailConfig" ("id","active","updatedAt") VALUES (gen_random_uuid()::text, true, CURRENT_TIMESTAMP)`,
      );
      console.log("  seed konfigurasi default (SMTP kosong — isi di menu Pengaturan → Konfigurasi Email)");
    }

    // seed template default per event (idempoten)
    let seeded = 0;
    for (const t of DEFAULT_TEMPLATES) {
      const r = await client.query(
        `INSERT INTO "EmailTemplate" ("id","event","label","notifyEmployee","notifyApprover","notifyHrd","subject","body","updatedAt")
         SELECT gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP
         WHERE NOT EXISTS (SELECT 1 FROM "EmailTemplate" e WHERE e."event" = $1)`,
        [t.event, t.label, t.notifyEmployee, t.notifyApprover, t.notifyHrd, t.subject, t.body],
      );
      if ((r.rowCount ?? 0) > 0) seeded++;
    }
    console.log(`  template default: ${seeded} baru, ${DEFAULT_TEMPLATES.length - seeded} sudah ada`);
  }

  await client.end();
  console.log("DONE — konfigurasi email siap (Task 34)");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
