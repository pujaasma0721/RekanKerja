// ============================================================================
// RECRUITMENT F8 — Analytics & Prediktif (DEVELOPMENT-PLAN-RECRUITMENT.md
// §7 F8 + HRX G1/G2/G3/G4/G5 + adverse-impact P4).
//
//   · getRecruitmentDashboard  — kesehatan & aging PR, beban recruiter,
//                                kepatuhan SLA, ROI sumber & cost per hire,
//                                funnel ringkas (reuse offerFunnel F4).
//   · getMetricsCatalog        — katalog metrik (time to fill/hire, offer
//                                acceptance, interview pass rate, source
//                                effectiveness, requisition aging).
//   · getAdverseImpact         — pass-through demografis per tahap + flag
//                                4/5ths rule (EEOC) per dimensi per tahap.
//   · snapshotMetrics          — upsert MetricSnapshot (periode YYYY-MM) —
//                                dipanggil job harian + migrasi awal.
//   · getProjections           — prediktif heuristik (BUKAN ML): projected
//                                time-to-fill per posisi + PR berisiko.
//   · getSnapshotHistory      — histori MetricSnapshot per metrik (chart).
//
// Konvensi: semua agregat dari kolom polos (status/source/birthDate/
// highestEduLevel — BUKAN PII terenkripsi) → aman groupBy SQL; uang
// (JobOpeningMethod.actualCost vault) di-decrypt via tenantCryptoForDb untuk
// agregat IN-MEMORY saja (tidak pernah di SQL — konvensi W28). Serializer
// JSON-friendly: Date → ISO string, angka tetap angka.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { offerFunnel, type OfferFunnel } from "@/rekankerja/recruitment/services/offer-service";

// ============ tipe (bentuk JSON API) ============

export interface PrHealth {
  open: number;
  avgAgeDays: number | null;
  oldest: { prNo: string; days: number } | null;
  atRisk: { prNo: string; positionTitle: string | null; ageDays: number; targetDays: number }[];
  closedThisPeriod: number;
}

export interface RecruiterLoadRow {
  officerId: string | null;
  name: string;
  activeCandidates: number;
  activePrs: number;
}

export interface SlaCompliance {
  onTime: number;
  late: number;
  rate: number | null; // persen onTime
  latestStage: { name: string; late: number } | null; // tahap terlambat terbanyak
}

export interface SourceRoiRow {
  source: string; // label sumber (Advertisement|Agency|Referral|Web|Internal|Other)
  spend: number | null; // total actualCost (decrypt in-memory) — null bila tak ada biaya tercatat
  hires: number;
  costPerHire: number | null;
}

export interface DashboardData {
  prHealth: PrHealth;
  recruiterLoad: RecruiterLoadRow[];
  slaCompliance: SlaCompliance;
  sourceRoi: SourceRoiRow[];
  funnel: OfferFunnel;
}

export interface MetricItem {
  key: string;
  labelId: string;
  labelEn: string;
  value: number | null;
  unit: string;
  /** padanan EN satuan ("hari"→"days") — BL-REC-CORE. */
  unitEn: string;
  hint: string;
  /** padanan EN hint kartu metrik — BL-REC-CORE. */
  hintEn: string;
  /** breakdown terstruktur (khusus source_effectiveness). */
  breakdown?: { source: string; applicants: number; hires: number; rate: number | null }[];
}

export interface AdverseGroup {
  label: string;
  entered: number;
  passed: number;
  rate: number | null; // persen
  /** grup ini terdampak: rate < 80% dari rate grup tertinggi (4/5ths). */
  flag: boolean;
  /** entered < 2 → statistik terlalu kecil (diuarankan label "n kecil"). */
  small: boolean;
}

export interface AdverseDim {
  dim: string; // gender | age | education
  groups: AdverseGroup[];
  /** lowest rate / highest rate antar grup layak uji (entered ≥ 2). */
  impactRatio: number | null;
  flagged: boolean; // impactRatio < 0.8 → indikasi adverse impact
}

export interface AdverseImpactData {
  stages: { stage: string; processOrder: number | null; dims: AdverseDim[] }[];
  rule: { threshold: number; noteId: string; noteEn: string };
}

