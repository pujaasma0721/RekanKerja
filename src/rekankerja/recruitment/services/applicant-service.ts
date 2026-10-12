// ============================================================================
// RECRUITMENT F2 — Applicant (talent pool) + PublicApplication staging service
// Sumber: DEVELOPMENT-PLAN-RECRUITMENT.md §7 F2 + §4.2/§4.3 (§2.5,
// ApplicantEngine versi aman + HRX I1 consent).
//
// PII: email/phone/address/city/placeOfBirth/identityNo TERENKRIPSI
// field-crypto (enc:v1:t:…) — decrypt HANYA di batas serializer. List
// menampilkan VERSI TOPENG (mask) demi minimisasi; detail penuh untuk HR.
// Uang: expectedSalary vault (enc:v1:n:…) — decrypt bila moneyVisible (W28).
//
// Kolom turunan highestEduLevel/highestGpa/totalExpMonths dihitung ulang
// pada create/update — query builder talent pool (advance search) tetap
// server-side. Kondisi expectedSalary (terenkripsi) dijalankan dua fase:
// pra-filter id → decrypt in-memory → idIn (paginasi tetap benar).
//
// Outdated: scheduler (job applicant-outdated) membalik status saat
// keepOnFileUntil lewat — idempoten by filter status Active.
// Blacklist/Suspend: WAJIB alasan (guard di sini, bukan UI).
// ============================================================================
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import type { AdvSearch, AdvOp } from "@/rekankerja/shared/lib/adv-search";
import { advPrismaWhere, type AdvServerField } from "@/rekankerja/shared/services/adv-search-server";
import {
  saveAttachment, deleteAttachmentsByEntity, listAttachmentsByEntity,
} from "@/rekankerja/shared/services/attachment-service";
import { notifyEmailEvent } from "@/rekankerja/shared/services/email-service";
import { getRecruitmentSetting } from "@/rekankerja/recruitment/services/recruitment-setting-service";
import { emitWebhookEvent } from "@/rekankerja/recruitment/services/webhook-service";

// ============ konstanta domain ============

export const APPLICANT_STATUSES = ["Active", "Rejected", "Outdated", "Employed"] as const;
export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number];

export const APPLICANT_SOURCES = ["Advertisement", "Agency", "Referral", "Web", "Internal", "Other"] as const;

/** Level pendidikan berurut (rank utk "tertinggi"). */
export const EDU_LEVELS = ["SMP", "SMA", "SMK", "D3", "S1", "S2", "S3", "PROF"] as const;
const EDU_RANK: Record<string, number> = { SMP: 1, SMA: 2, SMK: 2, D3: 3, S1: 4, S2: 5, S3: 6, PROF: 6 };

export const SKILL_LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;

export const APPLICATION_STATUSES = ["Received", "Screening", "Rejected", "Hired"] as const;

export const PA_STATUSES = ["Pending", "Verified", "Rejected", "Spam"] as const;

/** Versi teks consent publik (naikkan saat teks berubah — versioned). */
export const CONSENT_VERSION = "2026-01";

// ---- query builder talent pool (server-side whitelist) ----
// expectedSalary = dua-fase (terenkripsi) — TIDAK lewat advPrismaWhere.
const APPLICANT_ADV_FIELDS: Record<string, AdvServerField> = {
  applicantNo: { path: "applicantNo", type: "text" },
  status: { path: "status", type: "select" },
  source: { path: "source", type: "select" },
  gender: { path: "gender", type: "select" },
  birthDate: { path: "birthDate", type: "date" },
  keepOnFileUntil: { path: "keepOnFileUntil", type: "date" },
  dateApplied: { path: "dateApplied", type: "date" },
  educationLevel: { path: "highestEduLevel", type: "select" },
  gpa: { path: "highestGpa", type: "number" },
  fieldOfStudy: { path: "educations[].fieldOfStudy", type: "text" },
  institution: { path: "educations[].institution", type: "text" },
  totalExpMonths: { path: "totalExpMonths", type: "number" },
  skill: { path: "skills[].skill.name", type: "text" },
  referral: { path: "referralEmployee.fullName", type: "text" },
  institutionName: { path: "institutionName", type: "text" },
};

/** Whitelist sort server-side (bentuk ARRAY). */
const APPLICANT_SORT: Record<string, Prisma.ApplicantOrderByWithRelationInput[]> = {
  applicantNo: [{ applicantNo: "asc" }],
  dateApplied: [{ dateApplied: "asc" }],
  status: [{ status: "asc" }],
  firstName: [{ firstName: "asc" }],
  source: [{ source: "asc" }],
  totalExpMonths: [{ totalExpMonths: "asc" }],
  keepOnFileUntil: [{ keepOnFileUntil: "asc" }],
};

// ============ tipe ============

export interface EduInput { level: string; fieldOfStudy?: string | null; institution?: string | null; graduationYear?: number | null; gpa?: number | null }
export interface ExpInput { company?: string | null; position?: string | null; field?: string | null; startYear?: number | null; endYear?: number | null; months?: number | null }
export interface SkillInput { skillId: string; level?: string | null }

export interface ApplicantInput {
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  status?: string;
  dateApplied?: string | null;
  dateAvailable?: string | null;
  expectedSalary?: number | null;
  keepOnFileMonths?: number;
  source?: string | null;
  adMediaTypeId?: string | null;
  agencyId?: string | null;
  institutionName?: string | null;
  referralEmployeeId?: string | null;
  // PII (plain di input — dienkripsi saat disimpan)
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  placeOfBirth?: string | null;
  identityNo?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  notes?: string | null;
  educations?: EduInput[];
  experiences?: ExpInput[];
  skills?: SkillInput[];
}

export interface ApplicantRow {
  id: string;
  applicantNo: string;
  fullName: string;
  firstName: string; middleName: string | null; lastName: string | null; displayName: string | null;
  status: ApplicantStatus;
  blacklist: boolean;
  suspend: boolean;
  source: string | null;
  sourceLabel: string | null;
  dateApplied: string;
  dateAvailable: string | null;
  keepOnFileMonths: number;
  keepOnFileUntil: string | null;
  /** topeng (list) — detail penuh via getApplicant. */
  emailMasked: string | null;
  phoneMasked: string | null;
  city: string | null; // kota termasuk PII ringan — topeng di client
  birthDate: string | null;
  gender: string | null;
  highestEduLevel: string | null;
  highestGpa: number | null;
  totalExpMonths: number;
  /** null bila vault menyembunyikan — TIDAK pernah string cipher. */
  expectedSalary: number | null;
  applicationCount: number;
  referralName: string | null;
}

