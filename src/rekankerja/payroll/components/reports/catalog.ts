// RekanKerja Payroll — KATALOG LAPORAN DISTRIBUSI (12 laporan / 4 grup) =====
// Dipakai oleh PayrollReportsView (menu Laporan Payroll). Setiap definisi =
// kartu di katalog + sumber parameter + orientasi cetak + komponen dokumen.
// Palet per grup TANPA indigo/blue (kebijakan desain) — emerald / rose /
// amber / teal selaras tema aplikasi.
import {
  ReceiptText, TableProperties, Landmark, Calculator, FileSignature, Globe2,
  ShieldCheck, HeartPulse, Home, GitCompareArrows, Users, Clock4,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ReportId =
  | "r11" | "r12" | "r13"
  | "r21" | "r22" | "r23"
  | "r31" | "r32" | "r33"
  | "r41" | "r42" | "r43";

export interface ReportDef {
  id: ReportId;
  no: string;
  icon: LucideIcon;
  titleId: string;
  titleEn: string;
  descId: string;
  descEn: string;
  /** penerima laporan (badge katalog) */
  audience: string[];
  orientation: "portrait" | "landscape";
}

export interface GroupDef {
  id: string;
  titleId: string;
  titleEn: string;
  descId: string;
  descEn: string;
  reports: ReportDef[];
}

// Tema visual grup (T111-style): bar gradien 3px + blok ikon 44px + badge.
export const GROUP_THEMES: Record<string, {
  bar: string; iconBlock: string; badge: string; text: string; softBg: string;
}> = {
  g1: {
    bar: "bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400",
    iconBlock: "bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    badge: "bg-emerald-600/10 text-emerald-700 border-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/25",
    text: "text-emerald-700 dark:text-emerald-400",
    softBg: "bg-emerald-600/5 dark:bg-emerald-500/5",
  },
  g2: {
    bar: "bg-gradient-to-r from-rose-600 via-rose-500 to-orange-400",
    iconBlock: "bg-rose-600/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    badge: "bg-rose-600/10 text-rose-700 border-rose-600/20 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/25",
    text: "text-rose-700 dark:text-rose-400",
    softBg: "bg-rose-600/5 dark:bg-rose-500/5",
  },
  g3: {
    bar: "bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300",
    iconBlock: "bg-amber-600/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    badge: "bg-amber-600/10 text-amber-800 border-amber-600/25 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/25",
    text: "text-amber-700 dark:text-amber-400",
    softBg: "bg-amber-600/5 dark:bg-amber-500/5",
  },
  g4: {
    bar: "bg-gradient-to-r from-teal-600 via-teal-500 to-cyan-400",
    iconBlock: "bg-teal-600/10 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400",
    badge: "bg-teal-600/10 text-teal-700 border-teal-600/20 dark:bg-teal-500/15 dark:text-teal-400 dark:border-teal-500/25",
    text: "text-teal-700 dark:text-teal-400",
    softBg: "bg-teal-600/5 dark:bg-teal-500/5",
  },
};

export const REPORT_GROUPS: GroupDef[] = [
  {
    id: "g1",
    titleId: "Laporan Penggajian Internal",
    titleEn: "Internal Payroll Remittance",
    descId: "Dokumen kendali keuangan internal: slip gaji resmi, rekap bulanan, dan berkas transfer bank.",
    descEn: "Internal finance control: official payslips, monthly register, and bank transfer files.",
    reports: [
      {
        id: "r11", no: "R1.1", icon: ReceiptText, orientation: "portrait",
        titleId: "Slip Gaji Resmi Karyawan", titleEn: "Official Employee Payslip",
        descId: "Rincian gaji pokok, tunjangan, BPJS (porsi perusahaan & karyawan), potongan pajak, hingga Net THP.",
        descEn: "Breakdown of basic salary, allowances, BPJS company/employee parts, tax deductions, and net THP.",
        audience: ["Karyawan", "HR / Payroll"],
      },
      {
        id: "r12", no: "R1.2", icon: TableProperties, orientation: "landscape",
        titleId: "Rekapitulasi Gaji Bulanan", titleEn: "Payroll Summary Register",
        descId: "Daftar induk seluruh komponen upah karyawan berdampingan — dasar jurnal akuntansi.",
        descEn: "Master list of all employee wage components side-by-side — basis for accounting entries.",
        audience: ["Finance & Accounting", "Auditor"],
      },
      {
        id: "r13", no: "R1.3", icon: Landmark, orientation: "landscape",
        titleId: "Rekap Transfer Bank (Bank-Link)", titleEn: "Bank Transfer File Layout",
        descId: "Rekap siap distribusi ke bank mitra (BCA, Mandiri, BRI, dll.) untuk payroll batch.",
        descEn: "Distribution-ready recap for partner banks (BCA, Mandiri, BRI, etc.) for payroll batch.",
        audience: ["Bank Mitra", "Finance", "Direktur"],
      },
    ],
  },
  {
    id: "g2",
    titleId: "Pajak PPh 21/26 & Kepatuhan DJP",
    titleEn: "Tax Revolving & Compliance (PPh 21/26)",
    descId: "Laporan resmi mengikuti kerangka DJP dan regulasi TER terbaru (PMK 168/2023).",
    descEn: "Official layouts matching DJP frameworks and the latest TER regulations (PMK 168/2023).",
    reports: [
      {
        id: "r21", no: "R2.1", icon: Calculator, orientation: "landscape",
        titleId: "Rekapitulasi PPh 21 Bulanan", titleEn: "PPh 21 Monthly Tax Summary",
        descId: "Potongan PPh 21 per karyawan: status PTKP, penghasilan bruto, kategori tarif TER, pajak terutang.",
        descEn: "PPh 21 withheld per employee: PTKP status, gross income, TER rate category, tax due.",
        audience: ["KPP / DJP", "Finance Director"],
      },
      {
        id: "r22", no: "R2.2", icon: FileSignature, orientation: "portrait",
        titleId: "Bukti Potong PPh 21 (Form 1721-A1)", titleEn: "PPh 21 Withholding Slip (Form 1721-A1)",
        descId: "Formulir DJP siap cetak untuk pegawai tetap — identitas, rincian penghasilan & penghitungan PPh 21.",
        descEn: "Print-ready DJP form for permanent employees — identity, income detail & PPh 21 computation.",
        audience: ["KPP / DJP", "Karyawan"],
      },
      {
        id: "r23", no: "R2.3", icon: Globe2, orientation: "portrait",
        titleId: "Laporan PPh 26 Non-Residen", titleEn: "PPh 26 Non-Resident Tax Report",
        descId: "Potongan pajak 20% final untuk tenaga kerja asing / ekspatriat sesuai Pasal 26 UU PPh.",
        descEn: "Final 20% withholding for foreign workers / expatriates per Article 26 of the Income Tax Law.",
        audience: ["KPP / DJP", "Finance Director"],
      },
    ],
  },
  {
    id: "g3",
    titleId: "Iuran Wajib Pemerintah (BPJS · Tapera)",
    titleEn: "Government Statutory Contributions (BPJS · Tapera)",
    descId: "Kepatuhan iuran JHT, JP, JKK, JKM, JKN, dan Tapera dengan plafon resmi terbaru.",
    descEn: "Statutory JHT, JP, JKK, JKM, JKN, and Tapera compliance with the latest official caps.",
    reports: [
      {
        id: "r31", no: "R3.1", icon: ShieldCheck, orientation: "landscape",
        titleId: "Iuran BPJS Ketenagakerjaan", titleEn: "BPJS Ketenagakerjaan Premium Sheet",
        descId: "Rincian iuran JHT, JKK, JKM, dan JP — dipisah porsi Perusahaan dan porsi Karyawan.",
        descEn: "Detailed JHT, JKK, JKM, and JP premiums split by Company-borne and Employee deduction.",
        audience: ["BPJS Ketenagakerjaan", "Finance"],
      },
      {
        id: "r32", no: "R3.2", icon: HeartPulse, orientation: "landscape",
        titleId: "Iuran BPJS Kesehatan", titleEn: "BPJS Kesehatan Premium Sheet",
        descId: "Kalkulasi iuran 4% perusahaan dan 1% karyawan dengan plafon upah resmi berlaku.",
        descEn: "4% company and 1% employee premium calculation under the current official wage cap.",
        audience: ["BPJS Kesehatan", "Finance"],
      },
      {
        id: "r33", no: "R3.3", icon: Home, orientation: "portrait",
        titleId: "Iuran Tapera", titleEn: "Tapera Premium Sheet",
        descId: "Potongan tabungan perumahan rakyat (2,5% perusahaan + 0,5% karyawan) bila berlaku.",
        descEn: "Housing savings deduction (2.5% company + 0.5% employee) where applicable.",
        audience: ["BP Tapera", "Finance"],
      },
    ],
  },
  {
    id: "g4",
    titleId: "Analisis Biaya Tenaga Kerja",
    titleEn: "Labor Cost & Audit Analysis",
    descId: "Dasar pengambilan keputusan finansial eksekutif: variansi biaya, TCOW, dan pencairan lembur.",
    descEn: "For executive financial decision making: cost variance, TCOW, and overtime disbursement.",
    reports: [
      {
        id: "r41", no: "R4.1", icon: GitCompareArrows, orientation: "landscape",
        titleId: "Variansi Biaya Payroll", titleEn: "Payroll Variance Report",
        descId: "Perbandingan biaya bulan berjalan vs bulan lalu — mendeteksi anomali kenaikan/penurunan drastis.",
        descEn: "Current vs previous month cost comparison — detects drastic increases/decreases.",
        audience: ["Direktur", "Finance Manager"],
      },
      {
        id: "r42", no: "R4.2", icon: Users, orientation: "landscape",
        titleId: "Total Cost of Workforce (TCOW)", titleEn: "Total Cost of Workforce",
        descId: "Total biaya per departemen: gaji bersih + pajak ditanggung + iuran BPJS perusahaan.",
        descEn: "Total cost per department: net salary + tax borne + company BPJS contributions.",
        audience: ["Direktur", "Finance Director"],
      },
      {
        id: "r43", no: "R4.3", icon: Clock4, orientation: "landscape",
        titleId: "Pencairan Uang Lembur", titleEn: "Overtime Financial Disbursement Sheet",
        descId: "Rincian lembur yang terhitung ke payroll berdasarkan indeks resmi (1/173 × 1,5×/2×).",
        descEn: "Overtime detail computed into payroll based on the official index (1/173 × 1.5×/2×).",
        audience: ["Finance", "Payroll"],
      },
    ],
  },
];

export const ALL_REPORTS: ReportDef[] = REPORT_GROUPS.flatMap((g) => g.reports);

export function reportById(id: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
