// OneVity — FIELD CRYPTO (Task 28-c · rev Task 47) =======================
// ========================================================================
// Enkripsi field sensitif SAMPAI LEVEL DATABASE (AES-256-GCM):
//   · NIK (Employee.nationalId), NPWP (Employee.taxId +
//     EmployeePayrollProfile.npwp), no. rekening (Employee.bankAccount +
//     EmployeePayrollProfile.bankAccount) → teks terenkripsi.
//   · Nilai uang payroll (PayrollRunLine/Item/Run, EmployeeAssignment.
//     baseSalary, EmployeeComponentAssignment.amount, PayrollJournal[Line])
//     → teks terenkripsi yang menyimpan angka (encryptMoney/decryptMoney).
//
// SKEMA KUNCI (Task 47 — KATA SANDI PERUSAHAAN, tanpa env var):
//   · dataKey (32 byte) per tenant = PBKDF2(kata sandi brankas uang admin
//     workspace, salt, 210k iter). Disimpan HEX di baris MoneyVault.dataKey
//     (schema tenant itu sendiri) — server bisa dekripsi transparan tanpa
//     input sandi; VISIBILITAS tetap digerbangi status vault-open (memori)
//     + grant MoneyView + scope PII (money-view.ts).
//   · GANTI KATA SANDI = dataKey BARU + SELURUH data di-decrypt lalu
//     di-enkripsi ulang (engine migrate-rekey-vault) — data lama / backup
//     lama tidak terbaca lagi setelah rotasi.
//   · Format v2: enc:v2:<t|n>:<iv>:<tag>:<ct> = AES-256-GCM(dataKey).
//   · Format v1: LEGACY — AES-256-GCM(HMAC(legacyMaster, schema)). Ditulis
//     HANYA pra-setup vault ("kunci bootstrap"); tetap terbaca selamanya
//     (dispatch per prefix) agar migrasi setup/change berjalan mulus.
//   · legacyMaster: ONEVITY_ENCRYPTION_KEY bila di-set (opsional — hanya
//     memperkuat kunci bootstrap pra-vault), else fallback DETERMINISTIK
//     sha256("onevity-dev-fallback:" + TENANT_DB_BASE_URL). Sejak Task 47
//     production TIDAK lagi fail-fast (audit 42 M-10 digantikan model kata
//     sandi perusahaan di DB — arsitektur baru dipilih pemilik produk).
//
// FORMAT NILAI (self-describing):
//   enc:v1|v2:<t|n>:<iv b64>:<tag b64>:<ct b64>
//   t = teks (NIK/NPWP/rekening), n = angka uang (String(n) → parseFloat).
//   Marker t/n membuat walker generik (decryptJson) dapat mengembalikan
//   tipe asli (string / number) tanpa mengetahui skema tabel.
//
// LEGACY PLAINTEXT: decryptText melewati nilai TANPA prefix enc: apa
// adanya (data pra-migrasi tetap terbaca); nilai ter-enkripsi ulang pada
// tulis berikutnya. decryptMoney mem-parse plaintext numerik legacy.
//
// CACHE KUNCI VAULT: Map globalThis (selamat HMR) schema → dataKey|null;
// di-isi oleh primeTenantCrypto (pg) saat request pertama / parity boot,
// dan di-update in-process saat vault setup / ganti sandi.
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

const ENC_PREFIX_V1 = "enc:v1";
const ENC_PREFIX_V2 = "enc:v2";
const KEY_LABEL_PREFIX = "field-crypto:";

/** true bila string tersimpan bernilai terenkripsi OneVity (prefix enc:v1/v2). */
export function isEncrypted(s: string | null | undefined): boolean {
  return typeof s === "string" && (s.startsWith(ENC_PREFIX_V1) || s.startsWith(ENC_PREFIX_V2));
}

// ============ KUNCI BOOTSTRAP LEGACY (v1 — pra-vault) ============

let warnedFallback = false;

/** Master bootstrap v1: ONEVITY_ENCRYPTION_KEY opsional, else fallback
 *  deterministik. Sejak Task 47 TIDAK ada lagi fail-fast production —
 *  kunci v1 hanya dipakai data pra-setup vault; setelah admin mengatur
 *  kata sandi brankas, seluruh data di-re-key ke v2 (dataKey password). */
function legacyMasterKey(): Buffer {
  const env = process.env.ONEVITY_ENCRYPTION_KEY;
  if (env && env.trim().length > 0) {
    // Opsional — memperkuat kunci bootstrap pra-vault (kompatibilitas
    // instalasi lama yang sudah men-set env ini).
    return createHash("sha256").update(env.trim()).digest();
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      "[field-crypto] Belum ada kata sandi brankas perusahaan — data baru ditulis dengan kunci " +
        "bootstrap deterministik (enc:v1). Atur kata sandi enkripsi (tombol Brankas Uang) agar data " +
        "dienkripsi dengan kunci kata sandi perusahaan Anda (enc:v2) — migrasi otomatis saat pengaturan.",
    );
  }
  const base = process.env.TENANT_DB_BASE_URL ?? "local";
  return createHash("sha256").update(`onevity-dev-fallback:${base}`).digest();
}