export interface ApplicantDetail extends ApplicantRow {
  email: string | null;
  phone: string | null;
  address: string | null;
  placeOfBirth: string | null;
  identityNoMasked: string | null;
  maritalStatus: string | null;
  notes: string | null;
  adMediaName: string | null;
  agencyName: string | null;
  institutionName: string | null;
  blacklistNote: string | null; blacklistAt: string | null;
  suspendNote: string | null; suspendUntil: string | null;
  educations: { id: string; level: string; fieldOfStudy: string | null; institution: string | null; graduationYear: number | null; gpa: number | null }[];
  experiences: { id: string; company: string | null; position: string | null; field: string | null; startYear: number | null; endYear: number | null; months: number | null }[];
  skills: { id: string; skillId: string; skillName: string; level: string | null }[];
  documents: { id: string; title: string; requiredDocumentId: string | null; requiredDocTitle: string | null; requiredDocMandatory: boolean; verified: boolean; attachmentId: string | null; fileName: string | null; sizeBytes: number | null }[];
  applications: { id: string; jobOpeningId: string; dateApplied: string; status: string; sourceNote: string | null; slotTitle: string | null; joRefNo: string | null; joStatus: string | null }[];
  consents: { id: string; purpose: string; version: string; grantedAt: string; withdrawnAt: string | null; channel: string }[];
}

export interface ApplicantStats {
  total: number; active: number; outdated: number; rejected: number; employed: number;
  blacklisted: number; suspended: number; stagingPending: number;
}

// ============ helper ============

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 1) return "•••@***";
  return `${email.slice(0, 2)}•••${email.slice(at)}`;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `${digits.slice(0, 4)}•••${digits.slice(-3)}`;
}

function maskIdNo(no: string | null): string | null {
  if (!no) return null;
  return no.length <= 4 ? "••••" : `${no.slice(0, 2)}••••${no.slice(-2)}`;
}

