// T104 — katalog 16 laporan distribusi HR (4 grup) ============================
// Definisi statis (id, judul ID/EN, deskripsi, audiens, ikon) dipakai katalog
// grid di tab "Reports". id dipakai sebagai ?id= ke API report-documents.ts.
import {
  Users, LayoutGrid, Building2, IdCard, MapPin,
  FileWarning, Hourglass, ClipboardCheck,
  UserPlus, UserMinus, TrendingUp, ArrowLeftRight,
  Landmark, HeartPulse, Coins, BadgeCheck,
  type LucideIcon,
} from "lucide-react";

export interface ReportDef {
  id: string;
  /** nomor grup, cth. "R1.1" — badge di kartu katalog & kop dokumen. */
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
    key: "g1",
    labelId: "Grup 1 — Demografi & Profil Karyawan",
    labelEn: "Group 1 — Employee Demographics & Profile",
    descId: "Laporan biodata & sensus: profil lengkap, sebaran demografi, struktur departemen-posisi, status kepegawaian, dan pemetaan lokasi multi-cabang.",
    descEn: "Biodata & census reports: full profile, demographic distribution, department-position structure, employment status, and multi-branch location mapping.",
    reports: [
      {
        id: "r11", no: "R1.1",
        titleId: "Master Employee Report — Sensus Karyawan Lengkap",
        titleEn: "Master Employee Report — Full Employee Census",
        descId: "Sensus seluruh karyawan aktif: identitas, pendidikan, penempatan, masa kerja.",
        descEn: "Census of all active employees: identity, education, placement, tenure.",
        audience: "Direksi · HR · Audit Internal", icon: Users,
      },
      {
        id: "r12", no: "R1.2",
        titleId: "Employee Demography Summary",
        titleEn: "Employee Demography Summary",
        descId: "Ringkasan sebaran usia, gender, pendidikan, status pernikahan & agama.",
        descEn: "Summary distribution of age, gender, education, marital status & religion.",
        audience: "Manajemen HR · Perencanaan SDM", icon: LayoutGrid,
      },
      {
        id: "r13", no: "R1.3",
        titleId: "Department & Position Distribution Report",
        titleEn: "Department & Position Distribution Report",
        descId: "Struktur hierarki unit & posisi: headcount aktual vs anggaran, slot lowongan.",
        descEn: "Unit & position hierarchy: actual headcount vs budget, vacant slots.",
        audience: "Direksi · Manajer Departemen", icon: Building2,
      },
      {
        id: "r14", no: "R1.4",
        titleId: "Employment Status Report",
        titleEn: "Employment Status Report",
        descId: "Tabel tergrup: Karyawan Tetap vs Kontrak (PKWT) vs Probation vs Outsourcing.",
        descEn: "Grouped tables: Permanent vs Contract vs Probation vs Outsourcing.",
        audience: "HR · Legal · Audit Internal", icon: IdCard,
      },
      {
        id: "r15", no: "R1.5",
        titleId: "Multi-branch Location Mapping Report",
        titleEn: "Multi-branch Location Mapping Report",
        descId: "Pemetaan karyawan per kantor cabang & lokasi kerja (site/pabrik).",
        descEn: "Employee mapping per branch office & work location (site/plant).",
        audience: "Manajemen · GA · Audit", icon: MapPin,
      },
    ],
  },
  {
    key: "g2",
    labelId: "Grup 2 — Masa Kerja & Manajemen Kontrak",
    labelEn: "Group 2 — Tenure & Contract Management",
    descId: "Laporan aksi kritikal: jatuh tempo PKWT berjenjang urgensi, bracket masa kerja, dan jadwal evaluasi probation.",
    descEn: "Critical action reports: tiered contract expiry alerts, tenure brackets, and probation evaluation schedule.",
    reports: [
      {
        id: "r21", no: "R2.1",
        titleId: "Contract Expiry Alert Report (PKWT)",
        titleEn: "Contract Expiry Alert Report (PKWT)",
        descId: "Jatuh tempo kontrak dengan level urgensi: Kritis <30 hr · Perhatian <60 hr · Waspada <90 hr.",
        descEn: "Contract expiry with urgency levels: Critical <30d · Warning <60d · Caution <90d.",
        audience: "HR · Atasan Langsung · Legal", icon: FileWarning,
      },
      {
        id: "r22", no: "R2.2",
        titleId: "Employee Tenure Summary Report",
        titleEn: "Employee Tenure Summary Report",
        descId: "Bracket masa kerja + daftar long-service untuk program penghargaan.",
        descEn: "Tenure brackets + long-service list for recognition programs.",
        audience: "HR · Direksi (Service Award)", icon: Hourglass,
      },
      {
        id: "r23", no: "R2.3",
        titleId: "Probation Evaluation Schedule",
        titleEn: "Probation Evaluation Schedule",
        descId: "Timeline evaluasi probation (maks 3 bulan — PP 35/2021) utk review atasan.",
        descEn: "Probation evaluation timeline (max 3 months — GR 35/2021) for line-manager review.",
        audience: "Atasan Langsung · HR", icon: ClipboardCheck,
      },
    ],
  },
  {
    key: "g3",
    labelId: "Grup 3 — Pergerakan Karyawan (Turnover & Movement)",
    labelEn: "Group 3 — Employee Movement (Turnover & Movement)",
    descId: "Laporan pergerakan: penyambutan karyawan baru, keluar & exit interview, ringkasan turnover eksekutif, dan riwayat promosi-mutasi.",
    descEn: "Movement reports: new hire welcoming, termination & exit interviews, executive turnover summary, and promotion-transfer history.",
    reports: [
      {
        id: "r31", no: "R3.1",
        titleId: "New Hire Welcoming Report",
        titleEn: "New Hire Welcoming Report",
        descId: "Ringkasan karyawan yang onboarding bulan berjalan + progres checklist.",
        descEn: "Summary of employees onboarding this month + checklist progress.",
        audience: "HR · Supervisor · IT · GA", icon: UserPlus,
      },
      {
        id: "r32", no: "R3.2",
        titleId: "Employee Termination & Exit Interview Summary",
        titleEn: "Employee Termination & Exit Interview Summary",
        descId: "Keluar & alasan, hasil exit interview, dan status handover.",
        descEn: "Exits & reasons, exit interview results, and handover status.",
        audience: "HR · Direksi", icon: UserMinus,
      },
      {
        id: "r33", no: "R3.3",
        titleId: "Employee Turnover Executive Summary",
        titleEn: "Employee Turnover Executive Summary",
        descId: "Matriks turnover rate bulanan per divisi (12 bulan) + KPI eksekutif.",
        descEn: "Monthly turnover rate matrix per division (12 months) + executive KPIs.",
        audience: "Direksi · Manajemen Senior", icon: TrendingUp,
      },
      {
        id: "r34", no: "R3.4",
        titleId: "Promotion, Demotion & Transfer History Log",
        titleEn: "Promotion, Demotion & Transfer History Log",
        descId: "Riwayat pergerakan: unit/posisi asal → tujuan, no. dokumen PA.",
        descEn: "Movement history: from/to unit & position, PA document numbers.",
        audience: "HR · Direksi · Audit", icon: ArrowLeftRight,
      },
    ],
  },
  {
    key: "g4",
    labelId: "Grup 4 — Kepatuhan & Administrasi Legal (Indonesia)",
    labelEn: "Group 4 — Compliance & Legal Administration (Indonesia)",
    descId: "Laporan resmi standar pemerintah: WLKP, rekoniliasi BPJS, struktur & skala upah (Kemnaker), dan audit sertifikasi kompetensi.",
    descEn: "Official government-standard reports: WLKP, BPJS reconciliation, wage structure & scale (Kemnaker), and competency certification audit.",
    reports: [
      {
        id: "r41", no: "R4.1",
        titleId: "WLKP — Wajib Lapor Ketenagakerjaan",
        titleEn: "WLKP — Manpower Mandatory Report (Law No. 7/1981)",
        descId: "Form datar resmi: data pekerja, distribusi upah, kepesertaan jaminan sosial.",
        descEn: "Official flat form: worker data, wage distribution, social security membership.",
        audience: "Kemnaker/Disnaker · Direksi", icon: Landmark,
      },
      {
        id: "r42", no: "R4.2",
        titleId: "BPJS Kesehatan & Ketenagakerjaan Reconciliation Sheet",
        titleEn: "BPJS Health & Employment Reconciliation Sheet",
        descId: "Rekoniliasi peserta aktif payroll vs kepesertaan BPJS — sorot selisih.",
        descEn: "Reconcile active payroll vs BPJS membership — highlights discrepancies.",
        audience: "HR · Payroll · Finance", icon: HeartPulse,
      },
      {
        id: "r43", no: "R4.3",
        titleId: "Laporan Struktur dan Skala Upah",
        titleEn: "Structure and Scale of Wages Report",
        descId: "Struktur & skala upah per grade vs UMK — panduan Kemnaker (PP 78/2015).",
        descEn: "Wage structure & scale per grade vs minimum wage — Kemnaker guideline (GR 78/2015).",
        audience: "Kemnaker · Direksi · HR", icon: Coins,
      },
      {
        id: "r44", no: "R4.4",
        titleId: "Employee Competency & Certification Audit Sheet",
        titleEn: "Employee Competency & Certification Audit Sheet",
        descId: "Audit lisensi keselamatan (K3) & sertifikat profesional: kedaluwarsa/aktif.",
        descEn: "Audit safety (K3) licenses & professional certificates: expired/active.",
        audience: "HR · HSE/K3 · Audit", icon: BadgeCheck,
      },
    ],
  },
];

export const ALL_REPORTS: ReportDef[] = REPORT_GROUPS.flatMap((g) => g.reports);

export function reportById(id: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
