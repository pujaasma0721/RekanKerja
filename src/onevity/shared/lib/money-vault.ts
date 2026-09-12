// OneVity — MONEY VAULT (Task 45-a) =======================================
// ========================================================================
// "Vault uang" per tenant: kata sandi (HANYA dipegang admin workspace)
// membungkus KUNCI DATA TENANT (32 byte — kunci yang sama dengan field-crypto
// env path) → KEK hasil PBKDF2. Admin membuka (status "open"), mengganti sandi
// (hanya saat open), dan MEMBERI hak lihat uang ke anggota lain (MoneyViewGrant
// — granted user melihat uang TANPA tahu sandi; sandi tidak pernah menyebar).
//
// ARSITEKTUR STATE:
//   · Status "open" OTORITATIF ada di MEMORI proses (openKeys per schema,
//     symbol-keyed globalThis — selamat lintas HMR; restart = terkunci).
//     Kolom DB openUntil/openByUserId hanya INFORMATIF (diagnostik/audit).
//   · configCache (baris MoneyVault, TTL 60s) di-invalidate saat setup /
//     change-password; grantCache (Set userId aktif, TTL 60s) di-invalidate
//     saat grant/revoke.
//   · fails: lockout percobaan sandi salah (5× → 15 menit) per schema.
//
// KRIPTO (node:crypto saja):
//   PBKDF2(sandi, salt 16 byte, 210_000 iter, sha256, keylen 64)
//     → 32 byte pertama = KEK (untuk wrap), 32 byte terakhir = verifierKey.
//   verifier   = "vrf:v1:" + HMAC-SHA256(verifierKey, "onevity-money-vault").hex
//   wrappedKey = "vlt:v1:<ivB64>:<tagB64>:<ctB64>" = AES-256-GCM(KEK, DEK)
//     DEK = tenantDataKey(schema) 32 byte (helper field-crypto — kunci IDENTIK
//     dengan jalur env; rotasi ONEVITY_ENCRYPTION_KEY = data lama tak terbaca).
//
// KONSUMEN: db yang diberikan HARUS client tenant ber-brand schema
// (getTenantClient) — sama prasyarat tenantCryptoForDb.
import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { db as platformDb } from "@/lib/db";
import { TENANT_SCHEMA_BRAND, tenantDataKey } from "./field-crypto";
import type { TenantDb } from "./tenant-db";

// ============ konstanta ============

export const PBKDF2_ITERATIONS = 210_000;
export const VAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam — auto-lock saat TTL habis
export const LOCKOUT_MAX_FAILS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 menit
export const MIN_PASSWORD_LEN = 8;

const VERIFIER_LABEL = "onevity-money-vault";
const VERIFIER_PREFIX = "vrf:v1";
const WRAPPED_PREFIX = "vlt:v1";
const CONFIG_TTL_MS = 60_000; // cache baris MoneyVault
const GRANT_TTL_MS = 60_000; // cache Set grant aktif

// ============ error ============

export type VaultErrorCode =
  | "ALREADY_CONFIGURED"
  | "NOT_CONFIGURED"
  | "INVALID_PASSWORD"
  | "VAULT_LOCKED"
  | "LOCKOUT"
  | "WEAK_PASSWORD"
  | "NOT_ADMIN"
  | "NOT_MEMBER";

/** Peta status HTTP (spesifikasi 45-a): 400 WEAK_PASSWORD · 403 INVALID_PASSWORD/
 *  NOT_ADMIN · 404 NOT_MEMBER · 409 ALREADY_CONFIGURED/VAULT_LOCKED/NOT_CONFIGURED · 429 LOCKOUT. */
export const VAULT_ERROR_STATUS: Record<VaultErrorCode, number> = {
  WEAK_PASSWORD: 400,
  INVALID_PASSWORD: 403,
  NOT_ADMIN: 403,
  NOT_MEMBER: 404,
  ALREADY_CONFIGURED: 409,
  VAULT_LOCKED: 409,
  NOT_CONFIGURED: 409,
  LOCKOUT: 429,
};

/** Pesan manusiawi (Bahasa Indonesia) — sandi TIDAK PERNAH masuk pesan. */
export const VAULT_ERROR_MESSAGES: Record<VaultErrorCode, string> = {
  ALREADY_CONFIGURED: "Vault uang sudah dikonfigurasi untuk workspace ini — gunakan ganti kata sandi vault.",
  NOT_CONFIGURED: "Vault uang belum dikonfigurasi — atur kata sandi vault terlebih dahulu.",
  INVALID_PASSWORD: "Kata sandi vault salah.",
  VAULT_LOCKED: "Vault uang sedang terkunci — buka kunci vault terlebih dahulu.",
  LOCKOUT: "Terlalu banyak percobaan kata sandi salah — vault terkunci sementara, coba lagi nanti.",
  WEAK_PASSWORD: "Kata sandi vault minimal 8 karakter.",
  NOT_ADMIN: "Hanya admin workspace (Owner/Admin) yang dapat mengelola vault uang.",
  NOT_MEMBER: "Pengguna tersebut bukan anggota workspace ini.",
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
  dek: Buffer;
  openUntil: number; // epoch ms — autoritatif (memori), TTL 8 jam
  openBy: string;
}

