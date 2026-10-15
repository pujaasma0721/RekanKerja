// RekanKerja — TEMPLATE WHATSAPP DEFAULT (Task 28-a) ====================
// =====================================================================
// Sumber tunggal template default kanal WhatsApp (self-heal GET
// /api/rekankerja/wa-templates — upsert insert-if-missing, event-keyed,
// edit admin TIDAK pernah ditimpa ulang). Arsitektur menyalin
// email-defaults.ts (Task 34) — hanya body tanpa subjek (WA), pesan
// singkat sopan Bahasa Indonesia, placeholder {{key}}.
// =====================================================================
export interface WaTemplateDefault {
  event: string;
  label: string;
  active: boolean;
  body: string;
}

export const WA_DEFAULT_TEMPLATES: WaTemplateDefault[] = [
  {
    event: "leave.submitted", label: "Cuti — Pengajuan Baru (→ Approver)", active: true,
    body: "[RekanKerja] Halo Approver, {{nama}} mengajukan cuti {{jenisCuti}} ({{docNo}}) pada {{periode}}, {{jumlahHari}} hari kerja. Mohon persetujuan di aplikasi RekanKerja HRIS.",
  },
  {
    event: "leave.approved", label: "Cuti — Disetujui (→ Pengaju)", active: true,
    body: "[RekanKerja] Halo {{nama}}, permintaan cuti Anda {{docNo}} ({{jenisCuti}}, {{periode}}) telah DISSETUJUI. Catatan: {{catatan}}. Selamat beristirahat!",
  },
  {
    event: "payslip.sent", label: "Payroll — Slip Gaji Terkirim (→ Karyawan)", active: true,
    body: "[RekanKerja] Halo {{nama}}, slip gaji periode {{periode}} telah dikirim ke email Anda. Take Home Pay: {{net}} (run {{runNo}}). Slip bersifat RAHASIA.",
  },
  {
    event: "letter.requested", label: "Surat — Permintaan Baru (→ Admin/HR)", active: true,
    body: "[RekanKerja] Halo Admin, {{nama}} mengajukan surat {{jenisSurat}} ({{docNo}}){{keperluan}}. Mohon keputusan di menu Template Surat RekanKerja HRIS.",
  },
  {
    event: "letter.issued", label: "Surat — Diterbitkan (→ Pengaju)", active: true,
    body: "[RekanKerja] Halo {{nama}}, permintaan surat Anda {{docNo}} telah DITERBITKAN dengan nomor {{refNo}}. Silakan unduh di menu Surat RekanKerja HRIS.",
  },
  {
    event: "announcement.published", label: "Pengumuman — Terbit (→ Karyawan)", active: true,
    body: "[RekanKerja] Pengumuman: {{judul}}. {{ringkas}} Buka aplikasi RekanKerja untuk membaca selengkapnya.",
  },
  {
    event: "shiftswap.approved", label: "Tukar Shift — Disetujui (→ Kedua Pihak)", active: true,
    body: "[RekanKerja] Halo {{nama}}, tukar shift {{docNo}} pada {{tanggal}} telah disetujui — jadwal Anda bertukar dengan {{pasangan}}. Terima kasih.",
  },
  {
    // P1-PERF §18.8 (D17) — nudge pengingat formulir kinerja multi-kanal.
    event: "performance.nudge", label: "Kinerja — Pengingat Formulir (→ Atasan/Karyawan)", active: true,
    body: "[RekanKerja] {{title}}. {{body}}",
  },
  // ============ B6-BL — Rekrutmen (DEVELOPMENT-PLAN-BACKLOG.md §4 B6) ============
  // Mitigasi risiko §5 "WA spam pelamar": HANYA event transaksional penting
  // (undangan seleksi + offer + status PR + konfirmasi lamaran + onboarding).
  // OTP e-sign sengaja TIDAK DIBUATKAN template — OTP tidak lewat WhatsApp.
  {
    event: "recruitment.pr.submitted", label: "Rekrutmen — PR Diajukan (→ Approver)", active: true,
    body: "[RekanKerja] Halo Approver, {{nama}} mengajukan permintaan karyawan {{docNo}} — {{posisi}} ({{jumlahOrang}} orang, {{statusKerja}}). Alasan: {{alasan}}. Mohon persetujuan di RekanKerja HRIS.",
  },
  {
    event: "recruitment.pr.approved", label: "Rekrutmen — PR Disetujui (→ Pengaju)", active: true,
    body: "[RekanKerja] Halo {{nama}}, permintaan karyawan {{docNo}} — {{posisi}} ({{jumlahOrang}} orang) telah DISSETUJUI. Catatan: {{catatan}}. Siap diproses tim rekrutmen.",
  },
  {
    event: "recruitment.pr.rejected", label: "Rekrutmen — PR Ditolak (→ Pengaju)", active: true,
    body: "[RekanKerja] Halo {{nama}}, mohon maaf permintaan karyawan {{docNo}} — {{posisi}} DITOLAK. Alasan: {{catatan}}. Silakan hubungi HRD untuk penyesuaian.",
  },
  {
    event: "recruitment.selection.scheduled", label: "Rekrutmen — Tahap Seleksi Dijadwalkan (→ Kandidat/Evaluator)", active: true,
    body: "[RekanKerja] Undangan tahap seleksi — {{tahap}} ({{posisi}}). Kandidat: {{kandidat}}. Jadwal: {{jadwal}}, batas SLA {{batasSla}}. Link meeting: {{linkMeeting}}. Mohon persiapan dan kehadiran tepat waktu. Detail di RekanKerja HRIS.",
  },
  {
    event: "recruitment.selection.reminder", label: "Rekrutmen — Pengingat Tahap Seleksi (→ Kandidat/Evaluator)", active: true,
    body: "[RekanKerja] Pengingat tahap seleksi {{tahap}} ({{posisi}}). Kandidat: {{kandidat}}. Jadwal: {{jadwal}}, batas SLA {{batasSla}}. Link meeting: {{linkMeeting}}. Mohon segera tindak lanjuti di RekanKerja HRIS.",
  },
  {
    event: "recruitment.offer.sent", label: "Rekrutmen — Offer Dikirim (→ Kandidat)", active: true,
    body: "[RekanKerja] Halo {{nama}}, penawaran kerja {{docNo}} — {{posisi}} di {{perusahaan}} telah diterbitkan. Penghasilan {{gaji}}, mulai bekerja {{mulaiKerja}}, berlaku sampai {{berlakuSampai}}. Mohon konfirmasi sebelum batas waktu.",
  },
  {
    event: "recruitment.offer.reminder", label: "Rekrutmen — Pengingat Offer (→ Officer)", active: true,
    body: "[RekanKerja] Halo {{nama}}, pengingat offer {{docNo}} — kandidat {{kandidat}} ({{posisi}}) berstatus {{statusOffer}}, berakhir {{berlakuSampai}} ({{sisaHari}}). Mohon tindak lanjut di RekanKerja HRIS.",
  },
  {
    // A2 brief "SEMUA titik notifyEmailEvent" — offer.responded ikut di-wire
    // agar tidak menulis WaLog Skipped "Template tidak ditemukan".
    event: "recruitment.offer.responded", label: "Rekrutmen — Respons Offer (→ Officer)", active: true,
    body: "[RekanKerja] Halo {{nama}}, kandidat {{kandidat}} merespons offer {{docNo}} ({{posisi}}): {{statusOffer}}. Catatan: {{catatan}}. Mohon tindak lanjut di RekanKerja HRIS.",
  },
  {
    event: "recruitment.appointment.hired", label: "Rekrutmen — Kandidat Resmi Karyawan (→ Karyawan Baru/Officer)", active: true,
    body: "[RekanKerja] {{kandidat}} resmi menjadi karyawan {{employeeNo}} — posisi {{posisi}} (ref offer {{docNo}}). Checklist onboarding telah dibuat otomatis. Selamat bergabung!",
  },
  {
    event: "recruitment.application.received", label: "Rekrutmen — Konfirmasi Lamaran Diterima (→ Pelamar)", active: true,
    body: "[RekanKerja] Halo {{nama}}, lamaran Anda untuk posisi {{posisi}} di {{perusahaan}} telah kami terima ({{tanggal}}). Tim rekrutmen akan meninjau dan menghubungi kandidat yang memenuhi kualifikasi.",
  },
];

