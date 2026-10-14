// P8-PERF — katalog 14 laporan kinerja pf11–pf44 (4 grup) ====================
// (DEVELOPMENT-PLAN-PERFORMANCE.md §11.2 — AUTHORITATIVE). Mirror pola
// medical/report-documents/catalog.ts. Definisi statis (id, judul ID/EN,
// deskripsi, audiens, ikon) dipakai grid katalog di tab "Dokumen Laporan"
// modul Performance. id dipakai sebagai ?id= ke API
// performance-report-documents.ts.
import {
  CalendarRange, ListChecks, Target,
  ClipboardCheck, PieChart, ScrollText, Radar,
  GitBranch, FileWarning, Scale,
  Wallet, LifeBuoy, Grid3x3, LineChart,
  type LucideIcon,
} from "lucide-react";

export interface ReportDef {
  id: string;
  /** nomor laporan, cth. "F1.1" — badge di kartu katalog & kop dokumen. */
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
    descId: "Peta siklus penilaian & fase, completion per fase (siapa yang belum mengisi target / penilaian diri / atasan), dan register penetapan KPI beserta bobot-validasinya.",
    descEn: "Appraisal cycle & phase map, per-phase completion (who hasn't filled targets / self / manager assessment), and the KPI assignment register with weight validation.",
    reports: [
      {
        id: "pf11", no: "F1.1", icon: CalendarRange,
        titleId: "Register Siklus & Fase",
        titleEn: "Cycle & Phase Register",
        descId: "Daftar siklus penilaian per tahun: jendela fase (target → tengah tahun → self → atasan → kalibrasi), fase aktif, status, jumlah peserta, target terkunci, dan hasil terbit.",
        descEn: "Appraisal cycles per year: phase windows (goals → mid-year → self → manager → calibration), active phase, status, participant counts, locked targets, and published results.",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf12", no: "F1.2", icon: ListChecks,
        titleId: "Completion per Fase",
        titleEn: "Phase Completion Report",
        descId: "Matriks keikutsertaan per peserta satu siklus — menyorot SIAPA YANG BELUM MENGISI target, penilaian diri, atau penilaian atasan (dasar nudge §18.8).",
        descEn: "Per-participant participation matrix for one cycle — highlighting WHO HASN'T SUBMITTED targets, self, or manager assessment (the basis for nudges §18.8).",
        audience: "HR Admin · Atasan Langsung",
      },
      {
        id: "pf13", no: "F1.3", icon: Target,
        titleId: "Register Penetapan KPI",
        titleEn: "KPI Assignment Register",
        descId: "Seluruh KPI yang dinilai per siklus: kategori BSC, polaritas, bobot, ambang/target/stretch, satuan, asal (pustaka/salin/manual), dan sumber data (AUTO vs Manual).",
        descEn: "All assessed KPIs per cycle: BSC category, polarity, weight, threshold/target/stretch, unit, origin (library/copy/manual), and data source (AUTO vs Manual).",
        audience: "HR Admin · Atasan · Karyawan (ESS)",
      },
    ],
  },
  {
    key: "pg2",
    labelId: "Grup 2 — Penilaian & Hasil",
    labelEn: "Group 2 — Appraisal & Results",
    descId: "Register hasil per periode, distribusi rating per unit/atasan, detail skor KPI & kompetensi per karyawan (riwayat eksporabel PP 35/2021 §7.2), dan ringkasan 360 ter-agregasi.",
    descEn: "Period results register, rating distribution per unit/manager, per-employee KPI & competency detail (exportable history PP 35/2021 §7.2), and aggregated 360 summary.",
    reports: [
      {
        id: "pf21", no: "F2.1", icon: ClipboardCheck,
        titleId: "Register Hasil per Periode",
        titleEn: "Period Results Register",
        descId: "Hasil akhir seluruh peserta satu siklus: skor self/atasan/final, rating, status, jejak kalibrasi & banding — dasar surat hasil dan merit.",
        descEn: "Final results for all participants of one cycle: self/manager/final scores, rating, status, calibration & appeal trail — the basis for result letters and merit.",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf22", no: "F2.2", icon: PieChart,
        titleId: "Distribusi Rating per Unit/Atasan",
        titleEn: "Rating Distribution by Unit/Manager",
        descId: "Sebaran rating 1–5 per unit kerja atau per atasan penilai + rata-rata skor — lensa kewajaran antar kelompok (tanpa kuota).",
        descEn: "Rating 1–5 distribution per work unit or per appraising manager + average score — a fairness lens across groups (no forced quota).",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf23", no: "F2.3", icon: ScrollText,
        titleId: "Detail Skor KPI & Kompetensi per Karyawan",
        titleEn: "Employee KPI & Competency Detail",
        descId: "REGISTER RIWAYAT PER KARYAWAN (PP 35/2021 §7.2): seluruh siklus yang pernah diikuti + skor/rating/kalibrasi/banding/acknowledge — atau detail KPI & kompetensi satu siklus.",
        descEn: "PER-EMPLOYEE HISTORY REGISTER (PP 35/2021 §7.2): all cycles ever attended + score/rating/calibration/appeal/acknowledgement — or one cycle's KPI & competency detail.",
        audience: "HR Admin · Atasan · Karyawan (dirinya)",
      },
      {
        id: "pf24", no: "F2.4", icon: Radar,
        titleId: "Ringkasan 360 Ter-agregasi",
        titleEn: "Aggregated 360° Summary",
        descId: "Partisipasi & rata-rata skor 360 per kategori reviewer (rekan/bawahan/lintas tim/upward) — angka HANYA tampil saat ambang anonimitas ≥3 terpenuhi.",
        descEn: "360 participation & average scores per reviewer category (peer/subordinate/cross-team/upward) — numbers shown ONLY when the ≥3 anonymity threshold is met.",
        audience: "HR Admin · Atasan Langsung",
      },
    ],
  },
  {
    key: "pg3",
    labelId: "Grup 3 — Kualitas & Kepatuhan",
    labelEn: "Group 3 — Quality & Compliance",
    descId: "Jejak audit kalibrasi (setiap perubahan nilai + alasan wajib), indikator bias atasan (z-score pelis/royal D19), dan register banding beserta keputusannya.",
    descEn: "Calibration audit trail (every score change + mandatory reason), manager bias indicators (leniency/strictness z-score D19), and the appeal register with decisions.",
    reports: [
      {
        id: "pf31", no: "F3.1", icon: GitBranch,
        titleId: "Jejak Kalibrasi",
        titleEn: "Calibration Audit Trail",
        descId: "Setiap keputusan kalibrasi ter-audit: sesi forum, ketua, skor/rating dari → ke, band potensi, alasan WAJIB, pemutus & waktu — bukti kewajaran proses.",
        descEn: "Every calibration decision audited: forum session, chair, score/rating from → to, potential band, MANDATORY reason, decider & time — evidence of process fairness.",
        audience: "HR Admin · Direksi · Auditor",
      },
      {
        id: "pf32", no: "F3.2", icon: Scale,
        titleId: "Indikator Bias Atasan",
        titleEn: "Manager Bias Indicator",
        descId: "Statistik penilaian per atasan (rata-rata, sebaran, z-score vs perusahaan) — z ≤ −1 cenderung pelis, z ≥ +1 cenderung royal (amber), |z| ≥ 2 merah; central tendency terdeteksi.",
        descEn: "Per-manager rating statistics (mean, spread, z-score vs company) — z ≤ −1 lenient-leaning, z ≥ +1 strict-leaning (amber), |z| ≥ 2 red; central tendency detected.",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf33", no: "F3.3", icon: FileWarning,
        titleId: "Register Banding",
        titleEn: "Appeal Register",
        descId: "Seluruh banding karyawan atas hasil penilaian: alasan, tanggal, keputusan (Disetujui → skor baru / Ditolak), pemutus — bukti jalur keberatan yang hidup.",
        descEn: "All employee appeals against appraisal results: reason, date, decision (Approved → new score / Rejected), decider — evidence of a living objection channel.",
        audience: "HR Admin · Direksi",
      },
    ],
  },
  {
    key: "pg4",
    labelId: "Grup 4 — Konsekuensi & Analitik",
    labelEn: "Group 4 — Consequences & Analytics",
    descId: "Register merit (usulan → approval → jurnal payroll yang menyerap), register PIP & tingkat pemulihannya, snapshot 9-box, dan tren kinerja multi-tahun per unit.",
    descEn: "Merit register (proposal → approval → absorbing payroll journal), PIP register & recovery rate, 9-box snapshot, and multi-year performance trend per unit.",
    reports: [
      {
        id: "pf41", no: "F4.1", icon: Wallet,
        titleId: "Register Merit",
        titleEn: "Merit Register",
        descId: "Usulan bonus & kenaikan gaji pasca-penilaian: nominal (mengikuti Brankas Uang), status approval berjenjang, run payroll yang menyerap, dan tautan PA.",
        descEn: "Post-appraisal bonus & raise proposals: amounts (following the Money Vault), tiered approval status, the absorbing payroll run, and PA links.",
        audience: "HR C&B · Finance · Direksi",
      },
      {
        id: "pf42", no: "F4.2", icon: LifeBuoy,
        titleId: "Register PIP & Outcome",
        titleEn: "PIP & Outcome Register",
        descId: "Program Perbaikan Kinerja 30/60/90: periode (+perpanjangan), sasaran, capaian checkpoint, status, hasil akhir, dan tingkat pemulihan.",
        descEn: "30/60/90 Performance Improvement Plans: period (+extension), targets, checkpoint achievements, status, final outcome, and recovery rate.",
        audience: "HR Admin · Atasan Pembina",
      },
      {
        id: "pf43", no: "F4.3", icon: Grid3x3,
        titleId: "Snapshot 9-Box",
        titleEn: "9-Box Snapshot",
        descId: "Matriks kinerja × potensi 3×3 (rating → band performa, band potensi dari kalibrasi): sebaran talenta per sel + daftar karyawan — bahan suksesi.",
        descEn: "3×3 performance × potential matrix (rating → performance band, potential band from calibration): talent spread per cell + employee list — succession input.",
        audience: "HR Admin · Direksi",
      },
      {
        id: "pf44", no: "F4.4", icon: LineChart,
        titleId: "Tren Kinerja Multi-Tahun per Unit",
        titleEn: "Multi-Year Performance Trend by Unit",
        descId: "Rata-rata skor final per unit lintas tahun siklus + tren perusahaan — deteksi perbaikan/penurunan kinerja unit dari waktu ke waktu.",
        descEn: "Average final score per unit across cycle years + company trend — detect unit improvement/decline over time.",
        audience: "HR Admin · Direksi",
      },
    ],
  },
];

export const ALL_REPORTS: ReportDef[] = REPORT_GROUPS.flatMap((g) => g.reports);

export function reportById(id: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
