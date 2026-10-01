// Thin route MFA TOTP (T17-MFA) — logika di src/rekankerja/shared/api/auth-mfa.ts
// POST { password } → verifikasi kata sandi → reset secret + status.
export const runtime = "nodejs";
export { mfaDisable as POST } from "@/rekankerja/shared/api/auth-mfa";
