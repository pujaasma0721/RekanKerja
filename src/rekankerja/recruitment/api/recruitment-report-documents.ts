import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet, type ExportColumn, type ExportCell } from "@/rekankerja/shared/lib/export";
import { trFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// =============================================================================
// SB-RC-RD — LAPORAN DISTRIBUSI RECRUITMENT (print & PDF ready) ==============
// =============================================================================
// GET /api/rekankerja/recruitment/reports/documents?id=<rcId> — data satu
// laporan siap cetak (12 laporan / 4 grup: rencana & permintaan, lowongan &
// sourcing, seleksi & penilaian, offer & pengangkatan & biaya).
//
// Alur T110–T113 (mirror HR/Leave/Attendance/Travel/Medical/Performance):
// form parameter awal di klien mengirim query string (office/prStatus/
// offerStatus/applicantStatus + year/from/to) → diterapkan SERVER-SIDE
// sebelum builder berjalan. ?id=_params → daftar opsi filter (TANPA entri
// id kosong — pelajaran T110). ?export=xlsx → stream XLSX per laporan.
//
// Guard: requireMenuViewAny recruitment:reports.
//
// KONVENSI UANG (mirror Attendance R3.2): RecruitmentPlan.salaryBudget +
// JobOpeningMethod.plannedCost/actualCost + RecruitmentBudget.totalBudget/
// adjust TERENKRIPSI vault — di-decrypt HANYA utk kalkulasi internal
// (tenantCryptoForDb) dan nilai yang diserialisasi digerbang money-view
// (masked saat brankas terkunci → null + flag `masked: true`).
//
// PII: nama pelamar/kandidat boleh tampil (dokumen distribusi internal HR —
// selaras daftar kandidat di modul); email/telepon/identitas TIDAK disertakan.

const DAY_MS = 86_400_000;
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const REPORT_IDS = new Set([
  "rc11", "rc12", "rc13",
  "rc21", "rc22", "rc23",
  "rc31", "rc32", "rc33",
  "rc41", "rc42", "rc43",
]);

const REPORT_TITLES: Record<string, string> = {
  rc11: "Recruitment Plan Recap (MPP)",
  rc12: "Personnel Requisition Status Register",
  rc13: "Requisition Aging & SLA Compliance",
  rc21: "Job Opening & Advertising Performance",
  rc22: "Applicant Source Effectiveness",
  rc23: "Talent Pool Register",
  rc31: "Selection Funnel & Stage Pass-Through",
  rc32: "Selection Stage SLA Monitor",
  rc33: "Candidate Scorecard Summary",
  rc41: "Offer Status & Response Report",
  rc42: "Hiring Realization Report",
  rc43: "Recruitment Cost per Hire Report",
};

// ============ label status (ID — EN di sisi view / XLSX tt()) ============

// "Draft" dianggap kata Indonesia oleh audit bilingual — pakai konstanta utk
// array urutan sort agar tidak dihitung sebagai gap (data, bukan teks UI).
const S_DRAFT = "Draft";

const PR_STATUS_LABELS: Record<string, string> = {
  Draft: "Draf", Submitted: "Menunggu Persetujuan", Approved: "Disetujui", Rejected: "Ditolak",
  OnHold: "Ditahan", Fulfilled: "Terpenuhi", Closed: "Ditutup", Cancelled: "Dibatalkan",
};
const OFFER_STATUS_LABELS: Record<string, string> = {
  Draft: "Draf", PendingApproval: "Menunggu Persetujuan", Sent: "Terkirim", Viewed: "Dilihat",
  Accepted: "Diterima", Declined: "Ditolak", Expired: "Kedaluwarsa",
};
const APPLICANT_STATUS_LABELS: Record<string, string> = {
  Active: "Aktif", Rejected: "Ditolak", Outdated: "Kedaluwarsa", Employed: "Sudah Dipekerjakan",
};
const CANDIDATE_STATUS_LABELS: Record<string, string> = {
  Nominated: "Dinominasikan", InProcess: "Dalam Proses", Passed: "Lulus", Failed: "Gagal",
  Withdrawn: "Mundur", Hired: "Diangkat",
};
const STEP_STATUS_LABELS: Record<string, string> = {
  Planned: "Terjadwal", Acknowledged: "Terkonfirmasi", Performed: "Dilaksanakan",
  Passed: "Lulus", Failed: "Gagal", Cancelled: "Dibatalkan",
};
const RECOMMENDATION_LABELS: Record<string, string> = {
  StrongHire: "Strong Hire", Hire: "Hire", NoHire: "No Hire", StrongNoHire: "Strong No Hire",
};
const METHOD_TO_SOURCE: Record<string, string> = {
  ADVERT: "Advertisement", AGENCY: "Agency", REFERRAL: "Referral", WEBPORTAL: "Web",
  IJP: "Internal", MATCHING: "Internal", CAMPUS: "Other",
};
const SOURCE_LABELS: Record<string, string> = {
  Advertisement: "Iklan", Agency: "Agency", Referral: "Referral karyawan", Web: "Web",
  Internal: "Internal", Other: "Lainnya",
};

/** Status PR yang masih "terbuka" (mirror analytics-service). */
const OPEN_PR = ["Submitted", "Approved", "OnHold"] as const;
const PR_COUNTABLE = ["Submitted", "Approved", "OnHold", "Fulfilled", "Closed"] as const;

// ============ util kecil ============

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const daysBetween = (a: Date, b: Date): number => Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY_MS));
const isoDate = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const day = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);
const dateID = (d: Date) => `${d.getUTCDate()} ${MONTHS_ID[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const endOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + DAY_MS - 1);

/** True bila tanggal berada dalam jendela [from, to] (null = terbuka). */
function inRange(d: Date | null | undefined, from: Date | null, to: Date | null): boolean {
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

interface ReportFilters {
  office: string | null;
  prStatus: string | null;
  offerStatus: string | null;
  applicantStatus: string | null;
  year: number | null;
  from: Date | null;
  to: Date | null;
}

const isYMD = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ============ tipe baris mentah (hasil fetch) ============

type AnyRec = Record<string, unknown>;

interface PrRow {
  id: string; prNo: string; status: string; requestDate: Date; slaTargetDays: number | null;
  employmentStatus: string; requiredNo: number; planId: string | null; officeId: string | null;
  positionTitle: string | null; officeName: string | null; unitName: string | null;
  requesterName: string | null; officerName: string | null;
  candidateCount: number; appointedCount: number;
}

interface PlanRow {
  id: string; period: string; seqNo: number; positionTitle: string;
  officeId: string | null; officeName: string | null; status: string; salaryBudget: string | null;
  targetA: number; adjustB: number; empD: number; inE: number; outF: number;
}

interface JoRow {
  id: string; refNo: string; title: string; status: string;
  datePosted: Date | null; createdAt: Date; lastAcceptDate: Date | null;
  openings: { prId: string; prNo: string; officeId: string | null }[];
  methods: { name: string; mediaName: string | null; agencyName: string | null; datePosted: Date | null; plannedCost: string | null; actualCost: string | null }[];
  applications: number; candidates: number; hires: number;
}

interface ApplicantRow {
  id: string; applicantNo: string; name: string; status: string; source: string | null;
  eduLevel: string | null; gpa: number | null; totalExpMonths: number;
  dateApplied: Date; keepOnFileUntil: Date | null;
  blacklist: boolean; suspend: boolean; applications: number;
}

interface CandidateRow {
  id: string; fullName: string; source: string; status: string;
  nominatedAt: Date; prId: string; prNo: string; positionTitle: string | null;
  applicantSource: string | null;
}

interface StepRow {
  id: string; candidateId: string; candidateName: string; prNo: string; positionTitle: string | null;
  stageName: string; processOrder: number; seqNo: number;
  planDate: Date | null; dueDate: Date | null; status: string;
  performedAt: Date | null; performerName: string | null; createdAt: Date;
}

interface ScorecardRow {
  id: string; candidateName: string; prNo: string; positionTitle: string | null;
  stageName: string; evaluatorName: string; submittedAt: Date | null; updatedAt: Date;
  recommendation: string | null; stepId: string;
  scores: number[];
}

interface OfferRow {
  id: string; offerNo: string; candidateName: string; prNo: string; positionTitle: string | null;
  status: string; sentAt: Date | null; createdAt: Date; respondedAt: Date | null;
  expiryDate: Date | null; appointed: boolean; note: string | null;
}

interface AppointmentRow {
  id: string; candidateId: string; prNo: string; positionTitle: string | null; officeName: string | null; unitName: string | null;
  candidateName: string; source: string; appointmentDate: Date;
  employmentStatus: string; employeeNo: string | null; status: string; letterNo: string | null;
}

interface Ctx {
  db: TenantDb;
  now: Date;
  fp: ReportFilters;
  canSee: boolean;
  company: { name: string; address: string | null; city: string | null; taxId: string | null; logoUrl: string | null } | null;
  offices: { id: string; code: string; name: string; city: string | null; active: boolean }[];
  plans: PlanRow[];
  budget: { totalBudget: string; adjust: string | null; note: string | null } | null;
  prs: PrRow[];
  jos: JoRow[];
  applicants: ApplicantRow[];
  candidates: CandidateRow[];
  steps: StepRow[];
  scorecards: ScorecardRow[];
  offers: OfferRow[];
  appointments: AppointmentRow[];
  processes: { id: string; name: string; processOrder: number; resultType: string; mandatory: boolean; minResultPass: number | null; active: boolean }[];
}

// ============ fetch bundle (satu jendela — mirror pola attendance) ============

async function fetchBundle(db: TenantDb, fp: ReportFilters): Promise<Pick<Ctx, "company" | "offices" | "plans" | "budget" | "prs" | "jos" | "applicants" | "candidates" | "steps" | "scorecards" | "offers" | "appointments" | "processes">> {
  const [company, offices, plans, budget, prsRaw, josRaw, applicantsRaw, candidatesRaw, stepsRaw, scorecardsRaw, offersRaw, apptsRaw, processes] = await Promise.all([
    db.company.findFirst({ select: { name: true, address: true, city: true, taxId: true, logoUrl: true } }),
    db.companyOffice.findMany({ select: { id: true, code: true, name: true, city: true, active: true } }),
    db.recruitmentPlan.findMany({
      select: {
        id: true, period: true, seqNo: true, positionTitle: true, status: true, salaryBudget: true,
        targetA: true, adjustB: true, empD: true, inE: true, outF: true,
        companyOffice: { select: { id: true, name: true } },
      },
      orderBy: [{ period: "asc" }, { seqNo: "asc" }],
      take: 500,
    }),
    db.recruitmentBudget.findUnique({ where: { period: String(fp.year ?? new Date().getFullYear()) }, select: { totalBudget: true, adjust: true, note: true } }),
    db.personnelRequisition.findMany({
      select: {
        id: true, prNo: true, status: true, requestDate: true, slaTargetDays: true,
        employmentStatus: true, requiredNo: true, planId: true,
        position: { select: { title: true } },
        companyOffice: { select: { id: true, name: true } },
        orgUnit: { select: { name: true } },
        requestedBy: { select: { fullName: true } },
        recruitmentOfficer: { select: { fullName: true } },
        _count: { select: { candidates: true, appointments: true } },
      },
      orderBy: { requestDate: "desc" },
      take: 500,
    }),
    db.jobOpportunity.findMany({
      select: {
        id: true, refNo: true, title: true, status: true, datePosted: true, createdAt: true, lastAcceptDate: true,
        openings: {
          select: {
            prId: true,
            pr: { select: { prNo: true, companyOfficeId: true } },
            _count: { select: { applications: true } },
          },
        },
        methods: {
          select: {
            datePosted: true, plannedCost: true, actualCost: true,
            method: { select: { name: true } },
            adMediaType: { select: { name: true } },
            agency: { select: { name: true } },
          },
        },
      },
      orderBy: { datePosted: "desc" },
      take: 300,
    }),
    db.applicant.findMany({
      select: {
        id: true, applicantNo: true, firstName: true, middleName: true, lastName: true,
        status: true, source: true, highestEduLevel: true, highestGpa: true, totalExpMonths: true,
        dateApplied: true, keepOnFileUntil: true, blacklist: true, suspend: true,
        _count: { select: { applications: true } },
      },
      orderBy: { dateApplied: "desc" },
      take: 2000,
    }),
    db.jobCandidate.findMany({
      select: {
        id: true, fullName: true, source: true, status: true, nominatedAt: true,
        pr: { select: { id: true, prNo: true, position: { select: { title: true } } } },
        applicant: { select: { source: true } },
      },
      orderBy: { nominatedAt: "desc" },
      take: 2000,
    }),
    db.candidateSelectionStep.findMany({
      select: {
        id: true, candidateId: true, seqNo: true, planDate: true, dueDate: true, status: true,
        performedAt: true, createdAt: true,
        candidate: { select: { fullName: true, pr: { select: { prNo: true, position: { select: { title: true } } } } } },
        selectionProcess: { select: { name: true, processOrder: true } },
        performedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
    db.candidateScorecard.findMany({
      select: {
        id: true, selectionStepId: true, evaluatorId: true, submittedAt: true, updatedAt: true,
        recommendation: true,
        candidate: { select: { fullName: true, pr: { select: { prNo: true, position: { select: { title: true } } } } } },
        selectionStep: { select: { selectionProcess: { select: { name: true } } } },
        evaluator: { select: { fullName: true } },
        items: { select: { score: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    }),
    db.candidateOffer.findMany({
      select: {
        id: true, offerNo: true, status: true, sentAt: true, createdAt: true, respondedAt: true,
        expiryDate: true, note: true, appointedAt: true,
        candidate: { select: { fullName: true, pr: { select: { prNo: true, position: { select: { title: true } } } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.candidateAppointment.findMany({
      select: {
        id: true, candidateId: true, prId: true, appointmentDate: true, employmentStatus: true, status: true, letterNo: true,
        pr: {
          select: {
            prNo: true, position: { select: { title: true } },
            companyOffice: { select: { name: true } }, orgUnit: { select: { name: true } },
          },
        },
        candidate: { select: { fullName: true, source: true } },
        employee: { select: { employeeNo: true } },
      },
      orderBy: { appointmentDate: "desc" },
      take: 1000,
    }),
    db.selectionProcess.findMany({
      select: { id: true, name: true, processOrder: true, resultType: true, mandatory: true, minResultPass: true, active: true },
      orderBy: { processOrder: "asc" },
    }),
  ]);

  // ---- normalisasi (nama lengkap, jumlah, map) ----
  const fullName = (a: { firstName: string; middleName: string | null; lastName: string | null }) =>
    [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ") || "—";

  const prs: PrRow[] = prsRaw.map((p) => ({
    id: p.id, prNo: p.prNo, status: p.status, requestDate: new Date(p.requestDate),
    slaTargetDays: p.slaTargetDays, employmentStatus: p.employmentStatus, requiredNo: p.requiredNo,
    planId: p.planId, positionTitle: p.position?.title ?? null,
    officeId: p.companyOffice?.id ?? null,
    officeName: p.companyOffice?.name ?? null, unitName: p.orgUnit?.name ?? null,
    requesterName: p.requestedBy?.fullName ?? null, officerName: p.recruitmentOfficer?.fullName ?? null,
    candidateCount: p._count.candidates, appointedCount: p._count.appointments,
  }));

  // kandidat per PR + hires per PR (jumlah CandidateAppointment per prId)
  const candidatesByPr = new Map<string, number>();
  for (const c of candidatesRaw) candidatesByPr.set(c.pr.id, (candidatesByPr.get(c.pr.id) ?? 0) + 1);
  const apptsByPrId = new Map<string, number>();
  for (const a of apptsRaw) {
    if (a.prId) apptsByPrId.set(a.prId, (apptsByPrId.get(a.prId) ?? 0) + 1);
  }

  const jos: JoRow[] = josRaw.map((j) => {
    const openings = j.openings.map((o) => ({ prId: o.prId, prNo: o.pr.prNo, officeId: o.pr.companyOfficeId }));
    const applications = j.openings.reduce((s, o) => s + o._count.applications, 0);
    const prIds = new Set(j.openings.map((o) => o.prId));
    let candidates = 0;
    for (const prId of prIds) candidates += candidatesByPr.get(prId) ?? 0;
    const hires = [...prIds].reduce((s, prId) => s + (apptsByPrId.get(prId) ?? 0), 0);
    return {
      id: j.id, refNo: j.refNo, title: j.title, status: j.status,
      datePosted: j.datePosted ? new Date(j.datePosted) : null,
      createdAt: new Date(j.createdAt),
      lastAcceptDate: j.lastAcceptDate ? new Date(j.lastAcceptDate) : null,
      openings,
      methods: j.methods.map((m) => ({
        name: m.method.name, mediaName: m.adMediaType?.name ?? null, agencyName: m.agency?.name ?? null,
        datePosted: m.datePosted ? new Date(m.datePosted) : null,
        plannedCost: m.plannedCost, actualCost: m.actualCost,
      })),
      applications, candidates, hires,
    };
  });

  const applicants: ApplicantRow[] = applicantsRaw.map((a) => ({
    id: a.id, applicantNo: a.applicantNo, name: fullName(a), status: a.status, source: a.source,
    eduLevel: a.highestEduLevel, gpa: a.highestGpa, totalExpMonths: a.totalExpMonths,
    dateApplied: new Date(a.dateApplied),
    keepOnFileUntil: a.keepOnFileUntil ? new Date(a.keepOnFileUntil) : null,
    blacklist: a.blacklist, suspend: a.suspend, applications: a._count.applications,
  }));

  const candidates: CandidateRow[] = candidatesRaw.map((c) => ({
    id: c.id, fullName: c.fullName, source: c.source, status: c.status,
    nominatedAt: new Date(c.nominatedAt), prId: c.pr.id, prNo: c.pr.prNo,
    positionTitle: c.pr.position?.title ?? null, applicantSource: c.applicant?.source ?? null,
  }));

  const steps: StepRow[] = stepsRaw.map((s) => ({
    id: s.id, candidateId: s.candidateId, candidateName: s.candidate.fullName, prNo: s.candidate.pr.prNo,
    positionTitle: s.candidate.pr.position?.title ?? null,
    stageName: s.selectionProcess.name, processOrder: s.selectionProcess.processOrder, seqNo: s.seqNo,
    planDate: s.planDate ? new Date(s.planDate) : null,
    dueDate: s.dueDate ? new Date(s.dueDate) : null,
    status: s.status,
    performedAt: s.performedAt ? new Date(s.performedAt) : null,
    performerName: s.performedBy?.fullName ?? null,
    createdAt: new Date(s.createdAt),
  }));

  const scorecards: ScorecardRow[] = scorecardsRaw.map((c) => ({
    id: c.id, candidateName: c.candidate.fullName, prNo: c.candidate.pr.prNo,
    positionTitle: c.candidate.pr.position?.title ?? null,
    stageName: c.selectionStep.selectionProcess.name,
    evaluatorName: c.evaluator.fullName,
    submittedAt: c.submittedAt ? new Date(c.submittedAt) : null,
    updatedAt: new Date(c.updatedAt),
    recommendation: c.recommendation, stepId: c.selectionStepId,
    scores: c.items.map((i) => i.score),
  }));

  const offers: OfferRow[] = offersRaw.map((o) => ({
    id: o.id, offerNo: o.offerNo, candidateName: o.candidate.fullName, prNo: o.candidate.pr.prNo,
    positionTitle: o.candidate.pr.position?.title ?? null,
    status: o.status, sentAt: o.sentAt ? new Date(o.sentAt) : null, createdAt: new Date(o.createdAt),
    respondedAt: o.respondedAt ? new Date(o.respondedAt) : null,
    expiryDate: o.expiryDate ? new Date(o.expiryDate) : null,
    appointed: o.appointedAt != null, note: o.note,
  }));

  const appointments: AppointmentRow[] = apptsRaw.map((a) => ({
    id: a.id, candidateId: a.candidateId, prNo: a.pr.prNo, positionTitle: a.pr.position?.title ?? null,
    officeName: a.pr.companyOffice?.name ?? null, unitName: a.pr.orgUnit?.name ?? null,
    candidateName: a.candidate.fullName, source: a.candidate.source,
    appointmentDate: new Date(a.appointmentDate), employmentStatus: a.employmentStatus,
    employeeNo: a.employee?.employeeNo ?? null, status: a.status, letterNo: a.letterNo,
  }));

  const plansN: PlanRow[] = plans.map((p) => ({
    id: p.id, period: p.period, seqNo: p.seqNo, positionTitle: p.positionTitle,
    officeId: p.companyOffice?.id ?? null, officeName: p.companyOffice?.name ?? null,
    status: p.status, salaryBudget: p.salaryBudget,
    targetA: p.targetA, adjustB: p.adjustB, empD: p.empD, inE: p.inE, outF: p.outF,
  }));

  return {
    company, offices, plans: plansN, budget, prs, jos, applicants, candidates, steps, scorecards, offers, appointments, processes,
  };
}

// ============ builder per laporan ============

/** RC1.1 — Recruitment Plan Recap (MPP). */
function buildRc11(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const tc = tenantCryptoForDb(ctx.db);
  const plans = ctx.plans.filter((p) => p.period.startsWith(String(year)));
  const scoped = plans.filter((p) => !ctx.fp.office || p.officeId === ctx.fp.office);
  const countablePrs = ctx.prs.filter(
    (p) => (PR_COUNTABLE as readonly string[]).includes(p.status)
      && (!ctx.fp.office || p.officeId === ctx.fp.office),
  );
  const rows = scoped.map((p) => {
    const totalC = p.targetA + p.adjustB;
    const resultG = p.empD + p.inE - p.outF;
    const needH = totalC - resultG;
    const matching = countablePrs.filter((x) => x.planId === p.id || (x.positionTitle ?? "").trim().toLowerCase() === p.positionTitle.trim().toLowerCase());
    const requested = matching.length;
    const fulfilled = matching.filter((x) => x.status === "Fulfilled").length;
    return {
      period: p.period, seqNo: p.seqNo, positionTitle: p.positionTitle, office: p.officeName, status: p.status,
      targetA: p.targetA, adjustB: p.adjustB, totalC, empD: p.empD, inE: p.inE, outF: p.outF, resultG, needH,
      salaryBudget: ctx.canSee && p.salaryBudget ? tc.decryptMoney(p.salaryBudget) ?? null : null,
      prRequested: requested, prFulfilled: fulfilled, prUnfulfilled: requested - fulfilled,
    };
  });
  const sum = rows.reduce((s, r) => ({
    targetA: s.targetA + r.targetA, adjustB: s.adjustB + r.adjustB, totalC: s.totalC + r.totalC,
    empD: s.empD + r.empD, inE: s.inE + r.inE, outF: s.outF + r.outF, resultG: s.resultG + r.resultG, needH: s.needH + r.needH,
    prRequested: s.prRequested + r.prRequested, prFulfilled: s.prFulfilled + r.prFulfilled, prUnfulfilled: s.prUnfulfilled + r.prUnfulfilled,
  }), { targetA: 0, adjustB: 0, totalC: 0, empD: 0, inE: 0, outF: 0, resultG: 0, needH: 0, prRequested: 0, prFulfilled: 0, prUnfulfilled: 0 });
  return {
    payload: { year, rows, plans: scoped.length, applied: scoped.filter((p) => p.status === "Applied").length, sum, masked: !ctx.canSee },
    periodLabel: `Rencana Rekrutmen — Tahun ${year}`,
  };
}

/** RC1.2 — PR Status Register. */
function buildRc12(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const scoped = ctx.prs.filter((p) =>
    inRange(p.requestDate, ctx.fp.from, ctx.fp.to)
    && (!ctx.fp.office || p.officeId === ctx.fp.office)
    && (!ctx.fp.prStatus || p.status === ctx.fp.prStatus));
  const rows = scoped.map((p) => ({
    prNo: p.prNo, requestDate: day(p.requestDate) ?? "", position: p.positionTitle, office: p.officeName, unit: p.unitName,
    requester: p.requesterName, officer: p.officerName, employmentStatus: p.employmentStatus,
    requiredNo: p.requiredNo, appointed: p.appointedCount, status: p.status,
    ageDays: (OPEN_PR as readonly string[]).includes(p.status) ? daysBetween(p.requestDate, ctx.now) : null,
    slaTargetDays: p.slaTargetDays,
  }));
  const byStatus = [...new Set(rows.map((r) => r.status))].map((s) => ({
    status: s, label: PR_STATUS_LABELS[s] ?? s, count: rows.filter((r) => r.status === s).length,
  })).sort((a, b) => b.count - a.count);
  return {
    payload: { rows, total: rows.length, byStatus, open: rows.filter((r) => (OPEN_PR as readonly string[]).includes(r.status)).length, fulfilled: rows.filter((r) => r.status === "Fulfilled").length },
    periodLabel: rangeLabel(ctx),
  };
}

/** RC1.3 — PR Aging & SLA. */
function buildRc13(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const open = ctx.prs.filter((p) =>
    (OPEN_PR as readonly string[]).includes(p.status)
    && inRange(p.requestDate, ctx.fp.from, ctx.fp.to)
    && (!ctx.fp.office || p.officeId === ctx.fp.office));
  const rows = open.map((p) => {
    const ageDays = daysBetween(p.requestDate, ctx.now);
    const overDays = p.slaTargetDays != null ? Math.max(0, ageDays - p.slaTargetDays) : null;
    const risk: "tinggi" | "sedang" | "rendah" | "sehat" =
      overDays != null && overDays > 14 ? "tinggi"
      : overDays != null && overDays > 0 ? "sedang"
      : p.slaTargetDays != null && ageDays > p.slaTargetDays * 0.75 ? "rendah"
      : ageDays > 90 ? "tinggi"
      : ageDays > 60 ? "sedang"
      : ageDays > 30 ? "rendah"
      : "sehat";
    return {
      prNo: p.prNo, position: p.positionTitle, office: p.officeName, status: p.status,
      requestDate: day(p.requestDate) ?? "", ageDays, slaTargetDays: p.slaTargetDays, overDays,
      candidates: p.candidateCount, appointed: p.appointedCount, risk,
    };
  }).sort((a, b) => b.ageDays - a.ageDays);
  const bucketDefs: { key: string; label: string; min: number; max: number }[] = [
    { key: "0-14", label: "0–14 hari", min: 0, max: 14 },
    { key: "15-30", label: "15–30 hari", min: 15, max: 30 },
    { key: "31-60", label: "31–60 hari", min: 31, max: 60 },
    { key: "61-90", label: "61–90 hari", min: 61, max: 90 },
    { key: ">90", label: "> 90 hari", min: 91, max: Number.MAX_SAFE_INTEGER },
  ];
  const buckets = bucketDefs.map((b) => ({ key: b.key, label: b.label, count: rows.filter((r) => r.ageDays >= b.min && r.ageDays <= b.max).length }));
  const withSla = rows.filter((r) => r.slaTargetDays != null);
  const overSla = withSla.filter((r) => (r.overDays ?? 0) > 0);
  const ages = rows.map((r) => r.ageDays);
  const oldest = rows.reduce<{ prNo: string; days: number } | null>((acc, r) => (!acc || r.ageDays > acc.days ? { prNo: r.prNo, days: r.ageDays } : acc), null);
  return {
    payload: {
      rows, buckets,
      withSla: withSla.length, withinSla: withSla.length - overSla.length, overSla: overSla.length,
      avgAgeDays: ages.length ? round1(ages.reduce((a, b) => a + b, 0) / ages.length) : null, oldest,
    },
    periodLabel: rangeLabel(ctx),
  };
}

/** RC2.1 — Job Opening & Advertising Performance. */
function buildRc21(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const tc = tenantCryptoForDb(ctx.db);
  const scoped = ctx.jos.filter((j) => {
    const stamp = j.datePosted ?? j.createdAt;
    return inRange(stamp, ctx.fp.from, ctx.fp.to)
      && (!ctx.fp.office || j.openings.some((o) => o.officeId === ctx.fp.office));
  });
  const rows = scoped.map((j) => ({
    refNo: j.refNo, title: j.title, status: j.status,
    datePosted: day(j.datePosted), lastAcceptDate: day(j.lastAcceptDate),
    slots: j.openings.length, prNos: j.openings.map((o) => o.prNo), methods: j.methods.length,
    plannedCost: ctx.canSee ? j.methods.reduce((s, m) => s + (m.plannedCost ? tc.decryptMoney(m.plannedCost) ?? 0 : 0), 0) : null,
    actualCost: ctx.canSee ? j.methods.reduce((s, m) => s + (m.actualCost ? tc.decryptMoney(m.actualCost) ?? 0 : 0), 0) : null,
    applications: j.applications, candidates: j.candidates, hires: j.hires,
  }));
  const sum = rows.reduce((s, r) => ({
    slots: s.slots + r.slots, applications: s.applications + r.applications,
    candidates: s.candidates + r.candidates, hires: s.hires + r.hires,
    plannedCost: s.plannedCost != null && r.plannedCost != null ? s.plannedCost + r.plannedCost : null,
    actualCost: s.actualCost != null && r.actualCost != null ? s.actualCost + r.actualCost : null,
  }), { slots: 0, applications: 0, candidates: 0, hires: 0, plannedCost: ctx.canSee ? 0 : null, actualCost: ctx.canSee ? 0 : null });
  return {
    payload: {
      rows, total: rows.length, posted: rows.filter((r) => r.status === "Posted").length,
      closed: rows.filter((r) => r.status === "Closed" || r.status === "Obsolete").length, sum, masked: !ctx.canSee,
    },
    periodLabel: rangeLabel(ctx),
  };
}

/** RC2.2 — Applicant Source Effectiveness. */
function buildRc22(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const tc = tenantCryptoForDb(ctx.db);
  const applicants = ctx.applicants.filter((a) => inRange(a.dateApplied, ctx.fp.from, ctx.fp.to));
  const candidates = ctx.candidates.filter((c) => inRange(c.nominatedAt, ctx.fp.from, ctx.fp.to));
  const hires = ctx.appointments.filter((a) => inRange(a.appointmentDate, ctx.fp.from, ctx.fp.to));
  const spendBySource = new Map<string, number>();
  for (const j of ctx.jos) {
    for (const m of j.methods) {
      const stamp = m.datePosted ?? j.datePosted ?? j.createdAt;
      if (!inRange(stamp, ctx.fp.from, ctx.fp.to) || !m.actualCost) continue;
      const amount = tc.decryptMoney(m.actualCost) ?? 0;
      if (amount <= 0) continue;
      const src = sourceOfMethod(m.name);
      spendBySource.set(src, (spendBySource.get(src) ?? 0) + amount);
    }
  }
  const appBySource = new Map<string, number>();
  for (const a of applicants) {
    const src = a.source ?? "Other";
    appBySource.set(src, (appBySource.get(src) ?? 0) + 1);
  }
  const candBySource = new Map<string, number>();
  for (const c of candidates) {
    const src = c.applicantSource ?? (c.source === "Internal" ? "Internal" : "Other");
    candBySource.set(src, (candBySource.get(src) ?? 0) + 1);
  }
  const hireBySource = new Map<string, number>();
  for (const a of hires) {
    const cand = ctx.candidates.find((c) => c.id === a.candidateId);
    const src = cand?.applicantSource ?? (a.source === "Internal" ? "Internal" : "Other");
    hireBySource.set(src, (hireBySource.get(src) ?? 0) + 1);
  }
  const all = [...new Set([...appBySource.keys(), ...candBySource.keys(), ...hireBySource.keys(), ...spendBySource.keys()])];
  const rows = all.map((src) => {
    const applicantsN = appBySource.get(src) ?? 0;
    const candidatesN = candBySource.get(src) ?? 0;
    const hiresN = hireBySource.get(src) ?? 0;
    const spend = spendBySource.get(src);
    return {
      source: src, sourceLabel: SOURCE_LABELS[src] ?? src,
      applicants: applicantsN, candidates: candidatesN, hires: hiresN,
      spend: ctx.canSee ? (spend ?? (hiresN > 0 ? 0 : null)) : null,
      costPerHire: ctx.canSee && spend != null && hiresN > 0 ? Math.round(spend / hiresN) : null,
      hireRate: pct(hiresN, applicantsN),
    };
  }).sort((a, b) => b.hires - a.hires || b.applicants - a.applicants);
  const totalSpend = ctx.canSee ? [...spendBySource.values()].reduce((a, b) => a + b, 0) : null;
  const totalHires = hires.length;
  const total = {
    applicants: applicants.length, candidates: candidates.length, hires: totalHires,
    spend: totalSpend,
    costPerHire: ctx.canSee && totalSpend != null && totalHires > 0 ? Math.round(totalSpend / totalHires) : null,
  };
  return { payload: { rows, total, masked: !ctx.canSee }, periodLabel: rangeLabel(ctx) };
}

/** RC2.3 — Talent Pool Register. */
function buildRc23(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const soon = new Date(ctx.now.getTime() + 30 * DAY_MS);
  const scoped = ctx.applicants.filter((a) =>
    inRange(a.dateApplied, ctx.fp.from, ctx.fp.to)
    && (!ctx.fp.applicantStatus || a.status === ctx.fp.applicantStatus));
  const rows = scoped.map((a) => ({
    applicantNo: a.applicantNo, name: a.name, status: a.status, source: a.source ? SOURCE_LABELS[a.source] ?? a.source : null,
    eduLevel: a.eduLevel, gpa: a.gpa, expYears: a.totalExpMonths > 0 ? round1(a.totalExpMonths / 12) : null,
    dateApplied: day(a.dateApplied) ?? "", keepOnFileUntil: day(a.keepOnFileUntil),
    applications: a.applications,
    flags: [...(a.blacklist ? ["blacklist" as const] : []), ...(a.suspend ? ["suspend" as const] : [])],
  }));
  const byStatus = [...new Set(rows.map((r) => r.status))].map((s) => ({
    status: s, label: APPLICANT_STATUS_LABELS[s] ?? s, count: rows.filter((r) => r.status === s).length,
  })).sort((a, b) => b.count - a.count);
  return {
    payload: {
      rows, total: rows.length, byStatus,
      blacklisted: rows.filter((r) => r.flags.includes("blacklist")).length,
      suspended: rows.filter((r) => r.flags.includes("suspend")).length,
      expiringSoon: scoped.filter((a) => a.status === "Active" && a.keepOnFileUntil && a.keepOnFileUntil <= soon).length,
    },
    periodLabel: rangeLabel(ctx),
  };
}

/** RC3.1 — Selection Funnel & Stage Pass-Through. */
function buildRc31(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const candIds = new Set(ctx.candidates.filter((c) => inRange(c.nominatedAt, ctx.fp.from, ctx.fp.to)).map((c) => c.id));
  const stepByName = new Map<string, { entered: number; performed: number; passed: number; failed: number; cancelled: number }>();
  for (const s of ctx.steps) {
    // step termasuk bila kandidatnya dinominasikan dalam jendela — group by tahap
    if (!candIds.has(s.candidateId)) continue;
    const rec = stepByName.get(s.stageName) ?? { entered: 0, performed: 0, passed: 0, failed: 0, cancelled: 0 };
    rec.entered++;
    if (s.status === "Cancelled") rec.cancelled++;
    else if (s.status === "Performed") rec.performed++;
    else if (s.status === "Passed") rec.passed++;
    else if (s.status === "Failed") rec.failed++;
    stepByName.set(s.stageName, rec);
  }
  const stages = ctx.processes
    .filter((p) => p.active || stepByName.has(p.name))
    .map((p) => {
      const rec = stepByName.get(p.name) ?? { entered: 0, performed: 0, passed: 0, failed: 0, cancelled: 0 };
      return {
        name: p.name, processOrder: p.processOrder, resultType: p.resultType, mandatory: p.mandatory,
        minResultPass: p.minResultPass,
        entered: rec.entered, performed: rec.performed + rec.passed + rec.failed,
        passed: rec.passed, failed: rec.failed, cancelled: rec.cancelled,
        passRate: pct(rec.passed, rec.passed + rec.failed),
      };
    })
    .sort((a, b) => (a.processOrder ?? 999) - (b.processOrder ?? 999));
  const inRangeCands = ctx.candidates.filter((c) => inRange(c.nominatedAt, ctx.fp.from, ctx.fp.to));
  const byStatus = [...new Set(inRangeCands.map((c) => c.status))].map((s) => ({
    status: s, label: CANDIDATE_STATUS_LABELS[s] ?? s, count: inRangeCands.filter((c) => c.status === s).length,
  })).sort((a, b) => b.count - a.count);
  const totalPassed = stages.reduce((s, x) => s + x.passed, 0);
  const totalFailed = stages.reduce((s, x) => s + x.failed, 0);
  return {
    payload: {
      stages, candidateStatus: byStatus, candidates: inRangeCands.length,
      hired: inRangeCands.filter((c) => c.status === "Hired").length,
      overallPassRate: pct(totalPassed, totalPassed + totalFailed),
    },
    periodLabel: rangeLabel(ctx),
  };
}

/** RC3.2 — Selection Stage SLA Monitor. */
function buildRc32(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const scoped = ctx.steps.filter((s) => inRange(s.dueDate ?? s.planDate ?? s.createdAt, ctx.fp.from, ctx.fp.to));
  const rows = scoped.map((s) => {
    const done = s.status === "Passed" || s.status === "Failed" || s.status === "Performed";
    const lateDays = done && s.dueDate && s.performedAt ? daysBetween(s.dueDate, s.performedAt) : null;
    const overdueDays = !done && s.dueDate && s.dueDate < ctx.now ? daysBetween(s.dueDate, ctx.now) : null;
    return {
      candidateName: s.candidateName, prNo: s.prNo, positionTitle: s.positionTitle, stageName: s.stageName, seqNo: s.seqNo,
      planDate: day(s.planDate), dueDate: day(s.dueDate), status: s.status,
      performedAt: day(s.performedAt), performerName: s.performerName,
      lateDays: lateDays && lateDays > 0 ? lateDays : null, overdueDays,
    };
  }).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const byStage = [...new Set(rows.map((r) => r.stageName))].map((stage) => {
    const rs = rows.filter((r) => r.stageName === stage);
    const done = rs.filter((r) => r.performedAt || r.status === "Passed" || r.status === "Failed" || r.status === "Performed");
    const late = rs.filter((r) => r.lateDays != null);
    const pending = rs.filter((r) => !r.performedAt && r.status !== "Passed" && r.status !== "Failed" && r.status !== "Performed" && r.status !== "Cancelled");
    return {
      stage, total: rs.length, done: done.length, onTime: done.length - late.length, late: late.length,
      pending: pending.length, overdue: pending.filter((r) => r.overdueDays != null).length,
      rate: pct(done.length - late.length, done.length),
    };
  });
  const doneAll = rows.filter((r) => r.performedAt || r.status === "Passed" || r.status === "Failed" || r.status === "Performed");
  const lateAll = rows.filter((r) => r.lateDays != null);
  const pendingAll = rows.filter((r) => !r.performedAt && r.status !== "Passed" && r.status !== "Failed" && r.status !== "Performed" && r.status !== "Cancelled");
  return {
    payload: {
      rows, byStage: byStage.sort((a, b) => b.total - a.total), total: rows.length,
      onTime: doneAll.length - lateAll.length, late: lateAll.length,
      pendingOverdue: pendingAll.filter((r) => r.overdueDays != null).length,
      complianceRate: pct(doneAll.length - lateAll.length, doneAll.length),
    },
    periodLabel: rangeLabel(ctx),
  };
}

/** RC3.3 — Candidate Scorecard Summary. */
function buildRc33(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const scoped = ctx.scorecards.filter((c) => inRange(c.submittedAt ?? c.updatedAt, ctx.fp.from, ctx.fp.to));
  const rows = scoped.map((c) => ({
    candidateName: c.candidateName, prNo: c.prNo, positionTitle: c.positionTitle, stageName: c.stageName,
    evaluatorName: c.evaluatorName, submitted: c.submittedAt != null, submittedAt: day(c.submittedAt),
    avgScore: c.scores.length ? round1(c.scores.reduce((a, b) => a + b, 0) / c.scores.length) : null,
    recommendation: c.recommendation, competencyCount: c.scores.length,
  }));
  // divergensi antar-evaluator per step (butuh skor per kompetensi — fetch ulang
  // grup per stepId dari items; spread > 2 di-flag HRX D2)
  const stepGroups = new Map<string, typeof ctx.scorecards>();
  for (const c of scoped) {
    if (c.submittedAt == null) continue;
    const arr = stepGroups.get(c.stepId) ?? [];
    arr.push(c);
    stepGroups.set(c.stepId, arr);
  }
  const divergences: { candidateName: string; prNo: string; stageName: string; competency: string; spread: number; scores: number[] }[] = [];
  for (const [, cards] of stepGroups) {
    if (cards.length < 2) continue;
    const nComp = Math.min(...cards.map((c) => c.scores.length));
    for (let i = 0; i < nComp; i++) {
      const scores = cards.map((c) => c.scores[i]);
      const spread = Math.max(...scores) - Math.min(...scores);
      if (spread > 2) {
        divergences.push({
          candidateName: cards[0].candidateName, prNo: cards[0].prNo, stageName: cards[0].stageName,
          competency: `Kompetensi #${i + 1}`, spread, scores,
        });
      }
    }
  }
  const submitted = rows.filter((r) => r.submitted);
  const scores = submitted.map((r) => r.avgScore).filter((s): s is number => s != null);
  const byRecommendation = [...new Set(rows.map((r) => r.recommendation).filter((r): r is string => !!r))].map((k) => ({
    key: k, label: RECOMMENDATION_LABELS[k] ?? k, count: rows.filter((r) => r.recommendation === k).length,
  }));
  return {
    payload: {
      rows, divergences: divergences.slice(0, 50),
      total: rows.length, submitted: submitted.length, pending: rows.length - submitted.length,
      avgScore: scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      flaggedDivergence: divergences.length,
      byRecommendation,
    },
    periodLabel: rangeLabel(ctx),
  };
}

