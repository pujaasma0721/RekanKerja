// RekanKerja — MONEY VAULT (Task 45-a · rev Task 47) =========================
// ========================================================================
// "Brankas uang" per tenant: KATA SANDI PERUSAHAAN (dikelola admin workspace
// via UI — bebas diganti kapan pun) adalah SUMBER kunci enkripsi seluruh
// data sensitif (PII + uang) schema tenant ini:
//
//   dataKey = PBKDF2(kata sandi, salt, 210k) — 32 byte  (vault-derive.ts)
//   · disimpan HEX di baris MoneyVault.dataKey (schema tenant — "password di
//     DB" sesuai permintaan produk) → server dekripsi TRANSPARAN tanpa input
//     sandi: operasional harian (payroll, klaim, laporan) tidak terganggu.
//   · visibilitas UANG tetap digerbangi: status open (memori, TTL 8 jam) +
//     grant MoneyView (money-view.ts). PII digerbangi scope PII (M-9).
//   · GANTI KATA SANDI = dataKey BARU + SELURUH data di-decrypt lalu
//     di-enkripsi ulang (engine migrate-rekey-vault, SATU transaksi
//     atomik + advisory lock) — backup/data lama tak terbaca setelah rotasi.
//   · admin memberi hak lihat uang ke anggota lain TANPA menyebar sandi.
//
// ARSITEKTUR STATE:
//   · Status "open" OTORITATIF ada di MEMORI proses (openKeys per schema,
//     symbol-keyed globalThis — selamat lintas HMR; restart = terkunci).
//     Kolom DB openUntil/openByUserId hanya INFORMATIF (diagnostik/audit).
//   · configCache (baris MoneyVault, TTL 60s) di-invalidate saat setup /
//     change-password; grantCache (Set userId aktif, TTL 60s) di-invalidate
//     saat grant/revoke.
//   · fails: lockout percobaan sandi salah (5× → 15 menit) per schema —
//     dipakai unlock DAN ganti sandi (sama-sama menebak sandi).
//   · rekeyJobs: guard in-process — satu operasi re-enkripsi per schema.
//
// KRIPTO (vault-derive.ts, node:crypto saja):
//   PBKDF2(sandi, salt 16 byte, 210_000 iter, sha256, keylen 96)
//     → verifierKey (HMAC verifier) | kek (wrap dataKey) | dataKey (enc:v2).
//   verifier   = "vrf:v1:" + HMAC-SHA256(verifierKey, label).hex
//   wrappedKey = "vlt:v1:…" = AES-256-GCM(kek, dataKey) — SALINAN PEMULIHAN.
//   dataKey    = hex di kolom "dataKey" — kunci aktif produk.
//
// KONSUMEN: db yang diberikan HARUS client tenant ber-brand schema
// (getTenantClient) — sama prasyarat tenantCryptoForDb.
import { randomUUID } from "node:crypto";
import { db as platformDb } from "@/lib/db";
import { TENANT_SCHEMA_BRAND, setVaultDataKey } from "./field-crypto";
import { computeVaultVerifier, deriveVaultKeys, verifyVaultPassword, wrapDataKey } from "./vault-derive";
import type { TenantDb } from "./tenant-db";
import type { RekeyStats } from "../../../../scripts/migrate-rekey-vault";

// ============ konstanta ============

export const PBKDF2_ITERATIONS = 210_000;
export const VAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam — auto-lock saat TTL habis
export const LOCKOUT_MAX_FAILS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 menit
export const MIN_PASSWORD_LEN = 6; // Task 47: "terserah mau password apa" — batas minimal wajar

const CONFIG_TTL_MS = 60_000; // cache baris MoneyVault
const GRANT_TTL_MS = 60_000; // cache Set grant aktif

function tenantUrl(): string {
  const url = process.env.TENANT_DB_BASE_URL;
  if (!url) throw new Error("TENANT_DB_BASE_URL belum diset");
  return url;
}

