"use client";
// RekanKerja Recruitment — tipe & label bersama modul (F0).
// Sumber: DEVELOPMENT-PLAN-RECRUITMENT.md §3 (matriks jejak) + §7 F0.
import type { MasterType } from "@/rekankerja/recruitment/services/recruitment-master-service";

// ---------- katalog tipe master (label + ikon nama + deskripsi dwibahasa) ----------

export interface MasterTypeDef {
  type: MasterType;
  label: string;          // ID
  labelEn: string;        // EN
  desc: string;           // ID (ringkas utk tooltip/overview)
  descEn: string;
  /** kolom khusus tipe ini (selain code/nama/aktif) — config form generik */
  fields: MasterFieldKind[];
}

export type MasterFieldKind =
  | "scope"            // select Internal|External|Both (method)
  | "description"      // textarea (method/cost-item/skill/eval-category/selection-process)
  | "address"          // agency
  | "contact"          // agency
  | "note"             // agency
  | "fileType"         // required-document
  | "mandatory"        // required-document (checkbox)
  | "ranking"          // eval-scale (number)
  | "days"            // sla-group (number)
  | "resultType"       // selection-process (select Quant|Qual)
  | "processOrder"     // selection-process (number)
  | "slaDays"          // selection-process (number)
  | "minResultPass"    // selection-process (number, opsional)
  | "needAcknowledgement" // selection-process (checkbox)
  | "appliesInternal" // selection-process (checkbox)
  | "appliesExternal" // selection-process (checkbox)
  | "mandatoryStep";   // selection-process (checkbox)

export const MASTER_DEFS: MasterTypeDef[] = [
  {
    type: "method",
    label: "Metode Rekrutmen", labelEn: "Recruitment Method",
    desc: "Kanal pencarian kandidat (internal/eksternal) — padanan Recruitment Method oranHR",
    descEn: "Candidate sourcing channel (internal/external) — oranHR Recruitment Method",
    fields: ["scope", "description"],
  },
  {
    type: "ad-media",
    label: "Media Advertensi", labelEn: "Ad Media Type",
    desc: "Media iklan lowongan (koran, portal, LinkedIn…)",
    descEn: "Job ad media (newspaper, portal, LinkedIn…)",
    fields: [],
  },
  {
    type: "agency",
    label: "Agency Tenaga Kerja", labelEn: "Employment Agency",
    desc: "Vendor penempatan/outsourcing — padanan EmpAgency oranHR",
    descEn: "Placement/outsourcing vendor — oranHR EmpAgency",
    fields: ["address", "contact", "note"],
  },
  {
    type: "cost-item",
    label: "Pos Biaya Rekrutmen", labelEn: "Recruitment Cost Item",
    desc: "Kategori biaya (iklan, fee agency, psikotes…) — basis budget F5",
    descEn: "Cost categories (ads, agency fee, psych tests…) — budget base for F5",
    fields: ["description"],
  },
  {
    type: "skill",
    label: "Skill / Kemampuan", labelEn: "Skills",
    desc: "Kemampuan kandidat (padanan Skill oranHR)",
    descEn: "Candidate skills (oranHR Skill)",
    fields: ["description"],
  },
  {
    type: "required-document",
    label: "Dokumen Wajib Pelamar", labelEn: "Required Documents",
    desc: "Checklist dokumen lamaran (CV & KTP wajib) — dipakai talent pool F2",
    descEn: "Application document checklist (CV & KTP mandatory) — used by talent pool F2",
    fields: ["fileType", "mandatory"],
  },
  {
    type: "eval-category",
    label: "Kategori Penilaian", labelEn: "Evaluation Category",
    desc: "Dimensi penilaian kandidat — basis scorecard F3",
    descEn: "Candidate evaluation dimensions — scorecard base for F3",
    fields: ["description"],
  },
  {
    type: "eval-scale",
    label: "Skala Penilaian", labelEn: "Evaluation Scale",
    desc: "Skala + ranking (padanan Applicant Evaluation Scale oranHR)",
    descEn: "Scale + ranking (oranHR Applicant Evaluation Scale)",
    fields: ["ranking"],
  },
  {
    type: "sla-group",
    label: "Grup SLA", labelEn: "SLA Group",
    desc: "Target hari penyelesaian per kelompok tahap (padanan SLA Group oranHR)",
    descEn: "Days target per stage group (oranHR SLA Group)",
    fields: ["days"],
  },
  {
    type: "selection-process",
    label: "Tahap Seleksi", labelEn: "Selection Process",
    desc: "Katalog tahap seleksi berurutan — padanan Standard Selection Process oranHR (config-over-code)",
    descEn: "Ordered selection stage catalog — oranHR Standard Selection Process (config over code)",
    fields: ["description", "resultType", "processOrder", "slaDays", "minResultPass", "needAcknowledgement", "appliesInternal", "appliesExternal", "mandatoryStep"],
  },
];