export interface ProjectionPosition {
  position: string;
  avgFillDays: number | null; // histori posisi ini (null bila tanpa sampel)
  sampleSize: number;
}

export interface AtRiskPr {
  prNo: string;
  positionTitle: string | null;
  ageDays: number;
  projection: number; // estimasi hari penyelesaian (per posisi, fallback global)
  overdueFactor: number; // ageDays / projection (> 1.5 → berisiko)
}

export interface ProjectionsData {
  positions: ProjectionPosition[];
  atRisk: AtRiskPr[];
  globalAvgDays: number | null;
  method: "heuristic-avg"; // BUKAN ML — transparan by design
}

export interface SnapshotHistoryPoint {
  period: string; // YYYY-MM
  value: number;
  computedAt: string;
}

// ============ konstanta domain ============

/** Status PR yang masih "terbuka" (aktif direkrut / menunggu approval). */
const OPEN_PR = ["Submitted", "Approved", "OnHold"] as const;
/** Status kandidat aktif di pipeline (beban recruiter). */
const ACTIVE_CANDIDATE = ["Nominated", "InProcess"] as const;
/** Status langkah yang sudah punya hasil/terlaksana (basis SLA on-time). */
const DONE_STEP = ["Passed", "Failed", "Performed"] as const;
/** Status terminal PR (ditutup periode ini). */
const TERMINAL_PR = ["Fulfilled", "Closed", "Cancelled"] as const;

/** 4/5ths rule (EEOC): rasio seleksi kelompok terendah vs tertinggi < 80%. */
const FOUR_FIFTHS = 0.8;

/** Ambang minimum sampel utk ikut dihitung rasio (di bawah ini → "n kecil"). */
const MIN_GROUP_SIZE = 2;

/** Peta kode RecruitmentMethod master → kelompok sumber pelamar (Applicant.source). */
const METHOD_TO_SOURCE: Record<string, string> = {
  ADVERT: "Advertisement",
  AGENCY: "Agency",
  REFERRAL: "Referral",
  WEBPORTAL: "Web",
  IJP: "Internal",
  MATCHING: "Internal",
  CAMPUS: "Other",
};

const SOURCE_LABEL: Record<string, { id: string; en: string }> = {
  Advertisement: { id: "Iklan", en: "Advertisement" },
  Agency: { id: "Agency", en: "Agency" },
  Referral: { id: "Referral karyawan", en: "Employee referral" },
  Web: { id: "Web", en: "Web" },
  Internal: { id: "Internal", en: "Internal" },
  Other: { id: "Lainnya", en: "Other" },
};

const DAY_MS = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY_MS));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 100) : null;
}

/** Periode snapshot berjalan: YYYY-MM (UTC — stabil lintas siklus harian). */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Awal bulan berjalan (lokal) — jendela "closedThisPeriod". */
function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function ageOf(birthDate: Date | null): number | null {
  if (!birthDate) return null;
  const now = new Date();
  let a = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) a--;
  return a;
}

// ============ 1. dashboard ============

