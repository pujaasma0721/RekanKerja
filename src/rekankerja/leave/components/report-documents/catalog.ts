// T112 — katalog 12 laporan distribusi Leave (4 grup) ==========================
// Definisi statis (id, judul ID/EN, deskripsi, audiens, ikon) dipakai katalog
// grid di tab "Reports" modul Leave. id dipakai sebagai ?id= ke API
// leave-report-documents.ts.
import {
  Scale, Hourglass, Coins,
  ScrollText, GitPullRequestArrow, CalendarClock,
  Activity, Stethoscope, UserX,
  Baby, Palmtree, Flower2,
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
    key: "lg1",
    labelId: "Grup 1 — Saldo & Hak Cuti Karyawan",
    labelEn: "Group 1 — Leave Entitlement & Balances",
    descId: "Saldo cuti per karyawan: hak efektif, bawa periode lalu yang mendekati batas hangus, hingga liabilitas finansial saldo belum diambil.",
    descEn: "Employee leave balances: effective entitlement, carry-over approaching forfeiture, and financial liability of untaken balances.",
    reports: [
      {
        id: "lr11", no: "R1.1",
        titleId: "Annual Leave Balance Report — Saldo Cuti Karyawan Aktif",
        titleEn: "Annual Leave Balance Report — Active Employee Leave Balances",
        descId: "Saldo lengkap per karyawan: bawa + diperoleh + penyesuaian − diambil/terpasang/diuangkan = sisa.",
        descEn: "Full balance per employee: carried + earned + adjustment − taken/applied/cashed = remaining.",
        audience: "HR · Karyawan (self-service) · Atasan", icon: Scale,
      },
      {
        id: "lr12", no: "R1.2",
        titleId: "Leave Expiry & Forfeiture Alert Sheet",
        titleEn: "Leave Expiry & Forfeiture Alert Sheet",
        descId: "Saldo bawa (carry-over) yang hangus 31 Des — urut urgensi sisa hari menuju batas waktu.",
        descEn: "Carry-over balances expiring Dec 31 — sorted by urgency of remaining days.",
        audience: "HR · Karyawan · Atasan Langsung", icon: Hourglass,
      },
      {
        id: "lr13", no: "R1.3",
        titleId: "Leave Liability Report — Liabilitas Saldo Cuti",
        titleEn: "Leave Liability Report — Balance Financial Value",
        descId: "Nilai finansial saldo cuti belum diambil (sisa × upah harian) untuk kebutuhan akuntansi akrual.",
        descEn: "Financial value of untaken leave balances (remaining × daily rate) for accrual accounting.",
        audience: "Finance/Accounting · Direksi · Auditor", icon: Coins,
      },
    ],
  },
  {
    key: "lg2",
    labelId: "Grup 2 — Transaksi & Riwayat Pengajuan Cuti",
    labelEn: "Group 2 — Leave Transactions & History",
    descId: "Jejak audit pengajuan: riwayat detail per karyawan, pipeline persetujuan yang menunggu, dan jadwal cuti departemen anti-bentrok.",
    descEn: "Request audit trail: per-employee history, pending approval pipeline, and conflict-aware department schedule.",
    reports: [
      {
        id: "lr21", no: "R2.1",
        titleId: "Detailed Leave Activity Log",
        titleEn: "Detailed Leave Activity Log",
        descId: "Riwayat pengajuan per karyawan: tanggal mulai–selesai, sesi, alasan, pemutus keputusan.",
        descEn: "Request history per employee: start–end dates, sessions, reasons, decision makers.",
        audience: "HR · Auditor Internal", icon: ScrollText,
      },
      {
        id: "lr22", no: "R2.2",
        titleId: "Leave Approval Pipeline",
        titleEn: "Leave Approval Pipeline",
        descId: "Pengajuan menunggu persetujuan — durasi menunggu vs SLA 3 hari kerja.",
        descEn: "Requests pending approval — waiting duration vs 3-working-day SLA.",
        audience: "HR · Atasan Langsung", icon: GitPullRequestArrow,
      },
      {
        id: "lr23", no: "R2.3",
        titleId: "Departmental Leave Schedule",
        titleEn: "Departmental Leave Schedule",
        descId: "Rencana cuti disetujui per departemen + deteksi bentrok jadwal kerja satu unit.",
        descEn: "Approved leave plans per department + same-unit schedule conflict detection.",
        audience: "Manajer Departemen · HR · Operations", icon: CalendarClock,
      },
    ],
  },
  {
    key: "lg3",
    labelId: "Grup 3 — Analisis Ketidakhadiran & Absen",
    labelEn: "Group 3 — Absenteeism & Lost Time Analysis",
    descId: "Dampak waktu hilang: tingkat ketidakhadiran per divisi, audit cuti sakit + SKD, dan log alpa untuk tindakan disiplin.",
    descEn: "Lost-time impact: absenteeism rate per division, sick leave + SKD audit, and alpa log for discipline.",
    reports: [
      {
        id: "lr31", no: "R3.1",
        titleId: "Absenteeism Rate Summary",
        titleEn: "Absenteeism Rate Summary",
        descId: "Persentase ketidakhadiran per divisi: hadir vs cuti vs izin vs alpa atas hari kerja tersedia.",
        descEn: "Absence percentage per division: present vs leave vs permission vs alpa over available workdays.",
        audience: "Direksi · Manajemen Senior · HR", icon: Activity,
      },
      {
        id: "lr32", no: "R3.2",
        titleId: "Sick Leave Tracking & Medical Certificate Audit",
        titleEn: "Sick Leave Tracking & Medical Certificate Audit",
        descId: "Rekap cuti sakit + status kelengkapan Surat Keterangan Dokter (SKD) — UU 13/2003 Ps.93.",
        descEn: "Sick leave recap + medical certificate (SKD) completeness audit — Law 13/2003 Art.93.",
        audience: "HR · Payroll · Klinik Partner", icon: Stethoscope,
      },
      {
        id: "lr33", no: "R3.3",
        titleId: "Unexcused Absence / Alpa Log",
        titleEn: "Unexcused Absence / Alpa Log",
        descId: "Daftar mangkir karyawan — dasar penerbitan Surat Peringatan berjenjang.",
        descEn: "Employee no-show log — basis for issuing progressive warning letters.",
        audience: "HR · Atasan Langsung · Legal", icon: UserX,
      },
    ],
  },
  {
    key: "lg4",
    labelId: "Grup 4 — Kepatuhan & Cuti Khusus Regulasi",
    labelEn: "Group 4 — Regulatory & Special Leave Compliance",
    descId: "Cuti khusus berbayar UU Ketenagakerjaan 13/2003 & UU Cipta Kerja: melahirkan, menikah, duka, cuti besar, dan cuti haid.",
    descEn: "Paid special leave per Labor Law 13/2003 & Job Creation Law: maternity, marriage, bereavement, long leave, and menstrual leave.",
    reports: [
      {
        id: "lr41", no: "R4.1",
        titleId: "Statutory Special Leave Report",
        titleEn: "Statutory Special Leave Report",
        descId: "Rekap cuti khusus berbayar: melahirkan, keguguran, menikah, khitanan/baptis, duka keluarga.",
        descEn: "Paid special leave recap: maternity, miscarriage, marriage, circumcision/baptism, family bereavement.",
        audience: "HR · Legal · Disnaker · Direksi", icon: Baby,
      },
      {
        id: "lr42", no: "R4.2",
        titleId: "Long Leave / Grand Leave Report",
        titleEn: "Long Leave / Grand Leave Report",
        descId: "Cuti Besar (Hak Istirahat Panjang): riwayat pengambilan + daftar karyawan berhak belum ambil.",
        descEn: "Grand leave: usage history + eligible-but-not-taken employee register.",
        audience: "HR · Direksi", icon: Palmtree,
      },
      {
        id: "lr43", no: "R4.3",
        titleId: "Menstrual Leave Audit Sheet",
        titleEn: "Menstrual Leave Audit Sheet",
        descId: "Rekap cuti haid karyawan perempuan — UU 13/2003 Ps.81, tidak dihitung absen & maks 2 hari.",
        descEn: "Female employee menstrual leave recap — Law 13/2003 Art.81, not counted as absence, max 2 days.",
        audience: "HR · Kepatuhan · Auditor", icon: Flower2,
      },
    ],
  },
];

export const ALL_REPORTS: ReportDef[] = REPORT_GROUPS.flatMap((g) => g.reports);

export function reportById(id: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
