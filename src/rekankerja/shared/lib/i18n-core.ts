// RekanKerja i18n — core state bahasa TANPA React (aman diimpor helper mana pun). ==
//
// Strategi "teks sumber = Bahasa Indonesia di komponen":
//   · translate("Simpan")                        → ID: "Simpan" | EN: BASE_EN["Simpan"] ?? "Simpan"
//   · translate("Proses {n} karyawan?", "Process {n} employees?", { n: 12 })
//   · Fallback mulus: terjemahan EN tidak ada → teks Indonesia tetap tampil.
//
// State bahasa juga tersimpan module-level (bukan hanya React context) supaya
// helper non-React (fmtDate/fmtIDR/tenure di api.ts) bisa ikut bahasa aktif.
// Provider (i18n.tsx) yang memanggil setGlobalLang saat bahasa berganti.

export type Lang = "id" | "en";

export const LANG_OPTIONS: { id: Lang; label: string; en: string; short: string }[] = [
  { id: "id", label: "Bahasa Indonesia", en: "Indonesian", short: "ID" },
  { id: "en", label: "English", en: "English", short: "EN" },
];

let globalLang: Lang = "id";

export function getLang(): Lang {
  return globalLang;
}

export function setGlobalLang(l: Lang) {
  globalLang = l;
}

export function currentLocale(): "id-ID" | "en-US" {
  return globalLang === "en" ? "en-US" : "id-ID";
}

export const MONTHS_SHORT_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthsShort(): string[] {
  return globalLang === "en" ? MONTHS_SHORT_EN : MONTHS_SHORT_ID;
}

/** Terjemahkan. Argumen 1 = teks Indonesia (sumber kebenaran), argumen 2 = EN opsional. */
export function translate(id: string, en?: string, vars?: Record<string, string | number>): string {
  let out = globalLang === "en" ? (en ?? BASE_EN[id] ?? id) : id;
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m));
  }
  return out;
}

// ============ LOKALISASI NAMA BULAN PADA LABEL DATA ============
// Nama period dsb. disimpan di DB dalam Bahasa Indonesia (mis. "Agustus 2026").
// loc() mengganti nama bulan ID→EN pada label display saat bahasa aktif EN —
// dipakai EKSPLISIT pada titik render label period (bukan data sembarangan).
const MONTH_SWAP: [RegExp, string][] = [
  [/\b[Jj]anuari\b|\bJANUARI\b/g, "January"], [/\b[Ff]ebruari\b|\bFEBRUARI\b/g, "February"],
  [/\b[Mm]aret\b|\bMARET\b/g, "March"], [/\b[Aa]pril\b|\bAPRIL\b/g, "April"],
  [/\b[Mm]ei\b|\bMEI\b/g, "May"], [/\b[Jj]uni\b|\bJUNI\b/g, "June"],
  [/\b[Jj]uli\b|\bJULI\b/g, "July"], [/\b[Aa]gustus\b|\bAGUSTUS\b/g, "August"],
  [/\b[Ss]eptember\b|\bSEPTEMBER\b/g, "September"], [/\b[Oo]ktober\b|\bOKTOBER\b/g, "October"],
  [/\b[Nn]ovember\b|\bNOVEMBER\b/g, "November"], [/\b[Dd]esember\b|\bDESEMBER\b/g, "December"],
  [/\b[Aa]gu\b|\b[Aa]gs\b|\bAGU\b|\bAGS\b/g, "Aug"], [/\b[Oo]kt\b|\bOKT\b/g, "Oct"], [/\b[Dd]es\b|\bDES\b/g, "Dec"],
];
function applyMonthSwap(s: string): string {
  let out = s;
  for (const [re, en] of MONTH_SWAP) {
    out = out.replace(re, (m) => (m === m.toUpperCase() && m.length >= 3 ? en.toUpperCase() : en));
  }
  return out;
}

/** Lokalisasi nama bulan Indonesia→EN pada label display (aman utk null/undefined → ""). */
export function loc(s: string | null | undefined): string {
  if (s == null) return "";
  return globalLang === "en" ? applyMonthSwap(s) : s;
}

// ============ LOKALISASI TEKS SISTEM (activity log & notifikasi) ============
// Task 38: ActivityLog.detail & Notification.title/body ditulis SERVER dalam
// Bahasa Indonesia (data historis di DB). locActivity() menerjemahkan pola
// frasa sistem saat bahasa EN aktif — pengganti frasa TERPANJANG dulu; bagian
// yang tak dikenal tetap tampil Indonesia (fallback mulus, spt translate()).
// Hanya dipakai utk teks SISTEM — jangan utk konten user (pengumuman dsb.).

