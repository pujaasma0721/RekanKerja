// HR-BASE-FULL (Task 60) — definisi statis dataset lengkap ==================
// ===========================================================================
// Dipakai scripts/migrate-hr-base-full.ts (parity step "hr-base-full").
// Target: MII (tenant demo flagship) — 500 karyawan, 30 unit organisasi,
// 50 posisi, 20 kantor, 30 lokasi kerja + data turunan lengkap.
// Semua kode unik (insert-if-missing); angka realistis industri manufaktur.

// ---------- 20 KANTOR PERUSAHAAN (OFF-*) ----------
// 3 pertama = existing (OFF-HO, OFF-PLG, OFF-SBY) — hanya NPWP dilengkapi.
export type OfficeDef = {
  code: string; name: string; city: string; address: string; phone: string; npwp: string;
};

export const NEW_OFFICES: OfficeDef[] = [
  { code: "OFF-BDG", name: "Cabang Bandung", city: "Bandung", address: "Jl. Asia Afrika No. 88, Bandung Kota", phone: "022-4215566", npwp: "02.345.678.9-011.000" },
  { code: "OFF-SMG", name: "Cabang Semarang", city: "Semarang", address: "Jl. Pandanaran No. 112, Semarang Tengah", phone: "024-3548899", npwp: "02.456.789.0-012.000" },
  { code: "OFF-YOG", name: "Cabang Yogyakarta", city: "Yogyakarta", address: "Jl. Malioboro No. 45, Gedongtengen", phone: "0274-512233", npwp: "02.567.890.1-013.000" },
  { code: "OFF-MDN", name: "Cabang Medan", city: "Medan", address: "Jl. Gatot Subroto Km 5,5 No. 21, Medan Baru", phone: "061-4521177", npwp: "03.678.901.2-014.000" },
  { code: "OFF-PLM", name: "Cabang Palembang", city: "Palembang", address: "Jl. Sudirman No. 149, Ilir Barat I", phone: "0711-354466", npwp: "04.789.012.3-015.000" },
  { code: "OFF-DPS", name: "Cabang Denpasar", city: "Denpasar", address: "Jl. Teuku Umar No. 190, Denpasar Barat", phone: "0361-472889", npwp: "05.890.123.4-016.000" },
  { code: "OFF-MKS", name: "Cabang Makassar", city: "Makassar", address: "Jl. Ahmad Yani No. 67, Ujung Pandang", phone: "0411-365777", npwp: "06.901.234.5-017.000" },
  { code: "OFF-BKS", name: "Kantor Bekasi", city: "Bekasi", address: "Jl. Ahmad Yani No. 12, Bekasi Selatan", phone: "021-8844100", npwp: "01.345.678.0-018.000" },
  { code: "OFF-TNG", name: "Kantor Tangerang", city: "Tangerang", address: "Jl. Jenderal Sudirman No. 33, Tangerang Kota", phone: "021-5523344", npwp: "01.456.789.1-019.000" },
  { code: "OFF-DPK", name: "Kantor Depok", city: "Depok", address: "Jl. Margonda Raya No. 55, Beji", phone: "021-7540099", npwp: "01.567.890.2-020.000" },
  { code: "OFF-BGR", name: "Kantor Bogor", city: "Bogor", address: "Jl. Raya Pajajaran No. 26, Bogor Tengah", phone: "0251-321100", npwp: "01.678.901.3-021.000" },
  { code: "OFF-BTM", name: "Gudang Batam", city: "Batam", address: "Kawasan Industri Batamindo, Muka Kuning, Batam", phone: "0778-712885", npwp: "07.012.345.6-022.000" },
  { code: "OFF-PKU", name: "Cabang Pekanbaru", city: "Pekanbaru", address: "Jl. Soekarno Hatta No. 90, Simpang Tiga", phone: "0761-67455", npwp: "08.123.456.7-023.000" },
  { code: "OFF-BPN", name: "Cabang Balikpapan", city: "Balikpapan", address: "Jl. Jenderal Sudirman No. 78, Klandasan", phone: "0542-778899", npwp: "09.234.567.8-024.000" },
  { code: "OFF-PNK", name: "Cabang Pontianak", city: "Pontianak", address: "Jl. Gajah Mada No. 119, Pontianak Kota", phone: "0561-743322", npwp: "10.345.678.9-025.000" },
  { code: "OFF-MDO", name: "Cabang Manado", city: "Manado", address: "Jl. Sam Ratulangi No. 54, Wenang", phone: "0431-854466", npwp: "11.456.789.0-026.000" },
  { code: "OFF-BLJ", name: "Cabang Bandar Lampung", city: "Bandar Lampung", address: "Jl. Raden Intan No. 30, Tanjungkarang", phone: "0721-701122", npwp: "12.567.890.1-027.000" },
];