// ============ error ============

export type VaultErrorCode =
  | "ALREADY_CONFIGURED"
  | "NOT_CONFIGURED"
  | "INVALID_PASSWORD"
  | "VAULT_LOCKED"
  | "LOCKOUT"
  | "WEAK_PASSWORD"
  | "NOT_ADMIN"
  | "NOT_MEMBER"
  | "REKEY_IN_PROGRESS";

/** Peta status HTTP: 400 WEAK_PASSWORD · 403 INVALID_PASSWORD/NOT_ADMIN ·
 *  404 NOT_MEMBER · 409 ALREADY_CONFIGURED/VAULT_LOCKED/NOT_CONFIGURED/
 *  REKEY_IN_PROGRESS · 429 LOCKOUT. */
export const VAULT_ERROR_STATUS: Record<VaultErrorCode, number> = {
  WEAK_PASSWORD: 400,
  INVALID_PASSWORD: 403,
  NOT_ADMIN: 403,
  NOT_MEMBER: 404,
  ALREADY_CONFIGURED: 409,
  VAULT_LOCKED: 409,
  NOT_CONFIGURED: 409,
  REKEY_IN_PROGRESS: 409,
  LOCKOUT: 429,
};

/** Pesan manusiawi (Bahasa Indonesia) — sandi TIDAK PERNAH masuk pesan. */
export const VAULT_ERROR_MESSAGES: Record<VaultErrorCode, string> = {
  ALREADY_CONFIGURED: "Vault uang sudah dikonfigurasi untuk workspace ini — gunakan ganti kata sandi vault.",
  NOT_CONFIGURED: "Vault uang belum dikonfigurasi — atur kata sandi vault terlebih dahulu.",
  INVALID_PASSWORD: "Kata sandi vault salah.",
  VAULT_LOCKED: "Vault uang sedang terkunci — buka kunci vault terlebih dahulu.",
  LOCKOUT: "Terlalu banyak percobaan kata sandi salah — vault terkunci sementara, coba lagi nanti.",
  WEAK_PASSWORD: `Kata sandi vault minimal ${MIN_PASSWORD_LEN} karakter.`,
  NOT_ADMIN: "Hanya admin workspace (Owner/Admin) yang dapat mengelola vault uang.",
  NOT_MEMBER: "Pengguna tersebut bukan anggota workspace ini.",
  REKEY_IN_PROGRESS: "Proses re-enkripsi data sedang berjalan untuk workspace ini — tunggu hingga selesai lalu coba lagi.",
};

export class VaultError extends Error {
  constructor(public code: VaultErrorCode, public status: number, message?: string) {
    super(message ?? VAULT_ERROR_MESSAGES[code]);
    this.name = "VaultError";
  }
}

// ============ state in-memory (symbol-keyed globalThis — selamat HMR) ============

interface VaultRow {
  id: string;
  salt: string;
  verifier: string;
  wrappedKey: string;
  openUntil: Date | null;
  openByUserId: string | null;
}

interface OpenEntry {
  openUntil: number; // epoch ms — autoritatif (memori), TTL 8 jam
  openBy: string;
}

interface VaultState {
  openKeys: Map<string, OpenEntry>;
  configCache: Map<string, { row: VaultRow | null; cachedAt: number }>;
  grantCache: Map<string, { ids: Set<string>; cachedAt: number }>;
  fails: Map<string, { count: number; lockoutUntil: number }>;
  rekeyJobs: Set<string>; // schema dengan re-enkripsi berjalan
}

const VAULT_STATE = Symbol.for("rekankerja.moneyVault.state");
const globalForVault = globalThis as unknown as { [VAULT_STATE]?: VaultState };
const state: VaultState =
  globalForVault[VAULT_STATE] ??
  { openKeys: new Map(), configCache: new Map(), grantCache: new Map(), fails: new Map(), rekeyJobs: new Set() };
globalForVault[VAULT_STATE] = state;

