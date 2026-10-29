// RekanKerja — kripto secret LEVEL PLATFORM (schema public).
// =====================================================================
// FEAT-SUPPORT-P5: API key provider AI layanan support (SupportProviderConfig)
// adalah milik platform — BUKAN tenant. tenantCryptoForDb (field-crypto.ts)
// tak bisa dipakai: kuncinya diturunkan per-schema tenant (vault data key /
// legacy HMAC schema). Secret platform mengikuti preseden TOTP (auth.ts):
// AES-256-GCM, kunci = SHA-256(SESSION_SECRET + domain tag) — siapa pun dgn
// akses dump DB tanpa SESSION_SECRET tidak bisa membaca apiKey provider.
// Rotasi SESSION_SECRET membuat secret lama tak terbaca (dibaca sebagai
// rusak → admin platform memasukkan ulang key) — jangan rotasi sembarangan.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sessionSecret } from "@/rekankerja/shared/lib/auth";

const PLATFORM_KEY_DOMAIN = "rekankerja:platform-secret:v1";

function platformAesKey(): Buffer {
  return createHash("sha256").update(`${sessionSecret()}::${PLATFORM_KEY_DOMAIN}`).digest(); // 32 byte
}

/** Enkripsi secret platform → "v1:iv:tag:ct" (base64url, siap disimpan di DB). */
export function encryptPlatformSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", platformAesKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

/** Dekripsi "v1:iv:tag:ct" → plaintext; null bila format rusak/GAGAL (tampered). */
export function decryptPlatformSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", platformAesKey(), Buffer.from(parts[1]!, "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    const pt = Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64url")), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    return null; // rusak / kunci berganti / tampered
  }
}
