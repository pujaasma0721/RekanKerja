// ============================================================================
// RECRUITMENT P1.6 — REFERRAL SUBMISSION SERVICE (referral otomatis —
// DEVELOPMENT-PLAN-BENCHMARK.md §2 D-BM15 + §4 P1.6, Recruitment §4.5 gap-5).
//
// Alur: karyawan ESS mengajukan kandidat referral (nama + email/WA + lowongan
// opsional + catatan) → STAGING verifikasi HR ("ala public staging ringan") →
//   · verify   → Applicant BARU (source "Referral", referralEmployeeId =
//                perujuk — register B8 referral tracker mengambil alih dari
//                sini; PII email/phone terenkripsi persis applicant-service,
//                applicantNo APP-YY-##### + retryOnUnique).
//   · duplicate → email kandidat cocok blind-index emailHash pelamar EXISTING
//                → status "Duplicate" + verifyNote memuat applicantNo lama —
//                TIDAK membuat pelamar baru (pola dedupe REC-AUDIT-FIX M2).
//   · reject  → status "Rejected" + alasan (≥10 char — wajib).
//
// Model db.referralSubmission (sudah termigrasi): docNo RF-YYYY-####,
// status Submitted|Verified|Rejected|Duplicate, verifyNote, verifiedById/At.
//
// Anti-abuse: ≥10 pengajuan Submitted per karyawan per BULAN KALENDER → 429.
// Duplicate guard submit: karyawan sama + nama+email kandidat sama (case-
// insensitive) di antara Submitted → 409.
//
// Notifikasi in-app ke perujuk via notifyEvent (kind recruitment, deep-link
// ess:my-referrals — konstanta link ESS yang dipakai modul performance utk
// halaman ESS sejenis). Email: TIDAK ada template referral di email-defaults
// (hanya pr/selection/offer/appointment/application/esign/digest/status.link)
// → in-app only (keputusan: tidak memaksa template yang tidak pas).
// ============================================================================
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { retryOnUnique } from "@/rekankerja/shared/lib/doc-no-retry";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { createApplicant } from "@/rekankerja/recruitment/services/applicant-service";

// ============ error terpetakan HTTP (pola referral-service) ============

/** 404 — pengajuan / karyawan tidak ditemukan. */
export class ReferralSubmissionNotFoundError extends Error {}
/** 400 — payload tidak valid (nama/kontak/lowongan/catatan). */
export class ReferralSubmissionBadRequestError extends Error {}
/** 409 — sudah diproses / kandidat kembar masih menunggu. */
export class ReferralSubmissionConflictError extends Error {}
/** 429 — batas pengajuan bulanan tercapai (anti-abuse). */
export class ReferralSubmissionRateLimitError extends Error {}

export function referralSubmissionErrStatus(e: unknown): number {
  if (e instanceof ReferralSubmissionNotFoundError) return 404;
  if (e instanceof ReferralSubmissionBadRequestError) return 400;
  if (e instanceof ReferralSubmissionConflictError) return 409;
  if (e instanceof ReferralSubmissionRateLimitError) return 429;
  return 500;
}

/** Aktor ringan utk service (nama utk ActivityLog + employeeId utk verifiedById). */
export interface ReferralSubmissionActor {
  name: string;
  employeeId?: string | null;
}

// ============ konstanta + tipe ============

export const REFERRAL_SUB_STATUSES = ["Submitted", "Verified", "Rejected", "Duplicate"] as const;
export type ReferralSubStatus = (typeof REFERRAL_SUB_STATUSES)[number];

