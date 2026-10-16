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
  // REC-AUDIT-FIX H3 — fail-closed: endpoint publik TIDAK boleh jatuh ke
  // rahasia dev hard-coded yang bisa dipalsukan siapa pun yang membaca repo.
  const s = process.env.SESSION_SECRET;
  if (!s) {
    throw new Error(
      "SESSION_SECRET belum dikonfigurasi — token publik (captcha/status-link) menolak diterbitkan tanpa kunci. " +
        "Set env SESSION_SECRET (32+ karakter acak) lalu restart.",
    );
  }
  return s;
}

// ============ captcha matematika (stateless, HMAC-signed, sekali-pakai) ============
// REC-AUDIT-FIX H2: token HANYA berisi <exp>.<hmac(answer,exp)> — operan soal
// TIDAK pernah dikirim ke klien (bot tak bisa mem-parser token) + SEKALI-PAKAI
// (sig tercatat di memori sampai kedaluwarsa — replay ditolak).

export interface CaptchaChallenge {
  /** pertanyaan tampil — netral bahasa (angka + operator). */
  question: string;
  /** token <exp>.<hmac> — JAWABAN tidak pernah ada di token (H2). */
  token: string;
  /** detik sampai kedaluwarsa (tampilan UX). */
  expiresInSeconds: number;
}

function captchaSign(body: string): string {
  return createHmac("sha256", secret()).update(`recruit-captcha|${body}`).digest("hex");
}

/** Signature captcha yang sudah TERPAKAI (sekali-pakai H2) → expiry ms. */
const consumedCaptcha = new Map<string, number>();

/** Tandai sig terpakai; false bila sudah pernah dipakai (replay ditolak). */
function consumeCaptchaSig(sig: string, expMs: number): boolean {
  if (consumedCaptcha.has(sig)) return false;
  if (consumedCaptcha.size > 5000) {
    // prune periodik (lazy) — entri kedaluwarsa dibuang
    const now = Date.now();
    for (const [k, v] of consumedCaptcha) if (v < now) consumedCaptcha.delete(k);
  }
  consumedCaptcha.set(sig, expMs);
  return true;
}

/** Terbitkan challenge baru: a + b = ? (token hanya membawa exp + HMAC jawaban). */
export function issueCaptcha(): CaptchaChallenge {
  const a = 2 + Math.floor(Math.random() * (CAPTCHA_MAX - 1));
  const b = 1 + Math.floor(Math.random() * (CAPTCHA_MAX - 1));
  const exp = Date.now() + CAPTCHA_TTL_MS;
  // body yang ditandatangani = "<jawaban>.<exp>" — jawaban tidak pernah
  // dikirim ke klien; verifikasi menghitung ulang HMAC dari jawaban kirim.
  const body = `${a + b}.${exp}`;
  return {
    question: `${a} + ${b} = ?`,
    token: `${exp}.${captchaSign(body)}`,
    expiresInSeconds: Math.round(CAPTCHA_TTL_MS / 1000),
  };
}

/** Verifikasi jawaban captcha (token + jawaban) — sekali-pakai (replay ditolak). */
export function verifyCaptcha(token: string | undefined | null, answer: string | undefined | null): boolean {
  if (!token || !answer) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false; // token format lama (operan clear-text) ditolak
  const [exp, sig] = parts as [string, string];
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false; // kedaluwarsa
  const ans = parseInt(answer, 10);
  if (!Number.isFinite(ans)) return false;
  const expected = captchaSign(`${ans}.${exp}`);
  // bandingkan HMAC konstan-waktu
  try {
    const s1 = Buffer.from(sig, "utf8");
    const s2 = Buffer.from(expected, "utf8");
    if (s1.length !== s2.length || !timingSafeEqual(s1, s2)) return false;
  } catch {
    return false;
  }
  // H2: sekali-pakai — token yang sama tak boleh diverifikasi dua kali
  return consumeCaptchaSig(sig, expMs);
}

// ============ IP hash (rate-limit & audit — bukan IP mentah) ============

export function ipHashOf(ip: string): string {
  return createHash("sha256").update(`${secret()}|recruit-ip|${ip}`).digest("hex");
}

export function clientIpOf(req: { headers: { get(name: string): string | null } }): string {
  // REC-AUDIT-FIX H4 — ambil ENTRI TERAKHIR X-Forwarded-For. Topologi kita:
  // klien → gateway tepercaya (Caddy) → app. Proxy tepercaya MENAMBAHKAN IP
  // asli di ekor; entri di depan bisa disuntikkan klien ("X-Forwarded-For:
  // 1.2.3.4") untuk memalsukan identitas rate-limit. Tanpa XFF (akses lokal
  // langsung) → "unknown" (satu bucket bersama — perilaku lama).
  const list = req.headers.get("x-forwarded-for");
  if (!list) return "unknown";
  const parts = list.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : "unknown";
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
