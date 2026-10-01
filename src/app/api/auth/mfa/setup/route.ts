// Thin route MFA TOTP (T17-MFA) — logika di src/rekankerja/shared/api/auth-mfa.ts
// GET  → status MFA ({enabled, pending}) utk kartu pengaturan keamanan.
// POST → generate secret terenkripsi + otpauth URL + QR data URL (qrcode).
export const runtime = "nodejs";
export { mfaStatus as GET, mfaSetup as POST } from "@/rekankerja/shared/api/auth-mfa";