// NPWP untuk kantor existing (null saat ini) — dilengkapi.
export const EXISTING_OFFICE_NPWP: Record<string, string> = {
  "OFF-HO": "01.234.567.8-901.000",
  "OFF-PLG": "01.234.567.8-902.000",
  "OFF-SBY": "02.123.456.7-903.000",
};

// ---------- 30 LOKASI KERJA (LOC-*) ----------
// 6 existing (2 sudah ber-geofence); 4 existing dilengkapi city+koordinat.
export type LocDef = {
  code: string; name: string; city: string; officeCode: string;
  address?: string; latitude: number; longitude: number; radiusMeters: number;
};

/** Pelengkapan 4 lokasi existing yang belum ada kota/koordinat (area pabrik Pulogadung). */
export const EXISTING_LOC_FILL: Record<string, { city: string; latitude: number; longitude: number; radiusMeters: number }> = {
  "LOC-PRD-A": { city: "Jakarta Timur", latitude: -6.2568, longitude: 106.865, radiusMeters: 150 },
  "LOC-PRD-B": { city: "Jakarta Timur", latitude: -6.2572, longitude: 106.8646, radiusMeters: 150 },
  "LOC-WH": { city: "Jakarta Timur", latitude: -6.2579, longitude: 106.8658, radiusMeters: 200 },
  "LOC-QC": { city: "Jakarta Timur", latitude: -6.2565, longitude: 106.8642, radiusMeters: 100 },
};