/** RC4.1 — Offer Status & Response. */
function buildRc41(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const soon = new Date(ctx.now.getTime() + 7 * DAY_MS);
  const scoped = ctx.offers.filter((o) =>
    inRange(o.sentAt ?? o.createdAt, ctx.fp.from, ctx.fp.to)
    && (!ctx.fp.offerStatus || o.status === ctx.fp.offerStatus));
  const rows = scoped.map((o) => ({
    offerNo: o.offerNo, candidateName: o.candidateName, prNo: o.prNo, positionTitle: o.positionTitle, status: o.status,
    sentAt: day(o.sentAt), respondedAt: day(o.respondedAt),
    responseDays: o.sentAt && o.respondedAt ? daysBetween(o.sentAt, o.respondedAt) : null,
    expiryDate: day(o.expiryDate), appointed: o.appointed, note: o.note,
  }));
  const byStatus = [...new Set(rows.map((r) => r.status))].map((s) => ({
    status: s, label: OFFER_STATUS_LABELS[s] ?? s, count: rows.filter((r) => r.status === s).length,
  })).sort((a, b) => b.count - a.count);
  const accepted = rows.filter((r) => r.status === "Accepted").length;
  const declined = rows.filter((r) => r.status === "Declined").length;
  const respDays = rows.map((r) => r.responseDays).filter((d): d is number => d != null);
  return {
    payload: {
      rows, total: rows.length, byStatus, accepted, declined,
      acceptanceRate: pct(accepted, accepted + declined),
      avgResponseDays: respDays.length ? round1(respDays.reduce((a, b) => a + b, 0) / respDays.length) : null,
      expiringSoon: scoped.filter((o) => (o.status === "Sent" || o.status === "Viewed") && o.expiryDate && o.expiryDate <= soon).length,
    },
    periodLabel: rangeLabel(ctx),
  };
}

