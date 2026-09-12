// OneVity — FIELD CRYPTO (Task 28-c) =====================================
// ========================================================================
// Enkripsi field sensitif SAMPAI LEVEL DATABASE (AES-256-GCM):
//   · NIK (Employee.nationalId), NPWP (Employee.taxId +
//     EmployeePayrollProfile.npwp), no. rekening (Employee.bankAccount +
//     EmployeePayrollProfile.bankAccount) → teks terenkripsi.
//   · Nilai uang payroll (PayrollRunLine/Item/Run, EmployeeAssignment.
//     baseSalary, EmployeeComponentAssignment.amount, PayrollJournal[Line])
//     → teks terenkripsi yang menyimpan angka (encryptMoney/decryptMoney).
//
// SKEMA KUNCI:
//   master key  = ONEVITY_ENCRYPTION_KEY (env) — PRODUKSI WAJIB DI-SET.
//                 Bila kosong:
//                 · NODE_ENV=production → THROW pada penggunaan pertama
//                   (fix audit 42 M-10 — fallback deterministik tidak boleh
//                   dipakai di produksi: kunci bisa ditebak → data mudah dibuka).
//                 · dev/test → fallback DETERMINISTIK:
//                   sha256("onevity-dev-fallback:" + TENANT_DB_BASE_URL ?? "local")
//                   + console.warn sekali (instance sandbox/dev saja).
//   tenant key  = HMAC-SHA256(masterKey, "field-crypto:" + schema) — 32 byte,
//                 satu sub-kunci unik per schema tenant (domain-separated).
//                 Rotasi master key MEMBATALKAN data lama (dekripsi gagal).
//
// FORMAT NILAI (self-describing):
//   enc:v1:<t|n>:<iv b64>:<tag b64>:<ct b64>
//   t = teks (NIK/NPWP/rekening), n = angka uang (String(n) → parseFloat).
//   Marker t/n membuat walker generik (decryptJson) dapat mengembalikan
//   tipe asli (string / number) tanpa mengetahui skema tabel.
//
// LEGACY PLAINTEXT: decryptText melewati nilai TANPA prefix enc:v1 apa
// adanya (data pra-migrasi tetap terbaca); nilai ter-enkripsi ulang pada
// tulis berikutnya. decryptMoney mem-parse plaintext numerik legacy.
//
// KONSUMEN: helper menerima KONTEKS per-tenant — `tenantCrypto(schema)`
// eksplisit (skrip migrasi) atau `tenantCryptoForDb(db)` yang membaca
// brand symbol yang ditempel getTenantClient() pada client Prisma. Untuk
// kode DI DALAM $transaction (Prisma.TransactionClient tanpa brand),
// tangkap konteks dari client LUAR sebelum masuk transaksi (closure).
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Brand schema tenant pada instance client Prisma (ditempel getTenantClient).
 * NOTE: memakai STRING KEY tetap (bukan Symbol) — Symbol di-re-create oleh
 * HMR/Turbopack saat module di-evaluasi ulang, memutus identitas dgn client
 * yang sudah ter-cache di globalThis ("tanpa brand" palsu). String selamat
 * lintas hot-reload.
 */
export const TENANT_SCHEMA_BRAND = "__onevityTenantSchema" as const;

const ENC_PREFIX = "enc:v1";
const KEY_LABEL_PREFIX = "field-crypto:";

/** true bila string tersimpan bernilai terenkripsi OneVity (prefix enc:v1). */
export function isEncrypted(s: string | null | undefined): boolean {
  return typeof s === "string" && s.startsWith(ENC_PREFIX);
}

// ============ MASTER KEY ============

let warnedFallback = false;

