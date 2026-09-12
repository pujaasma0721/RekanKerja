// OneVity — MONEY VIEW GATE (Task 45-a) ===================================
// ========================================================================
// Gerbang visibilitas nilai uang terenkripsi DI BATAS SERIALIZER API.
// Dikonstruksi via getMoneyView(db, actor) — status:
//   · legacy      : belum ada baris MoneyVault → SEMUA orang melihat uang
//                   (perilaku pra-vault; dekripsi jalur env tenantCrypto).
//   · open-admin  : vault open + aktor admin workspace (OWNER/ADMIN) → lihat.
//   · open-granted: vault open + aktor punya grant aktif → lihat (TANPA sandi).
//   · vault-closed: vault terkunci (open state hanya di memori proses) → masked.
//   · no-grant    : vault open tapi aktor bukan admin & tanpa grant → masked.
//
// Ketika BISA MELIHAT (open): dekripsi memakai DEK hasil unwrap vault
// (decryptMoneyWithKey). Ketika LEGACY: jalur env (tenantCryptoForDb —
// perilaku decryptJson lama). Ketika MASKED: dec() → null; walker json
// tetap mendekripsi KIND TEKS (enc:v1:t: PII — aturan PII TIDAK dipengaruhi
// vault, pakai jalur env) tetapi KIND UANG (enc:v1:n:) → null.
//
// PENTING (kontrak 45-a→45-b): file ini OPT-IN — pemanggilan serializer
// yang BELUM men-thread money-view tetap memakai decryptJson lama
// (legacy-visible). JANGAN dipakai untuk query/sort SQL atau logika bisnis
// internal (payroll/loan engine tetap tenantCryptoForDb — dekripsi hanya
// di batas serializer, agregasi tetap in-memory).
import { isEncrypted, tenantCryptoForDb, decryptMoneyWithKey, decryptTextWithKey, type FieldCrypto } from "./field-crypto";
import type { TenantDb } from "./tenant-db";
import { grantUserIds, vaultOpenState, type VaultActor } from "./money-vault";
import { SUPER_ADMIN_PLATFORM_ROLES } from "../services/access-scope";

// ============ tipe ============

export type MoneyViewReason = "legacy" | "open-admin" | "open-granted" | "vault-closed" | "no-grant";

export interface MoneyView {
  readonly canSee: boolean;
  readonly reason: MoneyViewReason;
  /** Bisa lihat → dekripsi angka uang (DEK vault / jalur env legacy); masked → null. */
  dec(v: string | null | undefined): number | null;
  /** dec() ?? 0 — helper DTO angka. */
  dec0(v: string | null | undefined): number;
  /** Walker JSON dalam (array+objek): nilai enc:v1 diganti sesuai mode. */
  json<T>(payload: T): T;
}

// ============ walker ============

/** Segmen kind nilai terenkripsi ("t" | "n"); asumsi sudah isEncrypted. */
function encKind(v: string): string {
  return v.split(":")[2] ?? "";
}

/** Walker mode open (DEK): kind t → teks, kind n → angka — mirror decryptJson. */
function openWalker(dek: Buffer) {
  const walk = (v: unknown): unknown => {
    if (v == null) return v;
    if (typeof v === "string") {
      if (!isEncrypted(v)) return v;
      if (encKind(v) === "n") return decryptMoneyWithKey(v, dek);
      return decryptTextWithKey(v, dek);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date) return v;
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk;
}

/**
 * Walker mode MASKED: kind t tetap didekripsi (PII tidak dipengaruhi vault —
 * jalur env tenantCrypto; hasil IDENTIK dgn decryptTextWithKey(dek) karena
 * DEK vault memang kunci data tenant itu), kind n → null (uang disembunyikan).
 */
function maskedWalker(tc: FieldCrypto) {
  const walk = (v: unknown): unknown => {
    if (v == null) return v;
    if (typeof v === "string") {
      if (!isEncrypted(v)) return v;
      if (encKind(v) === "n") return null; // uang — masked
      return tc.decryptText(v); // PII (t) — tetap terbaca
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date) return v;
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk;
}

// ============ gerbang utama ============

/**
 * Resolusi MoneyView untuk aktor pada tenant db tsb.
 * Admin = membershipRole platform OWNER/ADMIN (mirror access-scope.ts —
 * SUPER_ADMIN_PLATFORM_ROLES diimpor dari sana, satu sumber kebenaran).
 */
export async function getMoneyView(db: TenantDb, actor: VaultActor): Promise<MoneyView> {
  const vs = await vaultOpenState(db);

  // ---- 1. LEGACY: belum ada vault → semua orang melihat (jalur env) ----
  if (!vs.configured) {
    const tc = tenantCryptoForDb(db);
    return {
      canSee: true,
      reason: "legacy",
      dec: (v) => tc.decryptMoney(v),
      dec0: (v) => tc.decryptMoney(v) ?? 0,
      json: <T,>(payload: T) => tc.decryptJson(payload),
    };
  }

  // ---- 2. VAULT CLOSED: open state hanya di memori proses → masked ----
  if (!vs.open || !vs.dek) {
    const tc = tenantCryptoForDb(db);
    const walk = maskedWalker(tc);
    return {
      canSee: false,
      reason: "vault-closed",
      dec: () => null,
      dec0: () => 0,
      json: <T,>(payload: T) => walk(payload) as T,
    };
  }

  // ---- 3. OPEN: admin (OWNER/ADMIN) ATAU grant aktif → lihat via DEK ----
  const isAdmin =
    actor.membershipRole != null && SUPER_ADMIN_PLATFORM_ROLES.includes(actor.membershipRole);
  if (isAdmin) {
    const dek = vs.dek;
    const walk = openWalker(dek);
    return {
      canSee: true,
      reason: "open-admin",
      dec: (v) => decryptMoneyWithKey(v, dek),
      dec0: (v) => decryptMoneyWithKey(v, dek) ?? 0,
      json: <T,>(payload: T) => walk(payload) as T,
    };
  }
  const grants = await grantUserIds(db);
  if (grants.has(actor.userId)) {
    const dek = vs.dek;
    const walk = openWalker(dek);
    return {
      canSee: true,
      reason: "open-granted",
      dec: (v) => decryptMoneyWithKey(v, dek),
      dec0: (v) => decryptMoneyWithKey(v, dek) ?? 0,
      json: <T,>(payload: T) => walk(payload) as T,
    };
  }

  // ---- 4. OPEN tapi tanpa hak → masked ----
  const tc = tenantCryptoForDb(db);
  const walk = maskedWalker(tc);
  return {
    canSee: false,
    reason: "no-grant",
    dec: () => null,
    dec0: () => 0,
    json: <T,>(payload: T) => walk(payload) as T,
  };
}
