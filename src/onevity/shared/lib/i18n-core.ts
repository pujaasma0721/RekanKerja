// OneVity i18n — core state bahasa TANPA React (aman diimpor helper mana pun). ==
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
  "Konfigurasi sistem OneVity": "OneVity system configuration",

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
};