function masterKey(): Buffer {
  const env = process.env.ONEVITY_ENCRYPTION_KEY;
  if (env && env.trim().length > 0) {
    // Kunci dipakai apa adanya (disarankan ≥ 32 karakter acak).
    return createHash("sha256").update(env.trim()).digest();
  }
  // fix audit 42 M-10 — fail-fast PRODUCTION: tanpa kunci env, fallback dev
  // deterministik TIDAK diizinkan. Throw saat PENGGUNAAN PERTAMA (bukan saat
  // import) — boot tetap jalan, tapi operasi crypto pertama gagal dengan
  // pesan yang jelas alih-alih "terenkripsi" dengan kunci tebakan.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[field-crypto] ONEVITY_ENCRYPTION_KEY wajib di-set di production — kunci fallback deterministik dev tidak diizinkan (data tidak aman). " +
        "Set variabel lingkungan ONEVITY_ENCRYPTION_KEY (disarankan ≥ 32 karakter acak) lalu restart.",
    );
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      "[field-crypto] ONEVITY_ENCRYPTION_KEY belum di-set — memakai kunci fallback DETERMINISTIK dev " +
        "(sha256 satu basis data). PRODUKSI WAJIB men-set ONEVITY_ENCRYPTION_KEY (rotasi kunci = data " +
        "terenkripsi tidak dapat dibaca lagi).",
    );
  }
  const base = process.env.TENANT_DB_BASE_URL ?? "local";
  return createHash("sha256").update(`onevity-dev-fallback:${base}`).digest();
}

// ============ KONTEKS PER-TENANT ============

const contextCache = new Map<string, FieldCrypto>();

function deriveTenantKey(schema: string): Buffer {
  return createHmac("sha256", masterKey()).update(`${KEY_LABEL_PREFIX}${schema}`).digest();
}

export interface FieldCrypto {
  /** Nama schema tenant milik konteks (diagnostik). */
  readonly schema: string;
  /** Enkripsi teks sensitif (NIK/NPWP/rekening) → enc:v1:t:…. */
  encryptText(plain: string | null | undefined): string | null;
  /** Dekripsi teks; plaintext legacy (tanpa prefix) diteruskan apa adanya. */
  decryptText(stored: string | null | undefined): string | null;
  /** Enkripsi angka uang → enc:v1:n:… (String(n) round-trip presisi double). */
  encryptMoney(n: number | null | undefined): string | null;
  /** Dekripsi angka uang; null → null; plaintext numerik legacy di-parse. */
  decryptMoney(stored: string | null | undefined): number | null;
  /** NIK disamarkan: 2 digit awal + • + 2 digit akhir (3176363464506 → 32••••••••••••06). */
  maskNik(nik: string | null | undefined): string | null;
  /** NPWP disamarkan: hanya 4 digit terakhir terlihat. */
  maskNpwp(npwp: string | null | undefined): string | null;
  /**
   * Walker generik di batas serializer: menyalin struktur JSON apa adanya dan
   * mengganti SETIAP string enc:v1:t/n dengan nilai aslinya (teks / angka).
   * Response API tetap berbentuk lama — angka tetap angka, frontend tidak
   * berubah. Date/number/boolean/null tidak tersentuh.
   */
  decryptJson<T>(value: T): T;
}

/** Konteks crypto untuk satu schema tenant (di-cache per schema per proses). */
export function tenantCrypto(schema: string): FieldCrypto {
  let ctx = contextCache.get(schema);
  if (!ctx) {
    ctx = makeContext(schema);
    contextCache.set(schema, ctx);
  }
  return ctx;
}

/**
 * Konteks crypto dari instance client Prisma tenant — membaca brand symbol
 * yang ditempel getTenantClient(). Client transaksi Prisma TIDAK membawa
 * brand: tangkap konteks dari client luar SEBELUM db.$transaction.
 */
export function tenantCryptoForDb(db: object): FieldCrypto {
  const schema = (db as Record<string, unknown>)[TENANT_SCHEMA_BRAND];
  if (typeof schema !== "string" || !schema) {
    throw new Error(
      "[field-crypto] client Prisma tanpa brand schema tenant — dapatkan konteks dari client luar " +
        "(getTenantClient) sebelum masuk $transaction, atau pakai tenantCrypto(schema) eksplisit.",
    );
  }
  return tenantCrypto(schema);
}