export async function getRecruitmentDashboard(db: TenantDb): Promise<DashboardData> {
  const now = new Date();
  const tc = tenantCryptoForDb(db);

  // ---- kesehatan & aging PR + data posisi (dipakai juga ROI/aktivitas) ----
  const prs = await db.personnelRequisition.findMany({
    select: {
      id: true, prNo: true, status: true, requestDate: true, updatedAt: true, decidedAt: true,
      slaTargetDays: true, recruitmentOfficerId: true,
      position: { select: { title: true } },
    },
    take: 500,
  });
  const open = prs.filter((p) => (OPEN_PR as readonly string[]).includes(p.status));
  const ages = open.map((p) => daysBetween(p.requestDate, now));
  const avgAgeDays = ages.length > 0 ? round1(ages.reduce((a, b) => a + b, 0) / ages.length) : null;
  let oldest: PrHealth["oldest"] = null;
  for (const p of open) {
    const d = daysBetween(p.requestDate, now);
    if (!oldest || d > oldest.days) oldest = { prNo: p.prNo, days: d };
  }
  const monthStart = startOfMonth(now);
  const closedThisPeriod = prs.filter(
    (p) => (TERMINAL_PR as readonly string[]).includes(p.status) && p.updatedAt >= monthStart,
  ).length;
  const atRisk: PrHealth["atRisk"] = open
    .filter((p) => p.slaTargetDays != null && daysBetween(p.requestDate, now) > (p.slaTargetDays ?? 0))
    .map((p) => ({
      prNo: p.prNo,
      positionTitle: p.position?.title ?? null,
      ageDays: daysBetween(p.requestDate, now),
      targetDays: p.slaTargetDays ?? 0,
    }))
    .sort((a, b) => b.ageDays - a.ageDays);

  // ---- beban recruiter: kandidat aktif per officer (groupBy in-memory) ----
  const activeCandidates = await db.jobCandidate.findMany({
    where: { status: { in: [...ACTIVE_CANDIDATE] } },
    select: { id: true, pr: { select: { recruitmentOfficerId: true } } },
    take: 2000,
  });
  const candByOfficer = new Map<string | null, number>();
  for (const c of activeCandidates) {
    const k = c.pr.recruitmentOfficerId ?? null;
    candByOfficer.set(k, (candByOfficer.get(k) ?? 0) + 1);
  }
  const prByOfficer = new Map<string | null, number>();
  for (const p of open) prByOfficer.set(p.recruitmentOfficerId ?? null, (prByOfficer.get(p.recruitmentOfficerId ?? null) ?? 0) + 1);

  // nama officer dari karyawan aktif
  const officerIds = [...new Set([...candByOfficer.keys(), ...prByOfficer.keys()].filter((k): k is string => !!k))];
  const officers = officerIds.length > 0
    ? await db.employee.findMany({ where: { id: { in: officerIds } }, select: { id: true, fullName: true } })
    : [];
  const officerName = new Map(officers.map((o) => [o.id, o.fullName]));
  const loadMap = new Map<string | null, RecruiterLoadRow>();
  for (const [k, n] of candByOfficer) {
    loadMap.set(k, {
      officerId: k,
      name: k ? (officerName.get(k) ?? "—") : "Belum ditugaskan",
      activeCandidates: n,
      activePrs: prByOfficer.get(k) ?? 0,
    });
  }
  for (const [k, n] of prByOfficer) {
    if (!loadMap.has(k)) {
      loadMap.set(k, {
        officerId: k,
        name: k ? (officerName.get(k) ?? "—") : "Belum ditugaskan",
        activeCandidates: 0,
        activePrs: n,
      });
    }
  }
  const recruiterLoad = [...loadMap.values()].sort((a, b) => b.activeCandidates - a.activeCandidates).slice(0, 10);

  // ---- kepatuhan SLA: langkah ber-done dengan dueDate ----
  const doneSteps = await db.candidateSelectionStep.findMany({
    where: { status: { in: [...DONE_STEP] }, dueDate: { not: null } },
    select: { dueDate: true, performedAt: true, updatedAt: true, selectionProcessId: true },
    take: 3000,
  });
  const processIds = [...new Set(doneSteps.map((s) => s.selectionProcessId))];
  const processes = processIds.length > 0
    ? await db.selectionProcess.findMany({ where: { id: { in: processIds } }, select: { id: true, name: true } })
    : [];
  const processName = new Map(processes.map((p) => [p.id, p.name]));
  let onTime = 0;
  const lateByStage = new Map<string, number>();
  for (const s of doneSteps) {
    const doneAt = s.performedAt ?? s.updatedAt; // performedAt bila ada, else mutasi hasil
    const name = processName.get(s.selectionProcessId) ?? "—";
    if (doneAt <= (s.dueDate as Date)) onTime++;
    else lateByStage.set(name, (lateByStage.get(name) ?? 0) + 1);
  }
  const late = doneSteps.length - onTime;
  const latestEntry = [...lateByStage.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  // ---- ROI sumber & cost per hire ----
  // spend: JobOpeningMethod.actualCost (vault) per method → dipetakan ke
  // kelompok sumber; hires: kandidat ter-appoint per Applicant.source.
  const joMethods = await db.jobOpeningMethod.findMany({
    select: { actualCost: true, method: { select: { code: true, name: true } } },
    take: 1000,
  });
  const spendBySource = new Map<string, number>();
  for (const m of joMethods) {
    if (!m.actualCost) continue;
    const amount = tc.decryptMoney(m.actualCost) ?? 0;
    if (amount <= 0) continue;
    const src = METHOD_TO_SOURCE[m.method.code] ?? "Other";
    spendBySource.set(src, (spendBySource.get(src) ?? 0) + amount);
  }
  const hiredCandidates = await db.jobCandidate.findMany({
    where: { appointments: { some: {} } },
    select: {
      applicant: { select: { source: true } },
      employeeId: true,
    },
    take: 1000,
  });
  const hiresBySource = new Map<string, number>();
  for (const c of hiredCandidates) {
    const src = c.applicant?.source ?? (c.employeeId ? "Internal" : "Other");
    hiresBySource.set(src, (hiresBySource.get(src) ?? 0) + 1);
  }
  const allSources = [...new Set([...spendBySource.keys(), ...hiresBySource.keys()])];
  const sourceRoi: SourceRoiRow[] = allSources
    .sort((a, b) => (hiresBySource.get(b) ?? 0) - (hiresBySource.get(a) ?? 0))
    .map((src) => {
      const spend = spendBySource.get(src);
      const hires = hiresBySource.get(src) ?? 0;
      return {
        source: SOURCE_LABEL[src]?.id ?? src,
        spend: spend != null ? spend : (hires > 0 ? 0 : null),
        hires,
        costPerHire: spend != null && hires > 0 ? Math.round(spend / hires) : null,
      };
    });

  // ---- funnel ringkas (reuse F4 — tidak duplikasi logika) ----
  const funnel = await offerFunnel(db, null);

  return {
    prHealth: { open: open.length, avgAgeDays, oldest, atRisk, closedThisPeriod },
    recruiterLoad,
    slaCompliance: {
      onTime,
      late,
      rate: pct(onTime, doneSteps.length),
      latestStage: latestEntry ? { name: latestEntry[0], late: latestEntry[1] } : null,
    },
    sourceRoi,
    funnel,
  };
}

// ============ 2. katalog metrik ============

export async function getMetricsCatalog(db: TenantDb): Promise<MetricItem[]> {
  const now = new Date();

  // --- time to fill: PR Fulfilled (decidedAt → updatedAt=Fulfilled) ---
  const fulfilled = await db.personnelRequisition.findMany({
    where: { status: "Fulfilled", decidedAt: { not: null } },
    select: { decidedAt: true, updatedAt: true, position: { select: { title: true } } },
    take: 500,
  });
  const fillDays = fulfilled
    .filter((p) => p.decidedAt && p.updatedAt > p.decidedAt)
    .map((p) => daysBetween(p.decidedAt as Date, p.updatedAt));
  const timeToFill = fillDays.length > 0 ? round1(fillDays.reduce((a, b) => a + b, 0) / fillDays.length) : null;

  // --- time to hire: Applicant.dateApplied → offer.appointedAt ---
  const hiredOffers = await db.candidateOffer.findMany({
    where: { appointedAt: { not: null } },
    select: {
      appointedAt: true,
      candidate: {
        select: { applicant: { select: { dateApplied: true } } },
      },
    },
    take: 500,
  });
  const hireDays = hiredOffers
    .filter((o) => o.candidate.applicant?.dateApplied && (o.appointedAt as Date) > o.candidate.applicant.dateApplied)
    .map((o) => daysBetween(o.candidate.applicant!.dateApplied, o.appointedAt as Date));
  const timeToHire = hireDays.length > 0 ? round1(hireDays.reduce((a, b) => a + b, 0) / hireDays.length) : null;

  // --- offer acceptance + interview pass ---
  const offers = await db.candidateOffer.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const oc = (s: string) => offers.find((o) => o.status === s)?._count._all ?? 0;
  const accepted = oc("Accepted");
  const declined = oc("Declined");
  const acceptance = accepted + declined > 0 ? Math.round((accepted / (accepted + declined)) * 100) : null;

  const interviewSteps = await db.candidateSelectionStep.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: { selectionProcess: { name: { contains: "Interview" } } },
  });
  const passed = interviewSteps.find((s) => s.status === "Passed")?._count._all ?? 0;
  const failed = interviewSteps.find((s) => s.status === "Failed")?._count._all ?? 0;
  const passRate = passed + failed > 0 ? Math.round((passed / (passed + failed)) * 100) : null;

  // --- source effectiveness: hires vs applicants per sumber ---
  const applicants = await db.applicant.findMany({
    select: { source: true, status: true },
    take: 3000,
  });
  const appsBySource = new Map<string, number>();
  for (const a of applicants) appsBySource.set(a.source ?? "Other", (appsBySource.get(a.source ?? "Other") ?? 0) + 1);
  const hiredByApplicant = await db.jobCandidate.findMany({
    where: { appointments: { some: {} }, applicantId: { not: null } },
    select: { applicant: { select: { source: true } } },
    take: 1000,
  });
  const hiresPerSource = new Map<string, number>();
  for (const c of hiredByApplicant) {
    const src = c.applicant?.source ?? "Other";
    hiresPerSource.set(src, (hiresPerSource.get(src) ?? 0) + 1);
  }
  const sources = [...new Set([...appsBySource.keys(), ...hiresPerSource.keys()])];
  const breakdown = sources
    .sort((a, b) => (hiresPerSource.get(b) ?? 0) - (hiresPerSource.get(a) ?? 0))
    .map((src) => ({
      source: SOURCE_LABEL[src]?.id ?? src,
      applicants: appsBySource.get(src) ?? 0,
      hires: hiresPerSource.get(src) ?? 0,
      rate: pct(hiresPerSource.get(src) ?? 0, appsBySource.get(src) ?? 0),
    }));

  // --- requisition aging: umur rata-rata PR terbuka ---
  const openPrs = await db.personnelRequisition.findMany({
    where: { status: { in: [...OPEN_PR] } },
    select: { requestDate: true },
    take: 500,
  });
  const aging = openPrs.length > 0
    ? round1(openPrs.reduce((s, p) => s + daysBetween(p.requestDate, now), 0) / openPrs.length)
    : null;

  return [
    {
      key: "time_to_fill", labelId: "Time to Fill", labelEn: "Time to Fill", value: timeToFill, unit: "hari", unitEn: "days",
      hint: "Rata-rata hari dari PR disetujui (decidedAt) sampai Fulfilled (lowongan terpenuhi)",
      hintEn: "Average days from requisition approval (decidedAt) to Fulfilled (opening filled)",
    },
    {
      key: "time_to_hire", labelId: "Time to Hire", labelEn: "Time to Hire", value: timeToHire, unit: "hari", unitEn: "days",
      hint: "Rata-rata hari pelamar masuk talent pool (dateApplied) sampai diangkat (appointedAt)",
      hintEn: "Average days from applicant entering the talent pool (dateApplied) to appointment (appointedAt)",
    },
    {
      key: "offer_acceptance_rate", labelId: "Tingkat Penerimaan Offer", labelEn: "Offer Acceptance Rate", value: acceptance, unit: "%", unitEn: "%",
      hint: `Offer diterima / (diterima + ditolak) — ${accepted} diterima, ${declined} ditolak`,
      hintEn: `Offers accepted / (accepted + declined) — ${accepted} accepted, ${declined} declined`,
    },
    {
      key: "interview_pass_rate", labelId: "Tingkat Lulus Interview", labelEn: "Interview Pass Rate", value: passRate, unit: "%", unitEn: "%",
      hint: `Tahap bertipe interview lulus / (lulus + gagal) — ${passed} lulus, ${failed} gagal`,
      hintEn: `Interview-type stages passed / (passed + failed) — ${passed} passed, ${failed} failed`,
    },
    {
      key: "source_effectiveness", labelId: "Efektivitas Sumber", labelEn: "Source Effectiveness", value: null, unit: "%", unitEn: "%",
      hint: "Rasio karyawan ter-hire per sumber pelamar (lihat breakdown)",
      hintEn: "Hired employees per applicant source ratio (see breakdown)",
      breakdown,
    },
    {
      key: "requisition_aging", labelId: "Umur PR Terbuka", labelEn: "Requisition Aging", value: aging, unit: "hari", unitEn: "days",
      hint: "Rata-rata umur PR berstatus Submitted/Approved/OnHold sampai hari ini",
      hintEn: "Average age of requisitions in Submitted/Approved/OnHold status up to today",
    },
  ];
}

