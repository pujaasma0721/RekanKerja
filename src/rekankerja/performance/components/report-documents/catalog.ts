// P8-PERF — katalog 14 laporan dokumen Performance (4 grup) ===================
// Mirror pola medical/components/report-documents/catalog.ts (MED-1-b; pola
// asal HR T110 / Leave T112). Definisi statis (id, judul ID/EN, deskripsi,
// audiens, ikon) dipakai katalog grid di tab "Dokumen Laporan" modul
// Performance. id dipakai sebagai ?id= ke API report-documents.ts (§11.2).
import {
  CalendarRange, ClipboardCheck, Target,
  ClipboardList, BarChart3, NotebookPen, Users,
  Scale, Gauge, MessageSquareWarning,
  Wallet, Waypoints, LayoutGrid, TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface ReportDef {
  id: string;
  /** nomor laporan, cth. "P1.1" — badge di kartu katalog & kop dokumen. */
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
    key: "pg1",
    labelId: "Grup 1 — Siklus & Partisipasi",
    labelEn: "Group 1 — Cycles & Participation",
    descId: "Register siklus penilaian & gerbang fase, tingkat penyelesaian formulir per fase (siapa yang belum mengisi target/penilaian), dan register penetapan KPI beserta bobot dan target.",
    descEn: "Appraisal cycle register & phase gates, per-phase form completion (who has not filled targets/appraisals), and the KPI assignment register with weights and targets.",
    reports: [
      {
        id: "pf11", no: "P1.1", icon: CalendarRange,
        titleId: "Register Siklus & Fase Penilaian",
        titleEn: "Appraisal Cycle & Phase Register",
        descId: "Daftar seluruh siklus: kode, periode, status, jendela fase (target–kalibrasi), jumlah peserta, dan tingkat penyelesaian.",
        descEn: "All cycles: code, period, status, phase windows (goals–calibration), participant count, and completion level.",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf12", no: "P1.2", icon: ClipboardCheck,
        titleId: "Completion per Fase",
        titleEn: "Per-Phase Completion",
        descId: "Per peserta dalam satu siklus: apakah target sudah dikunci, self-assessment selesai, penilaian atasan selesai, hasil di-acknowledge — plus daftar yang belum mengisi.",
        descEn: "Per participant in one cycle: targets locked?, self-assessment done?, manager appraisal done?, result acknowledged? — plus the not-yet-filled list.",
        audience: "HR Admin · Atasan Langsung",
      },
      {
        id: "pf13", no: "P1.3", icon: Target,
        titleId: "Register Penetapan KPI",
        titleEn: "KPI Assignment Register",
        descId: "Seluruh baris KPI per siklus: judul, satuan, polaritas, bobot, ambang gagal/target/stretch, flag kritis, dan asal baris (manual/pustaka/salin periode).",
        descEn: "All KPI rows per cycle: title, unit, polarity, weight, fail threshold/target/stretch, critical flag, and row origin (manual/library/copied).",
        audience: "HR Admin · Atasan · Karyawan (terkait)",
      },
    ],
  },
  {
    key: "pg2",
    labelId: "Grup 2 — Penilaian & Hasil",
    labelEn: "Group 2 — Assessment & Results",
    descId: "Register hasil per periode, distribusi rating per unit dan per atasan, scorecard detail per karyawan, dan ringkasan 360 ter-agregasi (anonim ≥3 penilai).",
    descEn: "Per-period results register, rating distribution by unit and manager, per-employee detailed scorecard, and aggregated 360 summary (anonymous, ≥3 raters).",
    reports: [
      {
        id: "pf21", no: "P2.1", icon: ClipboardList,
        titleId: "Register Hasil per Periode",
        titleEn: "Per-Period Results Register",
        descId: "Per peserta: skor atasan, skor final, rating, band potensi, status, dan penanda hasil ter-kalibrasi.",
        descEn: "Per participant: manager score, final score, rating, potential band, status, and the calibration-adjusted flag.",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf22", no: "P2.2", icon: BarChart3,
        titleId: "Distribusi Rating per Unit & Atasan",
        titleEn: "Rating Distribution by Unit & Manager",
        descId: "Hitungan rating 1–5, rata-rata, dan simpangan baku — dikelompokkan per unit kerja dan per atasan penilai.",
        descEn: "Rating 1–5 counts, mean, and standard deviation — grouped by work unit and by rating manager.",
        audience: "HR Admin · Direksi · Forum Kalibrasi",
      },
      {
        id: "pf23", no: "P2.3", icon: NotebookPen,
        titleId: "Detail Skor KPI & Kompetensi per Karyawan",
        titleEn: "Per-Employee KPI & Competency Scorecard",
        descId: "Scorecard utuh satu peserta dalam satu siklus: baris KPI (target/aktual/skor/bobot), skor kompetensi, ringkasan 360 (bila ada), dan hasil final.",
        descEn: "Full scorecard of one participant in one cycle: KPI rows (target/actual/score/weight), competency scores, 360 summary (when present), and the final result.",
        audience: "HR Admin · Atasan Langsung",
      },
      {
        id: "pf24", no: "P2.4", icon: Users,
        titleId: "Ringkasan 360 Ter-agregasi (Anonim)",
        titleEn: "Aggregated 360 Summary (Anonymous)",
        descId: "Agregat per kelompok reviewer (atasan/rekan/bawahan) — HANYA kelompok dengan ≥3 responden; tidak ada baris individual (jaga anonimitas §37).",
        descEn: "Aggregates per reviewer group (manager/peer/subordinate) — ONLY groups with ≥3 respondents; no individual rows (anonymity guard §37).",
        audience: "HR Admin · Forum Kalibrasi",
      },
    ],
  },
  {
    key: "pg3",
    labelId: "Grup 3 — Kualitas & Kepatuhan",
    labelEn: "Group 3 — Quality & Compliance",
    descId: "Jejak audit kalibrasi (dari → ke + alasan), indikator bias atasan (z-flag pelis/royal/central tendency — D19), dan register banding beserta keputusannya.",
    descEn: "Calibration audit trail (from → to + reason), rater bias indicators (stingy/lenient/central-tendency z-flags — D19), and the appeals register with decisions.",
    reports: [
      {
        id: "pf31", no: "P3.1", icon: Scale,
        titleId: "Jejak Kalibrasi (Audit Trail)",
        titleEn: "Calibration Audit Trail",
        descId: "Seluruh sesi kalibrasi siklus + setiap keputusan: skor/rating dari → ke, alasan wajib, pemutus, dan waktu keputusan.",
        descEn: "All calibration sessions of the cycle + every decision: score/rating from → to, mandatory reason, decider, and decision timestamp.",
        audience: "HR Admin · Auditor Internal · Direksi",
      },
      {
        id: "pf32", no: "P3.2", icon: Gauge,
        titleId: "Indikator Bias Atasan",
        titleEn: "Rater Bias Indicators",
        descId: "Per atasan: rata-rata tim vs rata-rata perusahaan, rasio sebaran, dan z-flag pelis/royal/central tendency (logika bell curve D19).",
        descEn: "Per manager: team mean vs company mean, spread ratio, and stingy/lenient/central-tendency z-flags (bell curve D19 logic).",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf33", no: "P3.3", icon: MessageSquareWarning,
        titleId: "Register Banding & Keputusannya",
        titleEn: "Appeals Register & Decisions",
        descId: "Seluruh banding hasil penilaian: alasan pengaju, status, pemutus, waktu keputusan, dan akhir jendela banding (D6).",
        descEn: "All result appeals: appellant's note, status, decider, decision time, and appeal window end (D6).",
        audience: "HR Admin · Direksi",
      },
    ],
  },
  {
    key: "pg4",
    labelId: "Grup 4 — Konsekuensi & Analitik",
    labelEn: "Group 4 — Consequences & Analytics",
    descId: "Register merit (usulan → approval → realisasi payroll/PA), register PIP & tingkat pemulihan, snapshot 9-box, dan tren kinerja multi-tahun per unit.",
    descEn: "Merit register (proposal → approval → payroll/PA realization), PIP register & recovery rate, 9-box snapshot, and multi-year performance trend per unit.",
    reports: [
      {
        id: "pf41", no: "P4.1", icon: Wallet,
        titleId: "Register Merit",
        titleEn: "Merit Register",
        descId: "Usulan merit per siklus: bulan/jumlah bonus, persen/jumlah kenaikan, status approval, realisasi payroll (run) dan PA, nomor surat hasil.",
        descEn: "Merit proposals per cycle: bonus months/amount, raise percent/amount, approval status, payroll (run) and PA realization, result letter number.",
        audience: "HR C&B · Finance · Direksi",
      },
      {
        id: "pf42", no: "P4.2", icon: Waypoints,
        titleId: "Register PIP & Outcome",
        titleEn: "PIP Register & Outcomes",
        descId: "Seluruh program perbaikan kinerja: periode, checkpoint ter-review, capaian terakhir, outcome (Pulih/Belum/Perpanjang), dan saran SP bila belum pulih.",
        descEn: "All performance improvement plans: period, checkpoints reviewed, last achievement, outcome (Recovered/Not/Extended), and SP suggestion when not recovered.",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf43", no: "P4.3", icon: LayoutGrid,
        titleId: "Snapshot 9-Box",
        titleEn: "9-Box Snapshot",
        descId: "Grid talenta 3×3 saat ini (band potensi × kinerja): daftar karyawan per sel dari hasil final siklus terpilih.",
        descEn: "Current 3×3 talent grid (potential band × performance): employees per cell from the selected cycle's final results.",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf44", no: "P4.4", icon: TrendingUp,
        titleId: "Tren Kinerja Multi-Tahun per Unit",
        titleEn: "Multi-Year Performance Trend per Unit",
        descId: "Per unit × tahun siklus: jumlah peserta, rata-rata skor final, dan distribusi rating — tabel tren lintas siklus.",
        descEn: "Per unit × cycle year: participant count, final score mean, and rating distribution — a trend table across cycles.",
        audience: "HR Admin · Direksi",
      },
    ],
  },
];

export const ALL_REPORTS: ReportDef[] = REPORT_GROUPS.flatMap((g) => g.reports);

export function reportById(id: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
