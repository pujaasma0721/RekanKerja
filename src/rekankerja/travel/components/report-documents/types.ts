// T-TRAVEL-REPORTS — tipe payload 12 laporan distribusi Travel =================
// Mirror 1:1 dari src/rekankerja/travel/api/travel-report-documents.ts — dipakai
// komponen tab "Dokumen Laporan" (report-documents-tab.tsx).
//
// KONVENSI UANG: semua nilai rupiah = number | null — null saat brankas uang
// terkunci (MoneyView masked); frontend merender "•••" (pola LR1.3 leave).
// Persen/hari/jumlah = number (selalu terisi — bukan uang).

/** Meta dokumen — header standar semua laporan (logo, perusahaan, periode, dsb.).
 *  Struktur identik dgn Medical/Leave types.DocMeta. */
export interface DocMeta {
  companyName: string;
  companyAddress: string | null;
  companyCity: string | null;
  companyTaxId: string | null;
  companyLogoUrl: string | null;
  branchLabel: string;
  printedBy: string;
  generatedAt: string;
  year: number;
  scope: "all" | "scoped";
  periodLabel: string;
  filters: { label: string; value: string }[];
}

export interface DocResponse<T> {
  id: string;
  meta: DocMeta;
  data: T;
}

/** Status badge permintaan perjalanan (R1.x). */
export type TravelRequestStatus = "Submitted" | "Approved" | "Rejected" | "Cancelled";

/** Fase perjalanan aktif (R1.3). */
export type ActivePhase = "final-day" | "returning-soon" | "mid-trip";

// ---------- Grup 1: Pengajuan & Validasi Perjalanan Dinas ----------

export interface TR11Data {
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    templateCode: string; templateName: string;
    requestDate: string; dateFrom: string; dateTo: string;
    durationDays: number;
    destinations: string;      // join multi-kaki: "Singapura → Kuala Lumpur"
    overseas: boolean;
    purpose: string; costCenter: string | null;
    status: TravelRequestStatus; statusLabel: string;
    decisionNote: string | null;
    claimRequested: boolean;   // klaim settlement sudah diajukan?
    advance: number | null;    // Σ uang muka request (masked → null)
  }[];
  total: number;
  byStatus: { status: string; label: string; count: number }[];
  overseasCount: number;
  claimRequestedCount: number;
  sum: { durationDays: number; advance: number | null };
}

export interface TR12Data {
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    destinations: string; purpose: string; costCenter: string | null;
    requestDate: string; tripFrom: string; tripTo: string;
    advanceStatus: "Given" | "Requested" | "Void";
    advanceStatusLabel: string;
    givenAt: string | null;
    amount: number | null;                          // nominal uang muka
    claimDocNo: string | null; claimStatusLabel: string | null;
    settlement: "unsettled" | "processing" | "settled";
    settlementLabel: string;
    outstanding: number | null;                     // amount − Σ settlement klaim selesai
  }[];
  byStatus: { status: string; label: string; count: number }[];
  counts: { given: number; requested: number; void: number; unsettled: number };
  sum: { amount: number | null; outstanding: number | null };
}

export interface TR13Data {
  asOf: string; // tanggal laporan (YYYY-MM-DD) — posisi hari ini
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    phone: string | null; grade: string | null;
    destinations: string; overseas: boolean;
    tripFrom: string; tripTo: string;
    totalDays: number; dayNo: number; daysToReturn: number;
    currentCity: string;          // kaki destinasi berdasarkan tanggal hari ini
    costCenter: string | null; purpose: string;
    phase: ActivePhase; phaseLabel: string;
    advance: number | null;
  }[];
  total: number;
  overseasCount: number;
  domesticCount: number;
  returningSoon: number; // phase final-day + returning-soon
  sum: { advance: number | null };
}

// ---------- Grup 2: Realisasi & Rekonsiliasi Biaya ----------

