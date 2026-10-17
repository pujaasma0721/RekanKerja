// ============================================================================
// RECRUITMENT F4 — Offer management (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F4 +
// §3.5 HRX E1/E3): offer dari kandidat Passed/tahap Offering → nomor OFF-YYYY-
// NNNN, gaji final TERENKRIPSI vault + guidance vs rentang gaji slot JO,
// tanggal mulai, expiry timer + reminder scheduler (jobOfferExpiry), status
// Draft→[PendingApproval]→Sent→Viewed→Accepted|Declined|Expired, counter
// dicatat sebagai note (HRX E3 versi awal — tanpa entitas counter terpisah).
//
// Approval offer (scope "recruitment/offer" — HRX E1 "approval by value"):
// OPSIONAL via config-over-code — hanya berlaku bila Admin membuat
// ApprovalStructure docType RecruitmentOffer aktif (Pengaturan → Approval
// Berjenjang); tanpa struktur → offer langsung terkirim (jalur cepat).
// Saat berlaku: send → PendingApproval → surat+kirim terjadi OTOMATIS saat
// jenjang terakhir approve; reject → kembali Draft + catatan.
//
// Surat penawaran via mesin surat (kategori Recruitment, key REC_OFFER) —
// snapshot RecruitmentLetter kind "Offer" + PDF (letterPdfBuffer reuse
// selection-service.letterPdf). Funnel report dasar (Applied → Candidate →
// per tahap → Offer → Hired) untuk overview + view Offer.
// ============================================================================
// P2.4-BM (D-BM19) — Offer versioning + self-service kandidat: setiap
// perubahan material offer bersnapshot ke CandidateOfferVersion (payload
// lengkap, gaji TETAP string terenkripsi vault — tanpa decrypt); diff nominal
// antar versi vault-gated di batas serializer. Kandidat dapat memutuskan
// accept/decline SENDIRI via portal /offer/<token> (token acak 32-byte,
// disimpan sebagai SHA-256 hash — pola EsignRequest DB-token) dengan
// race-guard: respondOffer memakai updateMany kondisional (status Sent|
// Viewed) → double-click paralel hanya SATU sukses, lainnya 409.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb, tenantSchemaOfDb } from "@/rekankerja/shared/lib/field-crypto";
import { db as platformDb } from "@/lib/db";
import { createHash, randomBytes } from "node:crypto";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent } from "@/rekankerja/shared/services/email-service";
import { sendWa, employeePhoneOf } from "@/rekankerja/shared/services/wa-service";
import { retryOnUnique } from "@/rekankerja/shared/lib/doc-no-retry";
import {
  getEmployeeApprovalParams, resolveApprovalStructure, startApprovalChain,
  decideApprovalChain, getApprovalChain, type ChainView, type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";
import { getRecruitmentSetting } from "@/rekankerja/recruitment/services/recruitment-setting-service";
import { emitWebhookEvent } from "@/rekankerja/recruitment/services/webhook-service";

// ============ konstanta domain ============

export const OFFER_STATUSES = ["Draft", "PendingApproval", "Sent", "Viewed", "Accepted", "Declined", "Expired"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Status offer yang masih "hidup" — kandidat dengan offer aktif tak boleh dibuat offer baru. */
const ACTIVE_OFFER: OfferStatus[] = ["Draft", "PendingApproval", "Sent", "Viewed", "Accepted"];

/** docType engine approval untuk offer rekrutmen (ApprovalStructure opsional). */
export const OFFER_DOC_TYPE = "RecruitmentOffer" as const;

export const OFFER_TEMPLATE_KEY = "REC_OFFER";

/** Masa berlaku default token self-service bila offer tanpa expiryDate. */
const SELF_SERVICE_TTL_MS = 7 * 24 * 60 * 60_000;

/** Basis URL portal kandidat (halaman /offer/<token> — pola esign/status-link). */
function portalBase(): string {
  return process.env.CANDIDATE_PORTAL_URL ?? "http://127.0.0.1:3010";
}

/** Slug registry Tenant milik client Prisma tenant (utk ?t= link portal). */
async function tenantSlugOf(db: TenantDb): Promise<string | null> {
  try {
    const row = await platformDb.tenant.findUnique({
      where: { schemaName: tenantSchemaOfDb(db) }, select: { slug: true },
    });
    return row?.slug ?? null;
  } catch {
    return null;
  }
}

/** Status kandidat yang boleh dibuatkan offer (Passed semua tahap / masih hidup di tahap Offering). */
const OFFERABLE_CANDIDATE = ["Passed", "InProcess"] as const;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function fmtDateId(d: Date | null | undefined): string {
  if (!d) return "—";
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00.000Z`);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Format uang Rupiah utk konteks surat (Rp 8.500.000). */
export function fmtMoneyId(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

// ============ tipe serializer (batas API) ============

/** Error 409 — offer tidak lagi bisa diputuskan (race double-click / status). */
export class OfferConflictError extends Error {
  readonly status = 409;
  constructor(message: string) { super(message); this.name = "OfferConflictError"; }
}

/** Error token self-service publik — 404 (tak dikenal) / 410 (kedaluwarsa). */
export class OfferSelfServiceError extends Error {
  constructor(public status: 404 | 410, message: string) { super(message); this.name = "OfferSelfServiceError"; }
}

/** Versi ringkas utk list/detail (tanpa payload — diff hanya di GET detail). */
export interface OfferVersionLite {
  versionNo: number;
  label: string | null;
  createdAt: string;
  createdById: string | null;
}

/** Diff non-uang antar 2 versi berurutan — "a → b". */
export interface OfferVersionDiffField {
  field: string;
  from: string | null;
  to: string | null;
}

/** Diff nominal gaji — angka hanya bila vault terbuka, changed selalu tersedia. */
export interface OfferSalaryDiff {
  from: number | null;
  to: number | null;
  changed: boolean;
}

/** Versi + diff vs versi sebelumnya (versi 1 = baseline, diff null). */
export interface OfferVersionView extends OfferVersionLite {
  diff: {
    fields: OfferVersionDiffField[];
    salaryDiff: OfferSalaryDiff | null;
  } | null;
}

export interface OfferRow {
  id: string;
  offerNo: string;
  status: OfferStatus;
  prId: string;
  prNo: string;
  positionTitle: string | null;
  candidateId: string;
  candidateName: string;
  candidateSource: string;
  jobOpeningId: string | null;
  joRefNo: string | null;
  /** gaji final — null bila pemanggil tanpa hak lihat uang (masked di serializer). */
  salary: number | null;
  currency: string;
  salaryUnit: string;
  startDate: string | null;
  expiryDate: string | null;
  /** hari menuju expiry (negatif = lewat) — dihitung saat baca. */
  expiresInDays: number | null;
  letterNo: string | null;
  letterId: string | null;
  note: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  appointedAt: string | null;
  hasAppointment: boolean;
  createdAt: string;
  /** P2.4 — riwayat versi ringkas (tanpa payload). */
  versions: OfferVersionLite[];
}

export interface OfferDetail extends OfferRow {
  approval: ChainView | null;
  /** P2.4 — versi + diff vs versi sebelumnya (nominal vault-gated). */
  versionDiffs: OfferVersionView[];
  /** P2.4 — tautan putusan mandiri penuh (raw token) — hanya bila token aktif. */
  selfServiceLink: string | null;
  appointment: {
    id: string;
    appointmentDate: string;
    status: string;
    letterNo: string | null;
    positionTitle: string | null;
    officeName: string | null;
    supervisorName: string | null;
    employeeNo: string | null;
    employeeId: string | null;
    onboardingId: string | null;
  } | null;
}

// ============ nomor dokumen ============

/** Nomor offer berikutnya: OFF-YYYY-NNNN (max-suffix, delete-safe — pola nextPrNo). */
export async function nextOfferNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const start = `OFF-${year}-`;
  let max = 0;
  const rows = await db.candidateOffer.findMany({
    where: { offerNo: { startsWith: start } },
    select: { offerNo: true },
    take: 500,
  });
  for (const r of rows) {
    const n = parseInt(r.offerNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(4, "0")}`;
}

// ============ opsi (UI) ============

export interface OfferableCandidate {
  id: string;
  fullName: string;
  status: string;
  source: string;
  applicantNo: string | null;
  /** ekspektasi gaji pelamar (decrypt — hanya utk display guidance). */
  expectedSalary: number | null;
  currentStage: string | null;
  activeOfferNo: string | null;
}

export interface OfferablePr {
  id: string;
  prNo: string;
  positionTitle: string | null;
  requiredNo: number;
  employmentStatus: string;
  officerName: string | null;
  appointedCount: number;
  /** guidance rentang gaji IKLAN slot JO pertama PR (publik by design). */
  salaryGuide: { min: number | null; max: number | null } | null;
  /** budget gaji PR (decrypt — utk display guidance). */
  salaryBudget: number | null;
  candidates: OfferableCandidate[];
}

/** Opsi PR yang bisa dibuatkan offer + kandidat offerable + guidance gaji. */
export async function offerOptions(db: TenantDb): Promise<{ prs: OfferablePr[] }> {
  const tc = tenantCryptoForDb(db);
  const prs = await db.personnelRequisition.findMany({
    where: { status: { in: ["Approved", "OnHold"] } },
    include: {
      position: { select: { title: true } },
      recruitmentOfficer: { select: { fullName: true } },
      openings: { select: { salaryMin: true, salaryMax: true }, orderBy: { createdAt: "asc" }, take: 1 },
      candidates: {
        where: { status: { in: [...OFFERABLE_CANDIDATE, "Failed", "Withdrawn", "Hired"] } },
        include: {
          applicant: { select: { applicantNo: true, expectedSalary: true } },
          offers: { select: { offerNo: true, status: true }, orderBy: { createdAt: "desc" } },
          selectionSteps: {
            where: { status: { in: ["Planned", "Acknowledged", "Performed"] } },
            include: { selectionProcess: { select: { name: true } } },
            orderBy: { seqNo: "asc" },
            take: 1,
          },
        },
        orderBy: { nominatedAt: "asc" },
      },
      appointments: { select: { id: true } },
    },
    orderBy: { prNo: "desc" },
    take: 100,
  });

  const rows: OfferablePr[] = [];
  for (const p of prs) {
    const cands: OfferableCandidate[] = [];
    for (const c of p.candidates) {
      // hanya kandidat masih hidup (Passed/InProcess) yang TAMPIL offerable;
      // lainnya dilewati (Hired/Failed/Withdrawn tidak bisa ditawari lagi)
      if (!OFFERABLE_CANDIDATE.includes(c.status as (typeof OFFERABLE_CANDIDATE)[number])) continue;
      const activeOffer = c.offers.find((o) => ACTIVE_OFFER.includes(o.status as OfferStatus));
      cands.push({
        id: c.id,
        fullName: c.fullName,
        status: c.status,
        source: c.source,
        applicantNo: c.applicant?.applicantNo ?? null,
        expectedSalary: c.applicant ? tc.decryptMoney(c.applicant.expectedSalary) : null,
        currentStage: c.selectionSteps[0]?.selectionProcess.name ?? null,
        activeOfferNo: activeOffer?.offerNo ?? null,
      });
    }
    // PR ditampilkan bila punya kandidat offerable ATAU sudah punya offer flow
    if (cands.length === 0) continue;
    const guide = p.openings[0]
      ? { min: p.openings[0].salaryMin ?? null, max: p.openings[0].salaryMax ?? null }
      : null;
    rows.push({
      id: p.id,
      prNo: p.prNo,
      positionTitle: p.position?.title ?? null,
      requiredNo: p.requiredNo,
      employmentStatus: p.employmentStatus,
      officerName: p.recruitmentOfficer?.fullName ?? null,
      appointedCount: p.appointments.length,
      salaryGuide: guide,
      salaryBudget: tc.decryptMoney(p.salaryBudget),
      candidates: cands,
    });
  }
  return { prs: rows };
}

// ============ daftar & detail ============

function versionsOf(
  vs: { versionNo: number; label: string | null; createdAt: Date; createdById: string | null }[] | undefined,
): OfferVersionLite[] {
  return (vs ?? [])
    .slice()
    .sort((a, b) => a.versionNo - b.versionNo)
    .map((v) => ({ versionNo: v.versionNo, label: v.label, createdAt: v.createdAt.toISOString(), createdById: v.createdById }));
}

interface OfferVersionPayload {
  offerNo: string;
  prId: string;
  candidateId: string;
  jobOpeningId: string | null;
  /** string terenkripsi vault — APA ADANYA (tanpa decrypt saat snapshot). */
  salary: string | null;
  currency: string;
  salaryUnit: string;
  startDate: string | null;
  expiryDate: string | null;
  status: string;
  note: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  label: string | null;
  /** P2.4 — salinan token self-service TERENKRIPSI (hanya versi "Sent") — utk
   *  merender tautan putusan HR; hash one-way di CandidateOffer tidak
   *  direkonstruksi. */
  selfServiceTokenEnc?: string;
}

/** Field non-uang yang di-diff antar versi (label tampil di UI). */
const DIFF_FIELDS: (keyof OfferVersionPayload)[] = [
  "startDate", "expiryDate", "status", "currency", "salaryUnit", "jobOpeningId", "note",
];

/** Parse payloadJson versi — rusak → null (versi lama tetap tampil tanpa diff). */
function parsePayload(json: string): OfferVersionPayload | null {
  try {
    return JSON.parse(json) as OfferVersionPayload;
  } catch {
    return null;
  }
}

function rowOf(
  o: {
    id: string; offerNo: string; status: string; prId: string; candidateId: string;
    jobOpeningId: string | null; salary: string | null; currency: string; salaryUnit: string;
    startDate: Date | null; expiryDate: Date | null; letterNo: string | null; note: string | null;
    sentAt: Date | null; respondedAt: Date | null; appointedAt: Date | null; createdAt: Date;
    candidate: { fullName: string; source: string; appointment?: { id: string } | null };
    pr: { prNo: string; position: { title: string } | null };
    jobOpening?: { jobOpportunity: { refNo: string } } | null;
    appointment?: { id: string } | null;
    versions?: { versionNo: number; label: string | null; createdAt: Date; createdById: string | null }[];
  },
  salary: number | null,
): OfferRow {
  const now = Date.now();
  const expiresInDays = o.expiryDate
    ? Math.ceil((o.expiryDate.getTime() - now) / 86_400_000)
    : null;
  return {
    id: o.id,
    offerNo: o.offerNo,
    status: o.status as OfferStatus,
    prId: o.prId,
    prNo: o.pr.prNo,
    positionTitle: o.pr.position?.title ?? null,
    candidateId: o.candidateId,
    candidateName: o.candidate.fullName,
    candidateSource: o.candidate.source,
    jobOpeningId: o.jobOpeningId,
    joRefNo: o.jobOpening?.jobOpportunity.refNo ?? null,
    salary,
    currency: o.currency,
    salaryUnit: o.salaryUnit,
    startDate: iso(o.startDate),
    expiryDate: iso(o.expiryDate),
    expiresInDays,
    letterNo: o.letterNo,
    letterId: null,
    note: o.note,
    sentAt: iso(o.sentAt),
    respondedAt: iso(o.respondedAt),
    appointedAt: iso(o.appointedAt),
    hasAppointment: o.appointment != null,
    createdAt: o.createdAt.toISOString(),
    versions: versionsOf(o.versions),
  };
}

const OFFER_LIST_INCLUDE = {
  candidate: { select: { fullName: true, source: true } },
  pr: { select: { prNo: true, position: { select: { title: true } } } },
  jobOpening: { select: { jobOpportunity: { select: { refNo: true } } } },
  appointment: { select: { id: true } },
  versions: { select: { versionNo: true, label: true, createdAt: true, createdById: true }, orderBy: { versionNo: "asc" as const } },
} as const;

export async function listOffers(
  db: TenantDb,
  opts: { prId?: string | null; status?: string | null },
  moneyVisible: boolean,
): Promise<{ rows: OfferRow[]; stats: Record<string, number> }> {
  const tc = tenantCryptoForDb(db);
  const offers = await db.candidateOffer.findMany({
    where: {
      ...(opts.prId ? { prId: opts.prId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
    include: OFFER_LIST_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const rows = offers.map((o) => {
    const r = rowOf(o, moneyVisible ? tc.decryptMoney(o.salary) : null);
    r.letterId = null; // surat dicari terpisah (detail)
    return r;
  });
  const stats: Record<string, number> = { total: rows.length };
  for (const s of OFFER_STATUSES) stats[s] = 0;
  for (const r of rows) stats[r.status] = (stats[r.status] ?? 0) + 1;
  return { rows, stats };
}

export async function getOffer(db: TenantDb, id: string, moneyVisible: boolean): Promise<OfferDetail | null> {
  const tc = tenantCryptoForDb(db);
  const o = await db.candidateOffer.findUnique({
    where: { id },
    include: {
      ...OFFER_LIST_INCLUDE,
      versions: {
        select: { versionNo: true, label: true, createdAt: true, createdById: true, payloadJson: true },
        orderBy: { versionNo: "asc" as const },
      },
      appointment: {
        select: {
          id: true, appointmentDate: true, status: true, letterNo: true,
          position: { select: { title: true } },
          companyOffice: { select: { name: true } },
          supervisor: { select: { fullName: true } },
          employee: { select: { id: true, employeeNo: true } },
          onboardingId: true,
        },
      },
    },
  });
  if (!o) return null;

  // letter terbit utk offer ini (kind Offer — terbaru)
  const letter = await db.recruitmentLetter.findFirst({
    where: { candidateId: o.candidateId, kind: "Offer", metaJson: { contains: o.offerNo } },
    orderBy: { issuedAt: "desc" },
    select: { id: true },
  });

  const approval = await getApprovalChain(db, OFFER_DOC_TYPE, o.id);
  const row = rowOf(o, moneyVisible ? tc.decryptMoney(o.salary) : null);

  // P2.4 — diff antar versi berurutan (versi 1 = baseline tanpa diff).
  const versionViews: OfferVersionView[] = [];
  const ordered = o.versions.slice().sort((a, b) => a.versionNo - b.versionNo);
  for (let i = 0; i < ordered.length; i++) {
    const v = ordered[i]!;
    const cur = parsePayload(v.payloadJson);
    const prev = i > 0 ? parsePayload(ordered[i - 1]!.payloadJson) : null;
    let diff: OfferVersionView["diff"] = null;
    if (i > 0 && cur) {
      const fields: OfferVersionDiffField[] = [];
      for (const f of DIFF_FIELDS) {
        const a = prev ? (prev[f] ?? null) : null;
        const b = cur[f] ?? null;
        if (String(a ?? "") !== String(b ?? "")) fields.push({ field: f, from: a, to: b });
      }
      // nominal: dibandingkan sebagai nilai terdekripsi di sisi server (metadata
      // changed); angka from/to hanya ikut keluar bila vault terbuka (mv).
      const decPrev = prev ? tc.decryptMoney(prev.salary) : null;
      const decCur = tc.decryptMoney(cur.salary);
      diff = {
        fields,
        salaryDiff: {
          from: moneyVisible ? decPrev : null,
          to: moneyVisible ? decCur : null,
          changed: decPrev !== decCur,
        },
      };
    }
    versionViews.push({
      versionNo: v.versionNo, label: v.label, createdAt: v.createdAt.toISOString(),
      createdById: v.createdById, diff,
    });
  }

  // tautan putusan mandiri — hanya utk offer Sent/Viewed dgn token masih hidup.
  // Token mentah TIDAK disimpan di CandidateOffer (kolom = hash one-way) —
  // salinan TERENKRIPSI vault (enc:v1) tersimpan di payload versi "Sent";
  // versi Sent TERAKHIR = token yang berlaku (kirim ulang menimpa hash lama).
  const tokenAlive = (o.status === "Sent" || o.status === "Viewed")
    && !!o.selfServiceTokenHash
    && !!o.selfServiceTokenExpAt && o.selfServiceTokenExpAt.getTime() > Date.now();
  let selfServiceLink: string | null = null;
  if (tokenAlive) {
    for (let i = ordered.length - 1; i >= 0 && !selfServiceLink; i--) {
      const p = parsePayload(ordered[i]!.payloadJson);
      const enc = (p as { selfServiceTokenEnc?: unknown } | null)?.selfServiceTokenEnc;
      if (typeof enc === "string" && enc !== "") {
        const raw = tc.decryptText(enc);
        if (raw) {
          const slug = await tenantSlugOf(db);
          selfServiceLink = `${portalBase()}/offer/${raw}${slug ? `?t=${encodeURIComponent(slug)}` : ""}`;
        }
      }
    }
  }

  return {
    ...row,
    letterId: letter?.id ?? null,
    approval,
    versionDiffs: versionViews,
    selfServiceLink,
    appointment: o.appointment
      ? {
          id: o.appointment.id,
          appointmentDate: o.appointment.appointmentDate.toISOString(),
          status: o.appointment.status,
          letterNo: o.appointment.letterNo,
          positionTitle: o.appointment.position?.title ?? null,
          officeName: o.appointment.companyOffice?.name ?? null,
          supervisorName: o.appointment.supervisor?.fullName ?? null,
          employeeNo: o.appointment.employee?.employeeNo ?? null,
          employeeId: o.appointment.employee?.id ?? null,
          onboardingId: o.appointment.onboardingId,
        }
      : null,
  };
}

// ============ P2.4 — snapshot versi (D-BM19) ============

/**
 * Snapshot state offer saat ini ke CandidateOfferVersion (versionNo =
 * jumlah versi + 1 via retryOnUnique — race P2002 dihitung ulang tiap
 * percobaan). payloadJson: field lengkap; gaji TETAP string terenkripsi
 * vault apa adanya (JANGAN decrypt di sini — decrypt hanya di batas
 * serializer dgn gate money view). ActivityLog "Created" tiap versi.
 */
export async function snapshotOfferVersion(
  db: TenantDb,
  input: { offerId: string; label: string; actorId?: string | null; extras?: Record<string, unknown> },
): Promise<number> {
  return retryOnUnique(async () => {
    const o = await db.candidateOffer.findUnique({
      where: { id: input.offerId },
      select: {
        offerNo: true, prId: true, candidateId: true, jobOpeningId: true,
        salary: true, currency: true, salaryUnit: true, startDate: true,
        expiryDate: true, status: true, note: true, sentAt: true, respondedAt: true,
      },
    });
    if (!o) throw new Error("Offer tidak ditemukan");
    const versionNo = (await db.candidateOfferVersion.count({ where: { offerId: input.offerId } })) + 1;
    const payloadJson = JSON.stringify({
      offerNo: o.offerNo,
      prId: o.prId,
      candidateId: o.candidateId,
      jobOpeningId: o.jobOpeningId,
      salary: o.salary, // string terenkripsi vault — APA ADANYA
      currency: o.currency,
      salaryUnit: o.salaryUnit,
      startDate: iso(o.startDate),
      expiryDate: iso(o.expiryDate),
      status: o.status,
      note: o.note,
      sentAt: iso(o.sentAt),
      respondedAt: iso(o.respondedAt),
      label: input.label,
      ...(input.extras ?? {}),
    });
    await db.candidateOfferVersion.create({
      data: {
        offerId: input.offerId,
        versionNo,
        payloadJson,
        label: input.label,
        createdById: input.actorId ?? null,
      },
    });
    await db.activityLog.create({
      data: {
        action: "Created", entity: "CandidateOfferVersion", entityId: `${o.offerNo}#v${versionNo}`,
        detail: `versi ${versionNo} (${input.label}) offer ${o.offerNo}`,
      },
    });
    return versionNo;
  });
}

// ============ input & validasi ============

export interface OfferInput {
  prId: string;
  candidateId: string;
  jobOpeningId?: string | null;
  salary?: number | null;
  currency?: string | null;
  salaryUnit?: string | null;
  startDate?: string | null;
  expiryDate?: string | null;
  note?: string | null;
}

export interface CreateOfferResult {
  id: string;
  offerNo: string;
  /** peringatan guidance gaji (bukan blocking — HRX A5 backlog). */
  warning: string | null;
}

async function offerCtx(db: TenantDb, id: string) {
  const o = await db.candidateOffer.findUnique({
    where: { id },
    include: {
      candidate: { select: { id: true, fullName: true, source: true, status: true, applicantId: true, employeeId: true } },
      pr: { select: { id: true, prNo: true, status: true, requiredNo: true } },
    },
  });
  if (!o) throw new Error("Offer tidak ditemukan");
  return o;
}

/** Buat offer (Draft) utk kandidat. Guard: PR terbuka, kandidat hidup,
 *  tanpa offer aktif lain, gaji positif. Guidance gaji = peringatan saja. */
export async function createOffer(
  db: TenantDb,
  input: OfferInput,
  actor?: { id?: string | null; name?: string | null },
): Promise<CreateOfferResult> {
  const pr = await db.personnelRequisition.findUnique({
    where: { id: input.prId },
    select: { id: true, prNo: true, status: true, requiredNo: true, position: { select: { title: true } } },
  });
  if (!pr) throw new Error("PR tidak ditemukan");
  if (pr.status !== "Approved" && pr.status !== "OnHold") {
    throw new Error(`PR ${pr.prNo} berstatus ${pr.status} — hanya PR Approved/OnHold yang bisa dibuatkan offer`);
  }

  const candidate = await db.jobCandidate.findUnique({
    where: { id: input.candidateId },
    select: { id: true, prId: true, fullName: true, status: true, source: true },
  });
  if (!candidate) throw new Error("Kandidat tidak ditemukan");
  if (candidate.prId !== pr.id) throw new Error("Kandidat bukan bagian dari PR ini");
  if (!OFFERABLE_CANDIDATE.includes(candidate.status as (typeof OFFERABLE_CANDIDATE)[number])) {
    throw new Error(`Kandidat ${candidate.fullName} berstatus ${candidate.status} — hanya kandidat Passed/InProcess yang bisa ditawari`);
  }

  const dupe = await db.candidateOffer.findFirst({
    where: { candidateId: candidate.id, status: { in: ACTIVE_OFFER } },
    select: { offerNo: true },
  });
  if (dupe) throw new Error(`Kandidat ${candidate.fullName} masih punya offer aktif ${dupe.offerNo} — batalkan/tolak offer lama dulu`);

  const salary = input.salary != null && String(input.salary) !== "" ? Number(input.salary) : null;
  if (salary != null && (!Number.isFinite(salary) || salary < 0)) {
    throw new Error("Gaji offer harus berupa angka tidak negatif");
  }

  let jobOpeningId: string | null = null;
  let warning: string | null = null;
  if (input.jobOpeningId) {
    const jo = await db.jobOpening.findUnique({
      where: { id: input.jobOpeningId },
      select: { id: true, prId: true, salaryMin: true, salaryMax: true, jobOpportunity: { select: { refNo: true } } },
    });
    if (!jo) throw new Error("Slot lowongan tidak ditemukan");
    if (jo.prId !== pr.id) throw new Error("Slot lowongan bukan milik PR ini");
    jobOpeningId = jo.id;
    if (salary != null && jo.salaryMax != null && salary > jo.salaryMax) {
      warning = `Gaji ${fmtMoneyId(salary)} melebihi rentang iklan ${fmtMoneyId(jo.salaryMin)}–${fmtMoneyId(jo.salaryMax)} (${jo.jobOpportunity.refNo})`;
    } else if (salary != null && jo.salaryMin != null && salary < jo.salaryMin) {
      warning = `Gaji ${fmtMoneyId(salary)} di bawah rentang iklan ${fmtMoneyId(jo.salaryMin)}–${fmtMoneyId(jo.salaryMax)} (${jo.jobOpportunity.refNo})`;
    }
  }

  const tc = tenantCryptoForDb(db);
  // REC-AUDIT-FIX L2 — offerNo max-suffix+1 tanpa lock: create bersamaan bisa
  // P2002 → gugur utuh & dicoba lagi dengan nomor baru (dihitung per percobaan).
  const offer = await retryOnUnique(async () => db.candidateOffer.create({
    data: {
      offerNo: await nextOfferNo(db),
      prId: pr.id,
      candidateId: candidate.id,
      jobOpeningId,
      salary: salary != null ? tc.encryptMoney(salary) : null,
      currency: input.currency?.trim() || "IDR",
      salaryUnit: input.salaryUnit?.trim() || "Monthly",
      startDate: parseDate(input.startDate),
      expiryDate: parseDate(input.expiryDate),
      status: "Draft",
      note: input.note?.trim() || null,
      createdById: actor?.id ?? null,
    },
  }));

  await db.activityLog.create({
    data: {
      action: "Created", entity: "CandidateOffer", entityId: offer.offerNo,
      detail: `Offer ${offer.offerNo} dibuat utk kandidat ${candidate.fullName} (PR ${pr.prNo}${pr.position?.title ? ` — ${pr.position.title}` : ""})${salary != null ? ` — gaji ${fmtMoneyId(salary)}` : ""}${actor?.name ? ` oleh ${actor.name}` : ""}`,
    },
  });
  // P2.4 — versi 1 "Created"
  await snapshotOfferVersion(db, { offerId: offer.id, label: "Created", actorId: actor?.id ?? null });
  return { id: offer.id, offerNo: offer.offerNo, warning };
}

/** Ubah offer Draft (sebelum dikirim).
 *  REC-AUDIT-FIX M7 — kini (1) MENULIS ActivityLog (dulu update Draft tak
 *  ter-audit sama sekali) dan (2) me-REVALIDASI jobOpeningId: slot harus ada
 *  DAN milik PR offer yang sama (dulu bisa dipoint ke slot PR lain / id asal
 *  → guidance gaji + relasi data salah).
 *  P2.4 — perubahan field MATERIAL (gaji/mata uang/satuan/tanggal/slot)
 *  di-snapshot sebagai versi "Updated"; perubahan note saja tidak (versi
 *  hanya utk checkpoint material — mencegah spam versi utk edit kosmetik). */
export async function updateOffer(db: TenantDb, id: string, input: Partial<OfferInput>, actorName?: string | null): Promise<{ offerNo: string }> {
  const o = await offerCtx(db, id);
  if (o.status !== "Draft") throw new Error(`Offer ${o.offerNo} berstatus ${o.status} — hanya Draft yang bisa diubah`);
  const tc = tenantCryptoForDb(db);
  const salary = input.salary != null && String(input.salary) !== "" ? Number(input.salary) : null;
  if (salary != null && (!Number.isFinite(salary) || salary < 0)) {
    throw new Error("Gaji offer harus berupa angka tidak negatif");
  }
  // M7 — revalidasi slot bila input mengubah jobOpeningId
  if (input.jobOpeningId !== undefined) {
    if (input.jobOpeningId) {
      const jo = await db.jobOpening.findUnique({
        where: { id: input.jobOpeningId },
        select: { id: true, prId: true, jobOpportunity: { select: { refNo: true } } },
      });
      if (!jo) throw new Error("Slot lowongan tidak ditemukan");
      if (jo.prId !== o.pr.id) throw new Error("Slot lowongan bukan milik PR offer ini");
    }
  }
  // P2.4 — deteksi perubahan MATERIAL sebelum menulis (utk snapshot versi)
  const cur = await db.candidateOffer.findUnique({
    where: { id },
    select: {
      salary: true, currency: true, salaryUnit: true, startDate: true,
      expiryDate: true, jobOpeningId: true,
    },
  });
  const dateEq = (a: Date | null, b: Date | null): boolean =>
    (a?.getTime() ?? null) === (b?.getTime() ?? null);
  let material = false;
  if (cur) {
    if (input.salary !== undefined && (tc.decryptMoney(cur.salary) ?? null) !== salary) material = true;
    if (input.currency !== undefined && cur.currency !== (input.currency?.trim() || "IDR")) material = true;
    if (input.salaryUnit !== undefined && cur.salaryUnit !== (input.salaryUnit?.trim() || "Monthly")) material = true;
    if (input.startDate !== undefined && !dateEq(cur.startDate, parseDate(input.startDate))) material = true;
    if (input.expiryDate !== undefined && !dateEq(cur.expiryDate, parseDate(input.expiryDate))) material = true;
    if (input.jobOpeningId !== undefined && cur.jobOpeningId !== (input.jobOpeningId || null)) material = true;
  }
  await db.candidateOffer.update({
    where: { id },
    data: {
      ...(input.salary !== undefined ? { salary: salary != null ? tc.encryptMoney(salary) : null } : {}),
      ...(input.currency !== undefined ? { currency: input.currency?.trim() || "IDR" } : {}),
      ...(input.salaryUnit !== undefined ? { salaryUnit: input.salaryUnit?.trim() || "Monthly" } : {}),
      ...(input.startDate !== undefined ? { startDate: parseDate(input.startDate) } : {}),
      ...(input.expiryDate !== undefined ? { expiryDate: parseDate(input.expiryDate) } : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      ...(input.jobOpeningId !== undefined ? { jobOpeningId: input.jobOpeningId || null } : {}),
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "CandidateOffer", entityId: o.offerNo,
      detail: `Offer ${o.offerNo} (Draft) diperbarui${actorName ? ` oleh ${actorName}` : ""}${input.salary !== undefined ? ` — gaji ${salary != null ? fmtMoneyId(salary) : "(dikosongkan)"}` : ""}${input.jobOpeningId !== undefined ? ` — slot ${input.jobOpeningId || "(dikosongkan)"}` : ""}`,
    },
  });
  if (material) {
    await snapshotOfferVersion(db, { offerId: id, label: "Updated" });
  }
  return { offerNo: o.offerNo };
}

/** Hapus offer Draft (salah buat). */
export async function deleteOffer(db: TenantDb, id: string): Promise<{ offerNo: string }> {
  const o = await offerCtx(db, id);
  if (o.status !== "Draft") throw new Error(`Offer ${o.offerNo} berstatus ${o.status} — hanya Draft yang bisa dihapus`);
  await db.candidateOffer.delete({ where: { id } });
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "CandidateOffer", entityId: o.offerNo,
      detail: `Offer ${o.offerNo} (kandidat ${o.candidate.fullName}, PR ${o.pr.prNo}) dihapus — belum pernah dikirim`,
    },
  });
  return { offerNo: o.offerNo };
}

// ============ kirim offer (+ approval opsional) ============

export interface SendOfferResult {
  offerNo: string;
  status: OfferStatus;
  /** true bila offer langsung terkirim (tanpa approval / final approve). */
  sent: boolean;
  letterNo?: string | null;
  approvalLevels?: number;
  firstApprover?: string | null;
  /** P2.4 — tautan putusan mandiri (raw token) utk kandidat, hanya saat sent. */
  selfServiceLink?: string | null;
}

/** employeeId konteks approval: officer PR → fallback pembuat offer. */
async function approvalEmployeeId(db: TenantDb, offerId: string, actorId?: string | null): Promise<string | null> {
  const o = await db.candidateOffer.findUnique({
    where: { id: offerId },
    select: { pr: { select: { recruitmentOfficerId: true } } },
  });
  return o?.pr.recruitmentOfficerId ?? actorId ?? null;
}

/** Terbitkan surat penawaran REC_OFFER + kirim email kandidat + notif officer
 *  + P2.4: terbitkan token self-service putusan mandiri (hash SHA-256 di
 *  CandidateOffer; salinan terenkripsi di payload versi "Sent") + email event
 *  recruitment.offer.selfservice berisi portalLink. */
async function performSend(db: TenantDb, offerId: string, actorName?: string | null): Promise<{ offerNo: string; letterNo: string; selfServiceLink: string | null }> {
  const o = await db.candidateOffer.findUnique({
    where: { id: offerId },
    include: {
      candidate: {
        select: {
          id: true, fullName: true, source: true, applicantId: true,
          pr: { select: { prNo: true, employmentStatus: true, position: { select: { title: true } }, orgUnit: { select: { name: true } }, recruitmentOfficer: { select: { id: true, fullName: true, email: true } } } },
        },
      },
      jobOpening: { select: { jobOpportunity: { select: { refNo: true } } } },
    },
  });
  if (!o) throw new Error("Offer tidak ditemukan");

  const template = await db.letterTemplate.findFirst({ where: { key: OFFER_TEMPLATE_KEY, active: true } });
  if (!template) {
    const any = await db.letterTemplate.findUnique({ where: { key: OFFER_TEMPLATE_KEY } });
    throw new Error(`Template surat penawaran (REC_OFFER) belum tersedia${any ? " — aktifkan di menu Template Surat" : " — hubungi admin untuk seeding"}`);
  }

  // nomor NNN/HR-RC/{romawi}/{tahun} (pola letter-service)
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  const countSame = await db.recruitmentLetter.count({ where: { issuedAt: { gte: yearStart, lt: yearEnd } } });
  const letterNo = `${String(countSame + 1).padStart(3, "0")}/HR-RC/${ROMAN[now.getMonth()]}/${now.getFullYear()}`;

  const tc = tenantCryptoForDb(db);
  const company = await db.company.findFirst({ select: { name: true, city: true } });
  const salary = tc.decryptMoney(o.salary);

  // email kandidat eksternal (bila tersedia & terdekripsi)
  let candidateEmail: string | null = null;
  let candidatePhone: string | null = null;
  if (o.candidate.applicantId) {
    const a = await db.applicant.findUnique({ where: { id: o.candidate.applicantId }, select: { email: true, city: true, phone: true } });
    if (a) {
      candidateEmail = tc.decryptText(a.email) || null;
      candidatePhone = tc.decryptText(a.phone) || null;
    }
  }

  const ctx: Record<string, string> = {
    letter_no: letterNo,
    letter_date: fmtDateId(now),
    city: company?.city ?? "Jakarta",
    company_name: company?.name ?? "RekanKerja HRIS",
    signatory_name: template.signatoryName?.trim() || "HR Manager",
    signatory_title: template.signatoryTitle,
    candidate_name: o.candidate.fullName,
    pr_no: o.candidate.pr.prNo,
    position_name: o.candidate.pr.position?.title ?? "posisi sesuai PR",
    offer_no: o.offerNo,
    salary: fmtMoneyId(salary),
    salary_unit: o.salaryUnit,
    start_date: fmtDateId(o.startDate),
    expiry_date: fmtDateId(o.expiryDate),
    employment_status: o.candidate.pr.employmentStatus,
    jo_ref: o.jobOpening?.jobOpportunity.refNo ?? "—",
  };
  const body = template.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, token: string) => {
    const v = ctx[token];
    return v != null && v.trim() !== "" ? v : "—";
  });

  await db.recruitmentLetter.create({
    data: {
      letterNo, kind: "Offer", templateKey: OFFER_TEMPLATE_KEY,
      candidateId: o.candidate.id, selectionStepId: null,
      subject: template.subject, body,
      metaJson: JSON.stringify({ templateName: template.name, offerNo: o.offerNo, salary: salary ?? null }),
      createdById: null,
    },
  });

  // P2.4 — token self-service putusan mandiri: acak 32-byte hex; DB hanya
  // menyimpan SHA-256 (pola DB-token EsignRequest); masa berlaku mengikuti
  // expiryDate offer (fallback 7 hari). Kirim ulang menimpa hash lama →
  // token lama otomatis terinvalidasi.
  const selfToken = randomBytes(32).toString("hex");
  const selfTokenHash = createHash("sha256").update(selfToken).digest("hex");
  const selfTokenExp = o.expiryDate ?? new Date(Date.now() + SELF_SERVICE_TTL_MS);
  const slug = await tenantSlugOf(db);
  const portalLink = `${portalBase()}/offer/${selfToken}${slug ? `?t=${encodeURIComponent(slug)}` : ""}`;

  await db.candidateOffer.update({
    where: { id: o.id },
    data: {
      status: "Sent", letterNo, sentAt: new Date(),
      selfServiceTokenHash: selfTokenHash, selfServiceTokenExpAt: selfTokenExp,
    },
  });

  // P2.4 — versi "Sent" (payload memuat salinan token TERENKRIPSI vault utk
  // merender tautan HR di GET detail — hash one-way tak bisa direkonstruksi)
  await snapshotOfferVersion(db, {
    offerId: o.id, label: "Sent", actorId: null,
    extras: { selfServiceTokenEnc: tc.encryptText(selfToken) ?? null },
  });

  // P2.4 — email tautan putusan mandiri ke kandidat. AWAIT (beda dari email
  // fire-and-forget lain — pelajaran P1.5): EmailLog tertulis deterministik
  // sebelum respons kembali → e2e meng-assert baris log tepat setelah send.
  if (candidateEmail) {
    try {
      await notifyEmailEvent(db, {
        event: "recruitment.offer.selfservice",
        to: [{ email: candidateEmail, name: o.candidate.fullName }],
        data: {
          kandidat: o.candidate.fullName, docNo: o.offerNo,
          posisi: o.candidate.pr.position?.title ?? "-",
          portalLink,
          berlakuSampai: fmtDateId(selfTokenExp),
        },
      });
    } catch {
      // never-throw — email tidak boleh menggagalkan pengiriman offer
    }
  }

  // email ke kandidat (bila alamat tersedia) — event recruitment.offer.sent
  if (candidateEmail) {
    void notifyEmailEvent(db, {
      event: "recruitment.offer.sent",
      to: [{ email: candidateEmail, name: o.candidate.fullName }],
      data: {
        nama: o.candidate.fullName, docNo: o.offerNo,
        posisi: o.candidate.pr.position?.title ?? "-",
        perusahaan: company?.name ?? "RekanKerja HRIS",
        gaji: fmtMoneyId(salary), mulaiKerja: fmtDateId(o.startDate), berlakuSampai: fmtDateId(o.expiryDate),
      },
    });
  }

  // B6 — WhatsApp ke kandidat (paralel email; fire-and-forget, never-throw)
  if (candidatePhone) {
    void sendWa(db, {
      event: "recruitment.offer.sent",
      toPhone: candidatePhone,
      placeholders: {
        nama: o.candidate.fullName, docNo: o.offerNo,
        posisi: o.candidate.pr.position?.title ?? "-",
        perusahaan: company?.name ?? "RekanKerja HRIS",
        gaji: fmtMoneyId(salary), mulaiKerja: fmtDateId(o.startDate), berlakuSampai: fmtDateId(o.expiryDate),
      },
    });
  }

  // notif in-app officer rekrutmen
  const officer = o.candidate.pr.recruitmentOfficer;
  if (officer) {
    const res = await notifyEvent(db, {
      to: "employee", employeeId: officer.id, docType: "CandidateOffer", docNo: o.offerNo,
      title: `Offer ${o.offerNo} terkirim — ${o.candidate.fullName}`,
      body: `Penawaran ${fmtMoneyId(salary)} (${o.candidate.pr.prNo}${o.candidate.pr.position?.title ? ` · ${o.candidate.pr.position.title}` : ""})${o.expiryDate ? ` — berlaku s.d. ${fmtDateId(o.expiryDate)}` : ""}`,
      kind: "recruitment", link: "recruitment:offers",
    }).catch(() => ({ recipients: [] }));
    if (officer.email && res.recipients.length === 0) {
      // fallback email officer bila notif in-app gagal
      void notifyEmailEvent(db, {
        event: "recruitment.offer.sent",
        to: [{ email: officer.email, name: officer.fullName }],
        data: { nama: officer.fullName, docNo: o.offerNo, posisi: o.candidate.pr.position?.title ?? "-", gaji: fmtMoneyId(salary), mulaiKerja: fmtDateId(o.startDate), berlakuSampai: fmtDateId(o.expiryDate), perusahaan: company?.name ?? "RekanKerja HRIS" },
      });
    }
    // B6 — WhatsApp officer (paralel fallback email; never-throw)
    void (async () => {
      const phone = await employeePhoneOf(db, officer.id);
      if (phone) {
        void sendWa(db, {
          event: "recruitment.offer.sent",
          toPhone: phone,
          placeholders: {
            nama: officer.fullName, docNo: o.offerNo,
            posisi: o.candidate.pr.position?.title ?? "-",
            perusahaan: company?.name ?? "RekanKerja HRIS",
            gaji: fmtMoneyId(salary), mulaiKerja: fmtDateId(o.startDate), berlakuSampai: fmtDateId(o.expiryDate),
          },
        });
      }
    })().catch(() => { /* never */ });
  }

  await db.activityLog.create({
    data: {
      action: "Updated", entity: "CandidateOffer", entityId: o.offerNo,
      detail: `Offer ${o.offerNo} DIKIRIM ke kandidat ${o.candidate.fullName} (PR ${o.candidate.pr.prNo}) — surat ${letterNo} + tautan putusan mandiri${actorName ? `, oleh ${actorName}` : ""}`,
    },
  });
  return { offerNo: o.offerNo, letterNo, selfServiceLink: portalLink };
}

/** Kirim offer: bila ada ApprovalStructure RecruitmentOffer aktif → mulai
 *  chain (PendingApproval); tanpa struktur → langsung performSend. */
export async function sendOffer(
  db: TenantDb,
  input: { id: string; actorId?: string | null; actorName?: string | null },
): Promise<SendOfferResult> {
  const o = await offerCtx(db, input.id);
  if (o.status !== "Draft") throw new Error(`Offer ${o.offerNo} berstatus ${o.status} — hanya Draft yang bisa dikirim`);

  const empId = await approvalEmployeeId(db, input.id, input.actorId);
  if (empId) {
    const params = await getEmployeeApprovalParams(db, empId);
    const structure = params ? await resolveApprovalStructure(db, params, OFFER_DOC_TYPE) : null;
    if (structure && structure.levels.length > 0) {
      // P2.4 — chain terminal lama (Approved dari pengiriman sebelumnya /
      // Rejected / Cancelled) → bersihkan supaya PENGIRIMAN ULANG pasca-counter
      // membentuk chain baru (pola payroll confirm P1.4; jejak keputusan lama
      // tetap ter-audit di ActivityLog + note step).
      const prevChain = await getApprovalChain(db, OFFER_DOC_TYPE, input.id);
      if (prevChain && prevChain.status !== "InProgress") {
        await db.approvalChain.delete({ where: { docType_docId: { docType: OFFER_DOC_TYPE, docId: input.id } } });
      }
      const tc = tenantCryptoForDb(db);
      const full = (await db.candidateOffer.findUnique({ where: { id: input.id }, select: { salary: true } }))!;
      const amount = tc.decryptMoney(full.salary) ?? undefined;
      const chain = await startApprovalChain(db, {
        docType: OFFER_DOC_TYPE, docId: input.id, employeeId: empId, amount, createdBy: input.actorName ?? null,
      });
      await db.candidateOffer.update({ where: { id: input.id }, data: { status: "PendingApproval" } });
      const first = chain.steps.find((s) => s.status === "Current") ?? null;
      await db.activityLog.create({
        data: {
          action: "Submitted", entity: "CandidateOffer", entityId: o.offerNo,
          detail: `Offer ${o.offerNo} diajukan ke approval (${chain.totalLevels} jenjang${input.actorName ? `, oleh ${input.actorName}` : ""}) — menunggu ${first?.approverLabel ?? "-"}`,
        },
      });
      return {
        offerNo: o.offerNo, status: "PendingApproval", sent: false,
        approvalLevels: chain.totalLevels, firstApprover: first?.approverLabel ?? null,
      };
    }
  }

  // tanpa struktur approval aktif → langsung kirim
  const r = await performSend(db, input.id, input.actorName);
  return { offerNo: r.offerNo, status: "Sent", sent: true, letterNo: r.letterNo, selfServiceLink: r.selfServiceLink };
}

/** Keputusan approval offer (dari kotak approval view Offer).
 *  Approve final → performSend otomatis; reject → kembali Draft + note. */
export async function decideOfferApproval(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject"; note?: string | null; actor: DecideActor },
): Promise<SendOfferResult> {
  const o = await offerCtx(db, input.id);
  if (o.status !== "PendingApproval") throw new Error(`Offer ${o.offerNo} berstatus ${o.status} — tidak menunggu keputusan`);

  const res = await decideApprovalChain(db, {
    docType: OFFER_DOC_TYPE, docId: input.id, action: input.action, note: input.note ?? undefined, actor: input.actor,
  });

  if (res.final && input.action === "approve") {
    const r = await performSend(db, input.id, input.actor.name);
    return { offerNo: o.offerNo, status: "Sent", sent: true, letterNo: r.letterNo, selfServiceLink: r.selfServiceLink };
  }

  if (input.action === "reject") {
    await db.candidateOffer.update({
      where: { id: input.id },
      data: { status: "Draft", note: [o.note, input.note?.trim() ? `Approval ditolak: ${input.note.trim()}` : null].filter(Boolean).join(" · ") || null },
    });
    await db.activityLog.create({
      data: {
        action: "Rejected", entity: "CandidateOffer", entityId: o.offerNo,
        detail: `Pengajuan offer ${o.offerNo} DITOLAK approval (${input.actor.name})${input.note ? ` — ${input.note.trim()}` : ""} — kembali Draft`,
      },
    });
    return { offerNo: o.offerNo, status: "Draft", sent: false };
  }

  // approve jenjang menengah — tetap menunggu
  await db.activityLog.create({
    data: {
      action: "Approved", entity: "CandidateOffer", entityId: o.offerNo,
      detail: `Offer ${o.offerNo} disetujui jenjang ${res.chain.currentLevel - 1}/${res.chain.totalLevels} (${input.actor.name}) — lanjut ke ${res.chain.steps.find((s) => s.status === "Current")?.approverLabel ?? "-"}`,
    },
  });
  return { offerNo: o.offerNo, status: "PendingApproval", sent: false };
}

// ============ respons kandidat (viewed / accept / decline) ============

/** Catat bahwa kandidat telah membaca offer (dilaporkan via email/telp —
 *  pelamar tidak punya akun sistem, HR yang mencatat). */
export async function markViewed(db: TenantDb, input: { id: string; actorName?: string | null }): Promise<{ offerNo: string; status: OfferStatus }> {
  const o = await offerCtx(db, input.id);
  if (o.status !== "Sent") throw new Error(`Offer ${o.offerNo} berstatus ${o.status} — hanya Sent yang bisa ditandai dilihat`);
  await db.candidateOffer.update({ where: { id: input.id }, data: { status: "Viewed" } });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "CandidateOffer", entityId: o.offerNo,
      detail: `Offer ${o.offerNo} dilihat kandidat ${o.candidate.fullName}${input.actorName ? ` (dicatat oleh ${input.actorName})` : ""}`,
    },
  });
  return { offerNo: o.offerNo, status: "Viewed" };
}