// ============ HELPER KUNCI EKSPLISIT (Task 45-a — money vault) ============
// Dipakai money-vault.ts / money-view.ts: kunci data tenant 32 byte yang
// SAMA dengan yang dipakai konteks env (tenantCrypto) — vault hanya
// membungkus (wrap) kunci ini dengan KEK hasil PBKDF2 sandi admin.

/** Kunci data tenant (32 byte) = HMAC-SHA256(master, "field-crypto:"+schema).
 *  Sumber tunggal deriveTenantKey — dipakai money-vault utk men-wrap DEK. */
export function tenantDataKey(schema: string): Buffer {
  return deriveTenantKey(schema);
}

/** Dekripsi enc:v1 generik dengan kunci EKSPLISIT (bukan dari env) —
 *  walker raw pemakaan vault (DEK hasil unwrap). Mirror perilaku konteks
 *  (malformat/auth-tag gagal → throw; kind salah → throw). */
function rawDecryptWithKey(stored: string, key: Buffer): { kind: "t" | "n"; value: string } {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error(`[field-crypto] nilai enc:v1 malformat (${stored.slice(0, 24)}…)`);
  }
  const kind = parts[2];
  if (kind !== "t" && kind !== "n") {
    throw new Error(`[field-crypto] jenis nilai tidak dikenal: ${kind}`);
  }
  try {
    const iv = Buffer.from(parts[3]!, "base64");
    const tag = Buffer.from(parts[4]!, "base64");
    const ct = Buffer.from(parts[5]!, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    return { kind, value: pt };
  } catch {
    throw new Error(
      `[field-crypto] gagal dekripsi (auth tag tidak cocok — kunci salah atau data lintas-tenant?). Awalan nilai: ${stored.slice(0, 24)}…`,
    );
  }
}

/** Dekripsi TEKS enc:v1:t:… dengan kunci eksplisit (vault open / DEK).
 *  Legacy plaintext (tanpa prefix) diteruskan apa adanya — sama decryptText. */
export function decryptTextWithKey(stored: string | null | undefined, key: Buffer): string | null {
  if (stored == null) return null;
  if (!isEncrypted(stored)) return stored; // legacy plaintext — diteruskan
  const { kind, value } = rawDecryptWithKey(stored, key);
  if (kind !== "t") {
    throw new Error("[field-crypto] field teks berisi nilai angka terenkripsi");
  }
  return value;
}

/** Dekripsi ANGKA enc:v1:n:… dengan kunci eksplisit (vault open / DEK).
 *  null → null; plaintext numerik legacy di-parse — sama decryptMoney. */
export function decryptMoneyWithKey(stored: string | null | undefined, key: Buffer): number | null {
  if (stored == null) return null;
  if (!isEncrypted(stored)) {
    const legacy = parseFloat(stored);
    return Number.isFinite(legacy) ? legacy : null; // plaintext numerik pra-migrasi
  }
  const { kind, value } = rawDecryptWithKey(stored, key);
  if (kind !== "n") {
    throw new Error("[field-crypto] field uang berisi nilai teks terenkripsi");
  }
  const n = parseFloat(value);
  if (!Number.isFinite(n)) {
    throw new Error(`[field-crypto] nilai uang terenkripsi bukan angka: ${value}`);
  }
  return n;
}

// ============ IMPLEMENTASI ============

