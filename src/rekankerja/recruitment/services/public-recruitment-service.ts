// ============================================================================
// RECRUITMENT F2 — layanan sisi PUBLIK (tanpa login)
// Sumber: DEVELOPMENT-PLAN-RECRUITMENT.md §7 F2 (D1: portal karir minimal).
//
// • listPublicOpenings: slot Posted+Open → JSON publik MINIM (tanpa PII,
//   tanpa data internal — hanya judul, lokasi, rentang gaji IKLAN, ringkasan).
// • Captcha ringan self-hosted (CSP connect-src 'self' — captcha eksternal
//   mustahil): soal matematika + token HMAC SESSION_SECRET (TTL 10 menit),
//   padanan signMfaToken/verifyMfaToken auth.ts.
// • ipHashOf: SHA-256 salted (bukan IP mentah) — disimpan di PublicApplication
//   utk rate-limit & audit (UU PDP — minimisasi data).
// Dipakai route /api/public/recruitment/* (guard: rate-limit per IP).
// ============================================================================
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

const CAPTCHA_TTL_MS = 10 * 60 * 1000; // 10 menit
const CAPTCHA_MAX = 20; // angka maks soal

function secret(): string {
  return process.env.SESSION_SECRET || "rekankerja-dev-secret";
}

// ============ captcha matematika (stateless, HMAC-signed) ============

export interface CaptchaChallenge {
  /** pertanyaan tampil — netral bahasa (angka + operator). */
  question: string;
  /** token berisi jawaban ter-HMAC — dikembalikan klien, diverifikasi server. */
  token: string;
  /** detik sampai kedaluwarsa (tampilan UX). */
  expiresInSeconds: number;
}

function captchaSign(body: string): string {
  return createHmac("sha256", secret()).update(`recruit-captcha|${body}`).digest("hex");
}

/** Terbitkan challenge baru: a + b = ? */
export function issueCaptcha(): CaptchaChallenge {
  const a = 2 + Math.floor(Math.random() * (CAPTCHA_MAX - 1));
  const b = 1 + Math.floor(Math.random() * (CAPTCHA_MAX - 1));
  const exp = Date.now() + CAPTCHA_TTL_MS;
  const body = `${a}.${b}.${exp}`;
  return {
    question: `${a} + ${b} = ?`,
    token: `${body}.${captchaSign(body)}`,
    expiresInSeconds: Math.round(CAPTCHA_TTL_MS / 1000),
  };
}

/** Verifikasi jawaban captcha (token + jawaban). */
export function verifyCaptcha(token: string | undefined | null, answer: string | undefined | null): boolean {
  if (!token || !answer) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [a, b, exp, sig] = parts as [string, string, string, string];
  const expected = captchaSign(`${a}.${b}.${exp}`);
  // bandingkan HMAC konstan-waktu
  try {
    const s1 = Buffer.from(sig, "utf8");
    const s2 = Buffer.from(expected, "utf8");
    if (s1.length !== s2.length || !timingSafeEqual(s1, s2)) return false;
  } catch {
    return false;
  }
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false; // kedaluwarsa
  const ans = parseInt(answer, 10);
  if (!Number.isFinite(ans)) return false;
  return ans === parseInt(a, 10) + parseInt(b, 10);
}

// ============ IP hash (rate-limit & audit — bukan IP mentah) ============

export function ipHashOf(ip: string): string {
  return createHash("sha256").update(`${secret()}|recruit-ip|${ip}`).digest("hex");
}

export function clientIpOf(req: { headers: { get(name: string): string | null } }): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// ============ listing publik (slot Posted) ============

export interface PublicOpeningItem {
  slotId: string;
  joRefNo: string;
  title: string;
  location: string | null;
  city: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  salaryUnit: string;
  jobDescSummary: string | null;
  jobSpecSummary: string | null;
  closingDate: string | null;
  employmentStatus: string | null;
  /** F6 (HRX B3): pertanyaan knockout aktif — PERTANYAAN saja (jawaban yang
   *  diharapkan TIDAK pernah dikirim ke klien — dievaluasi server-side). */
  knockouts: { questionId: string; question: string }[];
}

/** Slot Posted+Open untuk portal publik — TANPA PII/data internal.
 *  Urut: terbaru diposting dulu.
 *  F5: JO internalOnly / dalam jendela internalFirstUntil TIDAK tayang
 *  di portal publik (hanya ESS Lowongan Internal). */
export async function listPublicOpenings(db: TenantDb, limit = 50): Promise<PublicOpeningItem[]> {
  const slots = await db.jobOpening.findMany({
    where: {
      status: "Open",
      jobOpportunity: {
        status: "Posted",
        internalOnly: false,
        OR: [{ internalFirstUntil: null }, { internalFirstUntil: { lte: new Date() } }],
      },
    },
    include: {
      workLocation: { select: { name: true, city: true } },
      jobOpportunity: { select: { refNo: true, lastAcceptDate: true } },
      pr: { select: { employmentStatus: true } },
      knockouts: { where: { active: true }, orderBy: { orderNo: "asc" }, select: { id: true, question: true } },
    },
    orderBy: { postedAt: "desc" },
    take: Math.min(limit, 100),
  });
  return slots.map((s) => ({
    slotId: s.id,
    joRefNo: s.jobOpportunity.refNo,
    title: s.titleToShow,
    location: s.workLocation?.name ?? null,
    city: s.workLocation?.city ?? null,
    salaryMin: s.salaryMin ?? null,
    salaryMax: s.salaryMax ?? null,
    currency: s.currency,
    salaryUnit: s.salaryUnit,
    jobDescSummary: s.jobDescSummary,
    jobSpecSummary: s.jobSpecSummary,
    closingDate: s.jobOpportunity.lastAcceptDate ? s.jobOpportunity.lastAcceptDate.toISOString().slice(0, 10) : null,
    employmentStatus: s.pr.employmentStatus,
    knockouts: s.knockouts.map((k) => ({ questionId: k.id, question: k.question })),
  }));
}