export const NEW_LOCATIONS: LocDef[] = [
  // area pabrik Pulogadung (OFF-PLG)
  { code: "LOC-PRD-C", name: "Production Line C", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.2574, longitude: 106.8649, radiusMeters: 150 },
  { code: "LOC-PRD-D", name: "Production Line D", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.2578, longitude: 106.8655, radiusMeters: 150 },
  { code: "LOC-PKG", name: "Area Packaging", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.2582, longitude: 106.8661, radiusMeters: 180 },
  { code: "LOC-WH2", name: "Gudang Bahan Baku", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.2586, longitude: 106.8666, radiusMeters: 220 },
  { code: "LOC-WH3", name: "Gudang Barang Jadi", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.259, longitude: 106.867, radiusMeters: 220 },
  { code: "LOC-MTN", name: "Workshop Maintenance", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.2562, longitude: 106.8639, radiusMeters: 120 },
  { code: "LOC-PWR", name: "Power House & Utilities", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.2583, longitude: 106.8635, radiusMeters: 100 },
  { code: "LOC-SEC", name: "Pos Keamanan Gerbang Utama", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.2558, longitude: 106.8667, radiusMeters: 80 },
  { code: "LOC-CAN", name: "Kantor & Fasilitas Pabrik", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.2561, longitude: 106.8648, radiusMeters: 130 },
  { code: "LOC-TRN", name: "Training Center", city: "Jakarta Timur", officeCode: "OFF-PLG", latitude: -6.2555, longitude: 106.8656, radiusMeters: 90 },
  // kantor cabang
  { code: "LOC-BDG", name: "Kantor Cabang Bandung", city: "Bandung", officeCode: "OFF-BDG", latitude: -6.9219, longitude: 107.6075, radiusMeters: 200 },
  { code: "LOC-SMG", name: "Kantor Cabang Semarang", city: "Semarang", officeCode: "OFF-SMG", latitude: -6.9883, longitude: 110.4173, radiusMeters: 200 },
  { code: "LOC-YOG", name: "Kantor Cabang Yogyakarta", city: "Yogyakarta", officeCode: "OFF-YOG", latitude: -7.7971, longitude: 110.3678, radiusMeters: 200 },
  { code: "LOC-MDN", name: "Kantor Cabang Medan", city: "Medan", officeCode: "OFF-MDN", latitude: 3.5889, longitude: 98.6667, radiusMeters: 200 },
  { code: "LOC-PLM", name: "Kantor Cabang Palembang", city: "Palembang", officeCode: "OFF-PLM", latitude: -2.9803, longitude: 104.7567, radiusMeters: 200 },
  { code: "LOC-DPS", name: "Kantor Cabang Denpasar", city: "Denpasar", officeCode: "OFF-DPS", latitude: -8.6644, longitude: 115.2078, radiusMeters: 200 },
  { code: "LOC-MKS", name: "Kantor Cabang Makassar", city: "Makassar", officeCode: "OFF-MKS", latitude: -5.1426, longitude: 119.4337, radiusMeters: 200 },
  { code: "LOC-BKS", name: "Kantor Bekasi", city: "Bekasi", officeCode: "OFF-BKS", latitude: -6.2383, longitude: 106.9755, radiusMeters: 180 },
  { code: "LOC-TNG", name: "Kantor Tangerang", city: "Tangerang", officeCode: "OFF-TNG", latitude: -6.1731, longitude: 106.6628, radiusMeters: 180 },
  { code: "LOC-DPK", name: "Kantor Depok", city: "Depok", officeCode: "OFF-DPK", latitude: -6.3728, longitude: 106.8297, radiusMeters: 180 },
  { code: "LOC-BGR", name: "Kantor Bogor", city: "Bogor", officeCode: "OFF-BGR", latitude: -6.5955, longitude: 106.8056, radiusMeters: 180 },
  { code: "LOC-BTM", name: "Gudang Batamindo", city: "Batam", officeCode: "OFF-BTM", latitude: 1.0456, longitude: 104.0305, radiusMeters: 400 },
  { code: "LOC-PKU", name: "Kantor Cabang Pekanbaru", city: "Pekanbaru", officeCode: "OFF-PKU", latitude: 0.5211, longitude: 101.4393, radiusMeters: 200 },
  { code: "LOC-BPN", name: "Kantor Cabang Balikpapan", city: "Balikpapan", officeCode: "OFF-BPN", latitude: -1.2411, longitude: 116.8539, radiusMeters: 200 },
  { code: "LOC-PNK", name: "Kantor Cabang Pontianak", city: "Pontianak", officeCode: "OFF-PNK", latitude: -0.0263, longitude: 109.3425, radiusMeters: 200 },
  { code: "LOC-MDO", name: "Kantor Cabang Manado", city: "Manado", officeCode: "OFF-MDO", latitude: 1.4777, longitude: 124.8284, radiusMeters: 200 },
  { code: "LOC-BLJ", name: "Kantor Cabang Bandar Lampung", city: "Bandar Lampung", officeCode: "OFF-BLJ", latitude: -5.4274, longitude: 105.2601, radiusMeters: 200 },
  { code: "LOC-MLG", name: "Kantor Cabang Malang", city: "Malang", officeCode: "OFF-SBY", latitude: -7.9802, longitude: 112.6316, radiusMeters: 200 },
];

// ---------- 30 UNIT ORGANISASI (18 existing + 12 baru) ----------
export type OrgDef = { code: string; name: string; parentCode: string; level: number; headcountBudget: number };