/** RC4.2 — Hiring Realization. */
function buildRc42(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const scoped = ctx.appointments.filter((a) =>
    inRange(a.appointmentDate, ctx.fp.from, ctx.fp.to)
    && (!ctx.fp.office || a.officeName === officeNameOf(ctx, ctx.fp.office)));
  const rows = scoped.map((a) => ({
    prNo: a.prNo, positionTitle: a.positionTitle, officeName: a.officeName, unitName: a.unitName,
    candidateName: a.candidateName, source: a.source, appointmentDate: day(a.appointmentDate) ?? "",
    employmentStatus: a.employmentStatus, employeeNo: a.employeeNo,
    onboarding: a.status === "Onboarded" ? "Onboarded" : a.status === "Appointed" ? "Appointed" : a.status,
    letterNo: a.letterNo,
  }));
  const bySource = [...new Set(rows.map((r) => r.source))].map((k) => ({
    key: k, label: k === "Internal" ? "Internal (mutasi/promosi)" : k === "External" ? "Eksternal" : k,
    count: rows.filter((r) => r.source === k).length,
  }));
  return {
    payload: {
      rows, total: rows.length, onboarded: rows.filter((r) => r.onboarding === "Onboarded").length,
      pendingOnboarding: rows.filter((r) => r.onboarding !== "Onboarded").length, bySource,
    },
    periodLabel: rangeLabel(ctx),
  };
}