/** Kunci tenant LEGACY v1 (bootstrap) — HMAC(legacyMaster, label+schema). */
export function legacyTenantKey(schema: string): Buffer {
  return createHmac("sha256", legacyMasterKey()).update(`${KEY_LABEL_PREFIX}${schema}`).digest();
}

// ============ CACHE dataKey VAULT PER TENANT (globalThis — HMR-safe) ============

const VAULT_KEYS = Symbol.for("onevity.fieldCrypto.vaultKeys");
const VAULT_PRIMED = Symbol.for("onevity.fieldCrypto.vaultPrimed");
const globalForCrypto = globalThis as unknown as {
  [VAULT_KEYS]?: Map<string, Buffer | null>;
  [VAULT_PRIMED]?: Set<string>;
};
const vaultKeys: Map<string, Buffer | null> = globalForCrypto[VAULT_KEYS] ?? new Map();
globalForCrypto[VAULT_KEYS] = vaultKeys;
const vaultPrimed: Set<string> = globalForCrypto[VAULT_PRIMED] ?? new Set();
globalForCrypto[VAULT_PRIMED] = vaultPrimed;

/** dataKey vault tenant dari cache proses (null = belum dikonfigurasi). */
export function vaultDataKey(schema: string): Buffer | null {
  return vaultKeys.get(schema) ?? null;
}

/** Set/ganti dataKey vault tenant (dipakai setup / ganti sandi / prime).
 *  Sekali di-set eksplisit, schema ditandai primed (tidak dibaca ulang dari
 *  DB oleh request path — sumber in-process lebih segar). Cache context
 *  TIDAK perlu di-invalidate — kunci dibaca dinamis per panggilan. */
export function setVaultDataKey(schema: string, key: Buffer | null): void {
  if (key == null) vaultKeys.delete(schema);
  else vaultKeys.set(schema, key);
  vaultPrimed.add(schema);
}

/**
 * Muat dataKey vault satu schema dari DB tenant (baris MoneyVault.dataKey,
 * hex 64) ke cache. Idempoten per proses: hanya query bila belum pernah
 * sukses. P2021/tabel belum ada / baris tanpa dataKey → null (belum
 * dikonfigurasi — jalur bootstrap v1). Gagal koneksi → TIDAK ditandai
 * primed (dicoba lagi request berikutnya).
 */
export async function primeTenantCrypto(schema: string): Promise<void> {
  if (vaultPrimed.has(schema)) return;
  const url = process.env.TENANT_DB_BASE_URL;
  if (!url) return;
  const { Client } = await import("pg");
  const c = new Client({ connectionString: url });
  try {
    await c.connect();
    const r = await c.query<{ dataKey: string | null }>(
      `SELECT "dataKey" FROM "${schema}"."MoneyVault" ORDER BY "createdAt" ASC LIMIT 1`,
    );
    const hex = r.rows[0]?.dataKey;
    setVaultDataKey(schema, typeof hex === "string" && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, "hex") : null);
    vaultPrimed.add(schema);
  } catch (e) {
    // Tabel belum ada / kolom belum termigrasi → jalur legacy (bukan error).
    const code = (e as { code?: string }).code;
    if (code === "42P01" /* undefined_table */ || code === "42703" /* undefined_column */) {
      setVaultDataKey(schema, null);
      vaultPrimed.add(schema);
      return;
    }
    // Gangguan koneksi — jangan tandai primed, coba lagi nanti.
    setVaultDataKey(schema, null);
    console.warn(`[field-crypto] prime kunci vault schema ${schema} gagal (dicoba ulang nanti): ${code ?? (e instanceof Error ? e.message : String(e))}`);
  } finally {
    await c.end().catch(() => {});
  }
}

/**
 * Prime SEMUA tenant aktif dari registry platform (dipakai instrumentation
 * saat boot — scheduler/background job membaca field terenkripsi sebelum
 * request pertama). pg mentah (tanpa prisma) — bebas dependensi bundling.
 * Return jumlah schema yang berhasil diproses.
 */
export async function primeAllTenantCrypto(): Promise<number> {
  const tenantUrl = process.env.TENANT_DB_BASE_URL;
  const platformUrl = process.env.PLATFORM_DB_URL;
  if (!tenantUrl || !platformUrl) return 0;
  const { Client } = await import("pg");
  const c = new Client({ connectionString: platformUrl });
  let schemas: string[] = [];
  try {
    await c.connect();
    const r = await c.query<{ schemaName: string }>(
      `SELECT "schemaName" FROM "Tenant" WHERE "status" = 'ACTIVE'`,
    );
    schemas = r.rows.map((row) => row.schemaName).filter((s) => typeof s === "string" && s.length > 0);
  } catch {
    return 0; // platform DB belum siap — jalur request akan prime ulang
  } finally {
    await c.end().catch(() => {});
  }
  let n = 0;
  for (const schema of schemas) {
    await primeTenantCrypto(schema).catch(() => {});
    n++;
  }
  return n;
}

// ============ KONTEKS PER-TENANT ============