interface VaultState {
  openKeys: Map<string, OpenEntry>;
  configCache: Map<string, { row: VaultRow | null; cachedAt: number }>;
  grantCache: Map<string, { ids: Set<string>; cachedAt: number }>;
  fails: Map<string, { count: number; lockoutUntil: number }>;
}

const VAULT_STATE = Symbol.for("onevity.moneyVault.state");
const globalForVault = globalThis as unknown as { [VAULT_STATE]?: VaultState };
const state: VaultState =
  globalForVault[VAULT_STATE] ??
  { openKeys: new Map(), configCache: new Map(), grantCache: new Map(), fails: new Map() };
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

// ============ kripto primitif ============

/** PBKDF2 → {KEK, verifierKey}: 64 byte, 32 pertama KEK (wrap), 32 akhir verifier. */
function deriveKeys(password: string, saltHex: string): { kek: Buffer; verifierKey: Buffer } {
  const dk = pbkdf2Sync(password, Buffer.from(saltHex, "hex"), PBKDF2_ITERATIONS, 64, "sha256");
  return { kek: dk.subarray(0, 32), verifierKey: dk.subarray(32, 64) };
}

function computeVerifier(verifierKey: Buffer): string {
  return `${VERIFIER_PREFIX}:${createHmac("sha256", verifierKey).update(VERIFIER_LABEL).digest("hex")}`;
}

/** Cocok sandi terhadap verifier baris (timing-safe atas hex). */
function verifyPassword(row: VaultRow, password: string): boolean {
  const { verifierKey } = deriveKeys(password, row.salt);
  const expect = Buffer.from(row.verifier, "utf8");
  const got = Buffer.from(computeVerifier(verifierKey), "utf8");
  return expect.length === got.length && timingSafeEqual(expect, got);
}

