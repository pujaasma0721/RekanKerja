// T-MED-REPORTS — katalog 12 laporan distribusi Medical (4 grup) =================
// Mirror pola leave/report-documents/catalog.ts (T112). Definisi statis (id,
// judul ID/EN, deskripsi, audiens, ikon) dipakai katalog grid di tab "Dokumen
// Laporan" modul Medical. id dipakai sebagai ?id= ke API
// medical-report-documents.ts.
import {
  Wallet, TrendingDown, Landmark,
  ScrollText, Hourglass, HeartHandshake,
  PieChart, Activity, Microscope,
  GitCompareArrows, UserPlus, ShieldCheck,
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
    key: "mg1",
    labelId: "Grup 1 — Saldo & Plafon Tunjangan Medis",
    labelEn: "Group 1 — Medical Allowance & Balances",
    descId: "Pagu tahunan, pemakaian, dan sisa plafon per kategori perawatan (Rawat Jalan, Rawat Inap, Kacamata, Persalinan, MCU) hingga proyeksi liabilitas anggaran Finance.",
    descEn: "Annual limits, utilization, and remaining balances per treatment category (Outpatient, Inpatient, Glasses, Maternity, MCU) up to Finance budget liability projection.",
    reports: [
      {
        id: "mr11", no: "R1.1", icon: Wallet,
        titleId: "Employee Medical Benefit Limit Balance",
        titleEn: "Employee Medical Benefit Limit Balance",
        descId: "Laporan saldo plafon medis karyawan: pagu tahunan (benefit + penyesuaian + bawa), terpakai, dan sisa per kategori perawatan + status urgensi.",
        descEn: "Employee medical limit balance: annual quota (benefit + adjustment + carry-over), used, and remaining per treatment category + urgency status.",
        audience: "HR C&B · Karyawan (ESS) · Finance",
      },
      {
        id: "mr12", no: "R1.2", icon: TrendingDown,
        titleId: "Top Medical Limit Utilizers Alert Sheet",
        titleEn: "Top Medical Limit Utilizers Alert Sheet",
        descId: "Karyawan dengan sisa plafon kritis/hampir habis (< 20% sisa) sebelum akhir tahun buku — urut paling kritis.",
        descEn: "Employees with critical/near-exhausted remaining limits (< 20% left) before the fiscal year ends — sorted most critical first.",
        audience: "HR Benefit Officer · Atasan Langsung",
      },
      {
        id: "mr13", no: "R1.3", icon: Landmark,
        titleId: "Medical Benefit Liability Report",
        titleEn: "Medical Benefit Liability Report",
        descId: "Proyeksi liabilitas biaya medis perusahaan (sisa plafon × porsi perusahaan) untuk anggaran reimbursement internal Finance.",
        descEn: "Company medical cost liability projection (remaining limits × company portion) for Finance internal reimbursement budgeting.",
        audience: "Finance/Accounting · Direksi · Auditor",
      },
    ],
  },
  {
    key: "mg2",
    labelId: "Grup 2 — Transaksi & Rekapitulasi Klaim",
    labelEn: "Group 2 — Medical Reimbursement & Claims",
    descId: "Jejak audit klaim: register rincian pengajuan + kwitansi, pipeline klaim tertahan menunggu verifikasi, dan rekap biaya tanggungan keluarga.",
    descEn: "Claims audit trail: detailed submission register with receipts, held claims verification pipeline, and family dependent cost recap.",
    reports: [
      {
        id: "mr21", no: "R2.1", icon: ScrollText,
        titleId: "Detailed Medical Reimbursement Register",
        titleEn: "Detailed Medical Reimbursement Register",
        descId: "Log klaim per baris perawatan: tanggal kwitansi, pasien/tanggungan, jenis perawatan, diagnosis, dokter/RS, nominal klaim vs disetujui.",
        descEn: "Claim log per treatment line: receipt date, patient/dependent, treatment type, diagnosis, physician/hospital, claimed vs approved amounts.",
        audience: "HR Benefit · Finance · Auditor Internal",
      },
      {
        id: "mr22", no: "R2.2", icon: Hourglass,
        titleId: "Pending Claims & Verification Pipeline",
        titleEn: "Pending Claims & Verification Pipeline",
        descId: "Klaim tertahan (Draft/Submitted/Approved-belum-settle) + kelengkapan kwitansi & surat rujukan yang harus diverifikasi fisik.",
        descEn: "Held claims (Draft/Submitted/Approved-unsettled) + receipt & referral letter completeness requiring physical verification.",
        audience: "HR Benefit Officer · Verifikator Dokumen",
      },
      {
        id: "mr23", no: "R2.3", icon: HeartHandshake,
        titleId: "Family Dependent Claim Summary",
        titleEn: "Family Dependent Claim Summary",
        descId: "Rekap biaya medis anggota keluarga yang ditanggung perusahaan — pasangan/anak, per karyawan dengan hubungan keluarga.",
        descEn: "Company-borne family member medical recap — spouse/children, per employee with family relationship.",
        audience: "HR · Finance · Manajemen",
      },
    ],
  },
  {
    key: "mg3",
    labelId: "Grup 3 — Analisis Biaya & Utilisasi Kesehatan",
    labelEn: "Group 3 — Medical Cost & Utilization Analysis",
    descId: "Kendali biaya: distribusi pengeluaran per kategori perawatan, keterkaitan klaim sakit dengan hari kerja hilang, dan diagnosis terbanyak (anonim).",
    descEn: "Cost control: spending distribution per treatment category, sick claims vs lost workdays linkage, and top diagnoses (anonymized).",
    reports: [
      {
        id: "mr31", no: "R3.1", icon: PieChart,
        titleId: "Medical Claim Distribution by Type",
        titleEn: "Medical Claim Distribution by Type",
        descId: "Rekap pengeluaran per kategori perawatan (jumlah, tagihan, disetujui, porsi perusahaan/asuransi) + tren 12 bulan.",
        descEn: "Spending recap per treatment category (count, billed, approved, company/insurance share) + 12-month trend.",
        audience: "Direksi · Finance · HR C&B",
      },
      {
        id: "mr32", no: "R3.2", icon: Activity,
        titleId: "Absenteeism Due to Medical Reasons Analysis",
        titleEn: "Absenteeism Due to Medical Reasons Analysis",
        descId: "Keterkaitan klaim medis (rawat inap/jalan) dengan hari kerja hilang (cuti sakit) per departemen + biaya per hari hilang.",
        descEn: "Medical claims (inpatient/outpatient) vs lost workdays (sick leave) per department + cost per lost day.",
        audience: "HR · Manajemen Operasional · Direksi",
      },
      {
        id: "mr33", no: "R3.3", icon: Microscope,
        titleId: "High-Frequency Diagnosis Log",
        titleEn: "High-Frequency Diagnosis Log",
        descId: "Statistik diagnosis penyakit terbanyak yang diklaim — ANONIM demi privasi — dasar program wellness perusahaan.",
        descEn: "Most frequently claimed diagnosis statistics — ANONYMIZED for privacy — the basis for company wellness programs.",
        audience: "HR Wellness · Manajemen (Anonim)",
      },
    ],
  },
  {
    key: "mg4",
    labelId: "Grup 4 — Rekonsiliasi Asuransi & Kepatuhan",
    labelEn: "Group 4 — Insurance Reconciliation & Vendor Compliance",
    descId: "Kerja sama TPA/asuransi swasta: rekonsiliasi premi vs utilisasi, mutasi enrolment anti double-payment, dan audit Coordination of Benefits BPJS.",
    descEn: "TPA/private insurance partnership: premium vs utilization reconciliation, anti double-payment enrollment mutations, and BPJS CoB audit.",
    reports: [
      {
        id: "mr41", no: "R4.1", icon: GitCompareArrows,
        titleId: "Insurance Premium vs Utilization Reconciliation Sheet",
        titleEn: "Insurance Premium vs Utilization Reconciliation Sheet",
        descId: "Pembanding beban premi equivalen vs klaim riil karyawan per penanggung: pemulihan (recovery), piutang outstanding, write-off, dan loss ratio.",
        descEn: "Equivalent premium burden vs actual employee claims per insurer: recovery, outstanding receivables, write-off, and loss ratio.",
        audience: "Finance · Broker/TPA · Direksi",
      },
      {
        id: "mr42", no: "R4.2", icon: UserPlus,
        titleId: "Insurance Enrollment & De-enrollment Log",
        titleEn: "Insurance Enrollment & De-enrollment Log",
        descId: "Mutasi peserta asuransi: karyawan baru wajib didaftarkan & resign harus dinonaktifkan — mencegah double payment premi.",
        descEn: "Insurance member mutations: new hires to enroll & resignees to deactivate — preventing double premium payments.",
        audience: "HR · Broker/TPA · Finance",
      },
      {
        id: "mr43", no: "R4.3", icon: ShieldCheck,
        titleId: "Coordination of Benefits (CoB) Audit Report",
        titleEn: "Coordination of Benefits (CoB) Audit Report",
        descId: "Audit klaim yang memisahkan jaminan BPJS Kesehatan (penjamin pertama) dari asuransi swasta/reimbursement internal (penjamin kedua).",
        descEn: "Audit of claims separating BPJS Kesehatan (first payer) from private insurance/internal reimbursement (second payer).",
        audience: "Finance · Auditor · TPA/Asuransi",
      },
    ],
  },
];

export const ALL_REPORTS: ReportDef[] = REPORT_GROUPS.flatMap((g) => g.reports);

export function reportById(id: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
