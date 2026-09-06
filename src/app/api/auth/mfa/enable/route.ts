// Thin route MFA TOTP (T17-MFA) — logika di src/onevity/shared/api/auth-mfa.ts
// POST { token } → verifikasi kode 6 digit → totpEnabled = true.
export const runtime = "nodejs";
export { mfaEnable as POST } from "@/onevity/shared/api/auth-mfa";