/** Anti-abuse: maks pengajuan Submitted per karyawan per bulan kalender. */
export const REFERRAL_MONTHLY_CAP = 10;
/** Batas catatan perujuk (konsisten referralRewardNote B8). */
export const REFERRAL_NOTE_MAX = 500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Baris staging HR — email/phone kandidat tampil penuh (kotak verifikasi HR). */
export interface ReferralSubmissionRow {
  id: string;
  docNo: string;
  referrer: { employeeNo: string; fullName: string };
  jobOpening: { id: string; title: string; joRefNo: string } | null;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  note: string | null;
  status: string;
  verifyNote: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

/** Baris "Pengajuan Saya" ESS — TANPA email/phone (minimisasi; milik submitter sendiri). */
export interface MyReferralSubmissionRow {
  id: string;
  docNo: string;
  candidateName: string;
  jobOpening: { id: string; title: string; joRefNo: string } | null;
  note: string | null;
  status: string;
  verifyNote: string | null;
  createdAt: string;
}

/** Opsi lowongan Posted utk form ESS (id + judul + refNo saja). */
export interface ReferralOpeningOption {
  id: string;
  title: string;
  joRefNo: string;
}

// ============ include bersama ============
// CATATAN: ReferralSubmission HANYA punya relasi `referrer` di schema (kolom
// jobOpeningId/verifiedById TANPA @relation — prisma read-only utk slice ini);
// judul lowongan + nama verifier diselesaikan via lookup terpisah di bawah.

const SUBMISSION_INCLUDE = {
  referrer: { select: { id: true, employeeNo: true, fullName: true } },
} satisfies Prisma.ReferralSubmissionInclude;

type SubmissionWithRefs = Prisma.ReferralSubmissionGetPayload<{ include: typeof SUBMISSION_INCLUDE }>;

/** Batas aman staging register (tenant demo kecil — pola REGISTER_TAKE B8). */
const STAGING_TAKE = 500;

// ============ helper ============

/** Nomor pengajuan berikutnya: RF-YYYY-NNNN (max-suffix, delete-safe). */
async function nextRfNo(db: TenantDb): Promise<string> {
  const yy = String(new Date().getFullYear());
  const start = `RF-${yy}-`;
  let max = 0;
  const rows = await db.referralSubmission.findMany({
    where: { docNo: { startsWith: start } },
    select: { docNo: true },
    take: 1000,
  });
  for (const r of rows) {
    const n = parseInt(r.docNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(4, "0")}`;
}

/** Awal bulan kalender berjalan (window anti-abuse). */
function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Info lowongan ringkas utk map hasil lookup. */
interface OpeningInfo { id: string; title: string; joRefNo: string }

/** Map baris db → baris JSON (verifier + lowongan diselesaikan via lookup terpisah). */
function stagingRow(s: SubmissionWithRefs, verifierNames: Map<string, string>, openings: Map<string, OpeningInfo>): ReferralSubmissionRow {
  return {
    id: s.id,
    docNo: s.docNo,
    referrer: { employeeNo: s.referrer.employeeNo, fullName: s.referrer.fullName },
    jobOpening: s.jobOpeningId ? (openings.get(s.jobOpeningId) ?? null) : null,
    candidateName: s.candidateName,
    candidateEmail: s.candidateEmail,
    candidatePhone: s.candidatePhone,
    note: s.note,
    status: s.status,
    verifyNote: s.verifyNote,
    verifiedBy: s.verifiedById ? (verifierNames.get(s.verifiedById) ?? null) : null,
    verifiedAt: s.verifiedAt ? s.verifiedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Selesaikan nama karyawan verifier (verifiedById tanpa relasi di schema). */
async function verifierNamesOf(db: TenantDb, rows: SubmissionWithRefs[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.verifiedById).filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map();
  const emps = await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  return new Map(emps.map((e) => [e.id, e.fullName]));
}

/** Selesaikan info lowongan (jobOpeningId tanpa relasi di schema — lookup manual). */
async function openingsOf(db: TenantDb, ids: string[]): Promise<Map<string, OpeningInfo>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const slots = await db.jobOpening.findMany({
    where: { id: { in: uniq } },
    select: { id: true, titleToShow: true, jobOpportunity: { select: { refNo: true } } },
  });
  return new Map(slots.map((s) => [s.id, { id: s.id, title: s.titleToShow, joRefNo: s.jobOpportunity.refNo }]));
}

// ============ SUBMIT (ESS) ============

export interface ReferralSubmitInput {
  employeeId: string;
  jobOpeningId?: string | null;
  candidateName: string;
  candidateEmail?: string | null;
  candidatePhone?: string | null;
  note?: string | null;
}

export async function submitReferral(
  db: TenantDb,
  input: ReferralSubmitInput,
  actor: ReferralSubmissionActor,
): Promise<ReferralSubmissionRow> {
  // ---- karyawan perujuk (self-scope — id dari sesi ESS) ----
  const employee = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, employeeNo: true, fullName: true },
  });
  if (!employee) throw new ReferralSubmissionNotFoundError("Karyawan perujuk tidak ditemukan");

  // ---- validasi kandidat ----
  const name = input.candidateName?.trim() ?? "";
  if (name.length < 3) throw new ReferralSubmissionBadRequestError("Nama kandidat minimal 3 karakter");

  const email = input.candidateEmail?.trim() ?? "";
  const phone = input.candidatePhone?.trim() ?? "";
  if (!email && !phone) throw new ReferralSubmissionBadRequestError("Isi minimal satu kontak kandidat: email atau nomor WA/telepon");
  if (email && !EMAIL_RE.test(email)) throw new ReferralSubmissionBadRequestError(`Format email kandidat tidak valid: ${email}`);
  if (phone) {
    // 8–15 digit (izinkan prefiks +62 / 0 — spasi/dash/titik dipangkas)
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      throw new ReferralSubmissionBadRequestError("Nomor WA/telepon kandidat harus 8–15 digit (mis. 0812… atau +62…)");
    }
  }

  const note = input.note?.trim() ?? "";
  if (note.length > REFERRAL_NOTE_MAX) {
    throw new ReferralSubmissionBadRequestError(`Catatan maksimal ${REFERRAL_NOTE_MAX} karakter (terima ${note.length})`);
  }

  // ---- lowongan opsional: harus ada + JO-nya Posted ----
  let jo: { id: string; titleToShow: string; jobOpportunity: { refNo: string } } | null = null;
  const jobOpeningId = input.jobOpeningId?.trim() || null;
  if (jobOpeningId) {
    const found = await db.jobOpening.findUnique({
      where: { id: jobOpeningId },
      select: { id: true, titleToShow: true, jobOpportunity: { select: { refNo: true, status: true } } },
    });
    if (!found) throw new ReferralSubmissionBadRequestError("Lowongan tidak ditemukan");
    if (found.jobOpportunity.status !== "Posted") {
      throw new ReferralSubmissionBadRequestError(`Lowongan "${found.titleToShow}" sudah tidak dipublikasikan (status JO bukan Posted)`);
    }
    jo = { id: found.id, titleToShow: found.titleToShow, jobOpportunity: { refNo: found.jobOpportunity.refNo } };
  }

  // ---- anti-abuse: ≥10 Submitted bulan ini → 429 ----
  const monthCount = await db.referralSubmission.count({
    where: { referrerEmployeeId: employee.id, status: "Submitted", createdAt: { gte: startOfMonth() } },
  });
  if (monthCount >= REFERRAL_MONTHLY_CAP) {
    throw new ReferralSubmissionRateLimitError(
      `Batas pengajuan referral tercapai (maksimal ${REFERRAL_MONTHLY_CAP} per bulan) — coba lagi bulan depan`,
    );
  }

  // ---- duplicate guard: karyawan sama + nama+email sama (case-insens) di Submitted ----
  const dupWhere: Prisma.ReferralSubmissionWhereInput = {
    referrerEmployeeId: employee.id,
    status: "Submitted",
    candidateName: { equals: name, mode: "insensitive" },
    candidateEmail: email ? { equals: email, mode: "insensitive" } : null,
  };
  const dup = await db.referralSubmission.findFirst({ where: dupWhere, select: { docNo: true } });
  if (dup) {
    throw new ReferralSubmissionConflictError(
      `Anda sudah mengajukan kandidat dengan nama + email yang sama (${dup.docNo}) yang masih menunggu verifikasi HR`,
    );
  }

  // ---- create + retryOnUnique docNo (P2002 race → nomor baru) ----
  const sub = await retryOnUnique(async () =>
    db.referralSubmission.create({
      data: {
        docNo: await nextRfNo(db),
        referrerEmployeeId: employee.id,
        jobOpeningId: jo?.id ?? null,
        candidateName: name,
        candidateEmail: email || null,
        candidatePhone: phone || null,
        note: note || null,
        status: "Submitted",
      },
      include: SUBMISSION_INCLUDE,
    }),
  );

  // ActivityLog — audit trail; nama perujuk ya, PII kandidat di luar NAMA tidak
  // dimuat (email/WA tidak dituliskan ke log).
  await db.activityLog.create({
    data: {
      action: "Created", entity: "ReferralSubmission", entityId: sub.docNo,
      detail:
        `Pengajuan referral ${sub.docNo} oleh karyawan ${employee.fullName} (${employee.employeeNo})` +
        `${jo ? ` utk lowongan "${jo.titleToShow}" (${jo.jobOpportunity.refNo})` : ""} — kandidat "${name}" (${actor.name}) menunggu verifikasi HR`,
    },
  });

  return stagingRow(sub, new Map(), jo ? new Map([[jo.id, { id: jo.id, title: jo.titleToShow, joRefNo: jo.jobOpportunity.refNo }]]) : new Map());
}

// ============ STAGING LIST + DETAIL (HR) ============

export interface ReferralStagingOptions {
  status?: string | null;
  q?: string | null;
  jobOpeningId?: string | null;
}

export async function listReferralSubmissions(
  db: TenantDb,
  opts: ReferralStagingOptions,
): Promise<{ rows: ReferralSubmissionRow[]; stats: { total: number; submitted: number; verified: number; rejected: number; duplicate: number } }> {
  const where: Prisma.ReferralSubmissionWhereInput = {};
  if (opts.status && (REFERRAL_SUB_STATUSES as readonly string[]).includes(opts.status)) where.status = opts.status;
  if (opts.jobOpeningId) where.jobOpeningId = opts.jobOpeningId;
  const q = opts.q?.trim();
  if (q) {
    where.OR = [
      { docNo: { contains: q, mode: "insensitive" } },
      { candidateName: { contains: q, mode: "insensitive" } },
      { referrer: { is: { fullName: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [rows, group] = await Promise.all([
    db.referralSubmission.findMany({ where, include: SUBMISSION_INCLUDE, orderBy: { createdAt: "desc" }, take: STAGING_TAKE }),
    db.referralSubmission.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const st = (s: string) => group.find((g) => g.status === s)?._count._all ?? 0;
  const verifierNames = await verifierNamesOf(db, rows);
  const openings = await openingsOf(db, rows.map((r) => r.jobOpeningId ?? ""));

  return {
    rows: rows.map((r) => stagingRow(r, verifierNames, openings)),
    stats: {
      total: group.reduce((n, g) => n + g._count._all, 0),
      submitted: st("Submitted"), verified: st("Verified"), rejected: st("Rejected"), duplicate: st("Duplicate"),
    },
  };
}

/** Detail satu pengajuan (HR) — null bila tidak ada. */
export async function getReferralSubmission(db: TenantDb, id: string): Promise<ReferralSubmissionRow | null> {
  const s = await db.referralSubmission.findUnique({ where: { id }, include: SUBMISSION_INCLUDE });
  if (!s) return null;
  const [verifierNames, openings] = await Promise.all([
    verifierNamesOf(db, [s]),
    openingsOf(db, [s.jobOpeningId ?? ""]),
  ]);
  return stagingRow(s, verifierNames, openings);
}

// ============ VERIFY (HR staging → Applicant) ============

export interface ReferralVerifyInput {
  id: string;
  actor: ReferralSubmissionActor;
  /** default true — false = tandai Verified tanpa membuat Applicant (opsi API). */
  createApplicant?: boolean;
}

export async function verifyReferralSubmission(
  db: TenantDb,
  input: ReferralVerifyInput,
): Promise<{ status: ReferralSubStatus; applicantNo: string | null; row: ReferralSubmissionRow }> {
  const sub = await db.referralSubmission.findUnique({ where: { id: input.id }, include: SUBMISSION_INCLUDE });
  if (!sub) throw new ReferralSubmissionNotFoundError("Pengajuan referral tidak ditemukan");
  if (sub.status !== "Submitted") {
    throw new ReferralSubmissionConflictError(`Pengajuan ${sub.docNo} sudah diproses (${sub.status})`);
  }

  // ---- dedupe by email (blind index emailHash — persis verifyPublicApplication M2) ----
  const tc = tenantCryptoForDb(db);
  const normEmail = sub.candidateEmail?.trim().toLowerCase() || null;
  const existing = normEmail
    ? await db.applicant.findFirst({ where: { emailHash: tc.blindIndex(normEmail) }, select: { id: true, applicantNo: true } }).catch(() => null)
    : null;

  if (existing) {
    // DUPLICATE — kandidat sudah ada di talent pool; TIDAK membuat pelamar baru.
    const verifyNote = `Kandidat sudah terdaftar sebagai pelamar ${existing.applicantNo} (email sama) — tidak dibuat pelamar baru.`;
    await db.referralSubmission.update({
      where: { id: sub.id },
      data: { status: "Duplicate", verifyNote, verifiedById: input.actor.employeeId ?? null, verifiedAt: new Date() },
    });
    await db.activityLog.create({
      data: {
        action: "Duplicate", entity: "ReferralSubmission", entityId: sub.docNo,
        detail:
          `Pengajuan referral ${sub.docNo} DITANDAI DUPLIKAT oleh ${input.actor.name} — kandidat "${sub.candidateName}" sudah terdaftar sebagai pelamar ${existing.applicantNo} (email cocok blind-index); TIDAK dibuat pelamar baru`,
      },
    });
    // notifikasi in-app perujuk (deep-link ESS referral saya)
    void notifyEvent(db, {
      to: "employee", employeeId: sub.referrerEmployeeId, docType: "ReferralSubmission", docNo: sub.docNo,
      title: `Referral sudah terdaftar — ${sub.candidateName}`,
      body: `Pengajuan ${sub.docNo}: kandidat sudah ada di talent pool sebagai pelamar ${existing.applicantNo}, jadi tidak dibuat pelamar baru.`,
      kind: "recruitment", link: "ess:my-referrals",
    }).catch(() => {});

    const row = await getReferralSubmission(db, sub.id);
    if (!row) throw new ReferralSubmissionNotFoundError("Pengajuan referral tidak ditemukan");
    return { status: "Duplicate", applicantNo: existing.applicantNo, row };
  }

  // ---- verify → create Applicant (jalur produksi createApplicant — persis
  // verifyPublicApplication: applicantNo APP-YY-##### + retryOnUnique, PII
  // email/phone terenkripsi + emailHash blind index, consent, ActivityLog) ----
  let applicantNo: string | null = null;
  if (input.createApplicant !== false) {
    const applicant = await createApplicant(db, {
      firstName: sub.candidateName.trim(),
      source: "Referral",
      referralEmployeeId: sub.referrerEmployeeId,
      referralNote: sub.note,
      email: sub.candidateEmail,
      phone: sub.candidatePhone,
    }, `${input.actor.name} (verifikasi referral ${sub.docNo})`);
    applicantNo = applicant.applicantNo;
  }

  // info lowongan utk jejak ActivityLog (jobOpeningId tanpa relasi — lookup)
  const joInfo = sub.jobOpeningId ? (await openingsOf(db, [sub.jobOpeningId])).get(sub.jobOpeningId) ?? null : null;

  const verifyNote = applicantNo ? `Kandidat masuk talent pool sebagai pelamar ${applicantNo} (source Referral).` : "Diverifikasi tanpa membuat pelamar baru.";
  await db.referralSubmission.update({
    where: { id: sub.id },
    data: { status: "Verified", verifyNote, verifiedById: input.actor.employeeId ?? null, verifiedAt: new Date() },
  });
  await db.activityLog.create({
    data: {
      action: "Verified", entity: "ReferralSubmission", entityId: sub.docNo,
      detail:
        `Pengajuan referral ${sub.docNo} DIVERIFIKASI oleh ${input.actor.name} → pelamar ${applicantNo ?? "(tanpa pelamar)"}` +
        ` (source Referral, perujuk ${sub.referrer.fullName} ${sub.referrer.employeeNo}${joInfo ? `, lowongan "${joInfo.title}" (${joInfo.joRefNo})` : ""})`,
    },
  });
  void notifyEvent(db, {
    to: "employee", employeeId: sub.referrerEmployeeId, docType: "ReferralSubmission", docNo: sub.docNo,
    title: `Referral terverifikasi — ${sub.candidateName}`,
    body: `Pengajuan ${sub.docNo} telah diverifikasi HR${applicantNo ? ` — kandidat tercatat sebagai pelamar ${applicantNo} di talent pool` : ""}. Terima kasih telah merujuk!`,
    kind: "recruitment", link: "ess:my-referrals",
  }).catch(() => {});

  const row = await getReferralSubmission(db, sub.id);
  if (!row) throw new ReferralSubmissionNotFoundError("Pengajuan referral tidak ditemukan");
  return { status: "Verified", applicantNo, row };
}

// ============ REJECT (HR staging) ============

export async function rejectReferralSubmission(
  db: TenantDb,
  input: { id: string; note: string | null | undefined; actor: ReferralSubmissionActor },
): Promise<{ row: ReferralSubmissionRow }> {
  const sub = await db.referralSubmission.findUnique({ where: { id: input.id }, include: SUBMISSION_INCLUDE });
  if (!sub) throw new ReferralSubmissionNotFoundError("Pengajuan referral tidak ditemukan");
  if (sub.status !== "Submitted") {
    throw new ReferralSubmissionConflictError(`Pengajuan ${sub.docNo} sudah diproses (${sub.status})`);
  }
  const note = input.note?.trim() ?? "";
  if (note.length < 10) {
    throw new ReferralSubmissionBadRequestError("Alasan penolakan minimal 10 karakter (diberitahukan ke karyawan perujuk)");
  }

  await db.referralSubmission.update({
    where: { id: sub.id },
    data: { status: "Rejected", verifyNote: note, verifiedById: input.actor.employeeId ?? null, verifiedAt: new Date() },
  });
  await db.activityLog.create({
    data: {
      action: "Rejected", entity: "ReferralSubmission", entityId: sub.docNo,
      detail: `Pengajuan referral ${sub.docNo} DITOLAK oleh ${input.actor.name} — alasan: ${note}`,
    },
  });
  // notifikasi in-app perujuk — copy sopan
  void notifyEvent(db, {
    to: "employee", employeeId: sub.referrerEmployeeId, docType: "ReferralSubmission", docNo: sub.docNo,
    title: `Referral belum bisa dilanjutkan — ${sub.candidateName}`,
    body: `Pengajuan ${sub.docNo} belum bisa dilanjutkan. Catatan HR: ${note}`,
    kind: "recruitment", link: "ess:my-referrals",
  }).catch(() => {});

  const row = await getReferralSubmission(db, sub.id);
  if (!row) throw new ReferralSubmissionNotFoundError("Pengajuan referral tidak ditemukan");
  return { row };
}

// ============ ESS "PENGAJUAN SAYA" (self-scope) ============

export async function myReferralSubmissions(
  db: TenantDb,
  employeeId: string,
): Promise<{ rows: MyReferralSubmissionRow[]; stats: { total: number; submitted: number; verified: number; rejected: number; duplicate: number } }> {
  const where: Prisma.ReferralSubmissionWhereInput = { referrerEmployeeId: employeeId };
  const [rows, group] = await Promise.all([
    db.referralSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, docNo: true, candidateName: true, note: true, status: true, verifyNote: true, createdAt: true, jobOpeningId: true,
      },
    }),
    db.referralSubmission.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const st = (s: string) => group.find((g) => g.status === s)?._count._all ?? 0;
  // jobOpeningId tanpa relasi di schema — judul diselesaikan via lookup manual
  const openings = await openingsOf(db, rows.map((r) => r.jobOpeningId ?? ""));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      candidateName: r.candidateName,
      jobOpening: r.jobOpeningId ? (openings.get(r.jobOpeningId) ?? null) : null,
      note: r.note,
      status: r.status,
      verifyNote: r.verifyNote,
      createdAt: r.createdAt.toISOString(),
      // email/phone kandidat SENGAJA tidak dimuat — minimisasi (submitter sudah tahu).
    })),
    stats: {
      total: group.reduce((n, g) => n + g._count._all, 0),
      submitted: st("Submitted"), verified: st("Verified"), rejected: st("Rejected"), duplicate: st("Duplicate"),
    },
  };
}

// ============ opsi lowongan Posted (form ESS) ============

export async function referralOpenings(db: TenantDb): Promise<ReferralOpeningOption[]> {
  const now = new Date();
  const slots = await db.jobOpening.findMany({
    where: {
      status: "Open",
      jobOpportunity: { status: "Posted", OR: [{ lastAcceptDate: null }, { lastAcceptDate: { gte: now } }] },
    },
    select: { id: true, titleToShow: true, jobOpportunity: { select: { refNo: true } } },
    orderBy: { postedAt: "desc" },
    take: 50,
  });
  return slots.map((s) => ({ id: s.id, title: s.titleToShow, joRefNo: s.jobOpportunity.refNo }));
}