export const NEW_ORG_UNITS: OrgDef[] = [
  { code: "MII-HRD-TND", name: "Training & Development", parentCode: "MII-HRD", level: 4, headcountBudget: 6 },
  { code: "MII-FIN-PAY", name: "Payroll & Disbursement", parentCode: "MII-FIN", level: 4, headcountBudget: 5 },
  { code: "MII-FIN-TRX", name: "Treasury & Cash Management", parentCode: "MII-FIN", level: 4, headcountBudget: 4 },
  { code: "MII-PRD-PKG", name: "Packaging", parentCode: "MII-PRD", level: 4, headcountBudget: 48 },
  { code: "MII-PRD-WH", name: "Warehouse & Distribution", parentCode: "MII-PRD", level: 4, headcountBudget: 42 },
  { code: "MII-PRD-PLN", name: "Production Planning & Control", parentCode: "MII-PRD", level: 4, headcountBudget: 10 },
  { code: "MII-MKT-EXP", name: "Export Sales", parentCode: "MII-MKT", level: 4, headcountBudget: 12 },
  { code: "MII-MKT-CSR", name: "Customer Service", parentCode: "MII-MKT", level: 4, headcountBudget: 9 },
  { code: "MII-ITD-HLP", name: "IT Support & Helpdesk", parentCode: "MII-ITD", level: 4, headcountBudget: 14 },
  { code: "MII-ITD-DBA", name: "Data & Enterprise Systems", parentCode: "MII-ITD", level: 4, headcountBudget: 16 },
  { code: "MII-QAD-ENG", name: "QA Engineering & Audit", parentCode: "MII-QAD", level: 4, headcountBudget: 9 },
  { code: "MII-QAD-LAB", name: "Laboratory & Calibration", parentCode: "MII-QAD", level: 4, headcountBudget: 14 },
];

/** Bump headcountBudget divisi (mencerminkan ekspansi 42 → 500 karyawan). */
export const ORG_BUDGET_UPDATE: Record<string, number> = {
  "MII-MGT": 6,
  "MII-HRD": 26, "MII-FIN": 19, "MII-PRD": 175, "MII-MKT": 32,
  "MII-ITD": 21, "MII-QAD": 20, "MII-CEO": 1,
  // sub-unit existing ikut disesuaikan
  "MII-HRD-RC": 6, "MII-HRD-CB": 5, "MII-HRD-GA": 14,
  "MII-FIN-ACC": 12, "MII-FIN-TAX": 6,
  "MII-PRD-ASSY": 96, "MII-PRD-QC": 34, "MII-PRD-MAINT": 38,
  "MII-MKT-DIG": 15, "MII-MKT-RTL": 20,
};

// ---------- KATALOG JABATAN (16 existing + 26 baru) ----------
export type JobDef = { code: string; title: string; category: string; description: string };

