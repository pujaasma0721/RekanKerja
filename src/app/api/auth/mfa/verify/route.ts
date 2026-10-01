// Thin route MFA TOTP (T17-MFA) — logika di src/rekankerja/shared/api/auth-mfa.ts
// POST { mfaToken, token } → langkah-2 login: kode benar → cookie sesi normal.
export const runtime = "nodejs";
export { mfaVerify as POST } from "@/rekankerja/shared/api/auth-mfa";