// ============ resolusi schema dari client tenant ============

function schemaOf(db: TenantDb): string {
  const schema = (db as unknown as Record<string, unknown>)[TENANT_SCHEMA_BRAND];
  if (typeof schema !== "string" || !schema) {
    throw new Error(
      "[money-vault] client Prisma tanpa brand schema tenant — dapatkan client dari getTenantClient() " +
        "(brand dipasang getTenantClient; client $transaction tidak ber-brand).",
    );
  }
  return schema;
}

// ============ akses baris + grant (cache) ============

/** Baris MoneyVault (satu per schema — findFirst; >1 baris → pakai pertama).
 *  Cache 60s; P2021/P2022 (tabel/kolom belum termigrasi parity) → null =
 *  belum dikonfigurasi. Kolom dataKey sengaja TIDAK di-select (dibaca
 *  terpisah via pg oleh primeTenantCrypto — bebas P2022 pra-parity). */
async function vaultRow(db: TenantDb): Promise<VaultRow | null> {
  const schema = schemaOf(db);
  const cached = state.configCache.get(schema);
  if (cached && Date.now() - cached.cachedAt < CONFIG_TTL_MS) return cached.row;
  let row: VaultRow | null = null;
  try {
    const r = await db.moneyVault.findFirst({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        salt: true,
        verifier: true,
        wrappedKey: true,
        openUntil: true,
        openByUserId: true,
      },
    });
    row = r ?? null;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2021" || code === "P2022") return null; // tabel/kolom belum ada → legacy
    throw e;
  }
  state.configCache.set(schema, { row, cachedAt: Date.now() });
  return row;
}

/** Entri open dari memori; TTL lewat → dihapus otomatis (auto-lock). */
function openEntry(schema: string): OpenEntry | null {
  const e = state.openKeys.get(schema);
  if (!e) return null;
  if (e.openUntil <= Date.now()) {
    state.openKeys.delete(schema); // TTL 8 jam habis — anggap terkunci
    return null;
  }
  return e;
}

/** Catat percobaan sandi salah (unlock / ganti sandi) → lockout setelah 5×. */
function registerFail(schema: string): VaultError {
  const f = state.fails.get(schema) ?? { count: 0, lockoutUntil: 0 };
  f.count += 1;
  if (f.count >= LOCKOUT_MAX_FAILS) {
    f.lockoutUntil = Date.now() + LOCKOUT_MS;
    f.count = 0; // setelah lockout habis, hitungan mulai segar
    state.fails.set(schema, f);
    return new VaultError("LOCKOUT", 429);
  }
  state.fails.set(schema, f);
  return new VaultError("INVALID_PASSWORD", 403);
}

// ============ API publik ============

export type VaultActor = { userId: string; membershipRole: string | null | undefined };

/** Status inti vault utk gerbang money-view: terkonfigurasi? open?
 *  (Open hanya dari MEMORI proses; kunci dekripsi dibaca field-crypto.) */
export interface VaultOpenState {
  configured: boolean;
  open: boolean;
}

/** Dikonsumsi money-view.ts (getMoneyView). */
export async function vaultOpenState(db: TenantDb): Promise<VaultOpenState> {
  const schema = schemaOf(db);
  const row = await vaultRow(db);
  const e = openEntry(schema);
  return { configured: row != null, open: e != null };
}

export interface VaultInfo {
  configured: boolean;
  open: boolean;
  openUntil: Date | null;
  openBy: string | null;
  lockoutUntil: Date | null;
}

/** Status vault untuk UI (open bersifat otoritatif dari MEMORI proses ini). */
export async function vaultInfo(db: TenantDb): Promise<VaultInfo> {
  const schema = schemaOf(db);
  const row = await vaultRow(db);
  const e = openEntry(schema);
  const fail = state.fails.get(schema);
  const lockoutUntil = fail && fail.lockoutUntil > Date.now() ? new Date(fail.lockoutUntil) : null;
  return {
    configured: row != null,
    open: e != null,
    openUntil: e ? new Date(e.openUntil) : null,
    openBy: e ? e.openBy : (row?.openByUserId ?? null),
    lockoutUntil,
  };
}