const ACTIVITY_PHRASES: [string, string][] = [
  // — surat & dokumen (frasa panjang dulu; urutan final di-sort by length) —
  ["Surat Keterangan Pengalaman Kerja", "Work Experience Certificate"],
  ["Surat Keterangan Kerja", "Employment Certificate"],
  ["Surat Keterangan Gaji", "Salary Certificate"],
  ["Surat Peringatan (SP)", "Warning Letter (SP)"],
  ["Permintaan surat", "Letter request"],
  ["Permintaan surat baru", "New letter request"],
  ["Permintaan Masuk", "Incoming Requests"],
  ["siap diunduh di menu", "ready to download from the"],
  ["siap diunduh", "ready to download"],
  ["meminta", "requests"],
  ["Buka", "Open"],
  ["Referensi Kerja", "Reference"],
  ["mengunduh PDF surat", "downloaded letter PDF"],
  ["Unduh PDF surat", "Download letter PDF"],
  ["dokumen lengkap", "documents complete"],
  ["Surat", "Letter"],
  ["Dokumen", "Document"],
  // — Task 52-e: audit trail akses baca profil (UU PDP 27/2022) —
  ["Melihat detail karyawan", "Viewed employee profile"],
  ["cakupan PII", "PII scope"],
  ["Viewed", "Melihat"],
  ["penuh", "full"],
  // — notifikasi scheduler —
  ["menunggu persetujuan Anda", "awaiting your approval"],
  ["menunggu persetujuan atasan", "awaiting supervisor approval"],
  ["menunggu keputusan jenjang", "awaiting decision at tier"],
  ["approver terakhir", "final approver"],
  ["kedaluwarsa", "expiring"],
  ["berakhir", "ends"],
  ["hari lagi", "days left"],
  ["menunggu", "pending"],
  ["Kontrak", "Contract"],
  ["evaluasi", "evaluation"],
  ["gajian", "payday"],
  ["notifikasi", "notifications"],
  ["terkirim", "sent"],
  ["Dokumen Anda", "Your document"],
  // — aturan diferensiasi (Task 32–37) —
  ["Aturan diferensiasi", "Differentiation rule"],
  ["utk Jenis Benefit Medis", "for medical benefit type"],
  ["utk Jenis Biaya Travel", "for travel expense type"],
  ["utk Jenis Cuti", "for leave type"],
  ["utk komponen", "for component"],
  ["kondisi", "conditions"],
  // — payroll / ekspor / jurnal —
  ["Ekspor format upload BPJS Ketenagakerjaan (Laporan Kepegawaian)", "BPJS Employment (Employment Report) upload export"],
  ["Ekspor format upload BPJS Kesehatan (Data Peserta)", "BPJS Health (Participant Data) upload export"],
  ["Ekspor laporan kustom", "Custom report export"],
  ["Ekspor e-SPT", "e-SPT export"],
  ["Data payroll karyawan diperbarui", "Employee payroll data updated"],
  ["Export Excel direktori", "Directory Excel export"],
  ["otomatis dibuat dari run", "auto-created from run"],
  ["dibuat dari run", "created from run"],
  ["dihitung otomatis", "calculated automatically"],
  ["Laporan kustom baru", "New custom report"],
  ["Laporan kustom", "Custom report"],
  ["laporan tersimpan", "saved report"],
  ["total pajak", "total tax"],
  ["karyawan aktif", "active employees"],
  ["cakupan penuh", "full scope"],
  ["pegawai", "employees"],
  ["peserta", "participants"],
  ["Jurnal", "Journal"],
  ["jurnal", "journal"],
  ["karyawan", "employees"],
  ["baris", "rows"],
  ["jenjang", "tier"],
  ["Ekspor", "Export"],
  // — medis —
  ["Generate saldo medis", "Medical balance generation"],
  ["saldo medis", "medical balances"],
  ["Penyesuaian medis", "Medical adjustment"],
  ["Klaim medis", "Medical claim"],
  ["dikoreksi", "corrected"],
  ["diselesaikan", "settled"],
  ["nilai disetujui", "approved value"],
  // — pengumuman / template WA / laporan —
  ["Pengumuman baru", "New announcement"],
  ["Pengumuman", "Announcement"],
  ["diterbitkan ke seluruh ESS", "published to all ESS"],
  ["terbit langsung", "published immediately"],
  ["Template WhatsApp", "WhatsApp template"],
  ["Konfigurasi WhatsApp", "WhatsApp configuration"],
  ["isi pesan diubah", "message body edited"],
  // — aset / offboarding / tukar shift —
  ["ditugaskan kepada Anda", "assigned to you"],
  ["Pengembalian aset", "Asset return"],
  ["Permintaan tukar shift", "Shift swap request"],
  ["Tukar shift", "Shift swap"],
  ["Tugas clearance", "Clearance task"],
  ["Aset", "Asset"],
  ["tercatat", "recorded"],
  // — verba umum (terpanjang dulu di-sort; caps & lowercase) —
  ["dibatalkan pemohon", "cancelled by requester"],
  ["diajukan dari ESS", "submitted from ESS"],
  ["dilewati (assignment sudah ada)", "skipped (assignment already exists)"],
  ["Import mesin absen", "Attendance machine import"],
  ["log disisipkan", "logs inserted"],
  ["Disetujui", "Approved"],
  ["Ditolak", "Rejected"],
  ["Dibatalkan", "Cancelled"],
  ["Dikembalikan", "Returned"],
  ["dihapus", "deleted"],
  ["dibuat", "created"],
  ["diubah", "changed"],
  ["diperbarui", "updated"],
  ["dikonfirmasi", "confirmed"],
  ["dihitung", "calculated"],
  ["diterbitkan", "issued"],
  ["disetujui", "approved"],
  ["ditolak", "rejected"],
  ["dibatalkan", "cancelled"],
  ["dikembalikan", "returned"],
  ["diajukan", "submitted"],
  ["diaktifkan", "enabled"],
  ["dinonaktifkan", "disabled"],
  ["ditugaskan", "assigned"],
  ["dilewati", "skipped"],
  ["disisipkan", "inserted"],
  ["duplikat", "duplicates"],
  ["tak dikenal", "unknown"],
  ["tak valid", "invalid"],
  ["oleh", "by"],
  ["keperluan", "purpose"],
  ["Pengajuan cuti", "Leave request"],
  ["buka rincian gaji Anda di portal ESS", "open your payslip details in the ESS portal"],
  ["Slip gaji", "Payslip"],
  ["Perjalanan dinas", "Business travel"],
  ["Jam Kantor", "Office Hours"],
  ["Klaim", "Claim"],
  ["klaim", "claim"],
  ["Selesai", "Done"],
  ["ATAU", "OR"],
  ["DAN", "AND"],
  ["tersedia", "available"],
  ["pada", "on"],
  ["dari", "from"],
  ["dengan", "with"],
  ["sejak", "since"],
  ["tahun", "year"],
  ["hari", "days"],
  ["gaji", "salary"],
  ["cuti", "leave"],
  ["baru", "new"],
  ["jenis", "types"],
];