function makeContext(schema: string): FieldCrypto {
  // Kunci tenant di-derive sekali per konteks (per proses per schema).
  const key = deriveTenantKey(schema);

  const encrypt = (kind: "t" | "n", plain: string): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENC_PREFIX, kind, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
  };

  const decrypt = (stored: string): { kind: "t" | "n"; value: string } => {
    const parts = stored.split(":");
    // enc:v1:kind:iv:tag:ct → 6 segmen
    if (parts.length !== 6 || parts[0] !== "enc" || parts[1] !== "v1") {
      throw new Error(`[field-crypto:${schema}] nilai enc:v1 malformat (${stored.slice(0, 24)}…)`);
    }
    const kind = parts[2];
    if (kind !== "t" && kind !== "n") {
      throw new Error(`[field-crypto:${schema}] jenis nilai tidak dikenal: ${kind}`);
    }
    try {
      const iv = Buffer.from(parts[3], "base64");
      const tag = Buffer.from(parts[4], "base64");
      const ct = Buffer.from(parts[5], "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      return { kind, value: pt };
    } catch {
      throw new Error(
        `[field-crypto:${schema}] gagal dekripsi (auth tag tidak cocok — ONEVITY_ENCRYPTION_KEY ` +
          `berubah atau data lintas-tenant?). Awalan nilai: ${stored.slice(0, 24)}…`,
      );
    }
  };

  const maskKeep = (raw: string, head: number, tail: number): string => {
    const s = raw.trim();
    if (!s) return "";
    if (s.length <= head + tail) return "•".repeat(s.length);
    return s.slice(0, head) + "•".repeat(s.length - head - tail) + s.slice(-tail);
  };

  const ctx: FieldCrypto = {
    schema,
    encryptText(plain) {
      if (plain == null || plain === "") return plain == null ? null : "";
      return encrypt("t", String(plain));
    },
    decryptText(stored) {
      if (stored == null) return null;
      if (!isEncrypted(stored)) return stored; // legacy plaintext — diteruskan
      const { kind, value } = decrypt(stored);
      if (kind !== "t") {
        throw new Error(`[field-crypto:${schema}] field teks berisi nilai angka terenkripsi`);
      }
      return value;
    },
    encryptMoney(n) {
      if (n == null) return null;
      return encrypt("n", String(n));
    },
    decryptMoney(stored) {
      if (stored == null) return null;
      if (!isEncrypted(stored)) {
        const legacy = parseFloat(stored);
        return Number.isFinite(legacy) ? legacy : null; // plaintext numerik pra-migrasi
      }
      const { kind, value } = decrypt(stored);
      if (kind !== "n") {
        throw new Error(`[field-crypto:${schema}] field uang berisi nilai teks terenkripsi`);
      }
      const n = parseFloat(value);
      if (!Number.isFinite(n)) {
        throw new Error(`[field-crypto:${schema}] nilai uang terenkripsi bukan angka: ${value}`);
      }
      return n;
    },
    maskNik(nik) {
      if (nik == null) return null;
      const plain = isEncrypted(nik) ? ctx.decryptText(nik) : nik;
      return plain == null ? null : maskKeep(plain, 2, 2);
    },
    maskNpwp(npwp) {
      if (npwp == null) return null;
      const plain = isEncrypted(npwp) ? ctx.decryptText(npwp) : npwp;
      if (plain == null) return null;
      return "•".repeat(Math.max(0, plain.length - 4)) + plain.slice(-4);
    },
    decryptJson<T>(value: T): T {
      const walk = (v: unknown): unknown => {
        if (v == null) return v;
        if (typeof v === "string") {
          if (!isEncrypted(v)) return v;
          const { kind, value: pt } = decrypt(v);
          if (kind === "n") {
            const n = parseFloat(pt);
            if (!Number.isFinite(n)) {
              throw new Error(`[field-crypto:${schema}] nilai uang terenkripsi bukan angka: ${pt}`);
            }
            return n;
          }
          return pt;
        }
        if (Array.isArray(v)) return v.map(walk);
        if (v instanceof Date) return v;
        if (typeof v === "object") {
          // objek polos (row Prisma / DTO) — salin dengan nilai terdekripsi
          const out: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
          return out;
        }
        return v;
      };
      return walk(value) as T;
    },
  };
  return ctx;
}