export const NEW_JOBS: JobDef[] = [
  { code: "J-LDL", title: "Line Leader", category: "Supervisory", description: "Pemimpin lini produksi per shift" },
  { code: "J-TECH", title: "Maintenance Technician", category: "Staff", description: "Perawatan mekanik mesin produksi" },
  { code: "J-ELEC", title: "Electrical Technician", category: "Staff", description: "Instalasi & perawatan kelistrikan pabrik" },
  { code: "J-PPCO", title: "Packaging Operator", category: "Staff", description: "Operasi mesin pengemasan produk" },
  { code: "J-FORK", title: "Forklift Operator", category: "Staff", description: "Pengangkutan material gudang dengan forklift" },
  { code: "J-WHSW", title: "Warehouse Staff", category: "Staff", description: "Penerimaan, penyimpanan & pengeluaran barang" },
  { code: "J-DRIV", title: "Driver", category: "Staff", description: "Pengemudi kendaraan operasional perusahaan" },
  { code: "J-PPC", title: "Production Planner", category: "Supervisory", description: "Perencanaan jadwal & kapasitas produksi" },
  { code: "J-PPCS", title: "Production Planning Staff", category: "Staff", description: "Administrasi perencanaan produksi" },
  { code: "J-QCI", title: "QC Inspector", category: "Staff", description: "Inspeksi kualitas produk in-line & akhir" },
  { code: "J-LABA", title: "Lab Analyst", category: "Staff", description: "Analisis sampel laboratorium kualitas" },
  { code: "J-CALB", title: "Calibration Technician", category: "Staff", description: "Kalibrasi alat ukur laboratorium & produksi" },
  { code: "J-QAEN", title: "QA Engineer", category: "Supervisory", description: "Pengembangan sistem mutu & audit internal" },
  { code: "J-HELP", title: "IT Support Staff", category: "Staff", description: "Dukungan teknis pengguna & perangkat IT" },
  { code: "J-ERPA", title: "ERP Administrator", category: "Staff", description: "Administrasi sistem ERP & master data" },
  { code: "J-DATA", title: "Data Analyst", category: "Supervisory", description: "Analitik data operasional & dashboard" },
  { code: "J-NETW", title: "Network Engineer", category: "Supervisory", description: "Pengelolaan infrastruktur jaringan" },
  { code: "J-SALE", title: "Sales Executive", category: "Supervisory", description: "Penjualan produk ke pelanggan korporat" },
  { code: "J-TELE", title: "Telemarketing Officer", category: "Staff", description: "Penjualan melalui telepon & kanal digital" },
  { code: "J-EXPS", title: "Export Staff", category: "Staff", description: "Administrasi ekspor & dokumentasi kepabeanan" },
  { code: "J-CSRO", title: "Customer Service Officer", category: "Staff", description: "Layanan pelanggan & penanganan komplain" },
  { code: "J-MERC", title: "Merchandiser", category: "Staff", description: "Pengelolaan display produk di lokasi pelanggan" },
  { code: "J-PAYS", title: "Payroll Staff", category: "Staff", description: "Administrasi penggajian karyawan" },
  { code: "J-APST", title: "Accounts Payable Staff", category: "Staff", description: "Administrasi hutang vendor & supplier" },
  { code: "J-TRST", title: "Treasury Staff", category: "Staff", description: "Pengelolaan kas, bank & likuiditas harian" },
  { code: "J-TRAI", title: "Training Staff", category: "Staff", description: "Koordinasi pelatihan & pengembangan karyawan" },
  { code: "J-SECO", title: "Security Officer", category: "Staff", description: "Keamanan area pabrik & perkantoran" },
];

// ---------- 50 POSISI (20 existing + 30 baru) ----------
export type PosDef = {
  code: string; title: string; jobCode: string; orgCode: string; grade: string; levelCode: string;
  headcount: number; reportsTo?: string;
};

