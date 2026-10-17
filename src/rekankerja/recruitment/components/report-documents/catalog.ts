// SB-RC-RD — katalog 12 laporan distribusi Recruitment (4 grup) ============
// Definisi statis (id, judul ID/EN, deskripsi, audiens, ikon) dipakai katalog
// grid di tab "Dokumen Laporan" modul Recruitment. id dipakai sebagai ?id= ke
// API recruitment-report-documents.ts.
//
// Cakupan mengikuti alur bisnis F1–F4 (DEVELOPMENT-PLAN-RECRUITMENT.md):
//   G1 rencana & permintaan (MPP + PR) · G2 lowongan & sourcing ·
//   G3 seleksi & penilaian · G4 offer, pengangkatan & biaya.
import {
  ClipboardList, Hourglass, Gauge,
  Megaphone, GitBranch, UsersRound,
  Filter, AlarmClock, ClipboardCheck,
  MailCheck, UserCheck, Coins,
  type LucideIcon,
} from "lucide-react";

export interface ReportDef {
  id: string;
  /** nomor laporan, cth. "RC1.1" — badge di kartu katalog & kop dokumen. */
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
    key: "rg1",
    labelId: "Grup 1 — Rencana & Permintaan Karyawan",
    labelEn: "Group 1 — Planning & Requisitions",
    descId: "Rencana kebutuhan (MPP) formula a–h, register status permintaan (PR), dan pemantauan umur + kepatuhan SLA.",
    descEn: "Manpower plan (a–h formula), requisition status register, and aging + SLA compliance monitoring.",
    reports: [
      {
        id: "rc11", no: "RC1.1",
        titleId: "Recruitment Plan Recap — Rekap Rencana Kebutuhan (MPP)",
        titleEn: "Recruitment Plan Recap (MPP)",
        descId: "Formula a–h per posisi/kantor: target, penyesuaian, hasil, kebutuhan rekrut + rekonsiliasi PR & anggaran upah.",
        descEn: "a–h formula per position/office: target, adjustment, result, hiring need + PR reconciliation & salary budget.",
        audience: "Direksi · HR Manager · HRBP", icon: ClipboardList,
      },
      {
        id: "rc12", no: "RC1.2",
        titleId: "Personnel Requisition Status Register — Daftar Status PR",
        titleEn: "Personnel Requisition Status Register",
        descId: "Seluruh permintaan karyawan: posisi, pengaju, recruiter, jumlah dibutuh vs ter-appoint, status & umur.",
        descEn: "All requisitions: position, requester, recruiter, required vs appointed counts, status & age.",
        audience: "HR · Atasan Pengaju · Kepala Departemen", icon: Hourglass,
      },
      {
        id: "rc13", no: "RC1.3",
        titleId: "Requisition Aging & SLA Compliance — Umur PR & Kepatuhan SLA",
        titleEn: "Requisition Aging & SLA Compliance",
        descId: "Distribusi umur PR terbuka, bucket 14/30/60/90 hari, dan daftar PR melewati target SLA penyelesaian.",
        descEn: "Open requisition age distribution, 14/30/60/90-day buckets, and PRs past the completion SLA target.",
        audience: "HR · Manajer · Direksi", icon: Gauge,
      },
    ],
  },
  {
    key: "rg2",
    labelId: "Grup 2 — Lowongan & Sumber Pelamar",
    labelEn: "Group 2 — Openings & Sourcing",
    descId: "Kinerja iklan & slot lowongan, efektivitas kanal sumber pelamar, dan register talent pool.",
    descEn: "Advertising & opening slot performance, source channel effectiveness, and talent pool register.",
    reports: [
      {
        id: "rc21", no: "RC2.1",
        titleId: "Job Opening & Advertising Performance — Kinerja Iklan Lowongan",
        titleEn: "Job Opening & Advertising Performance",
        descId: "Per iklan (JO): slot PR yang dilayani, kanal & biaya terencana/aktual, lamaran masuk, kandidat & hire.",
        descEn: "Per job ad: PR slots served, channels & planned/actual cost, applications, candidates & hires.",
        audience: "HR · Marketing · Finance", icon: Megaphone,
      },
      {
        id: "rc22", no: "RC2.2",
        titleId: "Applicant Source Effectiveness — Efektivitas Sumber Pelamar",
        titleEn: "Applicant Source Effectiveness",
        descId: "Per sumber (iklan/agency/referral/web/internal): pelamar, kandidat, hire, belanja & cost per hire.",
        descEn: "Per source (ad/agency/referral/web/internal): applicants, candidates, hires, spend & cost per hire.",
        audience: "HR · Direksi · Finance", icon: GitBranch,
      },
      {
        id: "rc23", no: "RC2.3",
        titleId: "Talent Pool Register — Daftar Talent Pool",
        titleEn: "Talent Pool Register",
        descId: "Pelamar tersimpan: pendidikan tertinggi, IPK, pengalaman, sumber, status keep-on-file & flag blokir/suspend.",
        descEn: "Stored applicants: highest education, GPA, experience, source, keep-on-file status & block/suspend flags.",
        audience: "HR Recruiter · HRBP", icon: UsersRound,
      },
    ],
  },
  {
    key: "rg3",
    labelId: "Grup 3 — Seleksi & Penilaian Kandidat",
    labelEn: "Group 3 — Selection & Assessment",
    descId: "Corong seleksi per tahap (pass-through), pemantauan SLA jadwal tahap, dan ringkasan scorecard evaluator.",
    descEn: "Stage-by-stage selection funnel (pass-through), stage schedule SLA monitor, and evaluator scorecard summary.",
    reports: [
      {
        id: "rc31", no: "RC3.1",
        titleId: "Selection Funnel & Stage Pass-Through — Corong Seleksi per Tahap",
        titleEn: "Selection Funnel & Stage Pass-Through",
        descId: "Tahapan SelectionProcess aktif: jumlah masuk, dilaksanakan, lulus/gagal & pass rate + status kandidat.",
        descEn: "Active SelectionProcess stages: entered, performed, passed/failed & pass rate + candidate status roll-up.",
        audience: "HR · Psikolog · Interviewer Panel", icon: Filter,
      },
      {
        id: "rc32", no: "RC3.2",
        titleId: "Selection Stage SLA Monitor — Pemantauan SLA Tahap Seleksi",
        titleEn: "Selection Stage SLA Monitor",
        descId: "Jadwal & batas SLA per langkah kandidat: tepat waktu vs terlambat, tertunda yang sudah overdue.",
        descEn: "Schedule & SLA due per candidate step: on-time vs late, pending steps already overdue.",
        audience: "HR Recruiter · Atasan Interviewer", icon: AlarmClock,
      },
      {
        id: "rc33", no: "RC3.3",
        titleId: "Candidate Scorecard Summary — Ringkasan Scorecard Kandidat",
        titleEn: "Candidate Scorecard Summary",
        descId: "Pengisian rubrik per evaluator: rata-rata skor, rekomendasi hire, dan divergensi antar-evaluator > 2.",
        descEn: "Rubric completion per evaluator: average score, hire recommendation, and inter-evaluator divergence > 2.",
        audience: "HR · Interviewer Panel · Kepala Departemen", icon: ClipboardCheck,
      },
    ],
  },
  {
    key: "rg4",
    labelId: "Grup 4 — Offer, Pengangkatan & Biaya",
    labelEn: "Group 4 — Offer, Appointment & Cost",
    descId: "Status & respon offer, realisasi pengangkatan menjadi karyawan, dan biaya rekrutmen per hire.",
    descEn: "Offer status & response, appointment-to-employee realization, and recruitment cost per hire.",
    reports: [
      {
        id: "rc41", no: "RC4.1",
        titleId: "Offer Status & Response Report — Status & Respon Offer",
        titleEn: "Offer Status & Response Report",
        descId: "Offer terkirim: tanggal kirim/respon, kecepatan respon, kedaluwarsa, dan tingkat penerimaan.",
        descEn: "Sent offers: send/response dates, response speed, expiry, and acceptance rate.",
        audience: "HR · Direksi", icon: MailCheck,
      },
      {
        id: "rc42", no: "RC4.2",
        titleId: "Hiring Realization Report — Laporan Realisasi Rekrutmen",
        titleEn: "Hiring Realization Report",
        descId: "Kandidat yang diangkat: penempatan, tanggal mulai, pembuatan karyawan & status lanjut onboarding.",
        descEn: "Appointed candidates: placement, start date, employee creation & onboarding continuation status.",
        audience: "HR · Payroll · GA/IT (akun baru)", icon: UserCheck,
      },
      {
        id: "rc43", no: "RC4.3",
        titleId: "Recruitment Cost per Hire Report — Biaya Rekrutmen per Hire",
        titleEn: "Recruitment Cost per Hire Report",
        descId: "Biaya kanal per iklan: terencana vs aktual, total anggaran periode, dan cost per hire keseluruhan.",
        descEn: "Channel costs per job ad: planned vs actual, period budget total, and overall cost per hire.",
        audience: "Finance · Direksi · HR", icon: Coins,
      },
    ],
  },
];

export const ALL_REPORTS: ReportDef[] = REPORT_GROUPS.flatMap((g) => g.reports);

export function reportById(id: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
