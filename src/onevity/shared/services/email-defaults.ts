// OneVity — TEMPLATE EMAIL DEFAULT (Task 34) =========================
// Sumber tunggal template default (self-heal GET /api/onevity/email-templates).
// Duplikat sengaja dari scripts/migrate-email-config.ts (skrip berjalan
// standalone tanpa alias @/) — bila mengubah satu, ubah keduanya.
// =====================================================================
export interface EmailTemplateDefault {
  event: string;
  label: string;
  notifyEmployee: boolean;
  notifyApprover: boolean;
  notifyHrd: boolean;
  subject: string;
  body: string;
}

export const DEFAULT_TEMPLATES_PLACEHOLDER: EmailTemplateDefault[] = [
  {
    event: "leave.submitted", label: "Cuti — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Permintaan Cuti {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan cuti {{jenisCuti}} ({{docNo}}):\n- Periode: {{periode}}\n- Jumlah hari: {{jumlahHari}}\n- Alasan: {{alasan}}\n\nSilakan buka OneVity HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "leave.approved", label: "Cuti — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Permintaan Cuti {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nPermintaan cuti Anda ({{docNo}}) telah DISSETUJUI.\n- Jenis: {{jenisCuti}}\n- Periode: {{periode}}\n- Jumlah hari: {{jumlahHari}}\n- Catatan approver: {{catatan}}\n\nSelamat beristirahat!\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "leave.rejected", label: "Cuti — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Cuti {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, permintaan cuti Anda ({{docNo}}) DITOLAK.\n- Jenis: {{jenisCuti}}\n- Periode: {{periode}}\n- Alasan penolakan: {{catatan}}\n\nSilakan hubungi HRD atau ajukan kembali bila diperlukan.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.submitted", label: "Travel — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Permintaan Perjalanan Dinas {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan perjalanan dinas ({{docNo}}):\n- Tujuan: {{tujuan}}\n- Periode: {{periode}}\n- Estimasi biaya: {{biaya}}\n\nSilakan buka OneVity HRIS untuk menyetujui atau menolak.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.approved", label: "Travel — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Travel {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nPermintaan perjalanan dinas Anda ({{docNo}}) telah DISSETUJUI.\n- Tujuan: {{tujuan}}\n- Periode: {{periode}}\n- Catatan: {{catatan}}\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.rejected", label: "Travel — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Travel {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, permintaan perjalanan dinas Anda ({{docNo}}) DITOLAK.\n- Alasan: {{catatan}}\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.claim.submitted", label: "Klaim Travel — Diajukan", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Klaim Settlement {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan klaim settlement perjalanan ({{docNo}}):\n- Total klaim: {{jumlah}}\n- Periode: {{periode}}\n\nSilakan buka OneVity HRIS untuk memproses klaim ini.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.claim.approved", label: "Klaim Travel — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Settlement {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nKlaim settlement Anda ({{docNo}}) telah DISSETUJUI — total {{jumlah}}.\nPembayaran akan diproses sesuai metode settlement.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.claim.rejected", label: "Klaim Travel — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Settlement {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, klaim settlement Anda ({{docNo}}) DITOLAK.\n- Alasan: {{catatan}}\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.submitted", label: "Klaim Medis — Diajukan", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Klaim Medis {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan klaim medis ({{docNo}}):\n- Jenis benefit: {{jenis}}\n- Total klaim: {{jumlah}}\n\nSilakan buka OneVity HRIS untuk memproses klaim ini.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.approved", label: "Klaim Medis — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Medis {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nKlaim medis Anda ({{docNo}}) telah DISSETUJUI — total {{jumlah}}.\nSettlement akan diproses oleh tim HR/Medical.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.rejected", label: "Klaim Medis — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Medis {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, klaim medis Anda ({{docNo}}) DITOLAK.\n- Alasan: {{catatan}}\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.settled", label: "Klaim Medis — Settled", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Medis {{docNo}} telah Dibayarkan",
    body: "Halo {{nama}},\n\nKlaim medis Anda ({{docNo}}) telah diselesaikan & dibayarkan — total {{jumlah}}.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "payroll.run.confirmed", label: "Payroll — Run Dikonfirmasi", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "Run Payroll {{runNo}} FINAL ({{jumlah}} karyawan, total {{total}})",
    body: "Run payroll {{runNo}} periode {{periode}} telah dikonfirmasi:\n- Karyawan: {{jumlah}}\n- Total bruto: {{total}}\n- Jurnal telah diposting.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "payroll.run.paid", label: "Payroll — Run Ditandai Dibayar", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "Run Payroll {{runNo}} DIBAYARKAN",
    body: "Run payroll {{runNo}} periode {{periode}} telah ditandai dibayarkan (total {{total}}).\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "payroll.payslip", label: "Payroll — Slip Gaji (Lampiran PDF)", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Slip Gaji {{periode}} — {{nama}}",
    body: "Halo {{nama}},\n\nSlip gaji Anda untuk periode {{periode}} telah diterbitkan (run {{runNo}}).\n- Take Home Pay: {{net}}\n- Rincian lengkap terlampir dalam email ini (PDF).\n\nSlip gaji bersifat RAHASIA — mohon tidak diteruskan.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.submitted", label: "Personnel Action — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Personnel Action {{docNo}} — {{nama}} ({{jenisAksi}})",
    body: "Halo {{approver}},\n\n{{nama}} mengajukan Personnel Action {{jenisAksi}} ({{docNo}}):\n- Tanggal efektif: {{tanggalEfektif}}\n- Alasan: {{alasan}}\n- Menunggu persetujuan: {{layer}}\n\nSilakan buka OneVity HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.approved", label: "Personnel Action — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Personnel Action {{docNo}} ({{jenisAksi}}) DISSETUJUI",
    body: "Halo {{nama}},\n\nPengajuan Personnel Action {{jenisAksi}} ({{docNo}}) telah DISSETUJUI.\n- Tanggal efektif: {{tanggalEfektif}}\n- Catatan approver: {{catatan}}\n\nPerubahan akan diterapkan setelah dokumen diproses oleh tim HR.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.rejected", label: "Personnel Action — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Personnel Action {{docNo}} ({{jenisAksi}}) DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, pengajuan Personnel Action {{jenisAksi}} ({{docNo}}) DITOLAK.\n- Tanggal efektif: {{tanggalEfektif}}\n- Alasan penolakan: {{catatan}}\n\nSilakan hubungi HRD untuk informasi lebih lanjut atau ajukan kembali bila diperlukan.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.processed", label: "Personnel Action — Diproses", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Personnel Action {{docNo}} ({{jenisAksi}}) TELAH DIPROSES",
    body: "Halo {{nama}},\n\nPersonnel Action {{jenisAksi}} ({{docNo}}) telah DIPROSES dan perubahan sudah diterapkan pada data kepegawaian Anda.\n- Tanggal efektif: {{tanggalEfektif}}\n- Alasan: {{alasan}}\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "user.created", label: "Pengguna Baru Dibuat", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Akun OneVity HRIS Anda telah dibuat",
    body: "Halo {{nama}},\n\nAkun Anda untuk aplikasi OneVity HRIS telah dibuat:\n- Email login: {{email}}\n- Kata sandi sementara: {{password}}\n\nSegera login dan ganti kata sandi Anda. Kata sandi sementara hanya ditampilkan sekali.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "overtime.submitted", label: "Lembur — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Perintah Lembur {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan perintah lembur ({{docNo}}):\n- Tanggal: {{tanggal}}\n- Rencana jam: {{jumlahJam}} jam\n- Alasan: {{alasan}}\n\nMaksimal lembur 4 jam/hari sesuai PP 35/2021.\nSilakan buka OneVity HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  // ============ T14-SCHED: template pengingat scheduler latar belakang ============
  {
    event: "scheduler.contract-expiry", label: "Scheduler — Kontrak/Probation Segera Berakhir", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[Pengingat Scheduler] {{jenis}} {{nama}} ({{employeeNo}}) berakhir {{date}}",
    body: "Halo Tim HR,\n\nPengingat otomatis scheduler OneVity:\n- Karyawan: {{nama}} ({{employeeNo}})\n- Jenis: {{jenis}}\n- Tanggal berakhir: {{date}}\n- Sisa waktu: {{days}} hari\n\nMohon tindak lanjut perpanjangan kontrak / evaluasi probation karyawan ini.\n\n---\nEmail otomatis scheduler OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "scheduler.doc-expiry", label: "Scheduler — Dokumen Karyawan Kedaluwarsa", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "[Pengingat Scheduler] Dokumen {{docType}} {{nama}} kedaluwarsa {{date}}",
    body: "Halo,\n\nDokumen karyawan berikut akan segera / telah kedaluwarsa:\n- Karyawan: {{nama}} ({{employeeNo}})\n- Dokumen: {{docType}} {{docNo}}\n- Tanggal kedaluwarsa: {{date}}\n- Sisa waktu: {{days}} hari\n\nMohon pembaruan dokumen sebelum tanggal tersebut.\n\n---\nEmail otomatis scheduler OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "scheduler.approval-sla", label: "Scheduler — Persetujuan Melewati SLA", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[SLA] {{jenis}} {{docNo}} menunggu {{days}} hari",
    body: "Halo {{approver}},\n\nPersetujuan berikut menunggu lebih dari 3 hari (SLA terlampaui):\n- Dokumen: {{jenis}} {{docNo}}\n- Pemohon: {{nama}}\n- Jenjang menunggu: {{layer}}\n- Lama menunggu: {{days}} hari\n\nMohon tindak lanjut segera di OneVity HRIS.\n\n---\nEmail otomatis scheduler OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "scheduler.payroll-reminder", label: "Scheduler — Payroll D-3", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[D-{{days}}] Payroll periode {{periode}} gajian {{date}}",
    body: "Halo Tim HR,\n\nPeriode payroll {{periode}} ({{code}}) dijadwalkan gajian pada {{date}} — {{days}} hari lagi — dan belum ada run yang dikonfirmasi.\n\nMohon mulai proses payroll agar pembayaran tepat waktu.\n\n---\nEmail otomatis scheduler OneVity HRIS — tidak perlu dibalas.",
  },
  // ============ Task 65: checklist onboarding/offboarding per bagian ============
  {
    event: "onboarding.checklist", label: "Onboarding — Checklist Bagian Baru", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "[Checklist Onboarding] Tugas bagian {{bagian}} untuk {{nama}} ({{employeeNo}})",
    body: "Halo Tim {{bagian}},\n\nKaryawan baru berikut memerlukan penyiapan dari bagian Anda:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n- Mulai kerja: {{tanggal}}\n\nTugas bagian {{bagian}}:\n{{daftarTugas}}\n\nCentang status tugas Anda melalui tautan berikut (tanpa login, khusus bagian {{bagian}}):\n{{link}}\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "onboarding.completed", label: "Onboarding — Checklist Selesai", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[Selesai] Checklist onboarding {{nama}} ({{employeeNo}})",
    body: "Halo Tim HR,\n\nSeluruh checklist onboarding untuk karyawan berikut telah selesai:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "offboarding.checklist", label: "Offboarding — Checklist Bagian Baru", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "[Checklist Offboarding] Tugas bagian {{bagian}} untuk {{nama}} ({{employeeNo}})",
    body: "Halo Tim {{bagian}},\n\nKaryawan berikut akan keluar dan memerlukan clearance dari bagian Anda:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n- Hari terakhir: {{tanggal}}\n\nTugas bagian {{bagian}}:\n{{daftarTugas}}\n\nCentang status clearance Anda melalui tautan berikut (tanpa login, khusus bagian {{bagian}}):\n{{link}}\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
  {
    event: "offboarding.completed", label: "Offboarding — Checklist Selesai", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[Selesai] Checklist offboarding {{nama}} ({{employeeNo}})",
    body: "Halo Tim HR,\n\nSeluruh checklist offboarding/clearance untuk karyawan berikut telah tuntas:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
];

/** Label tampil untuk sebuah event (UI). */
export function templateLabelOf(event: string): string {
  return DEFAULT_TEMPLATES_PLACEHOLDER.find((t) => t.event === event)?.label ?? event;
}

// KATALOG PLACEHOLDER PER-EVENT =========================================
// Sumber kebenaran variabel {{...}} yang BENAR-BENAR dikirim hook tiap
// event (disalin dari pemanggilan notifyEmailEvent di API leave/travel/
// medical/payroll/app-users). Dipakai UI editor template: chip klik-untuk-
// sisipkan + preview langsung dengan nilai contoh. Placeholder tak
// terdaftar tetap boleh dipakai — dirender apa adanya saat kirim.
export interface PlaceholderDef { key: string; label: string; contoh: string }

const PH_NAMA: PlaceholderDef = { key: "nama", label: "Nama karyawan pengaju", contoh: "Hartono Wijaksono" };
const PH_DOC: PlaceholderDef = { key: "docNo", label: "Nomor dokumen", contoh: "LR-2026-010" };
const PH_PERIODE: PlaceholderDef = { key: "periode", label: "Periode / rentang tanggal", contoh: "2026-10-12 → 2026-10-13" };
const PH_CATATAN: PlaceholderDef = { key: "catatan", label: "Catatan approver saat keputusan", contoh: "Disetujui, selamat beristirahat" };
const PH_JENISCUTI: PlaceholderDef = { key: "jenisCuti", label: "Nama jenis cuti", contoh: "Cuti Tahunan" };
const PH_JUMLAHHARI: PlaceholderDef = { key: "jumlahHari", label: "Jumlah hari kerja (cuti)", contoh: "2" };
const PH_ALASAN: PlaceholderDef = { key: "alasan", label: "Alasan pengajuan (cuti)", contoh: "Acara keluarga" };
const PH_TUJUAN: PlaceholderDef = { key: "tujuan", label: "Kota tujuan perjalanan", contoh: "Surabaya, Jakarta" };
const PH_BIAYA: PlaceholderDef = { key: "biaya", label: "Estimasi biaya / uang muka", contoh: "Rp 5.000.000" };
const PH_JENIS: PlaceholderDef = { key: "jenis", label: "Jenis benefit medis", contoh: "Rawat Jalan" };
const PH_JUMLAH: PlaceholderDef = { key: "jumlah", label: "Jumlah klaim (Rp)", contoh: "Rp 1.250.000" };
const PH_RUNNO: PlaceholderDef = { key: "runNo", label: "Nomor run payroll", contoh: "PR-2026-09-001" };
const PH_JENISAKSI: PlaceholderDef = { key: "jenisAksi", label: "Jenis aksi Personnel Action", contoh: "Promosi" };
const PH_TGEFF: PlaceholderDef = { key: "tanggalEfektif", label: "Tanggal efektif aksi", contoh: "2026-10-01" };
const PH_LAYER: PlaceholderDef = { key: "layer", label: "Jenjang/layer persetujuan", contoh: "HR Manager" };
const PH_APPROVER: PlaceholderDef = { key: "approver", label: "Nama approver yang dituju", contoh: "Tri Handayani" };
const PH_TOTAL: PlaceholderDef = { key: "total", label: "Total bruto (Rp)", contoh: "Rp 412.500.000" };
const PH_NET: PlaceholderDef = { key: "net", label: "Take Home Pay (Rp)", contoh: "Rp 23.678.526" };
// T14-SCHED: placeholder template pengingat scheduler
const PH_EMPNO: PlaceholderDef = { key: "employeeNo", label: "Nomor karyawan", contoh: "MII00007" };
const PH_DATE: PlaceholderDef = { key: "date", label: "Tanggal berakhir / kedaluwarsa / gajian", contoh: "2026-10-06" };
const PH_DAYS: PlaceholderDef = { key: "days", label: "Jumlah hari (sisa waktu / lama menunggu)", contoh: "30" };
const PH_JENIS_SCHED: PlaceholderDef = { key: "jenis", label: "Jenis pengingat (Kontrak/Probation)", contoh: "Kontrak" };
const PH_DOCTYPE: PlaceholderDef = { key: "docType", label: "Jenis dokumen karyawan", contoh: "Paspor" };
const PH_CODE: PlaceholderDef = { key: "code", label: "Kode periode payroll", contoh: "2026-10" };
// T15-CHAIN-EXT: placeholder template lembur
const PH_TANGGAL: PlaceholderDef = { key: "tanggal", label: "Tanggal lembur", contoh: "2026-09-03" };
const PH_JUMLAHJAM: PlaceholderDef = { key: "jumlahJam", label: "Rencana jam lembur", contoh: "3" };

export const EVENT_PLACEHOLDERS: Record<string, PlaceholderDef[]> = {
  "leave.submitted": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_JUMLAHHARI, PH_ALASAN],
  "leave.approved": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_JUMLAHHARI, PH_CATATAN],
  "leave.rejected": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_CATATAN],
  "travel.submitted": [PH_NAMA, PH_DOC, PH_TUJUAN, PH_PERIODE, PH_BIAYA],
  "travel.approved": [PH_NAMA, PH_DOC, PH_TUJUAN, PH_PERIODE, PH_CATATAN],
  "travel.rejected": [PH_NAMA, PH_DOC, PH_TUJUAN, PH_PERIODE, PH_CATATAN],
  "travel.claim.submitted": [PH_NAMA, PH_DOC, PH_JUMLAH, PH_PERIODE],
  "travel.claim.approved": [PH_NAMA, PH_DOC, PH_JUMLAH, PH_PERIODE, PH_CATATAN],
  "travel.claim.rejected": [PH_NAMA, PH_DOC, PH_JUMLAH, PH_PERIODE, PH_CATATAN],
  "overtime.submitted": [PH_NAMA, PH_DOC, PH_TANGGAL, PH_JUMLAHJAM, PH_ALASAN],
  "medical.claim.submitted": [PH_NAMA, PH_DOC, PH_JENIS, PH_JUMLAH],
  "medical.claim.approved": [PH_NAMA, PH_DOC, PH_JENIS, PH_JUMLAH, PH_CATATAN],
  "medical.claim.rejected": [PH_NAMA, PH_DOC, PH_JENIS, PH_JUMLAH, PH_CATATAN],
  "medical.claim.settled": [PH_NAMA, PH_DOC, PH_JENIS, PH_JUMLAH, PH_CATATAN],
  "payroll.run.confirmed": [PH_RUNNO, PH_PERIODE, { ...PH_JUMLAH, label: "Jumlah karyawan dalam run", contoh: "44" }, PH_TOTAL],
  "payroll.run.paid": [PH_RUNNO, PH_PERIODE, PH_TOTAL],
  "payroll.payslip": [PH_NAMA, { ...PH_PERIODE, label: "Nama periode slip gaji", contoh: "AGUSTUS 2026" }, PH_NET, PH_RUNNO],
  "pa.submitted": [PH_NAMA, PH_DOC, PH_JENISAKSI, PH_TGEFF, PH_ALASAN, PH_LAYER, PH_APPROVER],
  "pa.approved": [PH_NAMA, PH_DOC, PH_JENISAKSI, PH_TGEFF, PH_CATATAN],
  "pa.rejected": [PH_NAMA, PH_DOC, PH_JENISAKSI, PH_TGEFF, PH_CATATAN],
  "pa.processed": [PH_NAMA, PH_DOC, PH_JENISAKSI, PH_TGEFF, PH_ALASAN],
  "user.created": [
    { key: "nama", label: "Nama pengguna baru", contoh: "Tri Handayani" },
    { key: "email", label: "Email login akun baru", contoh: "tri@mii.co.id" },
    { key: "password", label: "Kata sandi sementara (sekali tampil)", contoh: "Onevity!2026" },
  ],
  // T14-SCHED: katalog placeholder template pengingat scheduler
  "scheduler.contract-expiry": [PH_NAMA, PH_EMPNO, PH_JENIS_SCHED, PH_DATE, PH_DAYS],
  "scheduler.doc-expiry": [PH_NAMA, PH_EMPNO, PH_DOCTYPE, PH_DOC, PH_DATE, PH_DAYS],
  "scheduler.approval-sla": [PH_DOC, { ...PH_JENIS_SCHED, label: "Jenis dokumen (Cuti/Travel/dsb)", contoh: "Cuti" }, PH_NAMA, PH_APPROVER, PH_LAYER, PH_DAYS],
  "scheduler.payroll-reminder": [PH_PERIODE, PH_CODE, PH_DATE, PH_DAYS],
  // Task 65 — checklist onboarding/offboarding per bagian
  "onboarding.checklist": [
    { key: "bagian", label: "Bagian penerima (IT/GA/dll.)", contoh: "IT" },
    PH_NAMA,
    { key: "employeeNo", label: "Nomor karyawan", contoh: "SAYONE00001" },
    { key: "posisi", label: "Posisi karyawan", contoh: "Staff GA" },
    { key: "unit", label: "Unit organisasi", contoh: "GA & Umum" },
    { key: "tanggal", label: "Tanggal mulai / hari terakhir", contoh: "2026-09-20" },
    { key: "daftarTugas", label: "Daftar tugas bagian", contoh: "1. Siapkan user …" },
    { key: "link", label: "Tautan checklist publik", contoh: "https://…/checklist/…" },
  ],
  "onboarding.completed": [PH_NAMA, { key: "employeeNo", label: "Nomor karyawan", contoh: "SAYONE00001" }, { key: "posisi", label: "Posisi karyawan", contoh: "Staff GA" }, { key: "unit", label: "Unit organisasi", contoh: "GA & Umum" }],
  "offboarding.checklist": [
    { key: "bagian", label: "Bagian penerima (IT/GA/dll.)", contoh: "IT" },
    PH_NAMA,
    { key: "employeeNo", label: "Nomor karyawan", contoh: "SAYONE00001" },
    { key: "posisi", label: "Posisi karyawan", contoh: "Staff GA" },
    { key: "unit", label: "Unit organisasi", contoh: "GA & Umum" },
    { key: "tanggal", label: "Tanggal mulai / hari terakhir", contoh: "2026-09-20" },
    { key: "daftarTugas", label: "Daftar tugas bagian", contoh: "1. Nonaktifkan akun …" },
    { key: "link", label: "Tautan checklist publik", contoh: "https://…/checklist/…" },
  ],
  "offboarding.completed": [PH_NAMA, { key: "employeeNo", label: "Nomor karyawan", contoh: "SAYONE00001" }, { key: "posisi", label: "Posisi karyawan", contoh: "Staff GA" }, { key: "unit", label: "Unit organisasi", contoh: "GA & Umum" }],
};

/** Daftar placeholder untuk event (fallback: kosong — contoh config.test sistem). */
export function placeholdersOf(event: string): PlaceholderDef[] {
  return EVENT_PLACEHOLDERS[event] ?? [];
}