/**
 * Atur kata sandi vault PERTAMA KALI (satu baris per schema). Semua data
 * terenkripsi lama (v1 bootstrap / plaintext) langsung di-RE-ENKRIPSI dengan
 * dataKey hasil PBKDF2 sandi ini — SATU TRANSAKSI atomik (advisory lock;
 * gagal di tengah = rollback bersih, data tetap terbaca jalur lama).
 * Vault langsung OPEN (admin baru saja memasukkan sandi). 409 bila sudah
 * dikonfigurasi.
 */
export async function setupVault(
  db: TenantDb,
  actor: VaultActor,
  password: string,
): Promise<{ reEncrypted: RekeyStats }> {
  const schema = schemaOf(db);
  const existing = await vaultRow(db);
  if (existing) throw new VaultError("ALREADY_CONFIGURED", 409);
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
    throw new VaultError("WEAK_PASSWORD", 400);
  }
  if (state.rekeyJobs.has(schema)) throw new VaultError("REKEY_IN_PROGRESS", 409);
  state.rekeyJobs.add(schema);

  const keys = deriveVaultKeys(password);
  const verifier = computeVaultVerifier(keys.verifierKey);
  const wrappedKey = wrapDataKey(keys.kek, keys.dataKey);
  const dataKeyHex = keys.dataKey.toString("hex");
  const openUntil = Date.now() + VAULT_TTL_MS;

  const { Client } = await import("pg");
  const c = new Client({ connectionString: tenantUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${schema}:vault-rekey`]);
    // re-cek di dalam lock: dua admin setup bersamaan → salah satu 409
    const r = await c
      .query(`SELECT 1 FROM "${schema}"."MoneyVault" LIMIT 1`)
      .catch((e: { code?: string }) => {
        if (e.code === "42P01") {
          throw new Error(
            `[money-vault] tabel "${schema}"."MoneyVault" belum ada — jalur parity/DDL harus berjalan lebih dulu (restart aplikasi).`,
          );
        }
        throw e;
      });
    if (r.rowCount && r.rowCount > 0) throw new VaultError("ALREADY_CONFIGURED", 409);

    await c.query(
      `INSERT INTO "${schema}"."MoneyVault"
         (id, salt, verifier, "wrappedKey", "dataKey", "openUntil", "openByUserId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())`,
      [randomUUID(), keys.salt, verifier, wrappedKey, dataKeyHex, new Date(openUntil), actor.userId],
    );

    // ---- re-enkripsi SELURUH data (v1/plaintext → v2 dataKey sandi ini) ----
    const { rekeyVaultData } = await import("../../../../scripts/migrate-rekey-vault");
    const stats = await rekeyVaultData(c, { schema, oldDataKey: null, newDataKey: keys.dataKey });

    await c.query("COMMIT");
    // pasca-commit: kunci aktif di cache proses + vault terbuka
    setVaultDataKey(schema, keys.dataKey);
    state.configCache.delete(schema);
    state.openKeys.set(schema, { openUntil, openBy: actor.userId });
    state.fails.delete(schema);
    return { reEncrypted: stats };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    state.rekeyJobs.delete(schema);
    await c.end().catch(() => {});
  }
}

/** Buka vault (admin memasukkan sandi) → status open di memori 8 jam.
 *  Kesalahan sandi menaikkan fails → 429 LOCKOUT setelah 5× (15 menit). */
