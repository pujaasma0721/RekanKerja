// ============================================================================
// RECRUITMENT — Overview service (dashboard Ringkasan modul).
// Satu agregat ringan utk halaman Ringkasan: KPI pipeline (PR → lowongan →
// seleksi → offer/hired) + kesehatan PR + SLA + rencana/anggaran + rantai
// Standard Selection Process. Menggantikan 10+ pemanggilan API terpisah pada
// overview lama (dev-phase map) — kini pola leave/travel: satu endpoint.
//
// Reuse (angka identik dgn menu sumber — tidak duplikasi logika):
//   · prStats            (pr-service)       — status PR
//   · selectionSummaries  (selection-service) — kandidat aktif/overdue/undangan
//   · offerFunnel        (offer-service)   — funnel + hired + acceptance rate
//   · mppAchievement     (planning-service) — Σh / Σfulfilled capaian MPP
//   · outsidePlanPrs     (planning-service) — PR di luar rencana
//   · getBudget          (planning-service) — anggaran tahun berjalan (vault)
// Semua agregat dari kolom polos (status/plain) → aman SQL; uang hanya via
// getBudget (decrypt in-memory — konvensi W28). Silver medalist = padanan
// filter demographics-service (Passed tanpa pengangkatan + consent PDP).
// ============================================================================
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { prStats } from "@/rekankerja/recruitment/services/pr-service";
import { selectionSummaries } from "@/rekankerja/recruitment/services/selection-service";
import { offerFunnel } from "@/rekankerja/recruitment/services/offer-service";
import { mppAchievement, outsidePlanPrs, getBudget } from "@/rekankerja/recruitment/services/planning-service";

// ============ tipe (bentuk JSON API) ============

export interface OverviewPrHealth {
  open: number; // Submitted + Approved + OnHold
  avgAgeDays: number | null;
  oldest: { prNo: string; days: number } | null;
  atRisk: number; // umur > slaTargetDays (yang terisi)
  oldestRisk: { prNo: string; positionTitle: string | null; ageDays: number; targetDays: number } | null;
}

export interface OverviewData {
  pr: {
    stats: { total: number; draft: number; submitted: number; approved: number; rejected: number; onHold: number; fulfilled: number; closed: number; cancelled: number };
    health: OverviewPrHealth;
  };
  openings: { posted: number; openSlots: number; applications: number };
  applicants: { active: number; pendingStaging: number; blacklisted: number };
  selection: {
    prsWithCandidates: number; activeCandidates: number; overdue: number; invitations: number;
    topPrs: { prNo: string; candidates: number; overdue: number }[]; // top 5 by overdue
  };
  offers: {
    sent: number; awaiting: number; accepted: number; declined: number; expired: number;
    hired: number; acceptanceRate: number | null;
    funnel: { key: string; label: string; labelEn: string; count: number }[];
  };
  plan: { applied: number; sumH: number; sumFulfilled: number; outsideCount: number };
  budget: { period: string; total: number | null; used: number }; // total null = belum diset / masked
  silver: number;
  chain: { name: string; processOrder: number | null; slaDays: number | null; resultType: string | null }[];
}

const DAY_MS = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY_MS));
}

/** Status PR yang masih "terbuka" (aktif direkrut / menunggu approval). */
const OPEN_PR = ["Submitted", "Approved", "OnHold"] as const;

/** Silver medalist (auto-saran talent pool) — cermin filter demographics-service:
 *  Passed tanpa pengangkatan + keluarkan pelamar Anonymized & consent ditarik. */
const SILVER_WHERE: Prisma.JobCandidateWhereInput = {
  status: "Passed",
  appointments: { none: {} },
  OR: [
    { applicantId: null },
    {
      applicant: {
        status: { not: "Anonymized" },
        consents: { none: { purpose: "talent-pool", withdrawnAt: { not: null } } },
      },
    },
  ],
};

// ============ agregat ============