/** Label tampil untuk sebuah event (UI — fallback event mentah). */
export function waTemplateLabelOf(event: string): string {
  return WA_DEFAULT_TEMPLATES.find((t) => t.event === event)?.label ?? event;
}

// KATALOG PLACEHOLDER PER-EVENT =========================================
// Sumber kebenaran variabel {{...}} yang BENAR-BENAR dikirim hook tiap
// event (dipakai UI editor template: chip klik-untuk-sisipkan + contoh).
// Placeholder tak terdaftar tetap boleh dipakai — dirender apa adanya.
export interface WaPlaceholderDef { key: string; label: string; contoh: string }

const PH_NAMA: WaPlaceholderDef = { key: "nama", label: "Nama karyawan", contoh: "Yusuf Rahayu" };
const PH_DOC: WaPlaceholderDef = { key: "docNo", label: "Nomor dokumen", contoh: "LR-2026-011" };
const PH_PERIODE: WaPlaceholderDef = { key: "periode", label: "Periode / rentang tanggal", contoh: "2026-10-12 → 2026-10-13" };
const PH_CATATAN: WaPlaceholderDef = { key: "catatan", label: "Catatan approver", contoh: "Disetujui, selamat beristirahat" };
const PH_JENISCUTI: WaPlaceholderDef = { key: "jenisCuti", label: "Nama jenis cuti", contoh: "Cuti Tahunan" };
const PH_JUMLAHHARI: WaPlaceholderDef = { key: "jumlahHari", label: "Jumlah hari kerja", contoh: "2" };
const PH_NET: WaPlaceholderDef = { key: "net", label: "Take Home Pay (Rp)", contoh: "Rp 23.678.526" };
const PH_RUNNO: WaPlaceholderDef = { key: "runNo", label: "Nomor run payroll", contoh: "PR-2026-09-001" };
const PH_JENISSURAT: WaPlaceholderDef = { key: "jenisSurat", label: "Nama jenis surat", contoh: "Surat Keterangan Kerja" };
const PH_KEPERLUAN: WaPlaceholderDef = { key: "keperluan", label: "Keperluan surat", contoh: " — keperluan pengajuan visa" };
const PH_REFNO: WaPlaceholderDef = { key: "refNo", label: "Nomor surat terbitan", contoh: "001/HR-ES/IX/2026" };
const PH_JUDUL: WaPlaceholderDef = { key: "judul", label: "Judul pengumuman", contoh: "Cutoff Payroll September" };
const PH_RINGKAS: WaPlaceholderDef = { key: "ringkas", label: "Ringkasan isi pengumuman", contoh: "Cutoff absensi tanggal 25 — mohon…" };
const PH_TANGGAL: WaPlaceholderDef = { key: "tanggal", label: "Tanggal tukar shift", contoh: "2026-09-10" };
const PH_PASANGAN: WaPlaceholderDef = { key: "pasangan", label: "Nama pasangan tukar shift", contoh: "Dewi Halim" };
// B6-BL — placeholder template rekrutmen (mirror email-defaults PH_*)
const PH_POSISI: WaPlaceholderDef = { key: "posisi", label: "Posisi / jabatan", contoh: "Staff Accounting" };
const PH_JUMLAHORANG: WaPlaceholderDef = { key: "jumlahOrang", label: "Jumlah kebutuhan (orang)", contoh: "2" };
const PH_STATUSKERJA: WaPlaceholderDef = { key: "statusKerja", label: "Status kerja", contoh: "Tetap (Permanent)" };
const PH_ALASAN: WaPlaceholderDef = { key: "alasan", label: "Alasan pengajuan", contoh: "Ekspansi tim" };
const PH_KANDIDAT: WaPlaceholderDef = { key: "kandidat", label: "Nama kandidat", contoh: "Gita Savitri" };
const PH_TAHAP: WaPlaceholderDef = { key: "tahap", label: "Nama tahap seleksi", contoh: "Interview HR" };
const PH_JADWAL: WaPlaceholderDef = { key: "jadwal", label: "Jadwal pelaksanaan tahap", contoh: "20 Oktober 2026 09:00" };
const PH_BATASSLA: WaPlaceholderDef = { key: "batasSla", label: "Batas SLA tahap", contoh: "19 November 2026" };
const PH_LINKMEETING: WaPlaceholderDef = { key: "linkMeeting", label: "Tautan meeting video-call (opsional)", contoh: "https://meet.google.com/abc-defg-hij" };
const PH_PERUSAHAAN: WaPlaceholderDef = { key: "perusahaan", label: "Nama perusahaan", contoh: "PT Mitra Industri Internasional" };
const PH_GAJI: WaPlaceholderDef = { key: "gaji", label: "Gaji final offer (Rp)", contoh: "Rp 8.500.000" };
const PH_MULAIKERJA: WaPlaceholderDef = { key: "mulaiKerja", label: "Tanggal mulai bekerja", contoh: "1 November 2026" };
const PH_BERLAKUSAMPAI: WaPlaceholderDef = { key: "berlakuSampai", label: "Batas offer berlaku", contoh: "24 Oktober 2026" };
const PH_STATUSOFFER: WaPlaceholderDef = { key: "statusOffer", label: "Status offer", contoh: "Sent / DITERIMA / DITOLAK" };
const PH_SISAHARI: WaPlaceholderDef = { key: "sisaHari", label: "Sisa waktu offer", contoh: "2 hari lagi" };
const PH_EMPLOYEENO: WaPlaceholderDef = { key: "employeeNo", label: "Nomor karyawan hasil rekrutmen", contoh: "MII00041" };
const PH_TANGGAL_LAMARAN: WaPlaceholderDef = { key: "tanggal", label: "Tanggal lamaran diterima", contoh: "2026-10-20" };