export async function unlockVault(
  db: TenantDb,
  password: string,
  actor?: VaultActor,
): Promise<{ openUntil: Date }> {
  const schema = schemaOf(db);
  const row = await vaultRow(db);
  if (!row) throw new VaultError("NOT_CONFIGURED", 409);

  const fail = state.fails.get(schema);
  if (fail && fail.lockoutUntil > Date.now()) throw new VaultError("LOCKOUT", 429);

  if (typeof password !== "string" || !verifyVaultPassword(row.verifier, row.salt, password)) {
    throw registerFail(schema);
  }

  state.fails.delete(schema); // sukses — reset hitungan gagal
  const openUntil = Date.now() + VAULT_TTL_MS;
  state.openKeys.set(schema, { openUntil, openBy: actor?.userId ?? row.openByUserId ?? "unknown" });
  // sinkron kolom informatif (best-effort — status open tetap dari memori)
  await db.moneyVault
    .update({
      where: { id: row.id },
      data: { openUntil: new Date(openUntil), ...(actor ? { openByUserId: actor.userId } : {}) },
    })
    .catch(() => {});
  state.configCache.delete(schema);
  return { openUntil: new Date(openUntil) };
}

/** Kunci vault — hapus status open dari memori (idempoten). */
export async function lockVault(db: TenantDb): Promise<void> {
  const schema = schemaOf(db);
  const wasOpen = state.openKeys.delete(schema);
  if (wasOpen) {
    const row = await vaultRow(db);
    if (row) {
      await db.moneyVault.update({ where: { id: row.id }, data: { openUntil: null } }).catch(() => {});
      state.configCache.delete(schema);
    }
  }
}

/**
 * GANTI KATA SANDI VAULT (Task 47 — inti permintaan produk):
 *   1. verifikasi kata sandi saat ini (lockout bila salah terus-menerus);
 *   2. derive dataKey BARU dari sandi baru;
 *   3. SATU TRANSAKSI (advisory lock): SELURUH data di-decrypt dengan kunci
 *      lama (dataKey lama dari baris / v1 bootstrap / plaintext) lalu
 *      di-enkripsi ulang dengan dataKey baru + UPDATE baris vault;
 *   4. rollback bersih bila gagal di tengah — tidak ada campuran kunci.
 * Boleh dilakukan KAPAN PUN (vault open maupun closed — verifikasi sandi
 * adalah gerbangnya). Status open/closed DIPERTAHANKAN apa adanya.
 */