export function masterDefOf(type: MasterType): MasterTypeDef {
  return MASTER_DEFS.find((m) => m.type === type) ?? MASTER_DEFS[0];
}

// label status master aktif/nonaktif
export const ACTIVE_LABEL = { id: "Aktif", en: "Active" };
export const INACTIVE_LABEL = { id: "Nonaktif", en: "Inactive" };

// ---------- F1 — PersonnelRequisition (PR) ----------

/** Status PR + label dwibahasa (urutan = urutan filter UI). */
export const PR_STATUSES: { key: string; label: string; labelEn: string }[] = [
  { key: "Draft", label: "Draft", labelEn: "Draft" },
  { key: "Submitted", label: "Menunggu", labelEn: "Pending" },
  { key: "Approved", label: "Disetujui", labelEn: "Approved" },
  { key: "Rejected", label: "Ditolak", labelEn: "Rejected" },
  { key: "OnHold", label: "Ditahan", labelEn: "On Hold" },
  { key: "Fulfilled", label: "Terpenuhi", labelEn: "Fulfilled" },
  { key: "Closed", label: "Ditutup", labelEn: "Closed" },
  { key: "Cancelled", label: "Dibatalkan", labelEn: "Cancelled" },
];

export const PR_STATUS_LABEL: Record<string, string> = Object.fromEntries(PR_STATUSES.map((s) => [s.key, s.label]));
export const PR_STATUS_LABEL_EN: Record<string, string> = Object.fromEntries(PR_STATUSES.map((s) => [s.key, s.labelEn]));

/** Warna pill status PR (peta StatusPill tone). */
export const PR_STATUS_TONE: Record<string, string> = {
  Draft: "slate", Submitted: "amber", Approved: "emerald", Rejected: "rose",
  OnHold: "violet", Fulfilled: "teal", Closed: "zinc", Cancelled: "slate",
};

export const PR_EMPLOYMENT_STATUSES: { key: string; label: string; labelEn: string }[] = [
  { key: "Permanent", label: "Tetap", labelEn: "Permanent" },
  { key: "Contract", label: "Kontrak", labelEn: "Contract" },
  { key: "Probation", label: "Percobaan", labelEn: "Probation" },
  { key: "Outsourcing", label: "Outsourcing", labelEn: "Outsourcing" },
];

export const PR_EMPLOYMENT_LABEL: Record<string, string> = Object.fromEntries(PR_EMPLOYMENT_STATUSES.map((s) => [s.key, s.label]));
export const PR_EMPLOYMENT_LABEL_EN: Record<string, string> = Object.fromEntries(PR_EMPLOYMENT_STATUSES.map((s) => [s.key, s.labelEn]));

export const PR_SOURCES: { key: string; label: string; labelEn: string }[] = [
  { key: "Any", label: "Semua sumber", labelEn: "Any source" },
  { key: "Internal", label: "Internal", labelEn: "Internal" },
  { key: "External", label: "Eksternal", labelEn: "External" },
];

/** Baris PR versi UI (mirror JSON API pr-service PrRow). */
export interface PrRowUI {
  id: string;
  prNo: string;
  requestDate: string;
  status: string;
  requestedById: string;
  requesterName: string;
  requesterNo: string;
  positionId: string | null;
  positionTitle: string | null;
  positionCode: string | null;
  jobId: string | null;
  jobTitle: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  companyOfficeId: string | null;
  officeName: string | null;
  requiredNo: number;
  employmentStatus: string;
  preferredSource: string | null;
  earliestDate: string | null;
  latestDate: string | null;
  recruitmentOfficerId: string | null;
  officerName: string | null;
  reason: string | null;
  miscSpec: string | null;
  additionalQualification: string | null;
  salaryBudget: number | null;
  autoPostOpening: boolean;
  slaTargetDays: number | null;
  replacedEmployeeId: string | null;
  replacedEmployeeName: string | null;
  decisionNote: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  approval: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}

/** Opsi dropdown form PR (dari /recruitment/pr-options — SELECT sempit). */
export interface PrOptions {
  employees: { id: string; employeeNo: string; fullName: string; positionTitle: string | null }[];
  positions: { id: string; code: string; title: string; orgUnitName: string | null }[];
  jobs: { id: string; code: string; title: string }[];
  orgUnits: { id: string; code: string; name: string }[];
  offices: { id: string; code: string; name: string; city: string | null }[];
}
