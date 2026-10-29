// OneVity — TEMPLATE WHATSAPP DEFAULT (Task 28-a) ====================
// =====================================================================
// Sumber tunggal template default kanal WhatsApp (self-heal GET
// /api/onevity/wa-templates — upsert insert-if-missing, event-keyed,
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
    body: "[OneVity] Halo Approver, {{nama}} mengajukan cuti {{jenisCuti}} ({{docNo}}) pada {{periode}}, {{jumlahHari}} hari kerja. Mohon persetujuan di aplikasi OneVity HRIS.",
  },
  {
    event: "leave.approved", label: "Cuti — Disetujui (→ Pengaju)", active: true,
    body: "[OneVity] Halo {{nama}}, permintaan cuti Anda {{docNo}} ({{jenisCuti}}, {{periode}}) telah DISSETUJUI. Catatan: {{catatan}}. Selamat beristirahat!",
  },
  {
    event: "payslip.sent", label: "Payroll — Slip Gaji Terkirim (→ Karyawan)", active: true,
    body: "[OneVity] Halo {{nama}}, slip gaji periode {{periode}} telah dikirim ke email Anda. Take Home Pay: {{net}} (run {{runNo}}). Slip bersifat RAHASIA.",
  },
  {
    event: "letter.requested", label: "Surat — Permintaan Baru (→ Admin/HR)", active: true,
    body: "[OneVity] Halo Admin, {{nama}} mengajukan surat {{jenisSurat}} ({{docNo}}){{keperluan}}. Mohon keputusan di menu Template Surat OneVity HRIS.",
  },
  {
    event: "letter.issued", label: "Surat — Diterbitkan (→ Pengaju)", active: true,
    body: "[OneVity] Halo {{nama}}, permintaan surat Anda {{docNo}} telah DITERBITKAN dengan nomor {{refNo}}. Silakan unduh di menu Surat OneVity HRIS.",
  },
  {
    event: "announcement.published", label: "Pengumuman — Terbit (→ Karyawan)", active: true,
    body: "[OneVity] Pengumuman: {{judul}}. {{ringkas}} Buka aplikasi OneVity untuk membaca selengkapnya.",
  },
  {
    event: "shiftswap.approved", label: "Tukar Shift — Disetujui (→ Kedua Pihak)", active: true,
    body: "[OneVity] Halo {{nama}}, tukar shift {{docNo}} pada {{tanggal}} telah disetujui — jadwal Anda bertukar dengan {{pasangan}}. Terima kasih.",
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

export const WA_EVENT_PLACEHOLDERS: Record<string, WaPlaceholderDef[]> = {
  "leave.submitted": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_JUMLAHHARI],
  "leave.approved": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_CATATAN],
  "payslip.sent": [PH_NAMA, { ...PH_PERIODE, label: "Nama periode slip gaji", contoh: "AGUSTUS 2026" }, PH_NET, PH_RUNNO],
  "letter.requested": [PH_NAMA, PH_JENISSURAT, PH_DOC, PH_KEPERLUAN],
  "letter.issued": [PH_NAMA, PH_DOC, PH_REFNO],
  "announcement.published": [PH_JUDUL, PH_RINGKAS],
  "shiftswap.approved": [PH_NAMA, PH_DOC, PH_TANGGAL, PH_PASANGAN],
};

/** Daftar placeholder untuk event (fallback: kosong). */
export function waPlaceholdersOf(event: string): WaPlaceholderDef[] {
  return WA_EVENT_PLACEHOLDERS[event] ?? [];
}