export const NEW_POSITIONS: PosDef[] = [
  { code: "P-OPRN", title: "Operator Produksi", jobCode: "J-OPR", orgCode: "MII-PRD-ASSY", grade: "G1", levelCode: "PL1", headcount: 250 },
  { code: "P-LDL", title: "Line Leader", jobCode: "J-LDL", orgCode: "MII-PRD-ASSY", grade: "G2", levelCode: "PL3", headcount: 12 },
  { code: "P-TECH", title: "Teknisi Maintenance", jobCode: "J-TECH", orgCode: "MII-PRD-MAINT", grade: "G2", levelCode: "PL2", headcount: 14 },
  { code: "P-ELEC", title: "Teknisi Elektrikal", jobCode: "J-ELEC", orgCode: "MII-PRD-MAINT", grade: "G2", levelCode: "PL2", headcount: 8 },
  { code: "P-PPCO", title: "Operator Packaging", jobCode: "J-PPCO", orgCode: "MII-PRD-PKG", grade: "G1", levelCode: "PL1", headcount: 38 },
  { code: "P-PKGS", title: "Supervisor Packaging", jobCode: "J-LDL", orgCode: "MII-PRD-PKG", grade: "G3", levelCode: "PL3", headcount: 2 },
  { code: "P-FORK", title: "Operator Forklift", jobCode: "J-FORK", orgCode: "MII-PRD-WH", grade: "G1", levelCode: "PL1", headcount: 9 },
  { code: "P-WHS", title: "Staf Gudang", jobCode: "J-WHSW", orgCode: "MII-PRD-WH", grade: "G1", levelCode: "PL1", headcount: 12 },
  { code: "P-DRIV", title: "Driver Perusahaan", jobCode: "J-DRIV", orgCode: "MII-PRD-WH", grade: "G1", levelCode: "PL1", headcount: 6 },
  { code: "P-WHSS", title: "Supervisor Gudang & Distribusi", jobCode: "J-LDL", orgCode: "MII-PRD-WH", grade: "G3", levelCode: "PL3", headcount: 1 },
  { code: "P-PPC", title: "Production Planner", jobCode: "J-PPC", orgCode: "MII-PRD-PLN", grade: "G3", levelCode: "PL3", headcount: 3 },
  { code: "P-PPCS", title: "Staf PPC", jobCode: "J-PPCS", orgCode: "MII-PRD-PLN", grade: "G1", levelCode: "PL1", headcount: 4 },
  { code: "P-QCI", title: "QC Inspector", jobCode: "J-QCI", orgCode: "MII-PRD-QC", grade: "G1", levelCode: "PL1", headcount: 24 },
  { code: "P-LABA", title: "Analis Laboratorium", jobCode: "J-LABA", orgCode: "MII-QAD-LAB", grade: "G2", levelCode: "PL2", headcount: 8 },
  { code: "P-CALB", title: "Teknisi Kalibrasi", jobCode: "J-CALB", orgCode: "MII-QAD-LAB", grade: "G2", levelCode: "PL2", headcount: 3 },
  { code: "P-QAEN", title: "QA Engineer", jobCode: "J-QAEN", orgCode: "MII-QAD-ENG", grade: "G3", levelCode: "PL3", headcount: 5 },
  { code: "P-HELP", title: "Staf IT Support", jobCode: "J-HELP", orgCode: "MII-ITD-HLP", grade: "G1", levelCode: "PL1", headcount: 8 },
  { code: "P-ERPA", title: "Administrator ERP", jobCode: "J-ERPA", orgCode: "MII-ITD-HLP", grade: "G2", levelCode: "PL2", headcount: 3 },
  { code: "P-DATA", title: "Data Analyst", jobCode: "J-DATA", orgCode: "MII-ITD-DBA", grade: "G3", levelCode: "PL3", headcount: 5 },
  { code: "P-NETW", title: "Network Engineer", jobCode: "J-NETW", orgCode: "MII-ITD-DBA", grade: "G3", levelCode: "PL3", headcount: 3 },
  { code: "P-SALE", title: "Sales Executive", jobCode: "J-SALE", orgCode: "MII-MKT-RTL", grade: "G3", levelCode: "PL3", headcount: 12 },
  { code: "P-TELE", title: "Telemarketing Officer", jobCode: "J-TELE", orgCode: "MII-MKT-DIG", grade: "G1", levelCode: "PL1", headcount: 7 },
  { code: "P-EXPS", title: "Staf Ekspor", jobCode: "J-EXPS", orgCode: "MII-MKT-EXP", grade: "G2", levelCode: "PL2", headcount: 5 },
  { code: "P-CSRO", title: "Customer Service Officer", jobCode: "J-CSRO", orgCode: "MII-MKT-CSR", grade: "G1", levelCode: "PL1", headcount: 8 },
  { code: "P-MERC", title: "Merchandiser", jobCode: "J-MERC", orgCode: "MII-MKT-RTL", grade: "G2", levelCode: "PL2", headcount: 6 },
  { code: "P-PAYS", title: "Staf Payroll", jobCode: "J-PAYS", orgCode: "MII-FIN-PAY", grade: "G1", levelCode: "PL1", headcount: 2 },
  { code: "P-APST", title: "Staf Accounts Payable", jobCode: "J-APST", orgCode: "MII-FIN-ACC", grade: "G1", levelCode: "PL1", headcount: 4 },
  { code: "P-TRST", title: "Staf Treasury", jobCode: "J-TRST", orgCode: "MII-FIN-TRX", grade: "G1", levelCode: "PL1", headcount: 2 },
  { code: "P-TRAI", title: "Staf Pelatihan", jobCode: "J-TRAI", orgCode: "MII-HRD-TND", grade: "G2", levelCode: "PL2", headcount: 3 },
  { code: "P-SECO", title: "Petugas Keamanan", jobCode: "J-SECO", orgCode: "MII-HRD-GA", grade: "G1", levelCode: "PL1", headcount: 8 },
];