export interface TR21Data {
  items: {
    docNo: string; claimDate: string;
    employeeNo: string; name: string; unit: string | null;
    requestDocNo: string | null; templateName: string;
    purpose: string | null; costCenter: string | null;
    expenseCount: number;
    expenseTotal: number | null;     // Σ rincian baris biaya
    otherCompanyExp: number | null;  // (a) dibayar pihak lain / akun korporat
    exchangeLoss: number | null;     // rugi selisih kurs
    totalSettlement: number | null;  // gross = rincian + rugi kurs − (a)
    advance: number | null;         // uang muka request terkait
    payableEmployee: number | null;  // (b) kekurangan → dibayar ke karyawan
    payableCompany: number | null;   // (c) kelebihan → dikembalikan
    status: string; statusLabel: string;
    journalNo: string | null; periodCode: string | null;
    settlementMethod: string;
  }[];
  total: number;
  byStatus: { status: string; label: string; count: number }[];
  sum: {
    expenseTotal: number | null; otherCompanyExp: number | null; exchangeLoss: number | null;
    totalSettlement: number | null; advance: number | null;
    payableEmployee: number | null; payableCompany: number | null;
  };
}

export interface TR22Data {
  year: number;
  rows: {
    code: string; name: string; kind: string; kindLabel: string;
    claimCount: number; expenseCount: number;
    qty: number;                    // Σ unit (hari utk allowance, km mileage, malam hotel)
    amount: number | null;
    overLimitCount: number;
    sharePct: number | null;        // amount / total × 100
    avgPerLine: number | null;
  }[];
  byKind: { kind: string; kindLabel: string; amount: number | null; sharePct: number | null }[];
  monthly: { month: string; lines: number; amount: number | null }[]; // 12 bulan
  total: { lines: number; amount: number | null; overLimitCount: number };
}

export interface TR23Data {
  items: {
    claimDocNo: string; claimDate: string;
    employeeNo: string; name: string; unit: string | null;
    expenseDate: string | null;
    code: string; typeName: string;
    category: "mileage-km" | "fuel" | "local-rent" | "local-rail";
    categoryLabel: string;
    description: string | null;
    qty: number;                    // km / hari / unit
    qtyLabel: string;               // "km" | "hari" | "unit"
    amount: number | null;
    rate: number | null;            // amount ÷ qty (tarif satuan)
    overLimit: boolean;
  }[];
  byCategory: { category: string; categoryLabel: string; lines: number; qty: number; amount: number | null }[];
  byCode: { code: string; name: string; lines: number; qty: number; amount: number | null; avgRate: number | null }[];
  total: number;
  totalKm: number; // Σ qty baris L-JARAK (km kendaraan pribadi)
  sum: { amount: number | null };
}

// ---------- Grup 3: Analisis Kepatuhan Kebijakan Perjalanan ----------

export interface TR31Data {
  year: number;
  items: {
    claimDocNo: string; claimDate: string;
    employeeNo: string; name: string; unit: string | null; grade: string | null;
    code: string; typeName: string; kindLabel: string;
    qty: number;
    amount: number | null;
    limit: number;                  // limit jenis biaya (0 = tanpa limit — tak muncul)
    limitLabel: string;             // "Rp 2.000.000 / pengajuan"
    excess: number | null;          // amount − limit
    overPct: number | null;         // excess / limit × 100
    claimStatus: string; claimStatusLabel: string;
    approvedAnyway: boolean;         // pelanggaran tapi klaim tetap disetujui
  }[];
  byCode: { code: string; name: string; violations: number; excess: number | null }[];
  total: number;
  approvedAnyway: number;
  sum: { excess: number | null };
}

export interface TR32Data {
  year: number;
  items: {
    claimDocNo: string;
    employeeNo: string; name: string;
    city: string; cityMatched: boolean; // false → "Tidak terpetakan"
    code: string; typeName: string;
    qty: number; qtyLabel: string;       // "malam" (hotel) | "hari" (uang saku) | "tiket"
    actualPerUnit: number | null;       // amount ÷ qty
    refRate: number;                    // plafon hotel / uang harian kota (acuan SBI)
    refLabel: string;                   // "Plafon hotel Bandung (SBI)"
    lost: number | null;                // max(0, (actual − ref) × qty)
    lastMinute: boolean;               // tiket dibeli ≤ 1 hari sebelum berangkat / sesudah
    daysToDeparture: number | null;     // (tripFrom − expenseDate); negatif = saat trip
  }[];
  byCategory: { category: "hotel" | "per-diem" | "last-minute"; categoryLabel: string; lines: number; lost: number | null }[];
  total: number;
  matchedCount: number;
  lastMinuteCount: number;
  sum: { lost: number | null };
  methodology: string;
}