export const WA_EVENT_PLACEHOLDERS: Record<string, WaPlaceholderDef[]> = {
  "leave.submitted": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_JUMLAHHARI],
  "leave.approved": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_CATATAN],
  "payslip.sent": [PH_NAMA, { ...PH_PERIODE, label: "Nama periode slip gaji", contoh: "AGUSTUS 2026" }, PH_NET, PH_RUNNO],
  "letter.requested": [PH_NAMA, PH_JENISSURAT, PH_DOC, PH_KEPERLUAN],
  "letter.issued": [PH_NAMA, PH_DOC, PH_REFNO],
  "announcement.published": [PH_JUDUL, PH_RINGKAS],
  "shiftswap.approved": [PH_NAMA, PH_DOC, PH_TANGGAL, PH_PASANGAN],
  // B6-BL — rekrutmen (mirror email-defaults EVENT_PLACEHOLDERS)
  "recruitment.pr.submitted": [PH_NAMA, PH_DOC, PH_POSISI, PH_JUMLAHORANG, PH_STATUSKERJA, PH_ALASAN],
  "recruitment.pr.approved": [PH_NAMA, PH_DOC, PH_POSISI, PH_JUMLAHORANG, PH_CATATAN],
  "recruitment.pr.rejected": [PH_NAMA, PH_DOC, PH_POSISI, PH_CATATAN],
  "recruitment.selection.scheduled": [PH_NAMA, PH_DOC, PH_POSISI, PH_KANDIDAT, PH_TAHAP, PH_JADWAL, PH_BATASSLA, PH_LINKMEETING],
  "recruitment.selection.reminder": [PH_NAMA, PH_DOC, PH_POSISI, PH_KANDIDAT, PH_TAHAP, PH_JADWAL, PH_BATASSLA, PH_LINKMEETING],
  "recruitment.offer.sent": [PH_NAMA, PH_DOC, PH_POSISI, PH_PERUSAHAAN, PH_GAJI, PH_MULAIKERJA, PH_BERLAKUSAMPAI],
  "recruitment.offer.reminder": [PH_NAMA, PH_DOC, PH_POSISI, PH_KANDIDAT, PH_STATUSOFFER, PH_BERLAKUSAMPAI, PH_SISAHARI],
  "recruitment.offer.responded": [PH_NAMA, PH_DOC, PH_POSISI, PH_KANDIDAT, PH_STATUSOFFER, PH_CATATAN],
  "recruitment.appointment.hired": [PH_NAMA, PH_KANDIDAT, PH_EMPLOYEENO, PH_POSISI, PH_DOC],
  "recruitment.application.received": [PH_NAMA, PH_POSISI, PH_PERUSAHAAN, PH_TANGGAL_LAMARAN],
};

/** Daftar placeholder untuk event (fallback: kosong). */
export function waPlaceholdersOf(event: string): WaPlaceholderDef[] {
  return WA_EVENT_PLACEHOLDERS[event] ?? [];
}
