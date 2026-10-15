// ============================================================================
// RECRUITMENT B7 — STATUS-LINK SERVICE (magic-link cek status lamaran)
// DE DEVELOPMENT-PLAN-BACKLOG.md §4 B7 + mitigasi §5 "Magic-link jadi vektor
// enumerasi email":
//   · requestStatusLink: respons NETRAL — email terkirim HANYA bila pelamar
//     dgn email itu ada (PII email terenkripsi → decrypt + compare case-
//     insensitive; SEMUA status applicant boleh — Rejected tetap pelamar).
//   · Token `${exp}.${hex hmac}` — HMAC-SHA256, key = SHA256(SESSION_SECRET +
//     ":" + schemaName) atas `${schemaName}:${applicantId}:${exp}`; TANPA PII
//     di token (applicantId TIDAK tertanam — verifikasi memindai HMAC seluruh
//     pelamar, token tidak bisa dipetakan ke orang tanpa kunci).
//   · Sekali-pakai: Applicant.statusLinkUsedAt diisi saat VERIFIKASI sukses
//     pertama. Token "terpakai" bila diterbitkan SEBELUM statusLinkUsedAt
//     (waktu terbit = exp − 6 jam) — link yang sudah dipakai TETAP 410, tapi
//     link baru yang diterbitkan SETELAH pemakaian itu bekerja (tanpa reset
//     kolom — reset justru menghidupkan ulang link lama).
//   · Rate-limit in-memory per proses (pola D20 sliding window): 3/jam per
//     (schema, email) DAN 10/jam per (schema, IP) — DICEK PADA AWAL, sebelum
//     lookup (429 tetap 429 — tidak bocor enumerasi via timing).
//     KETERBATASAN: state Map module-level hilang saat restart / terpisah per
//     instance di belakang load balancer (pola D20 — lihat shared/lib/rate-
//     limit.ts; pindah ke store bersama bila multi-instance).
// ============================================================================
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantSchemaOfDb, tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { notifyEmailEvent } from "@/rekankerja/shared/services/email-service";

/** Masa berlaku tautan cek status (6 jam — backlog B7). */
export const STATUS_LINK_TTL_MS = 6 * 60 * 60 * 1000;

/** Batas rate-limit per email: 3 permintaan/jam. */
const EMAIL_LIMIT = 3;
/** Batas rate-limit per IP: 10 permintaan/jam. */
const IP_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;

// ============ rate limiter in-memory (pola D20 sliding window) ============

const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000; // guard pertumbuhan memori

