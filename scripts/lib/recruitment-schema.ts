// Peta lengkap struktur modul REKRUTMEN (F0–F9) yang dibuat migrasi phase —
// sumber tunggal untuk:
//   • scripts/audit-recruitment-schema.ts (audit read-only produksi)
//   • src/rekankerja/shared/lib/parity-runner.ts — checkParityGap()
//     (pemeriksaan gap TIDAK lagi satu tabel per fase, melainkan seluruh tabel
//    /kolom di bawah — latar: error produksi berulang menu-menu recruitment
//     akibat tabel sekunder fase yang luput dari deteksi gap).
// Selaras scripts/migrate-recruitment-f0..f9.ts + migrate-plan-link.ts:
// setiap entri dibuat CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
// Audit ibarat petunjuk, BUKAN sulap: aim-for-results yang diharapkan adalah
// daftar tabel/kolom yang hilang per tenant — bukan sekadar gap=true/false.

export type RecruitmentPhase = "F0" | "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "LINK";

export type RecruitmentTableMap = {
  phase: RecruitmentPhase;
  table: string;
  columns?: string[]; // kolom yang ditambahkan ALTER pada tabel lain/fase lain -> kosong utk baris CREATE penuh
} | null;

/** Tabel inti per fase — setiap baris Wajib ada di setiap tenant post-migrasi. */
export const RECRUITMENT_TABLES: { phase: RecruitmentPhase; table: string }[] = [
  // F0 — 10 tabel master + katalog tahap seleksi
  { phase: "F0", table: "RecruitmentMethod" },
  { phase: "F0", table: "AdMediaType" },
  { phase: "F0", table: "EmploymentAgency" },
  { phase: "F0", table: "RecruitmentCostItem" },
  { phase: "F0", table: "Skill" },
  { phase: "F0", table: "RequiredDocument" },
  { phase: "F0", table: "EvaluationCategory" },
  { phase: "F0", table: "EvaluationScale" },
  { phase: "F0", table: "SlaGroup" },
  { phase: "F0", table: "SelectionProcess" },
  // F1 — PersonnelRequisition (PR + approval)
  { phase: "F1", table: "PersonnelRequisition" },
  // F2 — 11 tabel lowongan + pelamar
  { phase: "F2", table: "JobOpportunity" },
  { phase: "F2", table: "JobOpening" },
  { phase: "F2", table: "JobOpeningMethod" },
  { phase: "F2", table: "Applicant" },
  { phase: "F2", table: "ApplicantApplication" },
  { phase: "F2", table: "ApplicantDocument" },
  { phase: "F2", table: "ApplicantEducation" },
  { phase: "F2", table: "ApplicantExperience" },
  { phase: "F2", table: "ApplicantSkill" },
  { phase: "F2", table: "ApplicantConsent" },
  { phase: "F2", table: "PublicApplication" },
  // F3 — 7 tabel kandidat & seleksi
  { phase: "F3", table: "JobCandidate" },
  { phase: "F3", table: "CandidateSelectionStep" },
  { phase: "F3", table: "ScorecardTemplate" },
  { phase: "F3", table: "ScorecardItem" },
  { phase: "F3", table: "ScorecardCompetency" },
  { phase: "F3", table: "CandidateScorecard" },
  { phase: "F3", table: "RecruitmentLetter" },
  // F4 — offer & pengangkatan
  { phase: "F4", table: "CandidateOffer" },
  { phase: "F4", table: "CandidateAppointment" },
  // F5 — rencana & anggaran
  { phase: "F5", table: "RecruitmentPlan" },
  { phase: "F5", table: "RecruitmentBudget" },
  { phase: "F5", table: "EmpJobApplication" },
  // F6 — AI rekrutmen
  { phase: "F6", table: "KnockoutQuestion" },
  { phase: "F6", table: "ApplicationAnswer" },
  { phase: "F6", table: "CvParseResult" },
  { phase: "F6", table: "CandidateAiScore" },
  // F7 — otomasi & integrasi
  { phase: "F7", table: "WebhookEndpoint" },
  { phase: "F7", table: "WebhookDelivery" },
  { phase: "F7", table: "NotificationPref" },
  { phase: "F7", table: "RecruitmentSetting" },
  { phase: "F7", table: "EsignRequest" },
  // F8 — analitik
  { phase: "F8", table: "MetricSnapshot" },
  { phase: "F8", table: "SavedReportView" },
  // F9 — DSR UU PDP
  { phase: "F9", table: "DataSubjectRequest" },
];

/** Kolom ALTER yang ditambahkan ke tabel LAIN pada fase-(n+1) — wajib ada
 *  bila tabel induknya sudah ada (pola sama dgn gap promotion v1). */
export const RECRUITMENT_ALTER_COLUMNS: { phase: RecruitmentPhase; table: string; column: string }[] = [
  { phase: "F3", table: "CandidateSelectionStep", column: "letterNo" },
  { phase: "F5", table: "JobOpportunity", column: "internalOnly" },
  { phase: "F5", table: "JobOpportunity", column: "internalFirstUntil" },
  { phase: "F6", table: "PersonnelRequisition", column: "rubricJson" },
  { phase: "LINK", table: "PersonnelRequisition", column: "planId" },
];
