// OneVity — VAULT KEY DERIVATION (Task 47) ================================
// ========================================================================
// Derivasi kunci brankas dari KATA SANDI PERUSAHAAN (murni node:crypto —
// tanpa dependensi prisma/pg, aman diimpor lib server maupun skrip CLI):
//
//   PBKDF2(sandi, salt 16 byte, 210_000 iter, sha256, keylen 96)
//     → [ 0..32)  verifierKey — HMAC utk verifier "vrf:v1:…" (cek sandi)
//     → [32..64)  kek         — membungkus dataKey (salinan pemulihan
//                                "vlt:v1:…" di kolom wrappedKey)
//     → [64..96)  dataKey     — KUNCI ENKRIPSI DATA perusahaan: seluruh
//                                kolom terenkripsi (PII + uang) schema tenant
//                                ini di-enkripsi dengannya (enc:v2:…).
//                                Ganti sandi = dataKey baru + re-enkripsi total.
import { createCipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const PBKDF2_ITERATIONS = 210_000;

const VERIFIER_LABEL = "onevity-money-vault";
const VERIFIER_PREFIX = "vrf:v1";
const WRAPPED_PREFIX = "vlt:v1";

export interface VaultKeySet {
  /** Salt hex (32 karakter) — disimpan di baris MoneyVault. */
  salt: string;
  /** Kunci HMAC verifier (cek sandi tanpa menyimpan sandi). */
  verifierKey: Buffer;
  /** Key-encryption-key — membungkus dataKey (salinan pemulihan). */
  kek: Buffer;
  /** Kunci enkripsi data perusahaan (enc:v2). */
  dataKey: Buffer;
}

/** Derivasi lengkap dari sandi (+ salt acak bila tidak diberikan). */
export function deriveVaultKeys(password: string, saltHex?: string): VaultKeySet {
  const salt = saltHex ?? randomBytes(16).toString("hex");
  const dk = pbkdf2Sync(password, Buffer.from(salt, "hex"), PBKDF2_ITERATIONS, 96, "sha256");
  return {
    salt,
    verifierKey: dk.subarray(0, 32),
    kek: dk.subarray(32, 64),
    dataKey: dk.subarray(64, 96),
  };
}

// ============ verifier (cek sandi) ============

/** Verifier = "vrf:v1:<hex>" HMAC(verifierKey, label) — sandi tak pernah disimpan. */
export function computeVaultVerifier(verifierKey: Buffer): string {
  return `${VERIFIER_PREFIX}:${createHmac("sha256", verifierKey).update(VERIFIER_LABEL).digest("hex")}`;
}

/** Cocok sandi terhadap verifier + salt baris (timing-safe atas hex). */
export function verifyVaultPassword(verifier: string, salt: string, password: string): boolean {
  const { verifierKey } = deriveVaultKeys(password, salt);
  const expect = Buffer.from(verifier, "utf8");
  const got = Buffer.from(computeVaultVerifier(verifierKey), "utf8");
  return expect.length === got.length && timingSafeEqual(expect, got);
}

// ============ wrap dataKey (salinan pemulihan) ============

/** Bungkus dataKey dengan KEK → "vlt:v1:<ivB64>:<tagB64>:<ctB64>". */
export function wrapDataKey(kek: Buffer, dataKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ct = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [WRAPPED_PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}