export async function changeVaultPassword(
  db: TenantDb,
  currentPassword: string,
  newPassword: string,
): Promise<{ reEncrypted: RekeyStats }> {
  const schema = schemaOf(db);
  const row = await vaultRow(db);
  if (!row) throw new VaultError("NOT_CONFIGURED", 409);

  const fail = state.fails.get(schema);
  if (fail && fail.lockoutUntil > Date.now()) throw new VaultError("LOCKOUT", 429);
  if (typeof currentPassword !== "string" || !verifyVaultPassword(row.verifier, row.salt, currentPassword)) {
    throw registerFail(schema);
  }
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LEN) {
    throw new VaultError("WEAK_PASSWORD", 400);
  }
  if (state.rekeyJobs.has(schema)) throw new VaultError("REKEY_IN_PROGRESS", 409);
  state.rekeyJobs.add(schema);

  const keys = deriveVaultKeys(newPassword);
  const verifier = computeVaultVerifier(keys.verifierKey);
  const wrappedKey = wrapDataKey(keys.kek, keys.dataKey);
  const dataKeyHex = keys.dataKey.toString("hex");

  const { Client } = await import("pg");
  const c = new Client({ connectionString: tenantUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${schema}:vault-rekey`]);
    // dataKey LAMA dari baris (di dalam lock — konsisten dengan re-cek baris)
    const r = await c.query<{ id: string; dataKey: string | null }>(
      `SELECT id, "dataKey" FROM "${schema}"."MoneyVault" ORDER BY "createdAt" ASC LIMIT 1`,
    );
    const current = r.rows[0];
    if (!current || current.id !== row.id) {
      throw new VaultError("ALREADY_CONFIGURED", 409); // baris berubah — retry
    }
    let oldDataKey: Buffer | null = null;
    if (current.dataKey && /^[0-9a-f]{64}$/i.test(current.dataKey)) {
      oldDataKey = Buffer.from(current.dataKey, "hex");
    }

    // ---- decrypt SEMUA data dengan kunci lama → encrypt ulang kunci baru ----
    const { rekeyVaultData } = await import("../../../../scripts/migrate-rekey-vault");
    const stats = await rekeyVaultData(c, { schema, oldDataKey, newDataKey: keys.dataKey });

    await c.query(
      `UPDATE "${schema}"."MoneyVault"
         SET salt = $1, verifier = $2, "wrappedKey" = $3, "dataKey" = $4, "updatedAt" = now()
         WHERE id = $5`,
      [keys.salt, verifier, wrappedKey, dataKeyHex, row.id],
    );

    await c.query("COMMIT");
    // pasca-commit: kunci baru aktif di cache proses; status open tak berubah
    setVaultDataKey(schema, keys.dataKey);
    state.configCache.delete(schema);
    state.fails.delete(schema); // ganti sandi sukses — reset hitungan
    return { reEncrypted: stats };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    state.rekeyJobs.delete(schema);
    await c.end().catch(() => {});
  }
}

/** Beri/tarik hak lihat uang (tanpa sandi). Idempoten; grantCache di-invalidate. */
export async function setGrant(
  db: TenantDb,
  actor: VaultActor,
  targetUserId: string,
  grant: boolean,
): Promise<void> {
  const existing = await db.moneyViewGrant.findUnique({ where: { userId: targetUserId } });
  if (grant) {
    if (!existing) {
      await db.moneyViewGrant.create({ data: { userId: targetUserId, grantedBy: actor.userId } });
    } else if (existing.revokedAt != null) {
      // aktifkan ulang: reset revokedAt + catat pemberi/waktu baru
      await db.moneyViewGrant.update({
        where: { id: existing.id },
        data: { revokedAt: null, grantedBy: actor.userId, grantedAt: new Date() },
      });
    } // sudah aktif → no-op (idempoten)
  } else {
    if (existing && existing.revokedAt == null) {
      await db.moneyViewGrant.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    } // sudah dicabut/tidak ada → no-op
  }
  state.grantCache.delete(schemaOf(db));
}

/** Set userId platform dengan grant AKTIF (revokedAt null) — cache 60s. */
export async function grantUserIds(db: TenantDb): Promise<Set<string>> {
  const schema = schemaOf(db);
  const cached = state.grantCache.get(schema);
  if (cached && Date.now() - cached.cachedAt < GRANT_TTL_MS) return cached.ids;
  let ids = new Set<string>();
  try {
    const rows = await db.moneyViewGrant.findMany({ where: { revokedAt: null }, select: { userId: true } });
    ids = new Set(rows.map((r) => r.userId));
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "P2021" && code !== "P2022") throw e; // tabel belum ada → kosong
  }
  state.grantCache.set(schema, { ids, cachedAt: Date.now() });
  return ids;
}

export interface VaultMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  granted: boolean;
}

/**
 * Daftar anggota workspace (join PLATFORM User + UserTenant untuk tenant ini),
 * urut nama, dengan flag granted (grant aktif).
 *
 * KEPUTUSAN DESAIN tenantId: client tenant TIDAK menyimpan platform tenantId
 * (hanya schemaName) — paling bersih: pemanggil (route) me-resolve tenantId
 * dari sesi (session.tid sudah tersedia di resolusi requireTenant-style) dan
 * meneruskannya eksplisit. MemberList teteknisi: platform db utk User/UserTenant
 * + tenant db utk grant (grantUserIds — cache 60s).
 */
export async function memberList(db: TenantDb, tenantId: string): Promise<VaultMember[]> {
  const grants = await grantUserIds(db);
  const memberships = await platformDb.userTenant.findMany({
    where: { tenantId },
    select: { role: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return memberships.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    granted: grants.has(m.user.id),
  }));
}