/** Frasa diurut TERPANJANG-DULU sekali di init (hindari kecocokan parsial). */
const ACTIVITY_PHRASES_SORTED = [...ACTIVITY_PHRASES].sort(
  (a, b) => b[0].length - a[0].length,
);

/** Terjemahkan best-effort teks sistem (activity/notifikasi) saat EN aktif. */
export function locActivity(s: string | null | undefined): string {
  if (s == null) return "";
  if (globalLang !== "en") return s;
  let out = applyMonthSwap(s); // nama bulan ID→EN dulu (mis. "Slip gaji AGUSTUS 2026")
  for (const [id, en] of ACTIVITY_PHRASES_SORTED) {
    if (out.includes(id)) out = out.split(id).join(en);
  }
  return out;
}

// ============ KAMUS DASAR (istilah umum + seluruh label navigasi shell) ============
// Dipakai via t("…") TANPA argumen en. String spesifik modul memakai t("…", "…") inline.
export const BASE_EN: Record<string, string> = {
  // — meta modul (desc & short) —
  "Inti administrasi karyawan": "Core employee administration",
  "Periode, proses & kepatuhan pajak": "Periods, runs & tax compliance",
  "Jadwal, clocking & lembur": "Schedules, clocking & overtime",
  "Saldo, permintaan & persetujuan": "Balances, requests & approvals",
  "Perjalanan dinas & settlement": "Business travel & settlement",
  "Benefit & klaim kesehatan": "Health benefits & claims",
  "Absensi": "Attendance",
  "Cuti": "Leave",
  "Medis": "Medical",
  "Pengaturan": "Settings",
  "Pengaturan Sistem": "System Settings",
  "Konfigurasi sistem RekanKerja": "RekanKerja system configuration",

  // — navigasi HR —
  "Perusahaan & Organisasi": "Company & Organization",
  "Perusahaan": "Company",
  "Kantor & Lokasi Kerja": "Offices & Work Locations",
  "Unit Organisasi": "Organizational Units",
  "Peta Organisasi": "Organization Chart",
  "Posisi & Jabatan": "Positions & Jobs",
  "Daftar Posisi": "Position List",
  "Katalog Jabatan": "Job Catalog",
  "Grade & Level": "Grades & Levels",
  "Level Jabatan": "Job Levels",
  "Direktori Karyawan": "Employee Directory",
  "Onboarding Karyawan": "Employee Onboarding",
  "Catatan Disiplin": "Disciplinary Records",
  "Pengajuan & Persetujuan": "Requests & Approvals",
  "Menunggu Persetujuan": "Pending Approvals",
  "Semua Pengajuan": "All Requests",

  // — navigasi Payroll —
  "Ringkasan": "Overview",
  "Periode & Proses": "Periods & Processing",
  "Periode Payroll": "Payroll Periods",
  "Proses & Hasil": "Runs & Results",
  "Master Data": "Master Data",
  "Komponen Upah": "Wage Components",
  "Template Upah": "Wage Templates",
  "Data Gaji Karyawan": "Employee Payroll Data",
  "Transaksi": "Transactions",
  "Transaksi & Rapel": "Transactions & Retro Pay",
  "Benefit Karyawan": "Employee Benefits",
  "Laporan Tahunan": "Annual Reports",
  "SPT & Pajak (1721-A1)": "SPT & Tax (1721-A1)",
  "Parameter": "Parameters",
  "Parameter Pajak": "Tax Parameters",
  "Akun & Posting": "Accounts & Posting",
  "Jurnal Payroll": "Payroll Journals",

  // — navigasi Attendance —
  "Jadwal & Shift": "Schedules & Shifts",
  "Template Jadwal": "Schedule Templates",
  "Assign Jadwal": "Schedule Assignment",
  "Matriks Jadwal": "Schedule Matrix",
  "Kehadiran": "Attendance",
  "Data Clocking": "Clocking Data",
  "Absensi & Izin": "Absence & Permits",
  "Lembur (Overtime)": "Overtime",

  // — navigasi Leave —
  "Cuti Karyawan": "Employee Leave",
  "Informasi Cuti (Saldo)": "Leave Balances",
  "Permintaan Cuti": "Leave Requests",
  "Persetujuan": "Approvals",
  "Cuti Massal (SKB)": "Mass Leave (SKB)",
  "Pengaturan & Integrasi": "Settings & Integration",
  "Jenis Cuti": "Leave Types",
  "Uang Pengganti Cuti": "Leave Encashment",
  "Laporan Cuti": "Leave Reports",

  // — navigasi Travel —
  "Perjalanan Dinas": "Business Travel",
  "Permintaan Travel": "Travel Requests",
  "Klaim & Settlement": "Claims & Settlement",
  "Approval Klaim & Transfer": "Claim & Transfer Approval",
  "Budget Travel": "Travel Budget",
  "Master & Laporan": "Master & Reports",
  "Master Travel": "Travel Master",
  "Laporan Travel": "Travel Reports",

  // — navigasi Medical —
  "Benefit Medis": "Medical Benefits",
  "Saldo Medis Karyawan": "Employee Medical Balances",
  "Klaim Medis": "Medical Claims",
  "Persetujuan & Settlement": "Approval & Settlement",
  "Penyesuaian Saldo": "Balance Adjustments",
  "Jenis Benefit": "Benefit Types",
  "Rumah Sakit & Asuransi": "Hospitals & Insurance",
  "Laporan Medis": "Medical Reports",

  // — navigasi Settings —
  "Keamanan & Akses": "Security & Access",
  "Approval Berjenjang": "Tiered Approvals",
  "Konfigurasi Email": "Email Configuration",
  "Log Aktivitas": "Activity Log",
  // — navigasi HR lanjutan (Task 38: label menu yang belum tercakup) —
  "Dokumen Karyawan": "Employee Documents",
  "Aset Karyawan": "Employee Assets",
  "Offboarding Karyawan": "Employee Offboarding",
  "Dokumen & Surat": "Documents & Letters",
  "Template Surat": "Letter Templates",
  "Komunikasi": "Communication",
  "Pengumuman": "Announcements",
  "Laporan": "Reports",
  "Laporan HR": "HR Reports",
  "Laporan Kustom": "Custom Reports",
  // — navigasi Attendance lanjutan —
  "Kalender Libur": "Holiday Calendar",
  "Papan Kehadiran": "Attendance Board",
  "Tukar Shift": "Shift Swap",
  "Import Mesin Absen": "Attendance Machine Import",
  // — navigasi Settings lanjutan —
  "Data Master": "Master Data",
  "Notifikasi WhatsApp": "WhatsApp Notifications",
  "API & Integrasi": "API & Integrations",

  // — quick create shell —
  "Proses Payroll": "Run Payroll",
  "Pengajuan Karyawan": "Employee Requests",
  "Posisi Baru": "New Position",

  // — tombol & aksi umum —
  "Simpan": "Save",
  "Menyimpan…": "Saving…",
  "Batal": "Cancel",
  "Tutup": "Close",
  "Hapus": "Delete",
  "Ubah": "Edit",
  "Tambah": "Add",
  "Baru": "New",
  "Buat Baru": "Create New",
  "Buat": "Create",
  "Kembali": "Back",
  "Lanjut": "Continue",
  "Sebelumnya": "Previous",
  "Berikutnya": "Next",
  "Selesai": "Done",
  "Cari": "Search",
  "Mencari…": "Searching…",
  "Filter": "Filter",
  "Reset": "Reset",
  "Terapkan": "Apply",
  "Segarkan": "Refresh",
  "Muat Ulang": "Reload",
  "Unduh": "Download",
  "Unggah": "Upload",
  "Salin": "Copy",
  "Konfirmasi": "Confirm",
  "Ya": "Yes",
  "Tidak": "No",
  "Lihat": "View",
  "Detail": "Details",
  "Pilih": "Select",
  "Semua": "All",
  "Buka": "Open",

  // — label kolom & istilah umum —
  "Nama": "Name",
  "Nama Lengkap": "Full Name",
  "Status": "Status",
  "Tanggal": "Date",
  "Aksi": "Actions",
  "Catatan": "Notes",
  "Keterangan": "Description",
  "Karyawan": "Employee",
  "Aktif": "Active",
  "Nonaktif": "Inactive",
  "Berhasil": "Success",
  "Gagal": "Failed",
  "Total": "Total",
  "Jumlah": "Amount",
  "Kode": "Code",
  "Tipe": "Type",
  "Jenis": "Type",
  "Departemen": "Department",
  "Jabatan": "Job Title",
  "Posisi": "Position",
  "Grade": "Grade",
  "Level": "Level",
  "Gaji": "Salary",
  "Gaji Pokok": "Base Salary",
  "Email": "Email",
  "Telepon": "Phone",
  "Alamat": "Address",
  "Periode": "Period",
  "Bulan": "Month",
  "Tahun": "Year",
  "Hari": "Day",
  "Jam": "Hour",
  "Menit": "Minute",
  "Kata Sandi": "Password",
  "Ganti Kata Sandi": "Change Password",
  "Ganti Sandi": "Change Password",
  "Keluar": "Log out",
  "Masuk": "Log in",
  "Memuat…": "Loading…",
  "Tidak ada data": "No data",
  "Beranda": "Home",
  "Navigasi": "Navigation",

  // — status umum —
  "Draft": "Draft",
  "Disetujui": "Approved",
  "Ditolak": "Rejected",
  "Menunggu": "Pending",
  "Diproses": "Processed",
  "Dibatalkan": "Cancelled",

  // — laporan HR & misc (Task 38) —
  "Komposisi Gender": "Gender Composition",
  "Divisi": "Division",
  "Laporan belum tersedia": "Report not yet available",
  "Cuti Massal": "Mass Leave",
  "Berjalan": "Ongoing",
  "Kedaluwarsa": "Expired",
  "Terbit": "Published",
  "Demografi": "Demographics",
  "Distribusi Tenure": "Tenure Distribution",
  "Distribusi Usia": "Age Distribution",
  "Rata-rata": "Average",
  "Kunci (prefix)": "Key (prefix)",
};
