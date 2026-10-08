// T-TRAVEL-REPORTS — katalog 12 laporan distribusi Travel (4 grup) =============
// Mirror pola medical/report-documents/catalog.ts (T-MED-REPORTS) & leave
// (T112). Definisi statis (id, judul ID/EN, deskripsi, audiens, ikon) dipakai
// grid katalog di tab "Dokumen Laporan" modul Travel. id dipakai sebagai ?id=
// ke API travel-report-documents.ts (tr11..tr43).
import {
  PlaneTakeoff, HandCoins, Radar,
  ScrollText, PieChart, CarFront,
  ShieldAlert, TrendingDown, Target,
  GitCompareArrows, BedDouble, Plane,
  type LucideIcon,
} from "lucide-react";

export interface ReportDef {
  id: string;
  /** nomor laporan, cth. "R1.1" — badge di kartu katalog & kop dokumen. */
  no: string;
  titleId: string;
  titleEn: string;
  descId: string;
  descEn: string;
  /** Target penerima dokumen (ditampilkan di kartu + kop). */
  audience: string;
  icon: LucideIcon;
}

export interface ReportGroupDef {
  key: string;
  labelId: string;
  labelEn: string;
  descId: string;
  descEn: string;
  reports: ReportDef[];
}

export const REPORT_GROUPS: ReportGroupDef[] = [
  {
    key: "tg1",
    labelId: "Grup 1 — Pengajuan & Validasi Perjalanan Dinas",
    labelEn: "Group 1 — Travel Request & Authorization",
    descId: "Jejak otorisasi perjalanan: log master pengajuan & Surat Perintah Perjalanan Dinas (SPPD), pencairan uang muka, dan pelacak karyawan yang sedang bertugas di luar kota/negeri secara real-time.",
    descEn: "Travel authorization trail: master request & SPPD log, cash advance disbursement, and real-time tracking of employees currently on domestic/overseas assignment.",
    reports: [
      {
        id: "tr11", no: "R1.1", icon: PlaneTakeoff,
        titleId: "Master Travel Request & Log SPPD",
        titleEn: "Master Travel Request & SPPD Log",
        descId: "Rekapitulasi seluruh pengajuan perjalanan dinas: Nomor SPPD, karyawan, tujuan (multi-kaki), tanggal keberangkatan/kepulangan, tujuan bisnis, dan status persetujuan.",
        descEn: "Recap of all business trip requests: SPPD number, employee, destinations (multi-leg), departure/return dates, business purpose, and approval status.",
        audience: "HR Travel Admin · Atasan · Finance",
      },
      {
        id: "tr12", no: "R1.2", icon: HandCoins,
        titleId: "Cash Advance Disbursed Sheet",
        titleEn: "Cash Advance Disbursed Sheet",
        descId: "Laporan uang muka perjalanan dinas yang dicairkan sebelum keberangkatan — status pencairan, penyelesaian klaim, dan sisa outstanding per karyawan.",
        descEn: "Travel cash advance disbursed before departure — disbursement status, claim settlement linkage, and outstanding balance per employee.",
        audience: "Finance/Accounting · HR Travel Admin",
      },
      {
        id: "tr13", no: "R1.3", icon: Radar,
        titleId: "Active Business Travelers Tracking Sheet",
        titleEn: "Active Business Travelers Tracking Sheet",
        descId: "Daftar karyawan yang saat ini sedang aktif bertugas di luar kota/negeri (posisi hari ke-n, kota saat ini, hitungan hari pulang) untuk mitigasi risiko & operasional real-time.",
        descEn: "Employees currently on active out-of-town/overseas assignment (day-n position, current city, days-to-return) for risk mitigation & real-time operations.",
        audience: "HR Travel Admin · GA/Security · Manajemen",
      },
    ],
  },
  {
    key: "tg2",
    labelId: "Grup 2 — Realisasi & Rekonsiliasi Biaya",
    labelEn: "Group 2 — Travel Expense & Settlement",
    descId: "Pertanggungjawaban pasca-perjalanan: register settlement (uang muka vs realisasi nota), rincian biaya per komponen pengeluaran, dan log reimburse mileage/transport lokal.",
    descEn: "Post-trip accountability: settlement register (advance vs actual receipts), itemized expense category breakdown, and mileage/local transport reimbursement log.",
    reports: [
      {
        id: "tr21", no: "R2.1", icon: ScrollText,
        titleId: "Travel Settlement & Expense Claim Register",
        titleEn: "Travel Settlement & Expense Claim Register",
        descId: "Pertanggungjawaban setelah kembali: perbandingan uang muka vs realisasi nota/kuitansi — kelebihan dikembalikan (c), kekurangan dicairkan (b), jurnal & voucher.",
        descEn: "Post-return accountability: advance vs actual receipts comparison — excess returned (c), shortfall disbursed (b), journal & voucher linkage.",
        audience: "Finance · Auditor Internal · HR Travel",
      },
      {
        id: "tr22", no: "R2.2", icon: PieChart,
        titleId: "Itemized Expense Category Breakdown",
        titleEn: "Itemized Expense Category Breakdown",
        descId: "Rekap biaya perjalanan dinas per komponen: Uang Saku/Per Diem, Tiket Pesawat/Kereta, Akomodasi/Hotel, Transportasi Lokal, Uang Makan, dan Entertainment/Representasi Klien + tren 12 bulan.",
        descEn: "Travel expense recap per component: Per Diem, Air/Rail Ticket, Hotel, Local Transport, Meals, and Client Entertainment + 12-month trend.",
        audience: "Finance · Direksi · HR C&B",
      },
      {
        id: "tr23", no: "R2.3", icon: CarFront,
        titleId: "Mileage & Local Transport Reimbursement Log",
        titleEn: "Mileage & Local Transport Reimbursement Log",
        descId: "Reimburse penggunaan kendaraan pribadi (jarak km × tarif), BBM, serta sewa lokal/taksi/kereta — per baris biaya dengan tarif satuan & flag melebihi batas.",
        descEn: "Private vehicle (km × rate), fuel, and local rental/taxi/rail reimbursement — per expense line with unit rate & over-limit flag.",
        audience: "Finance · HR Travel Admin",
      },
    ],
  },
  {
    key: "tg3",
    labelId: "Grup 3 — Analisis Kepatuhan Kebijakan Perjalanan",
    labelEn: "Group 3 — Travel Policy Compliance & Audit",
    descId: "Kendali biaya & audit: pelanggaran plafon per level jabatan, potensi penghematan (last-minute booking vs tarif acuan SBI), dan dampak biaya terhadap anggaran cost center.",
    descEn: "Cost control & audit: tier limit violations, lost savings (last-minute booking vs SBI reference rates), and cost-to-business impact against cost center budgets.",
    reports: [
      {
        id: "tr31", no: "R3.1", icon: ShieldAlert,
        titleId: "Travel Tier & Policy Violation Report",
        titleEn: "Travel Tier & Policy Violation Report",
        descId: "Audit biaya di luar kelas/plafon yang ditentukan per level jabatan (mis. Staff menginap di atas plafon hotel) — nilai lebih, persentase, dan status persetujuannya.",
        descEn: "Audit of expenses beyond tier limits per job level (e.g. Staff above hotel ceiling) — excess value, percentage, and approval outcome.",
        audience: "Internal Auditor · HR C&B · Atasan",
      },
      {
        id: "tr32", no: "R3.2", icon: TrendingDown,
        titleId: "Lost Savings Opportunity Sheet",
        titleEn: "Lost Savings Opportunity Sheet",
        descId: "Analisis pemborosan: tarif riil hotel/uang saku vs tarif acuan SBI kota (PMK 32/2025) + pemesanan mendadak (last-minute) tiket menjelang keberangkatan.",
        descEn: "Waste analysis: actual hotel/per-diem rates vs SBI city reference (PMK 32/2025) + last-minute ticket bookings near departure.",
        audience: "Procurement · Finance · Direksi",
      },
      {
        id: "tr33", no: "R3.3", icon: Target,
        titleId: "Travel ROI / Cost-to-Business Impact Analysis",
        titleEn: "Travel ROI / Cost-to-Business Impact Analysis",
        descId: "Biaya perjalanan dinas vs anggaran per cost center (trips, settlement, utilisasi %, rata-rata per trip, tujuan bisnis utama) — dasar efisiensi & justifikasi perjalanan.",
        descEn: "Travel cost vs cost center budget (trips, settlement, utilization %, average per trip, top business purposes) — efficiency & trip justification basis.",
        audience: "CFO · Direksi · Manajemen",
      },
    ],
  },
  {
    key: "tg4",
    labelId: "Grup 4 — Distribusi Vendor & Logistik Perjalanan",
    labelEn: "Group 4 — Vendor Utilization & Logistics",
    descId: "Evaluasi pengadaan: rekonsiliasi tagihan akun korporat vs manifes HRIS, volume room-nights jaringan hotel mitra, dan statistik utilisasi maskapai/kereta untuk negosiasi kontrak.",
    descEn: "Procurement evaluation: corporate account billing vs HRIS manifest reconciliation, partner hotel room-night volume, and air/rail carrier utilization for contract negotiation.",
    reports: [
      {
        id: "tr41", no: "R4.1", icon: GitCompareArrows,
        titleId: "Corporate Travel Agent (CTA) Reconciliation Sheet",
        titleEn: "Corporate Travel Agent (CTA) Reconciliation Sheet",
        descId: "Pencocokan tagihan pihak ketiga / akun korporat (biaya dibayar pihak lain) dengan manifes keberangkatan & klaim karyawan yang tercatat di HRIS — mencegah double payment.",
        descEn: "Third-party/corporate account billing (expenses paid by other party) vs HRIS departure manifest & employee claims — preventing double payment.",
        audience: "Finance · Procurement · Vendor/CTA",
      },
      {
        id: "tr42", no: "R4.2", icon: BedDouble,
        titleId: "Hotel Vendor Volume Summary",
        titleEn: "Hotel Vendor Volume Summary",
        descId: "Rekap jumlah malam menginap (room nights) per kota pada jaringan hotel mitra — tarif rata-rata per malam, kebutuhan negosiasi diskon/kontrak tahunan baru.",
        descEn: "Room-night recap per city across partner hotel networks — average nightly rate, basis for discount/annual contract renegotiation.",
        audience: "Procurement/Purchasing · GA",
      },
      {
        id: "tr43", no: "R4.3", icon: Plane,
        titleId: "Air Carrier Utilization Report",
        titleEn: "Air Carrier Utilization Report",
        descId: "Statistik utilisasi maskapai penerbangan & kereta oleh karyawan (rute, tarif rata-rata, pemesanan mendadak) — dasar program corporate loyalty points & kontrak korporat.",
        descEn: "Air & rail carrier utilization statistics per employee trip (routes, average fare, last-minute bookings) — basis for corporate loyalty programs & contracts.",
        audience: "Procurement · HR Travel Admin · Vendor Maskapai",
      },
    ],
  },
];

export const ALL_REPORTS: ReportDef[] = REPORT_GROUPS.flatMap((g) => g.reports);

export function reportById(id: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
