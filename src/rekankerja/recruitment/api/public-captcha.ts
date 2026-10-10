import { NextRequest, NextResponse } from "next/server";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import { issueCaptcha, clientIpOf } from "@/rekankerja/recruitment/services/public-recruitment-service";

// ============================================================================
// RECRUITMENT F2 — PUBLIC: terbitkan challenge captcha matematika (tanpa login).
// GET /api/public/recruitment/captcha
//   → { question, token, expiresInSeconds }
// Stateless: jawaban ter-HMAC SESSION_SECRET (TTL 10 menit) — verifikasi di
// POST /api/public/recruitment/apply (verifyCaptcha). Rate limit 30/menit/IP.
// ============================================================================

export const runtime = "nodejs";

const CAPTCHA_IP_LIMIT = 30;
const CAPTCHA_IP_WINDOW_MS = 60 * 1000;

export async function GET(req: NextRequest) {
  const ip = clientIpOf(req);
  const rl = hitRateLimit(`recruitment-captcha:ip:${ip}`, CAPTCHA_IP_LIMIT, CAPTCHA_IP_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  return NextResponse.json(issueCaptcha());
}
