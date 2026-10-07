// T113 — katalog 12 laporan distribusi Attendance (4 grup) ===================
// Definisi statis (id, judul ID/EN, deskripsi, audiens, ikon) dipakai katalog
// grid di tab "Reports" modul Attendance. id dipakai sebagai ?id= ke API
// attendance-report-documents.ts.
import {
  CalendarCheck2, ClipboardList, MapPin,
  Timer, Hourglass, AlertTriangle,
  Clock, Coins, ShieldCheck,
  CalendarClock, MoonStar, FileWarning,
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
    key: "ag1",
    labelId: "Grup 1 — Rekapitulasi Presensi Berkala",
    labelEn: "Group 1 — Periodic Attendance Summaries",
    descId: "Rekap siap payroll: kehadiran bulanan per karyawan, timesheet harian, dan presensi multi-lokasi via geofencing GPS.",
    descEn: "Payroll-ready summaries: monthly attendance per employee, daily timesheets, and multi-location geofenced presence.",
    reports: [
      {
        id: "ar11", no: "R1.1",
        titleId: "Monthly Attendance Summary Roll — Rekap Kehadiran Bulanan",
        titleEn: "Monthly Attendance Summary Roll",
        descId: "Hari hadir, telat, sakit, cuti, alpa & libur per karyawan — dasar input Payroll.",
        descEn: "Present, late, sick, leave, no-show & off days per employee — payroll input basis.",
        audience: "Payroll · HR · Kepala Departemen", icon: CalendarCheck2,
      },
      {
        id: "ar12", no: "R1.2",
        titleId: "Daily Attendance Timesheet — Detail Jam Masuk & Pulang",
        titleEn: "Daily Attendance Timesheet",
        descId: "Jam masuk/pulang, jadwal shift, lokasi check-in dan catatan per karyawan untuk tanggal tertentu.",
        descEn: "Check-in/out times, shift schedule, check-in location and notes per employee for a given date.",
        audience: "HR · Supervisor · Operations", icon: ClipboardList,
      },
      {
        id: "ar13", no: "R1.3",
        titleId: "Multi-Location / Geofencing Attendance Sheet",
        titleEn: "Multi-Location / Geofencing Attendance Sheet",
        descId: "Presensi berdasarkan lokasi GPS: WFO kantor/pabrik, WFH, dan kunjungan klien vs radius lokasi resmi.",
        descEn: "GPS-based presence: office/factory WFO, WFH, and client visits vs official location radius.",
        audience: "HR · Operations · Sales Manager", icon: MapPin,
      },
    ],
  },
  {
    key: "ag2",
    labelId: "Grup 2 — Analisis Keterlambatan & Jam Kerja Kurang",
    labelEn: "Group 2 — Late Arrival & Under-hours Analysis",
    descId: "Disiplin & produktivitas: log telat/pulang cepat, defisit jam kerja vs standar, dan peringkat pelanggar presensi.",
    descEn: "Discipline & productivity: late/early log, working-hours deficit vs standard, and attendance offender ranking.",
    reports: [
      {
        id: "ar21", no: "R2.1",
        titleId: "Late Arrival & Early Leaver Log",
        titleEn: "Late Arrival & Early Leaver Log",
        descId: "Daftar masuk telat & pulang cepat: menit pelanggaran vs jadwal shift beserta alasan.",
        descEn: "Late-in & early-out list: violation minutes vs shift schedule with reasons.",
        audience: "HR · Atasan Langsung · Supervisor", icon: Timer,
      },
      {
        id: "ar22", no: "R2.2",
        titleId: "Working Hours Deficit Report — Jam Kerja Kurang",
        titleEn: "Working Hours Deficit Report",
        descId: "Jam kerja efektif vs target standar (mis. < 40 jam/minggu) — defisit per karyawan.",
        descEn: "Effective hours vs standard target (e.g. < 40 hrs/week) — deficit per employee.",
        audience: "HR · Manajer Departemen · Payroll", icon: Hourglass,
      },
      {
        id: "ar23", no: "R2.3",
        titleId: "Top Attendance Offenders Sheet",
        titleEn: "Top Attendance Offenders Sheet",
        descId: "Peringkat karyawan telat/alpa tertinggi + rekomendasi konseling & SP berjenjang.",
        descEn: "Highest late/no-show ranking + counseling & progressive warning recommendation.",
        audience: "HR · Atasan Langsung · Legal", icon: AlertTriangle,
      },
    ],
  },
  {
    key: "ag3",
    labelId: "Grup 3 — Manajemen Lembur & Jam Kerja Efektif",
    labelEn: "Group 3 — Overtime & Effective Hours Management",
    descId: "Biaya & kepatuhan: rekap lembur hari kerja vs libur, estimasi indeks finansial, dan audit cap jam Depnaker.",
    descEn: "Cost & compliance: weekday vs holiday overtime recap, financial index estimate, and labour-cap audit.",
    reports: [
      {
        id: "ar31", no: "R3.1",
        titleId: "Overtime Summary Report — Rekap Jam Lembur",
        titleEn: "Overtime Summary Report",
        descId: "Jam lembur terverifikasi per karyawan: hari kerja vs akhir pean/hari libur yang disetujui atasan.",
        descEn: "Verified overtime per employee: weekday vs weekend/holiday approved by managers.",
        audience: "HR · Payroll · Kepala Departemen", icon: Clock,
      },
      {
        id: "ar32", no: "R3.2",
        titleId: "Overtime Financial Estimate Sheet — Estimasi Biaya Lembur",
        titleEn: "Overtime Financial Estimate Sheet",
        descId: "Kalkulasi estimasi bayar lembur berdasarkan indeks PP 35/2021 (gaji ÷ 173) untuk Finance/Payroll.",
        descEn: "Overtime pay estimate per PP 35/2021 index (salary ÷ 173) for Finance/Payroll.",
        audience: "Finance/Payroll · Direksi · Auditor", icon: Coins,
      },
      {
        id: "ar33", no: "R3.3",
        titleId: "Working Hours Compliance Audit — Cap Lembur",
        titleEn: "Working Hours Compliance Audit",
        descId: "Pemantauan batas maksimal lembur harian/mingguan/bulanan agar tidak melanggar regulasi Depnaker.",
        descEn: "Daily/weekly/monthly overtime cap monitoring against labour regulations.",
        audience: "HR · Legal/Kepatuhan · Auditor", icon: ShieldCheck,
      },
    ],
  },
  {
    key: "ag4",
    labelId: "Grup 4 — Variasi Jadwal & Kerja Shift",
    labelEn: "Group 4 — Shift Work & Schedule Variations",
    descId: "Operasional shift: deviasi jadwal vs presensi riil, jam premium malam/libur, dan transaksi presensi janggal.",
    descEn: "Shift operations: roster vs actual deviation, night/holiday premium hours, and attendance exceptions.",
    reports: [
      {
        id: "ar41", no: "R4.1",
        titleId: "Roster & Shift Schedule Deviation Report",
        titleEn: "Roster & Shift Schedule Deviation Report",
        descId: "Ketidaksesuaian jadwal shift terencana vs presensi riil: telat vs shift, tanpa punch, kerja hari off.",
        descEn: "Planned shift vs actual presence mismatch: late vs shift, no punch, off-day work.",
        audience: "Manajer Operasional · Supervisor Shift · HR", icon: CalendarClock,
      },
      {
        id: "ar42", no: "R4.2",
        titleId: "Night Shift & Special Premium Hours Log",
        titleEn: "Night Shift & Special Premium Hours Log",
        descId: "Rekap kerja shift malam & hari libur nasional — dasar penentuan insentif/tunjangan khusus.",
        descEn: "Night shift & national holiday work recap — basis for special incentive/allowance.",
        audience: "Payroll · HR · Manajer Operasional", icon: MoonStar,
      },
      {
        id: "ar43", no: "R4.3",
        titleId: "Attendance Exception Report — Transaksi Janggal",
        titleEn: "Attendance Exception Report",
        descId: "Absen masuk tanpa absen pulang, import mesin tanpa punch, dan koreksi manual hasil audit.",
        descEn: "Clock-in without clock-out, machine imports without punch, and audited manual corrections.",
        audience: "HR Operations · Supervisor · Auditor", icon: FileWarning,
      },
    ],
  },
];

export const ALL_REPORTS: ReportDef[] = REPORT_GROUPS.flatMap((g) => g.reports);

export function reportById(id: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