/** Headcount baru utk posisi existing (absorpsi karyawan tambahan). */
export const EXISTING_POS_HC_UPDATE: Record<string, number> = {
  "P-OPR": 38, "P-SUP": 4, "P-HRS": 3, "P-RCT": 3, "P-GAS": 8,
  "P-DEV": 6, "P-QAS": 10, "P-MKS": 8, "P-ACC": 4, "P-TAX": 2, "P-CBS": 4,
};

/** Jumlah karyawan baru per posisi (existing + baru) — total 456. */
export const HIRE_PLAN: { posCode: string; count: number }[] = [
  { posCode: "P-OPRN", count: 236 },
  { posCode: "P-LDL", count: 11 },
  { posCode: "P-TECH", count: 12 },
  { posCode: "P-ELEC", count: 6 },
  { posCode: "P-PPCO", count: 34 },
  { posCode: "P-PKGS", count: 1 },
  { posCode: "P-FORK", count: 8 },
  { posCode: "P-WHS", count: 11 },
  { posCode: "P-DRIV", count: 5 },
  { posCode: "P-WHSS", count: 1 },
  { posCode: "P-PPC", count: 2 },
  { posCode: "P-PPCS", count: 3 },
  { posCode: "P-QCI", count: 22 },
  { posCode: "P-LABA", count: 6 },
  { posCode: "P-CALB", count: 2 },
  { posCode: "P-QAEN", count: 4 },
  { posCode: "P-HELP", count: 6 },
  { posCode: "P-ERPA", count: 2 },
  { posCode: "P-DATA", count: 4 },
  { posCode: "P-NETW", count: 2 },
  { posCode: "P-SALE", count: 10 },
  { posCode: "P-TELE", count: 6 },
  { posCode: "P-EXPS", count: 4 },
  { posCode: "P-CSRO", count: 7 },
  { posCode: "P-MERC", count: 5 },
  { posCode: "P-PAYS", count: 1 },
  { posCode: "P-APST", count: 3 },
  { posCode: "P-TRST", count: 1 },
  { posCode: "P-TRAI", count: 2 },
  { posCode: "P-SECO", count: 6 },
  // absorpsi posisi existing
  { posCode: "P-OPR", count: 14 },
  { posCode: "P-SUP", count: 1 },
  { posCode: "P-HRS", count: 2 },
  { posCode: "P-RCT", count: 1 },
  { posCode: "P-GAS", count: 4 },
  { posCode: "P-DEV", count: 2 },
  { posCode: "P-QAS", count: 3 },
  { posCode: "P-MKS", count: 2 },
  { posCode: "P-ACC", count: 2 },
  { posCode: "P-TAX", count: 1 },
  { posCode: "P-CBS", count: 1 },
];

// ---------- Nama & data personal ----------
export const FIRST_M = [
  "Budi", "Agus", "Joko", "Rizky", "Andi", "Dedi", "Fajar", "Hendra", "Irfan", "Kurniawan",
  "Lukman", "Muhammad", "Nanda", "Prasetyo", "Rahmat", "Satria", "Taufik", "Wahyu", "Yusuf", "Zaki",
  "Bayu", "Dimas", "Eko", "Gilang", "Rudi", "Adi", "Bagus", "Cahyo", "Danu", "Erik",
  "Ferry", "Galih", "Hari", "Ilham", "Jaya", "Kevin", "Lutfi", "Marwan", "Naufal", "Oki",
  "Panji", "Reza", "Salman", "Teguh", "Umar", "Vino", "Wisnu", "Yoga", "Zulfikar", "Arif",
];
export const FIRST_F = [
  "Siti", "Dewi", "Ani", "Rina", "Fitri", "Hesti", "Indah", "Kartika", "Lestari", "Maya",
  "Nurul", "Putri", "Ratna", "Sari", "Tuti", "Wulan", "Yuni", "Zahra", "Ayu", "Citra",
  "Amel", "Bella", "Cantika", "Dinda", "Elisa", "Farah", "Gita", "Hanifah", "Intan", "Julia",
  "Kirana", "Laila", "Melati", "Nadia", "Olivia", "Permata", "Queena", "Raisa", "Syifa", "Tiara",
  "Ulfa", "Vania", "Winda", "Xena", "Yanti", "Zahira", "Aisyah", "Bunga", "Cindy", "Desi",
];
export const LAST_NAMES = [
  "Santoso", "Wijaya", "Kusuma", "Pratama", "Saputra", "Hidayat", "Nugroho", "Setiawan", "Ramadhan", "Firmansyah",
  "Gunawan", "Halim", "Iskandar", "Jatmiko", "Kurnia", "Lubis", "Mahendra", "Nasution", "Oktaviani", "Purnama",
  "Rahayu", "Susanto", "Tanaka", "Utami", "Wibowo", "Yulianti", "Abdullah", "Baskoro", "Cahyono", "Darmawan",
  "Efendi", "Fauzi", "Gultom", "Handoko", "Irawan", "Juwono", "Kusnadi", "Lesmana", "Maulana", "Nurdin",
  "Oktaviani", "Pangestu", "Rahmawati", "Suryani", "Tampubolon", "Umbara", "Verawati", "Wardani", "Yudhistira", "Zulkarnain",
];