export async function recruitmentOverviewStats(db: TenantDb, moneyVisible: boolean): Promise<OverviewData> {
  const year = String(new Date().getFullYear());

  const [
    prByStatus, openPrs, joGroup, slotOpen, applications,
    applicantGroup, blCount, paPending,
    selSum, offerGroup, hiredCount,
    planGroup, mpp, outside, budget, silver, chain,
  ] = await Promise.all([
    // PR — status (reuse shape prStats via groupBy ringan)
    db.personnelRequisition.groupBy({ by: ["status"], _count: { _all: true } }),
    // PR terbuka — aging & at-risk (kolom polos)
    db.personnelRequisition.findMany({
      where: { status: { in: [...OPEN_PR] } },
      select: { prNo: true, requestDate: true, slaTargetDays: true, position: { select: { title: true } } },
      take: 500,
    }),
    // Lowongan — status JO + slot terbuka + lamaran masuk
    db.jobOpportunity.groupBy({ by: ["status"], _count: { _all: true } }),
    db.jobOpening.count({ where: { status: "Open" } }),
    db.applicantApplication.count(),
    // Talent pool — status pelamar + blacklist + staging menunggu verifikasi
    db.applicant.groupBy({ by: ["status"], _count: { _all: true } }),
    db.applicant.count({ where: { blacklist: true } }),
    db.publicApplication.count({ where: { status: "Pending" } }),
    // Seleksi — reuse summaries (kandidat aktif/overdue/undangan per PR)
    selectionSummaries(db),
    // Offer — status
    db.candidateOffer.groupBy({ by: ["status"], _count: { _all: true } }),
    db.candidateAppointment.count({ where: { employeeId: { not: null } } }),
    // Rencana — status plan + capaian MPP + PR di luar rencana (reuse)
    db.recruitmentPlan.groupBy({ by: ["status"], _count: { _all: true } }),
    mppAchievement(db),
    outsidePlanPrs(db),
    // Anggaran tahun berjalan (vault-aware — reuse)
    getBudget(db, year, moneyVisible),
    // Silver medalist — padanan filter demographics-service (count saja)
    db.jobCandidate.count({ where: SILVER_WHERE }),
    // Rantai Standard Selection Process aktif (urut)
    db.selectionProcess.findMany({
      where: { active: true },
      select: { name: true, processOrder: true, slaDays: true, resultType: true },
      orderBy: [{ processOrder: "asc" }, { name: "asc" }],
      take: 30,
    }),
  ]);

  // ---- PR ----
  const ps = (s: string) => prByStatus.find((g) => g.status === s)?._count._all ?? 0;
  const now = new Date();
  const ages = openPrs.map((p) => daysBetween(p.requestDate, now));
  const risks = openPrs
    .filter((p) => p.slaTargetDays != null && daysBetween(p.requestDate, now) > (p.slaTargetDays ?? 0))
    .map((p) => ({
      prNo: p.prNo,
      positionTitle: p.position?.title ?? null,
      ageDays: daysBetween(p.requestDate, now),
      targetDays: p.slaTargetDays ?? 0,
    }))
    .sort((a, b) => b.ageDays - a.ageDays);
  let oldest: { prNo: string; days: number } | null = null;
  for (const p of openPrs) {
    const d = daysBetween(p.requestDate, now);
    if (!oldest || d > oldest.days) oldest = { prNo: p.prNo, days: d };
  }

  // ---- Offer ----
  const os = (s: string) => offerGroup.find((g) => g.status === s)?._count._all ?? 0;
  const sent = os("Sent") + os("Viewed") + os("Accepted") + os("Declined") + os("Expired");
  const awaiting = os("Sent") + os("Viewed") + os("PendingApproval");
  const accepted = os("Accepted");

  // ---- Funnel (reuse offer-service — angka identik menu Offer) ----
  const funnelFull = await offerFunnel(db, null);

  return {
    pr: {
      stats: {
        total: prByStatus.reduce((a, g) => a + g._count._all, 0),
        draft: ps("Draft"), submitted: ps("Submitted"), approved: ps("Approved"),
        rejected: ps("Rejected"), onHold: ps("OnHold"), fulfilled: ps("Fulfilled"),
        closed: ps("Closed"), cancelled: ps("Cancelled"),
      },
      health: {
        open: openPrs.length,
        avgAgeDays: ages.length > 0 ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : null,
        oldest,
        atRisk: risks.length,
        oldestRisk: risks[0] ?? null,
      },
    },
    openings: {
      posted: joGroup.find((g) => g.status === "Posted")?._count._all ?? 0,
      openSlots: slotOpen,
      applications,
    },
    applicants: {
      active: applicantGroup.find((g) => g.status === "Active")?._count._all ?? 0,
      pendingStaging: paPending,
      blacklisted: blCount,
    },
    selection: {
      prsWithCandidates: selSum.length,
      activeCandidates: selSum.reduce((a, s) => a + s.active, 0),
      overdue: selSum.reduce((a, s) => a + s.overdue, 0),
      invitations: selSum.reduce((a, s) => a + s.invitations, 0),
      topPrs: selSum
        .filter((s) => s.overdue > 0)
        .sort((a, b) => b.overdue - a.overdue)
        .slice(0, 5)
        .map((s) => ({ prNo: s.prNo, candidates: s.candidates, overdue: s.overdue })),
    },
    offers: {
      sent, awaiting, accepted, declined: os("Declined"), expired: os("Expired"),
      hired: hiredCount,
      acceptanceRate: sent > 0 ? Math.round((accepted / sent) * 100) : null,
      funnel: funnelFull.stages.map((s) => ({ key: s.key, label: s.label, labelEn: s.labelEn, count: s.count })),
    },
    plan: {
      applied: planGroup.find((g) => g.status === "Applied")?._count._all ?? 0,
      sumH: mpp.sumH,
      sumFulfilled: mpp.sumFulfilled,
      outsideCount: outside.length,
    },
    // getBudget bertipe nullable (praktis selalu mengembalikan baris — tetap
    // pertahankan bentuk respons stabil utk klien).
    budget: budget
      ? { period: budget.period, total: budget.adjustBudget ?? budget.totalBudget, used: budget.used }
      : { period: year, total: null, used: 0 },
    silver,
    chain: chain.map((c) => ({ name: c.name, processOrder: c.processOrder, slaDays: c.slaDays, resultType: c.resultType })),
  };
}