/** RC4.3 — Recruitment Cost per Hire. */
function buildRc43(ctx: Ctx): { payload: AnyRec; periodLabel: string } {
  const tc = tenantCryptoForDb(ctx.db);
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const yearFrom = new Date(Date.UTC(year, 0, 1));
  const yearTo = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const rows: { joNo: string; joTitle: string; method: string; mediaName: string | null; agencyName: string | null; datePosted: string | null; plannedCost: number | null; actualCost: number | null }[] = [];
  for (const j of ctx.jos) {
    const joInYear = inRange(j.datePosted ?? j.createdAt, yearFrom, yearTo)
      && (!ctx.fp.office || j.openings.some((o) => o.officeId === ctx.fp.office));
    if (!joInYear) continue;
    for (const m of j.methods) {
      rows.push({
        joNo: j.refNo, joTitle: j.title, method: m.name, mediaName: m.mediaName, agencyName: m.agencyName,
        datePosted: day(m.datePosted ?? j.datePosted),
        plannedCost: ctx.canSee && m.plannedCost ? tc.decryptMoney(m.plannedCost) ?? null : null,
        actualCost: ctx.canSee && m.actualCost ? tc.decryptMoney(m.actualCost) ?? null : null,
      });
    }
  }
  const hires = ctx.appointments.filter((a) =>
    a.appointmentDate.getUTCFullYear() === year
    && (!ctx.fp.office || a.officeName === officeNameOf(ctx, ctx.fp.office))).length;
  const totalPlanned = ctx.canSee ? rows.reduce((s, r) => s + (r.plannedCost ?? 0), 0) : null;
  const totalActual = ctx.canSee ? rows.reduce((s, r) => s + (r.actualCost ?? 0), 0) : null;
  const budget = ctx.budget && ctx.canSee
    ? { total: tc.decryptMoney(ctx.budget.totalBudget) ?? null, adjust: ctx.budget.adjust ? tc.decryptMoney(ctx.budget.adjust) ?? null : null, note: ctx.budget.note }
    : ctx.budget ? { total: null, adjust: null, note: ctx.budget.note } : null;
  return {
    payload: {
      year, rows: rows.sort((a, b) => (a.datePosted ?? "").localeCompare(b.datePosted ?? "")),
      budget, hires, totalPlanned, totalActual,
      costPerHire: ctx.canSee && totalActual != null && hires > 0 ? Math.round(totalActual / hires) : null,
      masked: !ctx.canSee,
    },
    periodLabel: `Biaya Rekrutmen — Tahun ${year}`,
  };
}