// ============ 3. adverse impact (P4 — 4/5ths rule) ============

/** Kelompok umur utk adverse-impact (spec F8): <30 / 30–40 / >40. */
function ageBand(birthDate: Date | null): { key: string; label: string } | null {
  const age = ageOf(birthDate);
  if (age == null) return null;
  if (age < 30) return { key: "lt30", label: "< 30" };
  if (age <= 40) return { key: "30-40", label: "30–40" };
  return { key: "gt40", label: "> 40" };
}

export async function getAdverseImpact(db: TenantDb): Promise<AdverseImpactData> {
  // muat kandidat + hasil per tahap + profil (gender/umur dari kolom polos —
  // Applicant.gender & Employee.gender memang non-enkrip; education hanya
  // dimiliki Applicant [kolom turunan]).
  const candidates = await db.jobCandidate.findMany({
    select: {
      selectionSteps: {
        select: { selectionProcessId: true, status: true },
      },
      applicant: { select: { gender: true, birthDate: true, highestEduLevel: true } },
      employee: { select: { gender: true, birthDate: true } },
    },
    take: 2000,
  });
  const stages = await db.selectionProcess.findMany({
    where: { active: true },
    select: { id: true, name: true, processOrder: true },
    orderBy: { processOrder: "asc" },
  });

  // normalisasi gender: Applicant pakai L|P, Employee pakai M|F → satukan L|P
  const genderOf = (c: (typeof candidates)[number]): string | null => {
    const g = c.applicant?.gender ?? c.employee?.gender ?? null;
    if (g === "M") return "L";
    if (g === "F") return "P";
    return g;
  };
  const birthOf = (c: (typeof candidates)[number]): Date | null =>
    c.applicant?.birthDate ?? c.employee?.birthDate ?? null;
  const eduOf = (c: (typeof candidates)[number]): string | null =>
    c.applicant?.highestEduLevel ?? null;

  const GENDER_LABEL: Record<string, string> = { L: "Laki-laki", P: "Perempuan" };

  const out: AdverseImpactData = {
    rule: {
      threshold: FOUR_FIFTHS,
      noteId: "Rasio seleksi kelompok terendah vs tertinggi < 80% ditandai berpotensi adverse impact (4/5ths rule EEOC).",
      noteEn: "Lowest vs highest group selection rate below 80% is flagged as potential adverse impact (EEOC 4/5ths rule).",
    },
    stages: [],
  };

  for (const st of stages) {
    // kandidat yang PERNAH masuk tahap ini (≥1 step non-Cancelled)
    const inStage = candidates.filter(
      (c) => c.selectionSteps.some((s) => s.selectionProcessId === st.id && s.status !== "Cancelled"),
    );
    if (inStage.length === 0) continue;

    const dims: AdverseDim[] = [];

    // -- dimensi: gender / umur / pendidikan --
    const dimDefs: { dim: string; keyOf: (c: (typeof candidates)[number]) => string | null; labelOf: (k: string) => string }[] = [
      {
        dim: "gender",
        keyOf: (c) => genderOf(c),
        labelOf: (k) => GENDER_LABEL[k] ?? "Tak diisi",
      },
      {
        dim: "age",
        keyOf: (c) => ageBand(birthOf(c))?.key ?? null,
        labelOf: (k) => (k === "lt30" ? "< 30" : k === "30-40" ? "30–40" : k === "gt40" ? "> 40" : "Tak diisi"),
      },
      {
        dim: "education",
        keyOf: (c) => eduOf(c),
        labelOf: (k) => (k && k !== "unknown" ? k : "Tak diisi"),
      },
    ];

    for (const def of dimDefs) {
      const buckets = new Map<string, { entered: number; passed: number }>();
      for (const c of inStage) {
        const k = def.keyOf(c) ?? "unknown";
        const b = buckets.get(k) ?? { entered: 0, passed: 0 };
        b.entered++;
        if (c.selectionSteps.some((s) => s.selectionProcessId === st.id && s.status === "Passed")) b.passed++;
        buckets.set(k, b);
      }
      // urutan stabil: ukuran turun, label naik
      const entries = [...buckets.entries()].sort((a, b) => b[1].entered - a[1].entered || a[0].localeCompare(b[0]));
      const eligible = entries.filter(([, v]) => v.entered >= MIN_GROUP_SIZE && v.entered > 0);
      const rates = eligible.map(([, v]) => v.passed / v.entered);
      const highest = rates.length > 0 ? Math.max(...rates) : null;
      const lowest = rates.length > 0 ? Math.min(...rates) : null;
      const impactRatio = highest != null && lowest != null && highest > 0 ? round1((lowest / highest) * 100) / 100 : null;

      const groups: AdverseGroup[] = entries.map(([k, v]) => {
        const rate = v.entered > 0 ? v.passed / v.entered : null;
        return {
          label: def.labelOf(k),
          entered: v.entered,
          passed: v.passed,
          rate: rate != null ? Math.round(rate * 100) : null,
          flag: rate != null && highest != null && highest > 0 && rate < FOUR_FIFTHS * highest,
          small: v.entered < MIN_GROUP_SIZE,
        };
      });

      dims.push({
        dim: def.dim,
        groups,
        impactRatio,
        flagged: impactRatio != null && impactRatio < FOUR_FIFTHS,
      });
    }

    out.stages.push({ stage: st.name, processOrder: st.processOrder, dims });
  }

  return out;
}

