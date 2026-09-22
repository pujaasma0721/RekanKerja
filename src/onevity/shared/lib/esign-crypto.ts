// OneVity e-SIGN — kriptografi tanda tangan internal (Task 80). ==============
// ============================================================================
// RSA-2048 + PSS (SHA-256) via node:crypto — tanpa dependency baru.
//   • generateKeyPair   — kunci per pengguna; privat dibungkus field-crypto
//                         tenant (dataKey Money Vault), TIDAK pernah ke klien
//   • computeDocHash    — hash SHA-256 canonical (JSON stabil + timestamp)
//   • signHash / verifyHash — RSA-PSS over digest dokumen
//   • chainHash         — ownHash = SHA-256(prevHash + field record) utk
//                         hash-chain per tenant (tamper-evident)
// Modul PURITY: hanya node:crypto — tanpa DB/env; mudah diuji unit.
// SERVER-ONLY (node runtime). JANGAN impor dari komponen client.
// ============================================================================
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as rsaSign, verify as rsaVerify, type KeyObject } from "node:crypto";

export const ESIGN_ALG = "RSA-PSS-SHA256";
export const GENESIS_HASH = "0".repeat(64); // prevHash tanda tangan pertama tenant

// ---------- keypair ----------

export interface GeneratedKeyPair {
  publicKeyPem: string;  // SPKI
  privateKeyPem: string; // PKCS8
}

/** Kunci baru per pengguna. Privat segera dibungkus pemanggil (field-crypto). */
export function generateKeyPair(): GeneratedKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Fingerprint publik (kolom & docHash pertama verifikasi manual — informatif). */
export function publicKeyFingerprint(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
}

// ---------- doc hash ----------

/**
 * Hash dokumen CANONICAL: JSON dengan kunci terurut + signedAt ISO.
 * signedAt HARUS sama dengan yang ditandatangani (disimpan di record) —
 * hash ulang kapan pun menghasilkan nilai sama (verifiable deterministically).
 */
export function computeDocHash(input: {
  docType: string;
  docId: string;
  docRef: string;
  snapshot: Record<string, unknown>;
  signedAtIso: string;
  tenantSlug: string;
}): string {
  const canonical = JSON.stringify(sortDeep({
    docType: input.docType,
    docId: input.docId,
    docRef: input.docRef,
    snapshot: input.snapshot,
    signedAt: input.signedAtIso,
    tenant: input.tenantSlug,
    alg: ESIGN_ALG,
  }));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortDeep(o[k])]));
  }
  return v;
}

// ---------- sign / verify (RSA-PSS) ----------

/** Tanda tangan atas DIGEST dokumen (hex) — buffer digest ikut sebagai data. */
export function signHash(docHashHex: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  return rsaSign("sha256", Buffer.from(docHashHex, "hex"), {
    key: key as KeyObject,
    padding: 1 /* RSA_PKCS1_PSS_PADDING */,
    saltLength: 32,
  }).toString("base64");
}

export function verifyHash(docHashHex: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return rsaVerify("sha256", Buffer.from(docHashHex, "hex"), {
      key: key as KeyObject,
      padding: 1,
      saltLength: 32,
    }, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

// ---------- hash-chain ----------

/** ownHash record — mengikat prevHash + field identitas (tamper-evident). */
export function chainHash(prevHash: string, record: {
  docType: string; docId: string; docHash: string; signerAppUserId: string; signedAtIso: string;
}): string {
  return createHash("sha256").update(
    `${prevHash}|${record.docType}|${record.docId}|${record.docHash}|${record.signerAppUserId}|${record.signedAtIso}`,
  ).digest("hex");
}

/** Kode challenge 6 digit (crypto-random, tanpa leading-zero bias). */
export function generateChallengeCode(): string {
  return (randomBytes(4).readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
}