export interface TR33Data {
  year: number;
  rows: {
    costCenter: string; costCenterLabel: string;
    trips: number; employees: number; claims: number;
    advance: number | null;
    settlement: number | null;      // Σ totalSettlement klaim selesai (Approved/Transferred/Paid)
    budget: number | null;         // dari TravelBudgetItem cost center (tahun tsb)
    utilizationPct: number | null; // settlement ÷ budget × 100
    avgPerTrip: number | null;
    topPurpose: string | null;     // tujuan bisnis terbanyak
  }[];
  total: {
    trips: number; employees: number; claims: number;
    advance: number | null; settlement: number | null; budget: number | null;
  };
  overallUtilization: number | null;
  unmatchedNote: string | null;    // catatan klaim/request tanpa cost center
  methodology: string;
}

// ---------- Grup 4: Distribusi Vendor & Logistik Perjalanan ----------

export interface TR41Data {
  year: number;
  items: {   // klaim dgn (a) biaya dibayar pihak lain / akun korporat > 0
    claimDocNo: string; claimDate: string;
    employeeNo: string; name: string;
    requestDocNo: string | null; destinations: string;
    templateName: string; purpose: string | null;
    corporateBilled: number | null;   // (a) ditagihkan ke akun korporat (CTA)
    payableEmployee: number | null;   // (b) disettle ke karyawan
    payableCompany: number | null;    // (c) dikembalikan perusahaan
    totalSettlement: number | null;
    journalNo: string | null;
    status: string; statusLabel: string;
    ageDays: number;                  // umur sejak klaim (hari)
  }[];
  monthly: { month: string; claims: number; corporateBilled: number | null }[];
  total: number;
  openCount: number;      // belum Transferred/Paid
  settledCount: number;
  sum: {
    corporateBilled: number | null; payableEmployee: number | null;
    payableCompany: number | null; totalSettlement: number | null;
  };
  manifestNote: string;
}

export interface TR42Data {
  year: number;
  byCity: {
    city: string; country: string; overseas: boolean;
    roomNights: number; amount: number | null;
    avgRate: number | null;          // amount ÷ roomNights
    employees: number; claims: number;
    sharePct: number | null;
  }[];
  detail: {
    claimDocNo: string; employeeNo: string; name: string;
    city: string; cityMatched: boolean;
    date: string | null; nights: number; rate: number | null; amount: number | null;
    overLimit: boolean;
  }[];
  total: number;
  cities: number;
  sum: { roomNights: number; amount: number | null };
}

export interface TR43Data {
  year: number;
  rows: {   // per carrier (best-effort parse dr description; fallback per mode)
    carrier: string;                 // "Garuda Indonesia" | "KAI (Kereta)" | "Tidak teridentifikasi" | ...
    mode: "air" | "rail" | "other"; modeLabel: string;
    tickets: number; routes: number; employees: number;
    amount: number | null; sharePct: number | null; avgFare: number | null;
  }[];
  detail: {
    claimDocNo: string; employeeNo: string; name: string;
    carrier: string; route: string | null; // "CGK–SIN" bila terparse
    expenseDate: string | null; amount: number | null;
    lastMinute: boolean;
  }[];
  total: number;
  airTickets: number;
  railTickets: number;
  unidentified: number;
  sum: { amount: number | null };
}

export type TravelReportData =
  | TR11Data | TR12Data | TR13Data
  | TR21Data | TR22Data | TR23Data
  | TR31Data | TR32Data | TR33Data
  | TR41Data | TR42Data | TR43Data;