/** Wrap DEK (32 byte) dengan KEK → "vlt:v1:<ivB64>:<tagB64>:<ctB64>". */
function wrapKey(kek: Buffer, dek: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [WRAPPED_PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Unwrap "vlt:v1:<ivB64>:<tagB64>:<ctB64>" dengan KEK → DEK 32 byte.
 *  (KEK sudah terbukti benar lewat verifier — kegagalan di sini = data vault
 *  rusak, throw Error umum → 500.) */
function unwrapKey(kek: Buffer, wrapped: string): Buffer {
  const parts = wrapped.split(":"); // ["vlt","v1",iv,tag,ct] — 5 segmen
  if (parts.length !== 5 || parts[0] !== "vlt" || parts[1] !== "v1") {
    throw new Error(`[money-vault] format wrappedKey malformat (${wrapped.slice(0, 16)}…)`);
  }
  try {
    const iv = Buffer.from(parts[2]!, "base64");
    const tag = Buffer.from(parts[3]!, "base64");
    const ct = Buffer.from(parts[4]!, "base64");
    const decipher = createDecipheriv("aes-256-gcm", kek, iv);
    decipher.setAuthTag(tag);
    const dek = Buffer.concat([decipher.update(ct), decipher.final()]);
    if (dek.length !== 32) {
      throw new Error(`panjang DEK ${dek.length} ≠ 32`);
    }
    return dek;
  } catch (e) {
    throw new Error(`[money-vault] gagal unwrap kunci vault (data rusak?): ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ============ akses baris + grant (cache) ============

/** Baris MoneyVault (satu per schema — findFirst; >1 baris → pakai pertama).
 *  Cache 60s; P2021 (tabel belum termigrasi) → null = belum dikonfigurasi. */
async function vaultRow(db: TenantDb): Promise<VaultRow | null> {
  const schema = schemaOf(db);
  const cached = state.configCache.get(schema);
  if (cached && Date.now() - cached.cachedAt < CONFIG_TTL_MS) return cached.row;
  let row: VaultRow | null = null;
  try {
    const r = await db.moneyVault.findFirst({ orderBy: { createdAt: "asc" } });
    row = r
      ? {
          id: r.id,
          salt: r.salt,
          verifier: r.verifier,
          wrappedKey: r.wrappedKey,
          openUntil: r.openUntil,
          openByUserId: r.openByUserId,
        }
      : null;
  } catch (e) {
    if ((e as { code?: string }).code === "P2021") return null; // tabel belum ada → legacy
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

// ============ API publik ============

export type VaultActor = { userId: string; membershipRole: string | null | undefined };

/** Status inti vault utk gerbang money-view: terkonfigurasi? open? DEK?.
 *  (Open hanya dari MEMORI proses; DEK null bila terkunci.) */
export interface VaultOpenState {
  configured: boolean;
  open: boolean;
  dek: Buffer | null;
}

/** Dikonsumsi money-view.ts (getMoneyView) — TIDAK membocorkan DEK ke klien. */
export async function vaultOpenState(db: TenantDb): Promise<VaultOpenState> {
  const schema = schemaOf(db);
  const row = await vaultRow(db);
  const e = openEntry(schema);
  return { configured: row != null, open: e != null, dek: e ? e.dek : null };
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

/** Atur kata sandi vault pertama kali (satu baris per schema). Vault langsung
 *  OPEN (admin baru saja memasukkan sandi). 409 bila sudah dikonfigurasi. */
export async function setupVault(db: TenantDb, actor: VaultActor, password: string): Promise<void> {
  const schema = schemaOf(db);
  const existing = await vaultRow(db);
  if (existing) throw new VaultError("ALREADY_CONFIGURED", 409);
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
    throw new VaultError("WEAK_PASSWORD", 400);
  }
  const salt = randomBytes(16).toString("hex"); // 32 karakter hex
  const { kek, verifierKey } = deriveKeys(password, salt);
  const dek = tenantDataKey(schema); // kunci data tenant (identik jalur env)
  const openUntil = Date.now() + VAULT_TTL_MS;
  await db.moneyVault.create({
    data: {
      salt,
      verifier: computeVerifier(verifierKey),
      wrappedKey: wrapKey(kek, dek),
      openUntil: new Date(openUntil), // informatif
      openByUserId: actor.userId, // informatif
    },
  });
  state.configCache.delete(schema);
  state.openKeys.set(schema, { dek, openUntil, openBy: actor.userId });
  state.fails.delete(schema);
}

/** Buka vault (admin memasukkan sandi) → DEK masuk memori 8 jam.
 *  Kesalahan sandi menaikkan fails → 429 LOCKOUT setelah 5× (15 menit). */
export async function unlockVault(db: TenantDb, password: string, actor?: VaultActor): Promise<{ openUntil: Date }> {
  const schema = schemaOf(db);
  const row = await vaultRow(db);
  if (!row) throw new VaultError("NOT_CONFIGURED", 409);

  const fail = state.fails.get(schema);
  if (fail && fail.lockoutUntil > Date.now()) throw new VaultError("LOCKOUT", 429);

  if (typeof password !== "string" || !verifyPassword(row, password)) {
    const f = fail ?? { count: 0, lockoutUntil: 0 };
    f.count += 1;
    if (f.count >= LOCKOUT_MAX_FAILS) {
      f.lockoutUntil = Date.now() + LOCKOUT_MS;
      f.count = 0; // setelah lockout habis, hitungan mulai segar
      state.fails.set(schema, f);
      throw new VaultError("LOCKOUT", 429);
    }
    state.fails.set(schema, f);
    throw new VaultError("INVALID_PASSWORD", 403);
  }

  state.fails.delete(schema); // sukses — reset hitungan gagal
  const { kek } = deriveKeys(password, row.salt);
  const dek = unwrapKey(kek, row.wrappedKey);
  const openUntil = Date.now() + VAULT_TTL_MS;
  state.openKeys.set(schema, { dek, openUntil, openBy: actor?.userId ?? row.openByUserId ?? "unknown" });
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

/** Kunci vault — hapus DEK dari memori (idempoten: sudah terkunci → no-op). */
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

/** Ganti sandi vault — HANYA saat open (DEK dari memori, kunci data tenant
 *  TIDAK berubah — hanya di-wrap ulang dengan KEK baru). Vault tetap open. */
export async function changeVaultPassword(
  db: TenantDb,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const schema = schemaOf(db);
  const row = await vaultRow(db);
  if (!row) throw new VaultError("NOT_CONFIGURED", 409);
  const e = openEntry(schema);
  if (!e) throw new VaultError("VAULT_LOCKED", 409);
  if (typeof currentPassword !== "string" || !verifyPassword(row, currentPassword)) {
    throw new VaultError("INVALID_PASSWORD", 403);
  }
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LEN) {
    throw new VaultError("WEAK_PASSWORD", 400);
  }
  const salt = randomBytes(16).toString("hex");
  const { kek, verifierKey } = deriveKeys(newPassword, salt);
  await db.moneyVault.update({
    where: { id: row.id },
    data: { salt, verifier: computeVerifier(verifierKey), wrappedKey: wrapKey(kek, e.dek) },
  });
  state.configCache.delete(schema);
  // e.dek tidak berubah → vault tetap open dengan TTL yang tersisa
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
    if ((e as { code?: string }).code !== "P2021") throw e; // tabel belum ada → kosong
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