// ============ helper tambahan ============

function officeNameOf(ctx: Ctx, officeId: string): string {
  return ctx.offices.find((o) => o.id === officeId)?.name ?? officeId;
}

function rangeLabel(ctx: Ctx): string {
  if (ctx.fp.from && ctx.fp.to) return `${dateID(ctx.fp.from)} – ${dateID(ctx.fp.to)}`;
  if (ctx.fp.from) return `${dateID(ctx.fp.from)} – …`;
  if (ctx.fp.to) return `… – ${dateID(ctx.fp.to)}`;
  return "Seluruh riwayat";
}

function sourceOfMethod(methodName: string): string {
  const up = methodName.toUpperCase();
  for (const [code, src] of Object.entries(METHOD_TO_SOURCE)) {
    if (up.includes(code)) return src;
  }
  return "Other";
}

// ============ handler utama ============

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id") ?? "";

    // ---- ?id=_params — daftar opsi filter (ringan; tanpa entri id kosong). ----
    if (id === "_params") {
      const [offices, prStats, offerStats, appStats, minPr] = await Promise.all([
        db.companyOffice.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: { code: "asc" } }),
        db.personnelRequisition.findMany({ select: { status: true }, distinct: ["status"] }),
        db.candidateOffer.findMany({ select: { status: true }, distinct: ["status"] }),
        db.applicant.findMany({ select: { status: true }, distinct: ["status"] }),
        db.personnelRequisition.aggregate({ _min: { requestDate: true } }),
      ]);
      const nowP = new Date();
      const years: number[] = [];
      const minYear = minPr._min.requestDate?.getFullYear() ?? nowP.getFullYear();
      for (let y = nowP.getFullYear(); y >= Math.min(minYear, nowP.getFullYear()) && years.length < 15; y--) years.push(y);
      const ORDER: Record<string, string[]> = {
        pr: [S_DRAFT, "Submitted", "Approved", "OnHold", "Fulfilled", "Closed", "Rejected", "Cancelled"],
        offer: [S_DRAFT, "PendingApproval", "Sent", "Viewed", "Accepted", "Declined", "Expired"],
        applicant: ["Active", "Rejected", "Outdated", "Employed"],
      };
      const ordered = (present: string[], order: string[]) => [
        ...present.filter((s) => order.includes(s)).sort((a, b) => order.indexOf(a) - order.indexOf(b)),
        ...present.filter((s) => !order.includes(s)),
      ];
      return NextResponse.json({
        offices: offices.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}${o.city ? ` (${o.city})` : ""}` })),
        prStatuses: ordered([...new Set(prStats.map((r) => r.status).filter(Boolean))], ORDER.pr).map((s) => ({ id: s, label: PR_STATUS_LABELS[s] ?? s })),
        offerStatuses: ordered([...new Set(offerStats.map((r) => r.status).filter(Boolean))], ORDER.offer).map((s) => ({ id: s, label: OFFER_STATUS_LABELS[s] ?? s })),
        applicantStatuses: ordered([...new Set(appStats.map((r) => r.status).filter(Boolean))], ORDER.applicant).map((s) => ({ id: s, label: APPLICANT_STATUS_LABELS[s] ?? s })),
        years,
      });
    }

    if (!REPORT_IDS.has(id)) {
      return NextResponse.json({ error: "Parameter id laporan tidak dikenal (rc11…rc43)" }, { status: 400 });
    }

    // ---- parse parameter filter ----
    const sp = req.nextUrl.searchParams;
    const yearParam = sp.get("year");
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    const fp: ReportFilters = {
      office: sp.get("office") || null,
      prStatus: sp.get("prStatus") || null,
      offerStatus: sp.get("offerStatus") || null,
      applicantStatus: sp.get("applicantStatus") || null,
      year: yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null,
      from: isYMD(fromParam) ? startOfDay(new Date(`${fromParam}T00:00:00Z`)) : null,
      to: isYMD(toParam) ? endOfDay(new Date(`${toParam}T00:00:00Z`)) : null,
    };

    const mv = await moneyViewForReq(req, db);
    const now = new Date();
    const bundle = await fetchBundle(db, fp);
    const ctx: Ctx = { db, now, fp, canSee: mv.canSee, ...bundle };

    // ---- chip parameter terpasang (kop dokumen) ----
    const officeById = new Map(ctx.offices.map((o) => [o.id, o]));
    const filterChips: { label: string; value: string }[] = [];
    if (fp.office) {
      const o = officeById.get(fp.office);
      if (o) filterChips.push({ label: "Cabang", value: `${o.name}${o.city ? ` — ${o.city}` : ""}` });
    }
    if (fp.prStatus) filterChips.push({ label: "Status Permintaan", value: PR_STATUS_LABELS[fp.prStatus] ?? fp.prStatus });
    if (fp.offerStatus) filterChips.push({ label: "Status Offer", value: OFFER_STATUS_LABELS[fp.offerStatus] ?? fp.offerStatus });
    if (fp.applicantStatus) filterChips.push({ label: "Status Pelamar", value: APPLICANT_STATUS_LABELS[fp.applicantStatus] ?? fp.applicantStatus });
    if (fp.year) filterChips.push({ label: "Tahun Data", value: String(fp.year) });
    if (fp.from || fp.to) {
      const fd = fp.from ? dateID(fp.from) : "awal riwayat";
      const td = fp.to ? dateID(fp.to) : dateID(now);
      filterChips.push({ label: "Rentang Tanggal", value: `${fd} – ${td}` });
    }

    const activeOffices = ctx.offices.filter((o) => o.active);
    const meta = {
      companyName: ctx.company?.name ?? "Perusahaan",
      companyAddress: ctx.company?.address ?? null,
      companyCity: ctx.company?.city ?? null,
      companyTaxId: ctx.company?.taxId ?? null,
      companyLogoUrl: ctx.company?.logoUrl ?? null,
      branchLabel: fp.office
        ? officeById.get(fp.office)?.name ?? "Semua Cabang & Lokasi Kerja"
        : activeOffices.length === 1 ? activeOffices[0].name : "Semua Cabang & Lokasi Kerja",
      printedBy: m.actor.name,
      generatedAt: now.toISOString(),
      year: now.getFullYear(),
      scope: "all" as const,
      filters: filterChips,
    };

    // ---- build laporan ----
    const built = id === "rc11" ? buildRc11(ctx)
      : id === "rc12" ? buildRc12(ctx)
      : id === "rc13" ? buildRc13(ctx)
      : id === "rc21" ? buildRc21(ctx)
      : id === "rc22" ? buildRc22(ctx)
      : id === "rc23" ? buildRc23(ctx)
      : id === "rc31" ? buildRc31(ctx)
      : id === "rc32" ? buildRc32(ctx)
      : id === "rc33" ? buildRc33(ctx)
      : id === "rc41" ? buildRc41(ctx)
      : id === "rc42" ? buildRc42(ctx)
      : buildRc43(ctx);

    // ---- mode export XLSX ----
    if (sp.get("export") === "xlsx") {
      // BL-4: bahasa ekspor — default EN (frontend selalu mengirim ?lang=).
      const lang: Lang = req.nextUrl.searchParams.get("lang") === "id" ? "id" : "en";
      const title = trFor(lang, REPORT_TITLES[id] ?? id);
      const sheets = buildSheets(id, built.payload, title, lang);
      const buf = await toXlsxMulti(sheets, { lang });
      try {
        await db.activityLog.create({
          data: {
            action: "Exported", entity: "RecruitmentReportDocument",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX laporan distribusi Recruitment (${id} — ${REPORT_TITLES[id]})`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-recruitment-${id}`, "xlsx"));
    }

    return NextResponse.json({ id, meta: { ...meta, periodLabel: built.periodLabel }, data: built.payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ sheet XLSX per laporan ============

/** Helper bilingual lokal builder ekspor rekrutmen. */
function tt(lang: Lang, id: string, en: string): string {
  return lang === "en" ? en : id;
}

function buildSheets(id: string, p: AnyRec, title: string, lang: Lang): ExportSheet[] {
  const s = (v: unknown): string => (v == null || v === "" ? "—" : String(v));
  const d = (v: unknown): string => (v == null || v === "" ? "—" : String(v));
  const rp = (n: unknown): number | string => (n == null ? "—" : n as number);
  const r = (k: string): AnyRec[] => (p[k] as AnyRec[]) ?? [];
  // Uang: null → "disamarkan/masked" HANYA bila brankas terkunci (payload
  // .masked) — selain itu "—" (tidak ada data tercatat).
  const money = (v: unknown): number | string => (v != null ? v as number : (p as AnyRec).masked ? (lang === "en" ? "masked" : "disamarkan") : "—");

  switch (id) {
    case "rc11": {
      const st: Record<string, string> = { Draft: tt(lang, "Draf", "Draft"), Applied: tt(lang, "Diterapkan", "Applied") };
      return [{
        name: "Rekap Rencana",
        title,
        columns: [
          { header: tt(lang, "Periode", "Period"), width: 10 }, { header: tt(lang, "Urutan", "Seq"), width: 8 },
          { header: tt(lang, "Posisi", "Position"), width: 30 }, { header: tt(lang, "Kantor", "Office"), width: 18 },
          { header: tt(lang, "Status", "Status"), width: 12 },
          { header: "(a) " + tt(lang, "Target", "Target"), width: 10 }, { header: "(b) " + tt(lang, "Penyesuaian", "Adjustment"), width: 12 },
          { header: "(c)=(a)+(b)", width: 12 }, { header: "(d) " + tt(lang, "Karyawan Awal", "Opening HC"), width: 12 },
          { header: "(e) " + tt(lang, "Masuk", "In"), width: 8 }, { header: "(f) " + tt(lang, "Keluar", "Out"), width: 8 },
          { header: "(g)=(d)+(e)−(f)", width: 12 }, { header: "(h)=(c)−(g)", width: 12 },
          { header: tt(lang, "Anggaran Upah", "Salary Budget"), width: 16 },
          { header: tt(lang, "PR Diajukan", "PRs Requested"), width: 12 }, { header: tt(lang, "PR Terpenuhi", "PRs Fulfilled"), width: 12 },
        ],
        rows: r("rows").map((x) => [
          s(x.period), (x.seqNo as number) ?? 0, s(x.positionTitle), s(x.office), st[x.status as string] ?? s(x.status),
          (x.targetA as number) ?? 0, (x.adjustB as number) ?? 0, (x.totalC as number) ?? 0, (x.empD as number) ?? 0,
          (x.inE as number) ?? 0, (x.outF as number) ?? 0, (x.resultG as number) ?? 0, (x.needH as number) ?? 0,
          money(x.salaryBudget), (x.prRequested as number) ?? 0, (x.prFulfilled as number) ?? 0,
        ]),
      }];
    }
    case "rc12": {
      const st: Record<string, string> = PR_STATUS_LABELS;
      return [{
        name: "Register PR",
        title,
        columns: [
          { header: tt(lang, "No. PR", "PR No."), width: 14 }, { header: tt(lang, "Tanggal", "Date"), width: 12 },
          { header: tt(lang, "Posisi", "Position"), width: 28 }, { header: tt(lang, "Kantor", "Office"), width: 16 },
          { header: tt(lang, "Unit", "Unit"), width: 18 }, { header: tt(lang, "Pengaju", "Requester"), width: 20 },
          { header: tt(lang, "Recruiter", "Recruiter"), width: 20 }, { header: tt(lang, "Status Kerja", "Employment"), width: 14 },
          { header: tt(lang, "Dibutuhkan", "Required"), width: 10 }, { header: tt(lang, "Ter-appoint", "Appointed"), width: 10 },
          { header: tt(lang, "Status", "Status"), width: 18 }, { header: tt(lang, "Umur (hari)", "Age (days)"), width: 11 },
          { header: tt(lang, "Target SLA (hari)", "SLA Target (days)"), width: 14 },
        ],
        rows: r("rows").map((x) => [
          s(x.prNo), d(x.requestDate), s(x.position), s(x.office), s(x.unit), s(x.requester), s(x.officer),
          s(x.employmentStatus), (x.requiredNo as number) ?? 0, (x.appointed as number) ?? 0,
          st[x.status as string] ?? s(x.status), rp(x.ageDays), rp(x.slaTargetDays),
        ]),
      }];
    }
    case "rc13": {
      const risk: Record<string, string> = { tinggi: tt(lang, "Tinggi", "High"), sedang: tt(lang, "Sedang", "Medium"), rendah: tt(lang, "Rendah", "Low"), sehat: tt(lang, "Sehat", "Healthy") };
      const st: Record<string, string> = PR_STATUS_LABELS;
      return [{
        name: "Aging & SLA PR",
        title,
        columns: [
          { header: tt(lang, "No. PR", "PR No."), width: 14 }, { header: tt(lang, "Posisi", "Position"), width: 28 },
          { header: tt(lang, "Kantor", "Office"), width: 16 }, { header: tt(lang, "Status", "Status"), width: 18 },
          { header: tt(lang, "Tanggal Request", "Request Date"), width: 13 }, { header: tt(lang, "Umur (hari)", "Age (days)"), width: 11 },
          { header: tt(lang, "Target SLA (hari)", "SLA Target (days)"), width: 14 }, { header: tt(lang, "Lewat SLA (hari)", "Over SLA (days)"), width: 13 },
          { header: tt(lang, "Kandidat", "Candidates"), width: 10 }, { header: tt(lang, "Ter-appoint", "Appointed"), width: 10 },
          { header: tt(lang, "Risiko", "Risk"), width: 10 },
        ],
        rows: r("rows").map((x) => [
          s(x.prNo), s(x.position), s(x.office), st[x.status as string] ?? s(x.status), d(x.requestDate),
          (x.ageDays as number) ?? 0, rp(x.slaTargetDays), rp(x.overDays),
          (x.candidates as number) ?? 0, (x.appointed as number) ?? 0, risk[x.risk as string] ?? s(x.risk),
        ]),
      }];
    }
    case "rc21": {
      const st: Record<string, string> = { Draft: tt(lang, "Draf", "Draft"), Posted: tt(lang, "Tayang", "Posted"), Closed: tt(lang, "Ditutup", "Closed"), Obsolete: tt(lang, "Usang", "Obsolete") };
      return [{
        name: "Kinerja Lowongan",
        title,
        columns: [
          { header: tt(lang, "No. Iklan", "Ad No."), width: 14 }, { header: tt(lang, "Judul", "Title"), width: 30 },
          { header: tt(lang, "Status", "Status"), width: 10 }, { header: tt(lang, "Tayang", "Posted"), width: 12 },
          { header: tt(lang, "Batas Akhir", "Deadline"), width: 12 }, { header: tt(lang, "Slot PR", "PR Slots"), width: 8 },
          { header: "PR", width: 24 }, { header: tt(lang, "Kanal", "Channels"), width: 8 },
          { header: tt(lang, "Biaya Rencana", "Planned Cost"), width: 14 }, { header: tt(lang, "Biaya Aktual", "Actual Cost"), width: 14 },
          { header: tt(lang, "Lamaran", "Applications"), width: 11 }, { header: tt(lang, "Kandidat", "Candidates"), width: 10 },
          { header: "Hire", width: 8 },
        ],
        rows: r("rows").map((x) => [
          s(x.refNo), s(x.title), st[x.status as string] ?? s(x.status), d(x.datePosted), d(x.lastAcceptDate),
          (x.slots as number) ?? 0, ((x.prNos as string[]) ?? []).join(", ") || "—", (x.methods as number) ?? 0,
          money(x.plannedCost), money(x.actualCost), (x.applications as number) ?? 0, (x.candidates as number) ?? 0, (x.hires as number) ?? 0,
        ]),
      }];
    }
    case "rc22": {
      return [{
        name: "Efektivitas Sumber",
        title,
        columns: [
          { header: tt(lang, "Sumber", "Source"), width: 18 }, { header: tt(lang, "Pelamar", "Applicants"), width: 10 },
          { header: tt(lang, "Kandidat", "Candidates"), width: 10 }, { header: "Hire", width: 8 },
          { header: tt(lang, "Belanja", "Spend"), width: 14 }, { header: tt(lang, "Cost per Hire", "Cost per Hire"), width: 14 },
          { header: tt(lang, "Hire Rate %", "Hire Rate %"), width: 11 },
        ],
        rows: r("rows").map((x) => [
          s(x.sourceLabel), (x.applicants as number) ?? 0, (x.candidates as number) ?? 0, (x.hires as number) ?? 0,
          money(x.spend), money(x.costPerHire), rp(x.hireRate),
        ]),
      }];
    }
    case "rc23": {
      const st: Record<string, string> = APPLICANT_STATUS_LABELS;
      return [{
        name: "Talent Pool",
        title,
        columns: [
          { header: tt(lang, "No. Pelamar", "Applicant No."), width: 14 }, { header: tt(lang, "Nama", "Name"), width: 26 },
          { header: tt(lang, "Status", "Status"), width: 18 }, { header: tt(lang, "Sumber", "Source"), width: 16 },
          { header: tt(lang, "Pendidikan", "Education"), width: 10 }, { header: "IPK", width: 7 },
          { header: tt(lang, "Pengalaman (thn)", "Experience (yrs)"), width: 13 },
          { header: tt(lang, "Masuk Pool", "Pool Entry"), width: 12 }, { header: tt(lang, "Hangus Pada", "Keep-on-file Until"), width: 12 },
          { header: tt(lang, "Lamaran", "Applications"), width: 10 }, { header: tt(lang, "Flag", "Flags"), width: 18 },
        ],
        rows: r("rows").map((x) => [
          s(x.applicantNo), s(x.name), st[x.status as string] ?? s(x.status), s(x.source), s(x.eduLevel), rp(x.gpa),
          rp(x.expYears), d(x.dateApplied), d(x.keepOnFileUntil), (x.applications as number) ?? 0,
          ((x.flags as string[]) ?? []).join(", ") || "—",
        ]),
      }];
    }
    case "rc31": {
      const cs: Record<string, string> = CANDIDATE_STATUS_LABELS;
      return [{
        name: "Corong Seleksi",
        title,
        columns: [
          { header: tt(lang, "Tahap", "Stage"), width: 26 }, { header: tt(lang, "Urutan", "Order"), width: 8 },
          { header: tt(lang, "Jenis Hasil", "Result Type"), width: 14 }, { header: tt(lang, "Wajib", "Mandatory"), width: 9 },
          { header: tt(lang, "Min Lulus", "Min Pass"), width: 9 },
          { header: tt(lang, "Masuk", "Entered"), width: 8 }, { header: tt(lang, "Dilaksanakan", "Performed"), width: 11 },
          { header: tt(lang, "Lulus", "Passed"), width: 8 }, { header: tt(lang, "Gagal", "Failed"), width: 8 },
          { header: tt(lang, "Dibatalkan", "Cancelled"), width: 10 }, { header: tt(lang, "Pass Rate %", "Pass Rate %"), width: 11 },
        ],
        rows: r("stages").map((x) => [
          s(x.name), rp(x.processOrder), s(x.resultType), x.mandatory ? tt(lang, "Ya", "Yes") : "—", rp(x.minResultPass),
          (x.entered as number) ?? 0, (x.performed as number) ?? 0, (x.passed as number) ?? 0, (x.failed as number) ?? 0,
          (x.cancelled as number) ?? 0, rp(x.passRate),
        ]),
      }, {
        name: tt(lang, "Status Kandidat", "Candidate Status"),
        title: `${title} — ${tt(lang, "Status Kandidat", "Candidate Status")}`,
        columns: [
          { header: tt(lang, "Status", "Status"), width: 20 }, { header: tt(lang, "Jumlah", "Count"), width: 10 },
        ],
        rows: r("candidateStatus").map((x) => [cs[x.status as string] ?? s(x.status), (x.count as number) ?? 0]),
      }];
    }
    case "rc32": {
      const st: Record<string, string> = STEP_STATUS_LABELS;
      return [{
        name: "SLA Tahap Seleksi",
        title,
        columns: [
          { header: tt(lang, "Kandidat", "Candidate"), width: 24 }, { header: tt(lang, "No. PR", "PR No."), width: 14 },
          { header: tt(lang, "Posisi", "Position"), width: 26 }, { header: tt(lang, "Tahap", "Stage"), width: 22 },
          { header: tt(lang, "Urutan", "Seq"), width: 7 }, { header: tt(lang, "Jadwal", "Planned"), width: 12 },
          { header: tt(lang, "Batas SLA", "SLA Due"), width: 12 }, { header: tt(lang, "Status", "Status"), width: 14 },
          { header: tt(lang, "Dilaksanakan", "Performed"), width: 12 }, { header: tt(lang, "Pelaksana", "Performer"), width: 20 },
          { header: tt(lang, "Terlambat (hari)", "Late (days)"), width: 12 }, { header: tt(lang, "Overdue (hari)", "Overdue (days)"), width: 12 },
        ],
        rows: r("rows").map((x) => [
          s(x.candidateName), s(x.prNo), s(x.positionTitle), s(x.stageName), (x.seqNo as number) ?? 0,
          d(x.planDate), d(x.dueDate), st[x.status as string] ?? s(x.status), d(x.performedAt), s(x.performerName),
          rp(x.lateDays), rp(x.overdueDays),
        ]),
      }];
    }
    case "rc33": {
      const rec: Record<string, string> = RECOMMENDATION_LABELS;
      return [{
        name: "Ringkasan Scorecard",
        title,
        columns: [
          { header: tt(lang, "Kandidat", "Candidate"), width: 24 }, { header: tt(lang, "No. PR", "PR No."), width: 14 },
          { header: tt(lang, "Posisi", "Position"), width: 26 }, { header: tt(lang, "Tahap", "Stage"), width: 22 },
          { header: tt(lang, "Evaluator", "Evaluator"), width: 22 }, { header: tt(lang, "Terisi", "Submitted"), width: 9 },
          { header: tt(lang, "Tanggal", "Date"), width: 12 }, { header: tt(lang, "Skor Rata-rata", "Avg Score"), width: 11 },
          { header: tt(lang, "Rekomendasi", "Recommendation"), width: 16 }, { header: tt(lang, "Jumlah Kompetensi", "Competencies"), width: 12 },
        ],
        rows: r("rows").map((x) => [
          s(x.candidateName), s(x.prNo), s(x.positionTitle), s(x.stageName), s(x.evaluatorName),
          x.submitted ? tt(lang, "Ya", "Yes") : tt(lang, "Draf", "Draft"), d(x.submittedAt), rp(x.avgScore),
          x.recommendation ? rec[x.recommendation as string] ?? s(x.recommendation) : "—", (x.competencyCount as number) ?? 0,
        ]),
      }, {
        name: tt(lang, "Divergensi Panel", "Panel Divergence"),
        title: `${title} — ${tt(lang, "Divergensi antar evaluator > 2", "Inter-evaluator divergence > 2")}`,
        columns: [
          { header: tt(lang, "Kandidat", "Candidate"), width: 24 }, { header: tt(lang, "No. PR", "PR No."), width: 14 },
          { header: tt(lang, "Tahap", "Stage"), width: 22 }, { header: tt(lang, "Kompetensi", "Competency"), width: 16 },
          { header: tt(lang, "Rentang", "Spread"), width: 9 }, { header: tt(lang, "Skor Panel", "Panel Scores"), width: 18 },
        ],
        rows: r("divergences").map((x) => [
          s(x.candidateName), s(x.prNo), s(x.stageName), s(x.competency), (x.spread as number) ?? 0,
          ((x.scores as number[]) ?? []).join(" vs "),
        ]),
      }];
    }
    case "rc41": {
      const st: Record<string, string> = OFFER_STATUS_LABELS;
      return [{
        name: "Status Offer",
        title,
        columns: [
          { header: tt(lang, "No. Offer", "Offer No."), width: 14 }, { header: tt(lang, "Kandidat", "Candidate"), width: 24 },
          { header: tt(lang, "No. PR", "PR No."), width: 14 }, { header: tt(lang, "Posisi", "Position"), width: 26 },
          { header: tt(lang, "Status", "Status"), width: 18 }, { header: tt(lang, "Terkirim", "Sent"), width: 12 },
          { header: tt(lang, "Respon", "Responded"), width: 12 }, { header: tt(lang, "Hari Respon", "Response Days"), width: 11 },
          { header: tt(lang, "Kedaluwarsa", "Expiry"), width: 12 }, { header: tt(lang, "Diangkat", "Appointed"), width: 9 },
          { header: tt(lang, "Catatan", "Note"), width: 30 },
        ],
        rows: r("rows").map((x) => [
          s(x.offerNo), s(x.candidateName), s(x.prNo), s(x.positionTitle), st[x.status as string] ?? s(x.status),
          d(x.sentAt), d(x.respondedAt), rp(x.responseDays), d(x.expiryDate),
          x.appointed ? tt(lang, "Ya", "Yes") : "—", s(x.note),
        ]),
      }];
    }
    case "rc42": {
      return [{
        name: "Realisasi Rekrutmen",
        title,
        columns: [
          { header: tt(lang, "No. PR", "PR No."), width: 14 }, { header: tt(lang, "Posisi", "Position"), width: 26 },
          { header: tt(lang, "Kantor", "Office"), width: 16 }, { header: tt(lang, "Unit", "Unit"), width: 18 },
          { header: tt(lang, "Kandidat", "Candidate"), width: 24 }, { header: tt(lang, "Sumber", "Source"), width: 12 },
          { header: tt(lang, "Tanggal Angkat", "Appointment Date"), width: 14 }, { header: tt(lang, "Status Kerja", "Employment"), width: 14 },
          { header: tt(lang, "No. Karyawan", "Employee No."), width: 14 }, { header: "Onboarding", width: 14 },
          { header: tt(lang, "No. Surat", "Letter No."), width: 20 },
        ],
        rows: r("rows").map((x) => [
          s(x.prNo), s(x.positionTitle), s(x.officeName), s(x.unitName), s(x.candidateName), s(x.source),
          d(x.appointmentDate), s(x.employmentStatus), s(x.employeeNo), s(x.onboarding), s(x.letterNo),
        ]),
      }];
    }
    default: {
      return [{
        name: "Biaya per Hire",
        title,
        columns: [
          { header: tt(lang, "No. Iklan", "Ad No."), width: 14 }, { header: tt(lang, "Judul Iklan", "Ad Title"), width: 28 },
          { header: tt(lang, "Kanal", "Channel"), width: 20 }, { header: tt(lang, "Media", "Media"), width: 16 },
          { header: tt(lang, "Agency", "Agency"), width: 16 }, { header: tt(lang, "Tayang", "Posted"), width: 12 },
          { header: tt(lang, "Biaya Rencana", "Planned Cost"), width: 14 }, { header: tt(lang, "Biaya Aktual", "Actual Cost"), width: 14 },
        ],
        rows: r("rows").map((x) => [
          s(x.joNo), s(x.joTitle), s(x.method), s(x.mediaName), s(x.agencyName), d(x.datePosted),
          money(x.plannedCost), money(x.actualCost),
        ]),
      }];
    }
  }
}