export function fullNameOf(a: { firstName: string; middleName?: string | null; lastName?: string | null; displayName?: string | null }): string {
  return a.displayName?.trim() || [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ").trim();
}

/** Hitung kolom turunan dari input education/experience. */
function deriveHighest(eds: EduInput[]): { level: string | null; gpa: number | null } {
  let best: { level: string | null; gpa: number | null; rank: number } | null = null;
  for (const e of eds) {
    const rank = EDU_RANK[e.level] ?? 0;
    if (!best || rank > best.rank || (rank === best.rank && (e.gpa ?? 0) > (best.gpa ?? 0))) {
      best = { level: rank > 0 ? e.level : null, gpa: e.gpa ?? null, rank };
    }
  }
  return { level: best?.level ?? null, gpa: best?.gpa ?? null };
}

function deriveExpMonths(exps: ExpInput[]): number {
  return exps.reduce((a, e) => {
    if (e.months != null && e.months > 0) return a + Math.round(e.months);
    if (e.startYear != null) {
      const end = e.endYear ?? new Date().getFullYear();
      return a + Math.max(0, end - e.startYear) * 12;
    }
    return a;
  }, 0);
}

function keepUntil(dateApplied: Date, months: number): Date {
  const d = new Date(dateApplied);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Nomor pelamar berikutnya: APP-YY-NNNNN (max-suffix, delete-safe). */
export async function nextApplicantNo(db: TenantDb): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const start = `APP-${yy}-`;
  let max = 0;
  const rows = await db.applicant.findMany({
    where: { applicantNo: { startsWith: start } },
    select: { applicantNo: true },
    take: 1000,
  });
  for (const r of rows) {
    const n = parseInt(r.applicantNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(5, "0")}`;
}

const APPLICANT_LIST_INCLUDE = {
  referralEmployee: { select: { fullName: true } },
  _count: { select: { applications: true } },
} satisfies Prisma.ApplicantInclude;

function applicantRow(a: Prisma.ApplicantGetPayload<{ include: typeof APPLICANT_LIST_INCLUDE }>, moneyVisible: boolean, tc: ReturnType<typeof tenantCryptoForDb>): ApplicantRow {
  return {
    id: a.id,
    applicantNo: a.applicantNo,
    fullName: fullNameOf(a),
    firstName: a.firstName, middleName: a.middleName, lastName: a.lastName, displayName: a.displayName,
    status: a.status as ApplicantStatus,
    blacklist: a.blacklist,
    suspend: a.suspend,
    source: a.source,
    sourceLabel: a.source,
    dateApplied: a.dateApplied.toISOString(),
    dateAvailable: iso(a.dateAvailable),
    keepOnFileMonths: a.keepOnFileMonths,
    keepOnFileUntil: iso(a.keepOnFileUntil),
    emailMasked: maskEmail(tc.decryptText(a.email)),
    phoneMasked: maskPhone(tc.decryptText(a.phone)),
    city: tc.decryptText(a.city),
    birthDate: iso(a.birthDate),
    gender: a.gender,
    highestEduLevel: a.highestEduLevel,
    highestGpa: a.highestGpa,
    totalExpMonths: a.totalExpMonths,
    expectedSalary: moneyVisible && a.expectedSalary ? (tc.decryptMoney(a.expectedSalary) ?? null) : null,
    applicationCount: a._count.applications,
    referralName: a.referralEmployee?.fullName ?? null,
  };
}

// ============ query (list + query builder dua fase) ============

export interface ListApplicantOptions {
  status?: string | null;
  q?: string | null;
  adv?: AdvSearch | null;
  limit?: number;
  offset?: number;
  sortBy?: string | null;
  sortDir?: string | null;
  moneyVisible?: boolean;
}

function cmpNum(v: number, op: AdvOp, a?: string, b?: string): boolean {
  const x = parseFloat(a ?? "");
  const y = parseFloat(b ?? "");
  switch (op) {
    case "eq": return Number.isFinite(x) && v === x;
    case "ne": return Number.isFinite(x) && v !== x;
    case "gt": return Number.isFinite(x) && v > x;
    case "gte": return Number.isFinite(x) && v >= x;
    case "lt": return Number.isFinite(x) && v < x;
    case "lte": return Number.isFinite(x) && v <= x;
    case "between": return Number.isFinite(x) && Number.isFinite(y) && v >= x && v <= y;
    default: return true;
  }
}

export async function listApplicants(
  db: TenantDb, opts: ListApplicantOptions,
): Promise<{ rows: ApplicantRow[]; total: number; stats: ApplicantStats }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const moneyVisible = opts.moneyVisible ?? false;
  const tc = tenantCryptoForDb(db);

  const where: Prisma.ApplicantWhereInput = {};
  // F9 — "Anonymized" sah sbg FILTER list (bukan input create — di luar
  // APPLICANT_STATUSES supaya HR tidak bisa membuat pelamar Anonymized manual)
  const listStatuses = [...APPLICANT_STATUSES, "Anonymized"] as const;
  if (opts.status && (listStatuses as readonly string[]).includes(opts.status)) where.status = opts.status;
  const q = opts.q?.trim();
  if (q) {
    where.OR = [
      { applicantNo: { contains: q, mode: "insensitive" } },
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { displayName: { contains: q, mode: "insensitive" } },
      { institutionName: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  // pisahkan kondisi expectedSalary (terenkripsi — dua fase) dari adv lain
  const salaryCond = opts.adv?.conds.find((c) => c.field === "expectedSalary") ?? null;
  const advRest: AdvSearch | null = opts.adv
    ? { match: opts.adv.match, conds: opts.adv.conds.filter((c) => c.field !== "expectedSalary") }
    : null;
  const hasOthers = advRest && advRest.conds.length > 0;
  if (hasOthers) {
    const w = advPrismaWhere(advRest, APPLICANT_ADV_FIELDS);
    if (w) where.AND = [where.AND, w].filter(Boolean) as Prisma.ApplicantWhereInput[];
  }

  // fase-1 expectedSalary: id yang cocok (decrypt in-memory)
  let salaryIds: string[] | null = null;
  if (salaryCond && salaryCond.op !== "empty" && salaryCond.op !== "notEmpty") {
    const candidates = await db.applicant.findMany({
      where: { ...where, expectedSalary: { not: null } },
      select: { id: true, expectedSalary: true },
    });
    salaryIds = candidates
      .filter((r) => cmpNum(tc.decryptMoney(r.expectedSalary) ?? NaN, salaryCond.op, salaryCond.value, salaryCond.value2))
      .map((r) => r.id);
  }

  let finalWhere = where;
  if (salaryIds) {
    // match=all → irisan; match=any (dengan kondisi lain) → union id
    if (hasOthers && opts.adv?.match === "any") {
      const others = await db.applicant.findMany({ where, select: { id: true } });
      const union = new Set([...others.map((o) => o.id), ...salaryIds]);
      finalWhere = { ...baseWhere(where), id: { in: [...union] } };
    } else {
      finalWhere = { ...baseWhere(where), id: { in: salaryIds } };
    }
  }

  const sortBy = opts.sortBy && APPLICANT_SORT[opts.sortBy] ? APPLICANT_SORT[opts.sortBy]! : APPLICANT_SORT.applicantNo!;
  const order: Prisma.ApplicantOrderByWithRelationInput[] = opts.sortDir === "desc"
    ? sortBy.map((s) => reverseOrder(s) as Prisma.ApplicantOrderByWithRelationInput)
    : sortBy;

  const [rows, total, groupStatus, bl, sus, pending] = await Promise.all([
    db.applicant.findMany({ where: finalWhere, include: APPLICANT_LIST_INCLUDE, orderBy: order, take: limit, skip: offset }),
    db.applicant.count({ where: finalWhere }),
    db.applicant.groupBy({ by: ["status"], _count: { _all: true } }),
    db.applicant.count({ where: { blacklist: true } }),
    db.applicant.count({ where: { suspend: true } }),
    db.publicApplication.count({ where: { status: "Pending" } }),
  ]);
  const st = (s: string) => groupStatus.find((g) => g.status === s)?._count._all ?? 0;

  return {
    rows: rows.map((r) => applicantRow(r, moneyVisible, tc)),
    total,
    stats: {
      total: groupStatus.reduce((a, g) => a + g._count._all, 0),
      active: st("Active"), outdated: st("Outdated"), rejected: st("Rejected"), employed: st("Employed"),
      blacklisted: bl, suspended: sus, stagingPending: pending,
    },
  };
}

/** where tanpa kunci AND adv (untuk fase-2 union). */
function baseWhere(w: Prisma.ApplicantWhereInput): Prisma.ApplicantWhereInput {
  const { AND: _drop, ...rest } = w;
  void _drop;
  return rest;
}

/** Balik arah order rekursif. */
function reverseOrder(o: Prisma.ApplicantOrderByWithRelationInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = reverseOrder(v as Prisma.ApplicantOrderByWithRelationInput);
    else if (v === "asc") out[k] = "desc";
    else if (v === "desc") out[k] = "asc";
    else out[k] = v;
  }
  return out;
}

const APPLICANT_DETAIL_INCLUDE = {
  referralEmployee: { select: { fullName: true } },
  adMediaType: { select: { name: true } },
  agency: { select: { name: true } },
  _count: { select: { applications: true } },
  educations: true,
  experiences: true,
  skills: { include: { skill: { select: { name: true } } } },
  documents: {
    include: {
      requiredDocument: { select: { title: true, mandatory: true } },
      attachment: { select: { fileName: true, sizeBytes: true, mimeType: true } },
    },
  },
  applications: {
    include: { jobOpening: { include: { jobOpportunity: { select: { refNo: true, status: true } } } } },
    orderBy: { dateApplied: "desc" as const },
  },
  consents: { orderBy: { grantedAt: "desc" as const } },
} satisfies Prisma.ApplicantInclude;

export async function getApplicant(db: TenantDb, id: string, moneyVisible: boolean): Promise<ApplicantDetail | null> {
  const a = await db.applicant.findUnique({ where: { id }, include: APPLICANT_DETAIL_INCLUDE });
  if (!a) return null;
  const tc = tenantCryptoForDb(db);
  return {
    ...applicantRow(a, moneyVisible, tc),
    email: tc.decryptText(a.email),
    phone: tc.decryptText(a.phone),
    address: tc.decryptText(a.address),
    placeOfBirth: tc.decryptText(a.placeOfBirth),
    identityNoMasked: maskIdNo(tc.decryptText(a.identityNo)),
    maritalStatus: a.maritalStatus,
    notes: a.notes,
    adMediaName: a.adMediaType?.name ?? null,
    agencyName: a.agency?.name ?? null,
    institutionName: a.institutionName,
    blacklistNote: a.blacklistNote, blacklistAt: iso(a.blacklistAt),
    suspendNote: a.suspendNote, suspendUntil: iso(a.suspendUntil),
    educations: a.educations.map((e) => ({ id: e.id, level: e.level, fieldOfStudy: e.fieldOfStudy, institution: e.institution, graduationYear: e.graduationYear, gpa: e.gpa })),
    experiences: a.experiences.map((e) => ({ id: e.id, company: e.company, position: e.position, field: e.field, startYear: e.startYear, endYear: e.endYear, months: e.months })),
    skills: a.skills.map((s) => ({ id: s.id, skillId: s.skillId, skillName: s.skill.name, level: s.level })),
    documents: a.documents.map((d) => ({
      id: d.id, title: d.title, requiredDocumentId: d.requiredDocumentId,
      requiredDocTitle: d.requiredDocument?.title ?? null, requiredDocMandatory: d.requiredDocument?.mandatory ?? false,
      verified: d.verified, attachmentId: d.attachmentId,
      fileName: d.attachment?.fileName ?? null, sizeBytes: d.attachment?.sizeBytes ?? null,
    })),
    applications: a.applications.map((ap) => ({
      id: ap.id, jobOpeningId: ap.jobOpeningId, dateApplied: ap.dateApplied.toISOString(),
      status: ap.status, sourceNote: ap.sourceNote,
      slotTitle: ap.jobOpening.titleToShow, joRefNo: ap.jobOpening.jobOpportunity.refNo, joStatus: ap.jobOpening.jobOpportunity.status,
    })),
    consents: a.consents.map((c) => ({ id: c.id, purpose: c.purpose, version: c.version, grantedAt: c.grantedAt.toISOString(), withdrawnAt: iso(c.withdrawnAt), channel: c.channel })),
  };
}

// ============ mutasi ============

/** Buat pelamar (input manual HR — channel consent "manual"). */
export async function createApplicant(
  db: TenantDb, input: ApplicantInput, actorName?: string | null,
): Promise<ApplicantRow> {
  const firstName = input.firstName?.trim();
  if (!firstName) throw new Error("Nama depan pelamar wajib diisi");
  const status = input.status && APPLICANT_STATUSES.includes(input.status as ApplicantStatus) ? input.status : "Active";
  if (input.expectedSalary != null && input.expectedSalary < 0) throw new Error("Ekspektasi gaji tidak boleh negatif");

  const tc = tenantCryptoForDb(db);
  const educations = (input.educations ?? []).filter((e) => e.level);
  const experiences = (input.experiences ?? []).filter((e) => e.company || e.position || e.startYear != null);
  const skills = (input.skills ?? []).filter((s) => s.skillId);
  const highest = deriveHighest(educations);
  const dateApplied = input.dateApplied ? new Date(input.dateApplied) : new Date();
  const keepMonths = Math.min(Math.max(input.keepOnFileMonths ?? 12, 1), 120);

  const a = await db.applicant.create({
    data: {
      applicantNo: await nextApplicantNo(db),
      firstName, middleName: input.middleName?.trim() || null, lastName: input.lastName?.trim() || null,
      displayName: input.displayName?.trim() || null,
      status,
      dateApplied,
      dateAvailable: input.dateAvailable ? new Date(input.dateAvailable) : null,
      expectedSalary: input.expectedSalary != null && input.expectedSalary > 0 ? tc.encryptMoney(input.expectedSalary) : null,
      keepOnFileMonths: keepMonths,
      keepOnFileUntil: keepUntil(dateApplied, keepMonths),
      source: input.source ?? null,
      adMediaTypeId: input.adMediaTypeId || null,
      agencyId: input.agencyId || null,
      institutionName: input.institutionName?.trim() || null,
      referralEmployeeId: input.referralEmployeeId || null,
      email: input.email?.trim() ? tc.encryptText(input.email.trim()) : null,
      phone: input.phone?.trim() ? tc.encryptText(input.phone.trim()) : null,
      address: input.address?.trim() ? tc.encryptText(input.address.trim()) : null,
      city: input.city?.trim() ? tc.encryptText(input.city.trim()) : null,
      placeOfBirth: input.placeOfBirth?.trim() ? tc.encryptText(input.placeOfBirth.trim()) : null,
      identityNo: input.identityNo?.trim() ? tc.encryptText(input.identityNo.trim()) : null,
      birthDate: input.birthDate ? new Date(input.birthDate) : null,
      gender: input.gender || null,
      maritalStatus: input.maritalStatus || null,
      notes: input.notes?.trim() || null,
      highestEduLevel: highest.level,
      highestGpa: highest.gpa,
      totalExpMonths: deriveExpMonths(experiences),
      educations: { create: educations.map((e) => ({ level: e.level, fieldOfStudy: e.fieldOfStudy?.trim() || null, institution: e.institution?.trim() || null, graduationYear: e.graduationYear ?? null, gpa: e.gpa ?? null })) },
      experiences: { create: experiences.map((e) => ({ company: e.company?.trim() || null, position: e.position?.trim() || null, field: e.field?.trim() || null, startYear: e.startYear ?? null, endYear: e.endYear ?? null, months: e.months ?? null })) },
      skills: { create: skills.map((s) => ({ skillId: s.skillId, level: s.level || null })) },
    },
    include: APPLICANT_LIST_INCLUDE,
  });

  // consent UU PDP — channel manual (input HR)
  await db.applicantConsent.create({
    data: { applicantId: a.id, purpose: "recruitment", version: CONSENT_VERSION, channel: "manual", note: `Input manual oleh ${actorName ?? "HR"}` },
  });

  await db.activityLog.create({
    data: {
      action: "Created", entity: "Applicant", entityId: a.applicantNo,
      detail: `Pelamar ${a.applicantNo} "${fullNameOf(a)}" ditambahkan ke talent pool${actorName ? ` oleh ${actorName}` : ""} — ${educations.length} pendidikan, ${experiences.length} pengalaman, ${skills.length} skill`,
    },
  });
  return applicantRow(a, true, tc);
}

/** Update pelamar — array education/experience/skill diganti penuh (replace). */
export async function updateApplicant(
  db: TenantDb, id: string, input: ApplicantInput, actorName?: string | null,
): Promise<void> {
  const a = await db.applicant.findUnique({ where: { id }, select: { id: true, applicantNo: true, dateApplied: true, keepOnFileMonths: true } });
  if (!a) throw new Error("Pelamar tidak ditemukan");

  const tc = tenantCryptoForDb(db);
  const educations = (input.educations ?? []).filter((e) => e.level);
  const experiences = (input.experiences ?? []).filter((e) => e.company || e.position || e.startYear != null);
  const skills = (input.skills ?? []).filter((s) => s.skillId);
  const highest = deriveHighest(educations);
  const keepMonths = input.keepOnFileMonths != null ? Math.min(Math.max(input.keepOnFileMonths, 1), 120) : a.keepOnFileMonths;
  const dateApplied = input.dateApplied ? new Date(input.dateApplied) : a.dateApplied;

  await db.applicant.update({
    where: { id },
    data: {
      firstName: input.firstName?.trim() || undefined,
      middleName: input.middleName !== undefined ? (input.middleName?.trim() || null) : undefined,
      lastName: input.lastName !== undefined ? (input.lastName?.trim() || null) : undefined,
      displayName: input.displayName !== undefined ? (input.displayName?.trim() || null) : undefined,
      dateApplied,
      dateAvailable: input.dateAvailable !== undefined ? (input.dateAvailable ? new Date(input.dateAvailable) : null) : undefined,
      expectedSalary: input.expectedSalary !== undefined ? (input.expectedSalary != null && input.expectedSalary > 0 ? tc.encryptMoney(input.expectedSalary) : null) : undefined,
      keepOnFileMonths: keepMonths,
      keepOnFileUntil: keepUntil(dateApplied, keepMonths),
      source: input.source !== undefined ? (input.source || null) : undefined,
      adMediaTypeId: input.adMediaTypeId !== undefined ? (input.adMediaTypeId || null) : undefined,
      agencyId: input.agencyId !== undefined ? (input.agencyId || null) : undefined,
      institutionName: input.institutionName !== undefined ? (input.institutionName?.trim() || null) : undefined,
      referralEmployeeId: input.referralEmployeeId !== undefined ? (input.referralEmployeeId || null) : undefined,
      email: input.email !== undefined ? (input.email?.trim() ? tc.encryptText(input.email.trim()) : null) : undefined,
      phone: input.phone !== undefined ? (input.phone?.trim() ? tc.encryptText(input.phone.trim()) : null) : undefined,
      address: input.address !== undefined ? (input.address?.trim() ? tc.encryptText(input.address.trim()) : null) : undefined,
      city: input.city !== undefined ? (input.city?.trim() ? tc.encryptText(input.city.trim()) : null) : undefined,
      placeOfBirth: input.placeOfBirth !== undefined ? (input.placeOfBirth?.trim() ? tc.encryptText(input.placeOfBirth.trim()) : null) : undefined,
      identityNo: input.identityNo !== undefined ? (input.identityNo?.trim() ? tc.encryptText(input.identityNo.trim()) : null) : undefined,
      birthDate: input.birthDate !== undefined ? (input.birthDate ? new Date(input.birthDate) : null) : undefined,
      gender: input.gender !== undefined ? (input.gender || null) : undefined,
      maritalStatus: input.maritalStatus !== undefined ? (input.maritalStatus || null) : undefined,
      notes: input.notes !== undefined ? (input.notes?.trim() || null) : undefined,
      highestEduLevel: highest.level,
      highestGpa: highest.gpa,
      totalExpMonths: deriveExpMonths(experiences),
    },
  });
  // replace arrays
  await db.applicantEducation.deleteMany({ where: { applicantId: id } });
  if (educations.length > 0) {
    await db.applicantEducation.createMany({ data: educations.map((e) => ({ applicantId: id, level: e.level, fieldOfStudy: e.fieldOfStudy?.trim() || null, institution: e.institution?.trim() || null, graduationYear: e.graduationYear ?? null, gpa: e.gpa ?? null })) });
  }
  await db.applicantExperience.deleteMany({ where: { applicantId: id } });
  if (experiences.length > 0) {
    await db.applicantExperience.createMany({ data: experiences.map((e) => ({ applicantId: id, company: e.company?.trim() || null, position: e.position?.trim() || null, field: e.field?.trim() || null, startYear: e.startYear ?? null, endYear: e.endYear ?? null, months: e.months ?? null })) });
  }
  await db.applicantSkill.deleteMany({ where: { applicantId: id } });
  if (skills.length > 0) {
    await db.applicantSkill.createMany({ data: skills.map((s) => ({ applicantId: id, skillId: s.skillId, level: s.level || null })) });
  }
  await db.activityLog.create({
    data: { action: "Updated", entity: "Applicant", entityId: a.applicantNo, detail: `Pelamar ${a.applicantNo} diperbarui${actorName ? ` oleh ${actorName}` : ""}` },
  });
}

/** Blacklist — WAJIB alasan. */
export async function blacklistApplicant(
  db: TenantDb, id: string, note: string, actor: { employeeId?: string | null; name?: string | null },
): Promise<void> {
  const reason = note?.trim();
  if (!reason) throw new Error("Alasan blacklist wajib diisi");
  const a = await db.applicant.findUnique({ where: { id }, select: { applicantNo: true, blacklist: true } });
  if (!a) throw new Error("Pelamar tidak ditemukan");
  if (a.blacklist) throw new Error(`Pelamar ${a.applicantNo} sudah di-blacklist`);
  await db.applicant.update({
    where: { id },
    data: { blacklist: true, blacklistNote: reason, blacklistAt: new Date(), blacklistById: actor.employeeId ?? null },
  });
  await db.activityLog.create({
    data: { action: "Updated", entity: "Applicant", entityId: a.applicantNo, detail: `Pelamar ${a.applicantNo} DI-BLACKLIST — alasan: ${reason}${actor.name ? ` (${actor.name})` : ""}` },
  });
}

/** Lepas blacklist (dengan jejak). */
export async function unblacklistApplicant(db: TenantDb, id: string, actorName?: string | null): Promise<void> {
  const a = await db.applicant.findUnique({ where: { id }, select: { applicantNo: true, blacklist: true, blacklistNote: true } });
  if (!a) throw new Error("Pelamar tidak ditemukan");
  if (!a.blacklist) throw new Error(`Pelamar ${a.applicantNo} tidak dalam blacklist`);
  await db.applicant.update({ where: { id }, data: { blacklist: false, blacklistNote: `…dilepaskan: ${a.blacklistNote ?? ""}` } });
  await db.activityLog.create({
    data: { action: "Updated", entity: "Applicant", entityId: a.applicantNo, detail: `Blacklist pelamar ${a.applicantNo} dilepaskan${actorName ? ` oleh ${actorName}` : ""}` },
  });
}

/** Suspend sementara — WAJIB alasan + sampai kapan. */
export async function suspendApplicant(
  db: TenantDb, id: string, note: string, until: string | null, actorName?: string | null,
): Promise<void> {
  const reason = note?.trim();
  if (!reason) throw new Error("Alasan suspend wajib diisi");
  const a = await db.applicant.findUnique({ where: { id }, select: { applicantNo: true, suspend: true } });
  if (!a) throw new Error("Pelamar tidak ditemukan");
  if (a.suspend) throw new Error(`Pelamar ${a.applicantNo} sudah di-suspend`);
  await db.applicant.update({
    where: { id },
    data: { suspend: true, suspendNote: reason, suspendUntil: until ? new Date(until) : null },
  });
  await db.activityLog.create({
    data: { action: "Updated", entity: "Applicant", entityId: a.applicantNo, detail: `Pelamar ${a.applicantNo} DI-SUSPEND — alasan: ${reason}${until ? ` s.d. ${until}` : ""}${actorName ? ` (${actorName})` : ""}` },
  });
}

export async function unsuspendApplicant(db: TenantDb, id: string, actorName?: string | null): Promise<void> {
  const a = await db.applicant.findUnique({ where: { id }, select: { applicantNo: true, suspend: true } });
  if (!a) throw new Error("Pelamar tidak ditemukan");
  if (!a.suspend) throw new Error(`Pelamar ${a.applicantNo} tidak dalam suspend`);
  await db.applicant.update({ where: { id }, data: { suspend: false, suspendNote: null, suspendUntil: null } });
  await db.activityLog.create({
    data: { action: "Updated", entity: "Applicant", entityId: a.applicantNo, detail: `Suspend pelamar ${a.applicantNo} diakhiri${actorName ? ` oleh ${actorName}` : ""}` },
  });
}

/** Melamar slot (multi-lamar: 1 pelamar → banyak slot; unik per pasangan). */
export async function applyToOpening(
  db: TenantDb, input: { applicantId: string; jobOpeningId: string; sourceNote?: string | null }, actorName?: string | null,
): Promise<{ id: string; slotTitle: string; joRefNo: string }> {
  const a = await db.applicant.findUnique({ where: { id: input.applicantId }, select: { id: true, applicantNo: true, blacklist: true, suspend: true, status: true } });
  if (!a) throw new Error("Pelamar tidak ditemukan");
  if (a.blacklist) throw new Error(`Pelamar ${a.applicantNo} di-blacklist — tidak dapat melamar`);
  if (a.suspend) throw new Error(`Pelamar ${a.applicantNo} di-suspend — tidak dapat melamar`);
  if (a.status === "Employed") throw new Error(`Pelamar ${a.applicantNo} sudah bekerja — tidak perlu melamar lagi`);

  const slot = await db.jobOpening.findUnique({
    where: { id: input.jobOpeningId },
    include: { jobOpportunity: { select: { id: true, refNo: true, status: true } } },
  });
  if (!slot) throw new Error("Slot lowongan tidak ditemukan");
  if (slot.status !== "Open") throw new Error(`Slot ${slot.titleToShow} berstatus ${slot.status}`);
  if (slot.jobOpportunity.status !== "Posted") {
    throw new Error(`Lowongan ${slot.jobOpportunity.refNo} berstatus ${slot.jobOpportunity.status} — tidak menerima lamaran`);
  }

  const dup = await db.applicantApplication.findUnique({
    where: { applicantId_jobOpeningId: { applicantId: input.applicantId, jobOpeningId: input.jobOpeningId } },
    select: { id: true },
  });
  if (dup) throw new Error(`Pelamar ${a.applicantNo} sudah terdaftar melamar slot ini`);

  const app = await db.applicantApplication.create({
    data: {
      applicantId: input.applicantId,
      jobOpeningId: input.jobOpeningId,
      sourceNote: input.sourceNote?.trim() || null,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "ApplicantApplication", entityId: a.applicantNo,
      detail: `Pelamar ${a.applicantNo} melamar slot "${slot.titleToShow}" (${slot.jobOpportunity.refNo})${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
  return { id: app.id, slotTitle: slot.titleToShow, joRefNo: slot.jobOpportunity.refNo };
}

/** Hapus pelamar + dokumen terkait (file fisik ikut dibersihkan). */
export async function deleteApplicant(db: TenantDb, id: string, tenantSlug: string, actorName?: string | null): Promise<{ applicantNo: string }> {
  void tenantSlug;
  const a = await db.applicant.findUnique({ where: { id }, select: { applicantNo: true, firstName: true, middleName: true, lastName: true, displayName: true } });
  if (!a) throw new Error("Pelamar tidak ditemukan");
  const docs = await db.applicantDocument.findMany({ where: { applicantId: id }, select: { id: true } });
  for (const d of docs) {
    // file fisik + baris Attachment (helper tepat — meta tanpa storagePath tidak cukup)
    await deleteAttachmentsByEntity(db, "ApplicantDocument", d.id).catch(() => {});
  }
  await db.applicant.delete({ where: { id } }); // cascade children
  await db.activityLog.create({
    data: { action: "Deleted", entity: "Applicant", entityId: a.applicantNo, detail: `Pelamar ${a.applicantNo} "${fullNameOf(a)}" dihapus dari talent pool${actorName ? ` oleh ${actorName}` : ""}` },
  });
  return { applicantNo: a.applicantNo };
}

// ============ dokumen (upload CV/dokumen pelamar — pattern EmployeeDocument) ============

export async function addApplicantDocument(
  db: TenantDb, tenantSlug: string,
  input: { applicantId: string; requiredDocumentId?: string | null; title: string; file: { buffer: Buffer; fileName: string; mimeType: string }; uploadedBy?: string | null },
): Promise<{ id: string }> {
  const a = await db.applicant.findUnique({ where: { id: input.applicantId }, select: { applicantNo: true } });
  if (!a) throw new Error("Pelamar tidak ditemukan");
  const title = input.title?.trim() || input.file.fileName;
  const doc = await db.applicantDocument.create({
    data: { applicantId: input.applicantId, requiredDocumentId: input.requiredDocumentId || null, title },
  });
  // simpan file via attachment-service (MIME whitelist + magic number + ≤5MB)
  await saveAttachment(db, tenantSlug, {
    file: input.file.buffer, fileName: input.file.fileName, mimeType: input.file.mimeType,
    entityType: "ApplicantDocument", entityId: doc.id, uploadedBy: input.uploadedBy ?? null,
  });
  const atts = await listAttachmentsByEntity(db, "ApplicantDocument", doc.id);
  await db.applicantDocument.update({ where: { id: doc.id }, data: { attachmentId: atts[atts.length - 1]?.id ?? null } });
  await db.activityLog.create({
    data: { action: "Created", entity: "ApplicantDocument", entityId: a.applicantNo, detail: `Dokumen "${title}" diunggah utk pelamar ${a.applicantNo}` },
  });
  return { id: doc.id };
}

export async function deleteApplicantDocument(db: TenantDb, tenantSlug: string, docId: string): Promise<void> {
  void tenantSlug;
  const d = await db.applicantDocument.findUnique({ where: { id: docId }, include: { applicant: { select: { applicantNo: true } } } });
  if (!d) throw new Error("Dokumen tidak ditemukan");
  await deleteAttachmentsByEntity(db, "ApplicantDocument", docId).catch(() => {});
  await db.applicantDocument.delete({ where: { id: docId } });
  await db.activityLog.create({
    data: { action: "Deleted", entity: "ApplicantDocument", entityId: d.applicant.applicantNo, detail: `Dokumen "${d.title}" dihapus dari pelamar ${d.applicant.applicantNo}` },
  });
}

export async function verifyApplicantDocument(db: TenantDb, docId: string, verified: boolean, actorName?: string | null): Promise<void> {
  const d = await db.applicantDocument.findUnique({ where: { id: docId }, include: { applicant: { select: { applicantNo: true } } } });
  if (!d) throw new Error("Dokumen tidak ditemukan");
  await db.applicantDocument.update({ where: { id: docId }, data: { verified } });
  await db.activityLog.create({
    data: { action: "Updated", entity: "ApplicantDocument", entityId: d.applicant.applicantNo, detail: `Dokumen "${d.title}" (${d.applicant.applicantNo}) ${verified ? "diverifikasi" : "verifikasi dibatalkan"}${actorName ? ` oleh ${actorName}` : ""}` },
  });
}

// ============ staging PublicApplication (verifikasi HR) ============

export interface PublicPayload {
  firstName: string; middleName?: string | null; lastName?: string | null;
  email?: string | null; phone?: string | null; city?: string | null;
  birthDate?: string | null; gender?: string | null;
  educationLevel?: string | null; fieldOfStudy?: string | null; institution?: string | null; graduationYear?: number | null; gpa?: number | null;
  expYears?: number | null; lastPosition?: string | null; lastCompany?: string | null;
  expectedSalary?: number | null; notes?: string | null;
  /** F6 (HRX B3): jawaban knockout yang dikirim form publik (audit — disalin
   *  ke ApplicationAnswer saat staging diverifikasi). */
  knockoutAnswers?: { questionId: string; answer: string | null; pass: boolean }[];
  /** tanda field terenkripsi di payloadJson — hanya utk dokumentasi. */
  [k: string]: unknown;
}

/** Enkripsi field PII payload sebelum stringify. */
function encryptPayload(tc: ReturnType<typeof tenantCryptoForDb>, p: PublicPayload): string {
  const enc = (v: string | null | undefined) => (v?.trim() ? tc.encryptText(v.trim()) : null);
  return JSON.stringify({
    ...p,
    email: enc(p.email),
    phone: enc(p.phone),
    city: enc(p.city),
    expectedSalary: p.expectedSalary != null && p.expectedSalary > 0 ? tc.encryptMoney(p.expectedSalary) : null,
  });
}

/** Dekripsi field PII payload. */
export function decryptPayload(tc: ReturnType<typeof tenantCryptoForDb>, json: string): PublicPayload {
  const p = JSON.parse(json) as PublicPayload;
  return {
    ...p,
    email: tc.decryptText(p.email ?? null),
    phone: tc.decryptText(p.phone ?? null),
    city: tc.decryptText(p.city ?? null),
    // expectedSalary tersimpan sbg string cipher (enc:v1:n:…) — input number
    // hanya sebelum enkripsi; setelah JSON roundtrip tipenya string.
    expectedSalary: p.expectedSalary != null ? tc.decryptMoney(String(p.expectedSalary)) : null,
  };
}

export interface StagingRow {
  id: string;
  submittedAt: string;
  status: string;
  jobOpeningId: string | null;
  slotTitle: string | null;
  joRefNo: string | null;
  applicantName: string;
  email: string | null; // HR melihat penuh di inbox verifikasi
  phone: string | null;
  city: string | null;
  educationLevel: string | null;
  fieldOfStudy: string | null;
  gpa: number | null;
  expYears: number | null;
  expectedSalary: number | null; // moneyVisible gated di route
  notes: string | null;
  cvAttachmentId: string | null;
  cvFileName: string | null;
  ipHashShort: string | null;
  consentVersion: string | null;
  rejectNote: string | null;
}

export async function listPublicApplications(
  db: TenantDb, opts: { status?: string | null; limit?: number; offset?: number; moneyVisible?: boolean },
): Promise<{ rows: StagingRow[]; total: number; stats: { pending: number; verified: number; rejected: number; spam: number } }> {
  const tc = tenantCryptoForDb(db);
  const where: Prisma.PublicApplicationWhereInput = {};
  if (opts.status && PA_STATUSES.includes(opts.status as never)) where.status = opts.status;
  const [rows, total, group] = await Promise.all([
    db.publicApplication.findMany({
      where,
      include: { jobOpening: { include: { jobOpportunity: { select: { refNo: true } } } } },
      orderBy: { submittedAt: "desc" },
      take: Math.min(Math.max(opts.limit ?? 50, 1), 100),
      skip: Math.max(opts.offset ?? 0, 0),
    }),
    db.publicApplication.count({ where }),
    db.publicApplication.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const moneyVisible = opts.moneyVisible ?? false;
  return {
    rows: rows.map((r) => {
      const p = safePayload(tc, r.payloadJson);
      const cv = r.consentId ? null : null; // CV diambil terpisah (attachment)
      void cv;
      return {
        id: r.id,
        submittedAt: r.submittedAt.toISOString(),
        status: r.status,
        jobOpeningId: r.jobOpeningId,
        slotTitle: r.jobOpening?.titleToShow ?? null,
        joRefNo: r.jobOpening?.jobOpportunity.refNo ?? null,
        applicantName: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ").trim(),
        email: p.email ?? null,
        phone: p.phone ?? null,
        city: p.city ?? null,
        educationLevel: p.educationLevel ?? null,
        fieldOfStudy: p.fieldOfStudy ?? null,
        gpa: p.gpa ?? null,
        expYears: p.expYears ?? null,
        expectedSalary: moneyVisible ? (p.expectedSalary ?? null) : null,
        notes: p.notes ?? null,
        cvAttachmentId: null, // diisi route via attachmentsByEntityIds (bila perlu)
        cvFileName: r.cvFileName,
        ipHashShort: r.ipHash ? r.ipHash.slice(0, 12) : null,
        consentVersion: null, // diisi bila consent termuat (r.join terpisah)
        rejectNote: r.rejectNote,
      };
    }),
    total,
    stats: {
      pending: group.find((g) => g.status === "Pending")?._count._all ?? 0,
      verified: group.find((g) => g.status === "Verified")?._count._all ?? 0,
      rejected: group.find((g) => g.status === "Rejected")?._count._all ?? 0,
      spam: group.find((g) => g.status === "Spam")?._count._all ?? 0,
    },
  };
}

function safePayload(tc: ReturnType<typeof tenantCryptoForDb>, json: string): PublicPayload {
  try {
    return decryptPayload(tc, json);
  } catch {
    return { firstName: "?(payload rusak)" };
  }
}

/** Buat lamaran publik (staging) — dipakai route publik DAN seed demo.
 *  PII payload dienkripsi; CV opsional via buffer (sudah tervalidasi mime
 *  oleh attachment-service). */
export async function submitPublicApplication(
  db: TenantDb, tenantSlug: string,
  input: { jobOpeningId?: string | null; payload: PublicPayload; cv?: { buffer: Buffer; fileName: string; mimeType: string } | null; ipHash?: string | null; spam?: boolean; knockoutRejected?: boolean; rejectNote?: string | null },
): Promise<{ id: string }> {
  const tc = tenantCryptoForDb(db);
  if (!input.payload.firstName?.trim()) throw new Error("Nama depan wajib diisi");

  // consent dicatat SEBELUM baris staging (versi teks saat ini)
  const consent = await db.applicantConsent.create({
    data: { purpose: "recruitment", version: CONSENT_VERSION, channel: "public-form", note: "Formulir lamaran publik (portal karir)" },
  });

  const pa = await db.publicApplication.create({
    data: {
      jobOpeningId: input.jobOpeningId || null,
      status: input.spam === true ? "Spam" : input.knockoutRejected === true ? "Rejected" : "Pending",
      rejectNote: input.knockoutRejected === true ? (input.rejectNote?.slice(0, 500) ?? "Gagal pertanyaan knockout") : null,
      payloadJson: encryptPayload(tc, input.payload),
      ipHash: input.ipHash ?? null,
      consentId: consent.id,
    },
  });
  await db.applicantConsent.update({ where: { id: consent.id }, data: { note: `PublicApplication ${pa.id}` } });

  if (input.cv) {
    const att = await saveAttachment(db, tenantSlug, {
      file: input.cv.buffer, fileName: input.cv.fileName, mimeType: input.cv.mimeType,
      entityType: "PublicApplication", entityId: pa.id, uploadedBy: null,
    });
    await db.publicApplication.update({ where: { id: pa.id }, data: { cvFileName: att.fileName, cvStoragePath: att.storagePath } });
  }

  // F7 — emit webhook application.received (TANPA nama/email — UU PDP
  // minimisasi) + auto-reply konfirmasi ke email kandidat (setting gated).
  if (pa.status !== "Spam") {
    const jo = input.jobOpeningId
      ? await db.jobOpening.findUnique({
          where: { id: input.jobOpeningId },
          select: { titleToShow: true, jobOpportunity: { select: { refNo: true, title: true } } },
        }).catch(() => null)
      : null;
    void emitWebhookEvent(db, "application.received", {
      stagingId: pa.id,
      joRefNo: jo?.jobOpportunity.refNo ?? null,
      receivedAt: pa.createdAt.toISOString(),
    }).catch(() => {});

    if ((await getRecruitmentSetting(db, "auto.reply.public-application", "true").catch(() => "true")) !== "false") {
      const company = await db.company.findFirst({ select: { name: true } }).catch(() => null);
      const nama = [input.payload.firstName, input.payload.middleName, input.payload.lastName]
        .filter(Boolean).join(" ").trim();
      void notifyEmailEvent(db, {
        event: "recruitment.application.received",
        to: [{ email: input.payload.email, name: nama || undefined }],
        data: {
          nama: nama || "Kandidat",
          posisi: jo?.titleToShow ?? jo?.jobOpportunity?.title ?? "-",
          perusahaan: company?.name ?? "RekanKerja HRIS",
          tanggal: new Date().toISOString().slice(0, 10),
        },
      });
    }
  }
  return { id: pa.id };
}

/** Ambil attachment id CV staging (utk tombol unduh di inbox). */
export async function stagingCvAttachmentId(db: TenantDb, paId: string): Promise<string | null> {
  const atts = await listAttachmentsByEntity(db, "PublicApplication", paId);
  return atts[0]?.id ?? null;
}

/** Verifikasi staging → jadi Applicant (+ lamaran ke slot + pindah CV). */
export async function verifyPublicApplication(
  db: TenantDb, tenantSlug: string,
  input: { id: string; action: "verify" | "reject" | "spam"; note?: string | null; actor: { employeeId?: string | null; name?: string | null } },
): Promise<{ applicantNo?: string; status: string }> {
  const tc = tenantCryptoForDb(db);
  const pa = await db.publicApplication.findUnique({ where: { id: input.id }, include: { jobOpening: { include: { jobOpportunity: { select: { refNo: true, status: true } } } } } });
  if (!pa) throw new Error("Lamaran publik tidak ditemukan");
  if (pa.status !== "Pending") throw new Error(`Lamaran sudah diproses (${pa.status})`);

  if (input.action !== "verify") {
    const status = input.action === "spam" ? "Spam" : "Rejected";
    await db.publicApplication.update({ where: { id: pa.id }, data: { status, rejectNote: input.note?.trim() || null } });
    await db.activityLog.create({
      data: { action: status === "Spam" ? "Updated" : "Rejected", entity: "PublicApplication", entityId: pa.id.slice(-8), detail: `Lamaran publik ${status === "Spam" ? "ditandai SPAM" : "DITOLAK"}${input.note ? ` — ${input.note.trim()}` : ""}${input.actor.name ? ` (${input.actor.name})` : ""}` },
    });
    return { status };
  }

  // verify: buat Applicant dari payload (jalur produksi = createApplicant)
  const p = safePayload(tc, pa.payloadJson);
  const dateApplied = new Date();
  const applicant = await createApplicant(db, {
    firstName: p.firstName,
    middleName: p.middleName ?? null,
    lastName: p.lastName ?? null,
    displayName: null,
    dateApplied: dateApplied.toISOString().slice(0, 10),
    expectedSalary: p.expectedSalary ?? null,
    source: "Web",
    email: p.email ?? null,
    phone: p.phone ?? null,
    city: p.city ?? null,
    birthDate: p.birthDate ?? null,
    gender: p.gender ?? null,
    notes: p.notes ?? null,
    educations: p.educationLevel ? [{
      level: p.educationLevel, fieldOfStudy: p.fieldOfStudy ?? null, institution: p.institution ?? null,
      graduationYear: p.graduationYear ?? null, gpa: p.gpa ?? null,
    }] : [],
    experiences: p.expYears || p.lastPosition || p.lastCompany ? [{
      company: p.lastCompany ?? null, position: p.lastPosition ?? null,
      startYear: p.expYears ? new Date().getFullYear() - Math.ceil(p.expYears) : null, endYear: null,
      months: p.expYears != null ? Math.round(p.expYears * 12) : null,
    }] : [],
    skills: [],
  }, input.actor.name ?? "Verifikasi HR");

  // gandakan consent staging → applicant (jejak PII milik applicant)
  if (pa.consentId) {
    await db.applicantConsent.update({ where: { id: pa.consentId }, data: { applicantId: applicant.id } });
  }

  // lamaran ke slot (bila mengincar slot & slot masih layak)
  let newApplicationId: string | null = null;
  if (pa.jobOpeningId && pa.jobOpening && pa.jobOpening.status === "Open" && pa.jobOpening.jobOpportunity.status === "Posted") {
    newApplicationId = await db.applicantApplication.create({
      data: { applicantId: applicant.id, jobOpeningId: pa.jobOpeningId, sourceNote: "Lamaran publik (portal karir)" },
    })
      .then((r) => r.id)
      .catch(() => null); /* unique — sudah melamar */
  }

  // F6 (HRX B3): salin jawaban knockout staging → ApplicationAnswer (audit
  // per lamaran — hanya questionId yang masih valid di slot)
  const koAnswers = Array.isArray(p.knockoutAnswers) ? p.knockoutAnswers : [];
  if (newApplicationId && koAnswers.length > 0) {
    const validQs = await db.knockoutQuestion.findMany({
      where: { id: { in: koAnswers.map((a) => String(a.questionId)) } },
      select: { id: true },
    });
    const validIds = new Set(validQs.map((q) => q.id));
    const rows = koAnswers
      .filter((a) => validIds.has(String(a.questionId)))
      .map((a) => ({
        applicationId: newApplicationId!,
        questionId: String(a.questionId),
        answer: a.answer != null ? String(a.answer).slice(0, 200) : null,
      }));
    if (rows.length > 0) await db.applicationAnswer.createMany({ data: rows, skipDuplicates: true });
  }

  // pindah CV staging → dokumen pelamar (requiredDocument CV bila ada)
  const cvAtts = await listAttachmentsByEntity(db, "PublicApplication", pa.id);
  if (cvAtts.length > 0) {
    const cvMaster = await db.requiredDocument.findUnique({ where: { code: "CV" }, select: { id: true } });
    const doc = await db.applicantDocument.create({
      data: { applicantId: applicant.id, requiredDocumentId: cvMaster?.id ?? null, title: cvAtts[0]!.fileName },
    });
    // RE-BIND attachment ke dokumen pelamar (satu file, pemilik baru)
    await db.attachment.update({ where: { id: cvAtts[0]!.id }, data: { entityType: "ApplicantDocument", entityId: doc.id } });
    await db.applicantDocument.update({ where: { id: doc.id }, data: { attachmentId: cvAtts[0]!.id } });
  }

  await db.publicApplication.update({
    where: { id: pa.id },
    data: { status: "Verified", verifiedById: input.actor.employeeId ?? null, verifiedAt: new Date() },
  });
  await db.activityLog.create({
    data: {
      action: "Verified", entity: "PublicApplication", entityId: applicant.applicantNo,
      detail: `Lamaran publik DIVERIFIKASI → pelamar ${applicant.applicantNo} masuk talent pool${pa.jobOpening ? ` + melamar slot "${pa.jobOpening.titleToShow}" (${pa.jobOpening.jobOpportunity.refNo})` : ""}${input.actor.name ? ` oleh ${input.actor.name}` : ""}`,
    },
  });
  return { applicantNo: applicant.applicantNo, status: "Verified" };
}