// ============ 4. snapshot metrik (MetricSnapshot) ============

/** Upsert satu baris snapshot (find-first → update/create; NULL dimsJson aman
 *  lintas dialek — unique index Postgres memperlakukan NULL sebagai berbeda). */
async function upsertSnapshot(
  db: TenantDb,
  metric: string,
  period: string,
  value: number,
  dimsJson: string | null,
): Promise<boolean> {
  const existing = await db.metricSnapshot.findFirst({ where: { metric, period, dimsJson } });
  if (existing) {
    await db.metricSnapshot.update({ where: { id: existing.id }, data: { value, computedAt: new Date() } });
  } else {
    await db.metricSnapshot.create({ data: { metric, period, dimsJson, value } });
  }
  return true;
}

/**
 * Hitung katalog metrik + beberapa dims (time_to_fill per posisi) → upsert
 * MetricSnapshot periode YYYY-MM berjalan. Idempoten (re-run = overwrite
 * periode sama). Return jumlah baris tertulis.
 */
export async function snapshotMetrics(db: TenantDb): Promise<number> {
  const period = currentPeriod();
  let written = 0;

  // metrik global dari katalog
  const catalog = await getMetricsCatalog(db);
  for (const m of catalog) {
    if (m.value == null) continue; // tanpa data → jangan tulis angka palsu
    if (m.key === "source_effectiveness") continue; // metrik breakdown — snapshot per sumber di bawah
    written += (await upsertSnapshot(db, m.key, period, m.value, null)) ? 1 : 0;
  }

  // source_effectiveness per sumber (dims {"source": label})
  const se = catalog.find((m) => m.key === "source_effectiveness");
  if (se?.breakdown) {
    for (const b of se.breakdown) {
      if (b.rate == null) continue;
      written += (await upsertSnapshot(db, "source_effectiveness", period, b.rate, JSON.stringify({ source: b.source }))) ? 1 : 0;
    }
  }

  // time_to_fill per posisi (dims {"position": title})
  const fulfilled = await db.personnelRequisition.findMany({
    where: { status: "Fulfilled", decidedAt: { not: null } },
    select: { decidedAt: true, updatedAt: true, position: { select: { title: true } } },
    take: 500,
  });
  const byPosition = new Map<string, number[]>();
  for (const p of fulfilled) {
    const title = p.position?.title;
    if (!title || !p.decidedAt || p.updatedAt <= p.decidedAt) continue;
    const arr = byPosition.get(title) ?? [];
    arr.push(daysBetween(p.decidedAt, p.updatedAt));
    byPosition.set(title, arr);
  }
  for (const [title, days] of byPosition) {
    if (days.length === 0) continue;
    const avg = round1(days.reduce((a, b) => a + b, 0) / days.length);
    written += (await upsertSnapshot(db, "time_to_fill", period, avg, JSON.stringify({ position: title }))) ? 1 : 0;
  }

  // cost per hire global (dari dashboard ROI) — selaras enum skema F8
  const dash = await getRecruitmentDashboard(db);
  const spend = dash.sourceRoi.reduce((s, r) => s + (r.spend ?? 0), 0);
  const hires = dash.sourceRoi.reduce((s, r) => s + r.hires, 0);
  if (hires > 0 && spend > 0) {
    written += (await upsertSnapshot(db, "cost_per_hire", period, Math.round(spend / hires), null)) ? 1 : 0;
  }

  return written;
}