/** Respons kandidat: accept | decline. P2.4 — RACE-GUARD: tulis via
 *  updateMany kondisional ({id, status in [Sent, Viewed]}) — double-click
 *  paralel / kandidat & HR bertabrakan → tepat SATU sukses, lainnya
 *  OfferConflictError 409 (bukan read-then-write yang bisa dobel-apply).
 *  Versi "SelfService" (via portal) / "Responded" (dicatat HR) disinkronkan
 *  SETELAH sukses; notifikasi officer + webhook offer.accepted tetap jalan. */
export async function respondOffer(
  db: TenantDb,
  input: { id: string; action: "accept" | "decline"; note?: string | null; actorName?: string | null; via?: "portal" },
): Promise<{ offerNo: string; status: OfferStatus }> {
  const o = await offerCtx(db, input.id);
  if (o.status !== "Sent" && o.status !== "Viewed") {
    throw new OfferConflictError(`Offer ${o.offerNo} berstatus ${o.status} — tidak menunggu respons kandidat`);
  }
  // REC-AUDIT-FIX M3 — cek expiryDate SEBELUHR respons diterima: dulu respons
  // tetap diproses walau offer sudah lewat tanggal kedaluwarsa (race dengan
  // scheduler 6 jam yang menandai Expired). Kedaluwarsa → tandai + tolak.
  if (o.expiryDate && o.expiryDate.getTime() <= Date.now()) {
    await db.candidateOffer.update({ where: { id: o.id }, data: { status: "Expired" } }).catch(() => {});
    throw new OfferConflictError(`Offer ${o.offerNo} telah KEDALUWARSA pada ${fmtDateId(o.expiryDate)} — tidak bisa direspons`);
  }
  const status: OfferStatus = input.action === "accept" ? "Accepted" : "Declined";
  const note = [o.note, input.note?.trim() || null].filter(Boolean).join(" · ") || null;
  // P2.4 race-guard — updateMany kondisional: hanya offer yang MASIH Sent/Viewed
  // yang berubah; count 0 = sudah diputuskan duluan (double-click/portal+HR).
  const updated = await db.candidateOffer.updateMany({
    where: { id: input.id, status: { in: ["Sent", "Viewed"] } },
    data: { status, respondedAt: new Date(), note },
  });
  if (updated.count === 0) {
    throw new OfferConflictError(
      `Offer ${o.offerNo} sudah diputuskan / tidak lagi menunggu respons kandidat`,
    );
  }

  // F7 — emit webhook offer.accepted (antrean; TANPA PII kandidat)
  if (input.action === "accept") {
    void emitWebhookEvent(db, "offer.accepted", {
      offerNo: o.offerNo,
      acceptedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  // notif officer rekrutmen
  const officer = await db.personnelRequisition.findUnique({
    where: { id: o.prId },
    select: { recruitmentOfficer: { select: { id: true, fullName: true, email: true } }, prNo: true, position: { select: { title: true } } },
  });
  if (officer?.recruitmentOfficer) {
    const off = officer.recruitmentOfficer;
    await notifyEvent(db, {
      to: "employee", employeeId: off.id, docType: "CandidateOffer", docNo: o.offerNo,
      title: `Offer ${o.offerNo} ${status === "Accepted" ? "DITERIMA" : "DITOLAK"} — ${o.candidate.fullName}`,
      body: `${status === "Accepted" ? "Kandidat menerima" : "Kandidat menolak"} penawaran (${officer.prNo}${officer.position?.title ? ` · ${officer.position.title}` : ""})${input.note ? ` — ${input.note}` : ""}`,
      kind: "recruitment", link: "recruitment:offers",
    }).catch(() => /* notif tidak boleh gagalkan bisnis */ undefined);
    if (off.email) {
      void notifyEmailEvent(db, {
        event: "recruitment.offer.responded",
        to: [{ email: off.email, name: off.fullName }],
        data: {
          nama: off.fullName, docNo: o.offerNo, kandidat: o.candidate.fullName,
          posisi: officer.position?.title ?? "-", statusOffer: status === "Accepted" ? "DITERIMA" : "DITOLAK",
          catatan: input.note?.trim() || "-",
        },
      });
    }
    // B6 — WhatsApp officer (paralel email; fire-and-forget, never-throw)
    void (async () => {
      const phone = await employeePhoneOf(db, off.id);
      if (phone) {
        void sendWa(db, {
          event: "recruitment.offer.responded",
          toPhone: phone,
          placeholders: {
            nama: off.fullName, docNo: o.offerNo, kandidat: o.candidate.fullName,
            posisi: officer.position?.title ?? "-", statusOffer: status === "Accepted" ? "DITERIMA" : "DITOLAK",
            catatan: input.note?.trim() || "-",
          },
        });
      }
    })().catch(() => { /* never */ });
  }

  await db.activityLog.create({
    data: {
      action: status === "Accepted" ? "Approved" : "Rejected",
      entity: "CandidateOffer", entityId: o.offerNo,
      detail: `Offer ${o.offerNo} ${status === "Accepted" ? "DITERIMA" : "DITOLAK"} kandidat ${o.candidate.fullName}${input.note ? ` — ${input.note.trim()}` : ""}${input.actorName ? ` (dicatat oleh ${input.actorName})` : ""}`,
    },
  });
  // P2.4 — sinkronkan versi putusan (SETELAH sukses; label beda jalur)
  await snapshotOfferVersion(db, {
    offerId: input.id,
    label: input.via === "portal" ? "SelfService" : "Responded",
  });
  return { offerNo: o.offerNo, status };
}

// ============ P2.4 — counter offer (negosiasi terstruktur, D-BM19) ============

export interface CounterOfferEdits {
  salary?: number | null;
  currency?: string | null;
  salaryUnit?: string | null;
  startDate?: string | null;
  expiryDate?: string | null;
  note?: string | null;
  jobOpeningId?: string | null;
}

/**
 * Counter offer: kandidat menawar (dicatat HR / hasil nego) → offer Sent/Viewed
 * kembali ke DRAFT dgn revisi (gaji/tanggal/catatan) + versi "Counter".
 * respondedAt DIPERTAHANKAN (jejak bahwa kandidat pernah merespons) dan token
 * self-service lama DIINVALIDASI (hash dinull-kan) — keputusan hanya lewat
 * pengiriman ulang. Setelah Accepted/Declined/Expired → 409 (final).
 */
export async function counterOffer(
  db: TenantDb,
  input: { id: string; edits: CounterOfferEdits; actor?: { id?: string | null; name?: string | null } },
): Promise<{ offerNo: string; status: OfferStatus }> {
  const o = await offerCtx(db, input.id);
  if (o.status !== "Sent" && o.status !== "Viewed") {
    throw new OfferConflictError(
      `Offer ${o.offerNo} berstatus ${o.status} — counter hanya untuk offer Sent/Viewed (sebelum diputuskan/kedaluwarsa)`,
    );
  }
  const tc = tenantCryptoForDb(db);
  const edits = input.edits ?? {};
  const salary = edits.salary != null && String(edits.salary) !== "" ? Number(edits.salary) : null;
  if (salary != null && (!Number.isFinite(salary) || salary < 0)) {
    throw new Error("Gaji offer harus berupa angka tidak negatif");
  }
  if (edits.jobOpeningId) {
    const jo = await db.jobOpening.findUnique({
      where: { id: edits.jobOpeningId },
      select: { id: true, prId: true },
    });
    if (!jo) throw new Error("Slot lowongan tidak ditemukan");
    if (jo.prId !== o.pr.id) throw new Error("Slot lowongan bukan milik PR offer ini");
  }

  await db.candidateOffer.update({
    where: { id: input.id },
    data: {
      ...(edits.salary !== undefined ? { salary: salary != null ? tc.encryptMoney(salary) : null } : {}),
      ...(edits.currency !== undefined ? { currency: edits.currency?.trim() || "IDR" } : {}),
      ...(edits.salaryUnit !== undefined ? { salaryUnit: edits.salaryUnit?.trim() || "Monthly" } : {}),
      ...(edits.startDate !== undefined ? { startDate: parseDate(edits.startDate) } : {}),
      ...(edits.expiryDate !== undefined ? { expiryDate: parseDate(edits.expiryDate) } : {}),
      ...(edits.note !== undefined ? { note: edits.note?.trim() || null } : {}),
      ...(edits.jobOpeningId !== undefined ? { jobOpeningId: edits.jobOpeningId || null } : {}),
      status: "Draft",
      selfServiceTokenHash: null, // tautan putusan lama terinvalidasi
      selfServiceTokenExpAt: null,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "CandidateOffer", entityId: o.offerNo,
      detail: `Offer ${o.offerNo} COUNTER (nego) oleh ${input.actor?.name ?? "HR"} — kembali Draft utk revisi` +
        `${edits.salary !== undefined ? ` — gaji ${salary != null ? fmtMoneyId(salary) : "(dikosongkan)"}` : ""}` +
        `${edits.startDate ? ` — mulai ${fmtDateId(parseDate(edits.startDate))}` : ""}` +
        `${edits.note?.trim() ? ` — catatan: ${edits.note.trim()}` : ""}`,
    },
  });
  await snapshotOfferVersion(db, { offerId: input.id, label: "Counter", actorId: input.actor?.id ?? null });
  return { offerNo: o.offerNo, status: "Draft" };
}

// ============ P2.4 — putusan mandiri kandidat via portal (publik) ============

/** Hash token self-service (SHA-256 hex — kolom CandidateOffer menyimpan ini). */
function selfServiceTokenHashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface OfferSelfServiceSummary {
  ok: true;
  offerNo: string;
  position: string | null;
  company: string | null;
  startDate: string | null;
  expiryDate: string | null;
  status: string;
}

/**
 * Ringkasan offer utk halaman putusan portal (TANPA nominal gaji — kebijakan
 * halaman status: surat resmi bertanda tangan dikirim via email). Token
 * tak dikenal → 404 netral; kedaluwarsa → 410.
 */
export async function offerSelfServiceSummary(db: TenantDb, input: { token: string }): Promise<OfferSelfServiceSummary> {
  const offer = await db.candidateOffer.findUnique({
    where: { selfServiceTokenHash: selfServiceTokenHashOf(input.token) },
    select: {
      offerNo: true, status: true, startDate: true, expiryDate: true,
      selfServiceTokenExpAt: true,
      pr: { select: { position: { select: { title: true } } } },
    },
  });
  if (!offer) {
    throw new OfferSelfServiceError(404, "Tautan putusan offer tidak valid atau tidak dikenali");
  }
  if (!offer.selfServiceTokenExpAt || offer.selfServiceTokenExpAt.getTime() <= Date.now()) {
    throw new OfferSelfServiceError(410, "Tautan putusan offer telah kedaluwarsa — minta tim rekrutmen mengirim ulang");
  }
  const company = await db.company.findFirst({ select: { name: true } });
  return {
    ok: true,
    offerNo: offer.offerNo,
    position: offer.pr.position?.title ?? null,
    company: company?.name ?? null,
    startDate: iso(offer.startDate),
    expiryDate: iso(offer.expiryDate),
    status: offer.status,
  };
}

/**
 * Putusan mandiri kandidat via portal (token publik). Jalur sama dgn
 * respondOffer (race-guard 409) + ActivityLog actorType system "putusan
 * mandiri via portal". 404/410/409 sesuai kelas error.
 */
export async function respondOfferSelfService(
  db: TenantDb,
  input: { token: string; action: "accept" | "decline"; note?: string | null },
): Promise<{ offerNo: string; status: OfferStatus }> {
  const offer = await db.candidateOffer.findUnique({
    where: { selfServiceTokenHash: selfServiceTokenHashOf(input.token) },
    select: { id: true, offerNo: true, selfServiceTokenExpAt: true },
  });
  if (!offer) {
    throw new OfferSelfServiceError(404, "Tautan putusan offer tidak valid atau tidak dikenali");
  }
  if (!offer.selfServiceTokenExpAt || offer.selfServiceTokenExpAt.getTime() <= Date.now()) {
    throw new OfferSelfServiceError(410, "Tautan putusan offer telah kedaluwarsa — minta tim rekrutmen mengirim ulang");
  }
  const res = await respondOffer(db, {
    id: offer.id,
    action: input.action,
    note: input.note ?? null,
    actorName: "Portal Kandidat",
    via: "portal",
  });
  await db.activityLog.create({
    data: {
      actorType: "system", action: "Updated", entity: "CandidateOffer", entityId: res.offerNo,
      detail: `putusan mandiri via portal — ${input.action}`,
    },
  });
  return res;
}

// ============ scheduler: expiry + reminder (HRX E3) ============

/** Job scheduler offer: (1) Sent/Viewed lewat expiryDate → Expired;
 *  (2) pengingat offer berakhir ≤3 hari (dedupe ActivityLog per tanggal). */
export async function jobOfferExpiry(db: TenantDb): Promise<{ expired: number; reminded: number; notified: number }> {
  const now = new Date();
  // F7 — setting otomasi (default ON; baris "false" mematikan reminder saja)
  const reminderOn = (await getRecruitmentSetting(db, "auto.reminder.offer", "true").catch(() => "true")) !== "false";

  // 1) kedaluwarsa — idempoten by filter status
  const stale = await db.candidateOffer.findMany({
    where: { status: { in: ["Sent", "Viewed"] }, expiryDate: { not: null, lt: now } },
    select: { id: true, offerNo: true, candidate: { select: { fullName: true } }, pr: { select: { prNo: true } } },
    take: 200,
  });
  for (const o of stale) {
    await db.candidateOffer.update({ where: { id: o.id }, data: { status: "Expired" } });
    await db.activityLog.create({
      data: {
        actorType: "system", action: "Updated", entity: "CandidateOffer", entityId: o.offerNo,
        detail: `Offer ${o.offerNo} kandidat ${o.candidate.fullName} (${o.pr.prNo}) otomatis KEDALUWARSA oleh scheduler — melewati batas waktu`,
      },
    });
  }

  // 2) pengingat — offer Sent/Viewed berakhir ≤3 hari (dedupe per tanggal)
  if (!reminderOn) return { expired: stale.length, reminded: 0, notified: 0 };
  const horizon = new Date(now.getTime() + 3 * 86_400_000);
  const upcoming = await db.candidateOffer.findMany({
    where: { status: { in: ["Sent", "Viewed"] }, expiryDate: { not: null, gte: now, lte: horizon } },
    include: {
      candidate: {
        select: {
          fullName: true,
          pr: { select: { prNo: true, position: { select: { title: true } }, recruitmentOfficer: { select: { id: true, fullName: true, email: true } } } },
        },
      },
      createdBy: { select: { id: true, fullName: true, email: true } },
    },
    take: 200,
  });

  let reminded = 0;
  let notified = 0;
  for (const o of upcoming) {
    if (!o.expiryDate) continue;
    const diffDays = Math.ceil((o.expiryDate.getTime() - now.getTime()) / 86_400_000);
    const key = `offer-reminder:${o.id}:${o.expiryDate.toISOString().slice(0, 10)}`;
    const claimed = await db.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "ActivityLog"
      WHERE "action" = 'Reminder' AND "entity" = 'Scheduler' AND "entityId" = ${key}`.then((r) => r[0]?.n ?? 0);
    if (claimed > 0) continue;

    // target: officer PR → fallback pembuat offer (createdById)
    const target = o.candidate.pr.recruitmentOfficer ?? o.createdBy;
    if (target) {
      const res = await notifyEvent(db, {
        to: "employee", employeeId: target.id, docType: "CandidateOffer", docNo: o.offerNo,
        title: `[Pengingat] Offer ${o.offerNo} berakhir ${diffDays} hari`,
        body: `Kandidat ${o.candidate.fullName} belum merespons — batas ${fmtDateId(o.expiryDate)} (${o.candidate.pr.prNo})`,
        kind: "recruitment", link: "recruitment:offers",
      }).catch(() => ({ recipients: [] }));
      notified += res.recipients.length;
      if (target.email) {
        void notifyEmailEvent(db, {
          event: "recruitment.offer.reminder",
          to: [{ email: target.email, name: target.fullName }],
          data: {
            nama: target.fullName, docNo: o.offerNo, kandidat: o.candidate.fullName,
            posisi: o.candidate.pr.position?.title ?? "-", statusOffer: o.status,
            berlakuSampai: fmtDateId(o.expiryDate), sisaHari: `${diffDays} hari lagi`,
          },
        });
      }
      // B6 — WhatsApp target (officer PR / pembuat offer; paralel email)
      void (async () => {
        const phone = await employeePhoneOf(db, target.id);
        if (phone) {
          void sendWa(db, {
            event: "recruitment.offer.reminder",
            toPhone: phone,
            placeholders: {
              nama: target.fullName, docNo: o.offerNo, kandidat: o.candidate.fullName,
              posisi: o.candidate.pr.position?.title ?? "-", statusOffer: o.status,
              berlakuSampai: fmtDateId(o.expiryDate), sisaHari: `${diffDays} hari lagi`,
            },
          });
        }
      })().catch(() => { /* never */ });
    }
    await db.activityLog.create({
      data: {
        actorType: "system", action: "Reminder", entity: "Scheduler", entityId: key,
        detail: `Pengingat offer ${o.offerNo} kandidat ${o.candidate.fullName} (${o.candidate.pr.prNo}) — berakhir ${diffDays} hari lagi`,
      },
    });
    reminded++;
  }
  return { expired: stale.length, reminded, notified };
}

// ============ funnel report dasar (§7 F4 poin 4) ============

export interface FunnelStage {
  key: string;
  label: string;
  labelEn: string;
  count: number;
}

export interface OfferFunnel {
  prId: string | null;
  stages: FunnelStage[];
  /** konversi tahap seleksi: berapa kandidat pernah mencapai tahap (≥1 step non-cancelled). */
  selectionStages: { name: string; processOrder: number | null; reached: number; passed: number }[];
  offerAcceptanceRate: number | null;
}

/** Funnel Applied → Candidate → per tahap → Offer → Hired (global atau per PR). */
export async function offerFunnel(db: TenantDb, prId?: string | null): Promise<OfferFunnel> {
  const prFilter = prId ?? null;
  const openingScope = prFilter
    ? { jobOpening: { prId: prFilter } }
    : {};

  const [applicants, applications, candidates, offers, appointments, stages] = await Promise.all([
    db.applicant.count({ where: { status: { not: "Outdated" } } }),
    db.applicantApplication.count({ where: openingScope }),
    db.jobCandidate.count({ where: prFilter ? { prId: prFilter } : {} }),
    db.candidateOffer.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: prFilter ? { prId: prFilter } : {},
    }),
    db.candidateAppointment.count({
      where: {
        ...(prFilter ? { prId: prFilter } : {}),
        employeeId: { not: null },
      },
    }),
    db.selectionProcess.findMany({
      where: { active: true },
      select: { id: true, name: true, processOrder: true },
      orderBy: { processOrder: "asc" },
    }),
  ]);

  const offerCount = (s: string) => offers.find((o) => o.status === s)?._count._all ?? 0;
  const offersSent = offerCount("Sent") + offerCount("Viewed") + offerCount("Accepted") + offerCount("Declined") + offerCount("Expired");
  const accepted = offerCount("Accepted");

  // per tahap: kandidat yang step-nya pernah dibuat & tidak Cancelled
  const selectionStages: OfferFunnel["selectionStages"] = [];
  for (const st of stages) {
    const steps = await db.candidateSelectionStep.findMany({
      where: {
        selectionProcessId: st.id,
        status: { not: "Cancelled" },
        ...(prFilter ? { candidate: { prId: prFilter } } : {}),
      },
      select: { status: true },
    });
    selectionStages.push({
      name: st.name,
      processOrder: st.processOrder,
      reached: steps.length,
      passed: steps.filter((s) => s.status === "Passed").length,
    });
  }

  return {
    prId: prFilter,
    stages: [
      { key: "applicants", label: "Talent Pool", labelEn: "Talent Pool", count: applicants },
      { key: "applications", label: "Lamaran Masuk", labelEn: "Applications", count: applications },
      { key: "candidates", label: "Kandidat", labelEn: "Candidates", count: candidates },
      { key: "offers", label: "Offer Terkirim", labelEn: "Offers Sent", count: offersSent },
      { key: "accepted", label: "Offer Diterima", labelEn: "Accepted", count: accepted },
      { key: "hired", label: "Diangkat (Hired)", labelEn: "Hired", count: appointments },
    ],
    selectionStages,
    offerAcceptanceRate: offersSent > 0 ? Math.round((accepted / offersSent) * 100) : null,
  };
}
