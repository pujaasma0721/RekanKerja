// T17-MFA — utilitas uji (jalankan dengan bun):
//   bun run scripts/t17-test-mfa.ts selftest                    → vektor RFC 6238 + base32
//   bun run scripts/t17-test-mfa.ts code <secretBase32>         → kode TOTP saat ini (6 digit)
//   bun run scripts/t17-test-mfa.ts code-at <secretBase32> <epochMs> → kode utk waktu tertentu
//   bun run scripts/t17-test-mfa.ts expired-token <uid>         → mfaToken HMAC valid tapi exp lampau
// Dipakai harness E2E curl (kode dihitung murni RFC 6238 dari secret —
// sama dgn src/rekankerja/shared/lib/totp.ts, tanpa otplib).
import { createHmac } from "node:crypto";
import {
  base32Decode, base32Encode, currentCode, generateSecret, hotp, otpauthUrl, verifyCode,
} from "@/rekankerja/shared/lib/totp";

const arg = process.argv[2];

if (arg === "selftest") {
  const secretB32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));
  const key = base32Decode(secretB32);
  const vectors: Array<[number, string]> = [
    [59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"],
    [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"],
  ];
  let fail = 0;
  for (const [t, want] of vectors) {
    const got = hotp(key, Math.floor(t / 30), 8);
    if (got !== want) { console.error(`FAIL T=${t}: ${got} ≠ ${want}`); fail++; }
  }
  if (secretB32 !== "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ") { console.error("FAIL base32 RFC 4648"); fail++; }
  if (hotp(key, 1) !== "287082") { console.error("FAIL 6-digit T=59"); fail++; }
  const s = generateSecret();
  const ok = verifyCode(s, currentCode(s)) && verifyCode(s, currentCode(s, Date.now() - 30000));
  if (!ok) { console.error("FAIL verifyCode window ±1"); fail++; }
  if (verifyCode(s, "12345") || verifyCode("!!!", "123456")) { console.error("FAIL input guard"); fail++; }
  console.log(fail === 0 ? "SELFTEST OK — RFC 6238 SHA-1 6-digit 30s window±1 + base32" : `SELFTEST FAIL (${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}

if (arg === "code") {
  const secret = process.argv[3] ?? "";
  if (!secret) { console.error("pakai: code <secretBase32>"); process.exit(2); }
  console.log(currentCode(secret));
}

if (arg === "code-at") {
  const secret = process.argv[3] ?? "";
  const ms = Number(process.argv[4] ?? "0");
  if (!secret || !Number.isFinite(ms)) { console.error("pakai: code-at <secretBase32> <epochMs>"); process.exit(2); }
  console.log(currentCode(secret, ms));
}

if (arg === "expired-token") {
  // mfaToken dgn MAC VALID tapi exp di masa lalu → /api/auth/mfa/verify harus 401.
  // Replika minimal signMfaToken (auth.ts) — secret dev fallback bila SESSION_SECRET kosong.
  const uid = process.argv[3] ?? "";
  if (!uid) { console.error("pakai: expired-token <uid>"); process.exit(2); }
  const secret = process.env.SESSION_SECRET || "rekankerja-dev-secret";
  const body = Buffer.from(JSON.stringify({ typ: "mfa", uid, exp: Date.now() - 60_000 })).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  console.log(`${body}.${mac}`);
}

if (arg === "otpauth") {
  const secret = process.argv[3] ?? "";
  const email = process.argv[4] ?? "user@example.com";
  console.log(otpauthUrl(secret, email, "RekanKerja"));
}

if (!arg) {
  console.error("perintah: selftest | code <secret> | code-at <secret> <ms> | expired-token <uid> | otpauth <secret> <email>");
  process.exit(2);
}