// ============ 5. prediktif heuristik (G4 — BUKAN ML) ============

export async function getProjections(db: TenantDb): Promise<ProjectionsData> {
  const now = new Date();

  // histori: hari penyelesaian per posisi (PR Fulfilled)
  const fulfilled = await db.personnelRequisition.findMany({
    where: { status: "Fulfilled", decidedAt: { not: null } },
    select: { decidedAt: true, updatedAt: true, position: { select: { title: true } } },
    take: 500,
  });
  const byPosition = new Map<string, number[]>();
  const allDays: number[] = [];
  for (const p of fulfilled) {
    if (!p.decidedAt || p.updatedAt <= p.decidedAt) continue;
    const d = daysBetween(p.decidedAt, p.updatedAt);
    allDays.push(d);
    if (p.position?.title) {
      const arr = byPosition.get(p.position.title) ?? [];
      arr.push(d);
      byPosition.set(p.position.title, arr);
    }
  }
  const globalAvgDays = allDays.length > 0 ? round1(allDays.reduce((a, b) => a + b, 0) / allDays.length) : null;

  // posisi aktif (PR terbuka) → proyeksi per posisi, fallback global
  const openPrs = await db.personnelRequisition.findMany({
    where: { status: { in: [...OPEN_PR] } },
    select: { prNo: true, requestDate: true, position: { select: { title: true } } },
    take: 500,
  });
  const positions: ProjectionsData["positions"] = [];
  const atRisk: AtRiskPr[] = [];
  for (const p of openPrs) {
    const title = p.position?.title ?? "(tanpa posisi)";
    const hist = byPosition.get(title);
    const projection = hist && hist.length > 0
      ? round1(hist.reduce((a, b) => a + b, 0) / hist.length)
      : (globalAvgDays ?? 0);
    if (!positions.some((x) => x.position === title)) {
      positions.push({
        position: title,
        avgFillDays: hist && hist.length > 0 ? round1(hist.reduce((a, b) => a + b, 0) / hist.length) : null,
        sampleSize: hist?.length ?? 0,
      });
    }
    const ageDays = daysBetween(p.requestDate, now);
    const overdueFactor = projection > 0 ? round1(ageDays / projection) : 0;
    if (projection > 0 && ageDays > projection * 1.5) {
      atRisk.push({ prNo: p.prNo, positionTitle: p.position?.title ?? null, ageDays, projection, overdueFactor });
    }
  }
  positions.sort((a, b) => b.sampleSize - a.sampleSize || a.position.localeCompare(b.position));
  atRisk.sort((a, b) => b.overdueFactor - a.overdueFactor);

  return { positions, atRisk, globalAvgDays, method: "heuristic-avg" };
}

// ============ 6. histori snapshot (chart garis) ============

export async function getSnapshotHistory(
  db: TenantDb,
  metric: string,
  limit = 24,
): Promise<{ metric: string; points: SnapshotHistoryPoint[] }> {
  const take = Math.min(Math.max(Math.trunc(limit) || 24, 1), 24);
  const rows = await db.metricSnapshot.findMany({
    where: { metric, dimsJson: null },
    orderBy: { period: "desc" },
    take,
  });
  return {
    metric,
    points: rows
      .reverse() // chart garis: periode naik (lama → baru)
      .map((r) => ({ period: r.period, value: r.value, computedAt: r.computedAt.toISOString() })),
  };
}