export const CITIES = [
  "Jakarta", "Bandung", "Surabaya", "Bekasi", "Tangerang", "Depok", "Semarang", "Bogor",
  "Medan", "Palembang", "Denpasar", "Makassar", "Batam", "Pekanbaru", "Malang", "Yogyakarta",
];

export const STREETS = [
  "Merdeka", "Sudirman", "Ahmad Yani", "Diponegoro", "Gatot Subroto", "Cempaka", "Melati", "Kenanga",
  "Rajawali", "Merpati", "Anggrek", "Bougenville", "Pahlawan", "Veteran", "Kartini", "Melati Raya",
];

export const RELIGIONS = ["Islam", "Islam", "Islam", "Islam", "Islam", "Kristen Protestan", "Kristen Protestan", "Katolik", "Katolik", "Hindu", "Buddha", "Konghucu"];
export const BLOOD = ["A", "B", "AB", "O"];
export const BANKS = ["BCA", "Mandiri", "BNI", "BRI", "CIMB Niaga", "Danamon"];

export const OCCUPATIONS = [
  "Ibu Rumah Tangga", "Guru", "Wiraswasta", "Karyawan Swasta", "PNS", "Petani", "Pedagang", "Perawat", "Buruh Harian",
];

export const UNIV = [
  "Universitas Indonesia", "Institut Teknologi Bandung", "Universitas Gadjah Mada", "Universitas Airlangga",
  "Institut Pertanian Bogor", "Universitas Diponegoro", "Universitas Brawijaya", "Universitas Telkom",
  "Politeknik Negeri Jakarta", "Politeknik Manufaktur Bandung", "STT Terpadu Nurul Fikri", "Universitas Mercu Buana",
  "Universitas Negeri Jakarta", "Universitas Pendidikan Indonesia", "Politeknik Negeri Bandung",
];

export const SMA = [
  "SMKN 1 Jakarta", "SMKN 4 Bandung", "SMKN 2 Surabaya", "SMAN 5 Semarang", "SMKN 26 Jakarta",
  "SMKN 3 Bekasi", "STM Negeri 1 Bandung", "SMKN 1 Bogor", "SMAN 8 Jakarta", "SMKN 5 Malang",
];

export const MAJORS = [
  "Manajemen", "Akuntansi", "Teknik Industri", "Teknik Mesin", "Teknik Elektro", "Informatika",
  "Sistem Informasi", "Psikologi", "Kimia", "Statistika", "Teknik Kimia", "Administrasi Bisnis",
];

export const PREV_COMPANIES = [
  "PT Astra International", "PT Unilever Indonesia", "PT Sinar Mas", "PT Indofood CBP", "CV Karya Abadi",
  "PT Hankook Tire Indonesia", "PT LG Electronics Indonesia", "PT Panasonic Manufacturing",
  "PT Sanken Elektronika", "PT Sharp Electronics Indonesia", "PT Maspion", "PT Wings Surya",
  "PT Mayora Indah", "PT Garudafood", "PT Tirta Investama",
];