const contextCache = new Map<string, FieldCrypto>();

export interface FieldCrypto {
  /** Nama schema tenant milik konteks (diagnostik). */
  readonly schema: string;
  /** Enkripsi teks sensitif (NIK/NPWP/rekening) → enc:v2:t:… (vault) / enc:v1:t:… (bootstrap). */
  encryptText(plain: string | null | undefined): string | null;
  /** Dekripsi teks; plaintext legacy (tanpa prefix) diteruskan apa adanya. */
  decryptText(stored: string | null | undefined): string | null;
  /** Enkripsi angka uang → enc:v2:n:… (vault) / enc:v1:n:… (bootstrap). */
  encryptMoney(n: number | null | undefined): string | null;
  /** Dekripsi angka uang; null → null; plaintext numerik legacy di-parse. */
  decryptMoney(stored: string | null | undefined): number | null;
  /** NIK disamarkan: 2 digit awal + • + 2 digit akhir (3176363464506 → 32••••••••••••06). */
  maskNik(nik: string | null | undefined): string | null;
  /** NPWP disamarkan: hanya 4 digit terakhir terlihat. */
  maskNpwp(npwp: string | null | undefined): string | null;
  /**
   * Walker generik di batas serializer: menyalin struktur JSON apa adanya dan
   * mengganti SETIAP string enc:v1/v2 t/n dengan nilai aslinya (teks / angka).
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

// ============ HELPER KUNCI EKSPLISIT (engine re-key / migrasi) ============

/** Enkripsi teks/angka dengan kunci EKSPLISIT → enc:v2:<kind>:….
 *  Dipakai engine re-enkripsi (migrate-rekey-vault) dengan dataKey baru. */
export function encryptWithKey(kind: "t" | "n", plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_PREFIX_V2, kind, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Dekripsi enc:v1/v2 generik dengan kunci EKSPLISIT — mirror perilaku konteks
 *  (malformat/auth-tag gagal → throw; kind salah → throw). */
function rawDecryptWithKey(stored: string, key: Buffer): { kind: "t" | "n"; value: string } {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "enc" || (parts[1] !== "v1" && parts[1] !== "v2")) {
    throw new Error(`[field-crypto] nilai enc: malformat (${stored.slice(0, 24)}…)`);
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

/** Dekripsi TEKS enc:t:… dengan kunci eksplisit. Legacy plaintext (tanpa
 *  prefix) diteruskan apa adanya — sama decryptText. */
export function decryptTextWithKey(stored: string | null | undefined, key: Buffer): string | null {
  if (stored == null) return null;
  if (!isEncrypted(stored)) return stored; // legacy plaintext — diteruskan
  const { kind, value } = rawDecryptWithKey(stored, key);
  if (kind !== "t") {
    throw new Error("[field-crypto] field teks berisi nilai angka terenkripsi");
  }
  return value;
}

/** Dekripsi ANGKA enc:n:… dengan kunci eksplisit. null → null;
 *  plaintext numerik legacy di-parse — sama decryptMoney. */
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
  /** Kunci tulis: dataKey vault bila sudah dikonfigurasi (v2), else bootstrap v1. */
  const writeKey = (): { key: Buffer; prefix: string } => {
    const dk = vaultDataKey(schema);
    return dk ? { key: dk, prefix: ENC_PREFIX_V2 } : { key: legacyTenantKey(schema), prefix: ENC_PREFIX_V1 };
  };

  /** Kunci baca per prefix nilai: v2 → dataKey; v1 → bootstrap legacy. */
  const readKey = (version: string): Buffer => {
    if (version === "v2") {
      const dk = vaultDataKey(schema);
      if (!dk) {
        throw new Error(
          `[field-crypto:${schema}] nilai enc:v2 (kunci kata sandi perusahaan) tidak dapat dibaca — ` +
            `brankas belum termuat di proses ini. Panggil primeTenantCrypto("${schema}") / buka ulang aplikasi.`,
        );
      }
      return dk;
    }
    return legacyTenantKey(schema);
  };

  const encrypt = (kind: "t" | "n", plain: string): string => {
    const { key, prefix } = writeKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [prefix, kind, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
  };

  const decrypt = (stored: string): { kind: "t" | "n"; value: string } => {
    const parts = stored.split(":");
    // enc:v1|v2:kind:iv:tag:ct → 6 segmen
    if (parts.length !== 6 || parts[0] !== "enc" || (parts[1] !== "v1" && parts[1] !== "v2")) {
      throw new Error(`[field-crypto:${schema}] nilai enc: malformat (${stored.slice(0, 24)}…)`);
    }
    const kind = parts[2];
    if (kind !== "t" && kind !== "n") {
      throw new Error(`[field-crypto:${schema}] jenis nilai tidak dikenal: ${kind}`);
    }
    const key = readKey(parts[1]!);
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
        `[field-crypto:${schema}] gagal dekripsi (auth tag tidak cocok — kata sandi brankas sudah ` +
          `diganti? atau data lintas-tenant?). Awalan nilai: ${stored.slice(0, 24)}…`,
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