function hit(key: string, limit: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((hits[0]! - cutoff) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) {
    for (const [k, h] of buckets) {
      const alive = h.filter((t) => t > cutoff);
      if (alive.length === 0) buckets.delete(k);
      else buckets.set(k, alive);
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Reset seluruh state rate limiter (in-process — test/cleanup). */
export function __resetRateLimiterForTest(): void {
  buckets.clear();
}

// ============ error ============

/** 429 — terlalu banyak permintaan (pesan dwibahasa netral di route). */
export class StatusLinkRateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super("Terlalu banyak permintaan. Silakan coba lagi nanti.");
  }
}

/** 400 (format/rusak) ATAU 410 (kedaluwarsa / sudah dipakai) — pesan netral. */
export class StatusLinkTokenError extends Error {
  constructor(public status: 400 | 410, message: string) {
    super(message);
  }
}

export const STATUS_LINK_TOKEN_INVALID = "Tautan tidak valid atau tidak dikenali";
export const STATUS_LINK_TOKEN_GONE = "Tautan sudah kedaluwarsa atau pernah digunakan — silakan minta tautan baru";

// ============ token HMAC ============

/** Kunci HMAC per tenant: SHA256(SESSION_SECRET ":" schemaName). */
function tokenKey(schemaName: string): Buffer {
  const secret = process.env.SESSION_SECRET || "rekankerja-dev-secret";
  return createHash("sha256").update(`${secret}:${schemaName}`).digest();
}

function tokenSign(schemaName: string, applicantId: string, expMs: number): string {
  return createHmac("sha256", tokenKey(schemaName)).update(`${schemaName}:${applicantId}:${expMs}`).digest("hex");
}

/**
 * Buat token `${exp}.${hex hmac}` (tanpa PII — exp epoch ms + tanda tangan).
 * Dipakai internal requestStatusLink; diekspor juga untuk pengujian E2E
 * (mis. craft token kedaluwarsa tanpa menunggu 6 jam nyata).
 */
export function craftStatusToken(schemaName: string, applicantId: string, expMs: number): string {
  return `${expMs}.${tokenSign(schemaName, applicantId, expMs)}`;
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ============ minta link (publik, netral) ============

/** Basis URL portal kandidat (halaman /status/<token> hidup di portal). */
function portalBase(): string {
  return process.env.CANDIDATE_PORTAL_URL ?? "http://127.0.0.1:3010";
}

function fmtBerlaku(expMs: number): string {
  const d = new Date(expMs);
  const tgl = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(d);
  const jam = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(d).replace(".", ":");
  return `${tgl}, ${jam} WIB`;
}

/**
 * Minta tautan cek status untuk email. SELALU resolve tanpa nilai yang bisa
 * membedakan email terdaftar/tidak (anti-enumerasi) — email terkirim hanya
 * bila pelamar ditemukan. Throw StatusLinkRateLimitError (429) bila terkena
 * batas (dicek SEBELUM lookup supaya 429 tidak membocorkan timing).
 */
export async function requestStatusLink(
  db: TenantDb,
  input: { email: string; ip: string },
): Promise<void> {
  const schema = tenantSchemaOfDb(db);
  const email = input.email.trim().toLowerCase();

  // rate-limit DI AWAL — per-IP DAN per-email (jangan sampai lookup dulu)
  const rlIp = hit(`sl:${schema}:ip:${input.ip}`, IP_LIMIT);
  if (!rlIp.allowed) throw new StatusLinkRateLimitError(rlIp.retryAfterSec);
  const rlEmail = hit(`sl:${schema}:em:${email}`, EMAIL_LIMIT);
  if (!rlEmail.allowed) throw new StatusLinkRateLimitError(rlEmail.retryAfterSec);

  // cari pelamar dgn email terenkripsi yang cocok (case-insensitive) — SEMUA
  // status (Rejected tetap pelamar berhak tahu statusnya; bila ada ganda,
  // pakai yang terbaru masuk talent pool)
  const tc = tenantCryptoForDb(db);
  const rows = await db.applicant.findMany({
    select: { id: true, email: true, dateApplied: true },
    orderBy: { dateApplied: "desc" },
  });
  const match = rows.find((a) => (tc.decryptText(a.email)?.trim().toLowerCase() ?? "") === email) ?? null;
  if (!match) return; // netral — tidak ada email, tidak ada error

  const applicant = await db.applicant.findUnique({
    where: { id: match.id },
    select: { id: true, firstName: true, middleName: true, lastName: true, displayName: true },
  });
  if (!applicant) return;
  const fullName = applicant.displayName?.trim()
    || [applicant.firstName, applicant.middleName, applicant.lastName].filter(Boolean).join(" ").trim()
    || email;

  // link baru — kolom statusLinkUsedAt TIDAK di-reset: verifikasi token
  // menganggap token terpakai bila diterbitkan sebelum statusLinkUsedAt,
  // jadi link lama yang sudah dipakai tetap 410 dan link baru (diterbitkan
  // setelah pemakaian terakhir) bekerja (lihat verifyStatusToken)
  const exp = Date.now() + STATUS_LINK_TTL_MS;
  const token = craftStatusToken(schema, match.id, exp);

  void notifyEmailEvent(db, {
    event: "recruitment.status.link",
    to: [{ email, name: fullName }],
    data: {
      nama: fullName,
      link: `${portalBase()}/status/${token}`,
      berlaku: fmtBerlaku(exp),
    },
  });
}

// ============ verifikasi token (sekali-pakai) ============

/**
 * Verifikasi token cek status → payload status pelamar (TANPA data internal
 * sensitif). Throw StatusLinkTokenError:
 *   400 — format token rusak / tanda tangan tidak cocok;
 *   410 — kedaluwarsa ATAU sudah pernah dipakai (pesan netral sama).
 * Sekali-pakai: token dianggap TERPAKAI bila waktu terbitnya (exp − TTL)
 * mendahului statusLinkUsedAt — link yang sudah dibuka tetap 410, namun link
 * BARU yang diminta setelah pemakaian bekerja normal. Sukses pertama
 * mengisi statusLinkUsedAt = now.
 */
export async function verifyStatusToken(db: TenantDb, token: string): Promise<ApplicantStatusPayload> {
  const schema = tenantSchemaOfDb(db);
  const m = /^(\d{10,16})\.([a-f0-9]{64})$/.exec(token.trim());
  if (!m) throw new StatusLinkTokenError(400, STATUS_LINK_TOKEN_INVALID);
  const exp = Number(m[1]);
  const sig = m[2]!;
  if (exp < Date.now()) throw new StatusLinkTokenError(410, STATUS_LINK_TOKEN_GONE);

  // scan pelamar — token tidak memuat applicantId (anti-PII), jadi tanda
  // tangan diverifikasi terhadap setiap id (jumlah pelamar per tenant kecil)
  const rows = await db.applicant.findMany({
    select: { id: true, statusLinkUsedAt: true },
    orderBy: { dateApplied: "desc" },
  });
  const match = rows.find((a) => safeEqualHex(tokenSign(schema, a.id, exp), sig)) ?? null;
  if (!match) throw new StatusLinkTokenError(400, STATUS_LINK_TOKEN_INVALID);
  // sekali-pakai vs penerbitan: token terbit (exp − TTL) SEBELUM momen pakai
  // terakhir → token itu (dan semua token yang lebih lama) sudah dipakai;
  // token yang diterbitkan SETELAH pemakaian tetap valid
  const issuedAt = exp - STATUS_LINK_TTL_MS;
  if (match.statusLinkUsedAt && match.statusLinkUsedAt.getTime() > issuedAt) {
    throw new StatusLinkTokenError(410, STATUS_LINK_TOKEN_GONE);
  }

  const applicant = await db.applicant.findUnique({ where: { id: match.id } });
  if (!applicant) throw new StatusLinkTokenError(400, STATUS_LINK_TOKEN_INVALID);
  await db.applicant.update({ where: { id: match.id }, data: { statusLinkUsedAt: new Date() } });
  return applicantStatusPayload(db, applicant);
}

// ============ payload status (publik, minim) ============

export interface StatusStepItem {
  name: string;
  status: string;
  planDate: string | null;
}

export interface StatusOfferItem {
  offerNo: string;
  status: string;
  date: string | null;
}

export interface StatusAttachmentItem {
  title: string;
  fileName: string;
  sizeBytes: number;
}

export interface ApplicantStatusPayload {
  applicantNo: string;
  fullName: string;
  status: string;
  appliedCount: number;
  latestApplication: { joRefNo: string; title: string; dateApplied: string; status: string } | null;
  selection: { prNo: string | null; steps: StatusStepItem[] } | null;
  offer: StatusOfferItem | null;
  attachments: StatusAttachmentItem[];
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/**
 * Payload status untuk PELAMAR sendiri — data yang boleh dilihat kandidat:
 * identitas terbatas, slot terakhir, status, tahapan (TANPA nama evaluator /
 * catatan internal), offer (TANPA nominal gaji), lampiran + total lamaran.
 * TIDAK ADA rating / catatan HR / skor AI / data internal lain.
 */
export async function applicantStatusPayload(
  db: TenantDb,
  applicant: {
    id: string; applicantNo: string; firstName: string; middleName: string | null;
    lastName: string | null; displayName: string | null; status: string;
  },
): Promise<ApplicantStatusPayload> {
  const fullName = applicant.displayName?.trim()
    || [applicant.firstName, applicant.middleName, applicant.lastName].filter(Boolean).join(" ").trim();

  // lamaran slot (multi-lamaran) — terakhir + total
  const applications = await db.applicantApplication.findMany({
    where: { applicantId: applicant.id },
    orderBy: { dateApplied: "desc" },
    include: { jobOpening: { select: { titleToShow: true, jobOpportunity: { select: { refNo: true } } } } },
  });
  const latest = applications[0] ?? null;

  // kandidat PR terbaru milik pelamar ini → tahapan + offer (TANPA evaluator)
  const candidates = await db.jobCandidate.findMany({
    where: { applicantId: applicant.id },
    orderBy: { nominatedAt: "desc" },
    select: {
      pr: { select: { prNo: true } },
      selectionSteps: {
        orderBy: { seqNo: "asc" },
        select: {
          status: true, planDate: true, seqNo: true,
          selectionProcess: { select: { name: true } },
        },
      },
      offers: {
        orderBy: { createdAt: "desc" },
        select: { offerNo: true, status: true, sentAt: true, createdAt: true },
      },
    },
  });
  const cand = candidates[0] ?? null;
  const offerRow = cand?.offers[0] ?? null;

  // dokumen pelamar (lampiran) — nama file + ukuran
  const docs = await db.applicantDocument.findMany({
    where: { applicantId: applicant.id },
    orderBy: { createdAt: "asc" },
    select: { title: true, attachment: { select: { fileName: true, sizeBytes: true } } },
  });

  return {
    applicantNo: applicant.applicantNo,
    fullName,
    status: applicant.status,
    appliedCount: applications.length,
    latestApplication: latest
      ? {
          joRefNo: latest.jobOpening.jobOpportunity.refNo,
          title: latest.jobOpening.titleToShow,
          dateApplied: latest.dateApplied.toISOString(),
          status: latest.status,
        }
      : null,
    selection: cand
      ? {
          prNo: cand.pr.prNo,
          steps: cand.selectionSteps.map((s) => ({
            name: s.selectionProcess.name,
            status: s.status,
            planDate: iso(s.planDate),
          })),
        }
      : null,
    offer: offerRow
      ? { offerNo: offerRow.offerNo, status: offerRow.status, date: iso(offerRow.sentAt ?? offerRow.createdAt) }
      : null,
    attachments: docs
      .filter((d) => d.attachment)
      .map((d) => ({ title: d.title, fileName: d.attachment!.fileName, sizeBytes: d.attachment!.sizeBytes })),
  };
}
