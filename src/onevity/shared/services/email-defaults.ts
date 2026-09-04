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
    event: "user.created", label: "Pengguna Baru Dibuat", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Akun OneVity HRIS Anda telah dibuat",
    body: "Halo {{nama}},\n\nAkun Anda untuk aplikasi OneVity HRIS telah dibuat:\n- Email login: {{email}}\n- Kata sandi sementara: {{password}}\n\nSegera login dan ganti kata sandi Anda. Kata sandi sementara hanya ditampilkan sekali.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.",
  },
];

/** Label tampil untuk sebuah event (UI). */
export function templateLabelOf(event: string): string {
  return DEFAULT_TEMPLATES_PLACEHOLDER.find((t) => t.event === event)?.label ?? event;
}
