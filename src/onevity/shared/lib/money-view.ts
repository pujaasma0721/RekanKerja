// OneVity — MONEY VIEW GATE (Task 45-a · rev Task 47) =====================
// ========================================================================
// Gerbang visibilitas nilai uang terenkripsi DI BATAS SERIALIZER API.
// Dikonstruksi via getMoneyView(db, actor) — status:
//   · legacy      : belum ada baris MoneyVault → SEMUA orang melihat uang
//                   (perilaku pra-vault; data masih v1 bootstrap/plaintext).
//   · open-admin  : vault open + aktor admin workspace (OWNER/ADMIN) → lihat.
//   · open-granted: vault open + aktor punya grant aktif → lihat (TANPA sandi).
//   · vault-closed: vault terkunci (open state hanya di memori proses) → masked.
//   · no-grant    : vault open tapi aktor bukan admin & tanpa grant → masked.
//
// DEKRIPSI (Task 47): semua mode memakai konteks field-crypto dengan
// DISPATCH PREFIX — enc:v2 (kunci kata sandi perusahaan) / enc:v1 (bootstrap
// legacy) / plaintext — kunci dibaca field-crypto dari cache vault.
// Ketika MASKED (Task 56 — keputusan pemilik produk): walker json
// mengembalikan 0 utk KIND UANG (enc:n: — "belum masukkan kata sandi
// enkripsi → nilai 0"; setelah unlock, halaman me-refresh otomatis via
// event onevity:vault-changed dan nilai asli muncul), sedangkan KIND TEKS
// (enc:t: PII) tetap didekripsi — aturan PII TIDAK dipengaruhi vault.
// dec() tetap null saat masked (jalur PDF payslip/email/ESS memakai "—"
// sebagai penanda tersembunyi — karyawan tidak boleh melihat "Rp 0").
//
// PENTING (kontrak 45-a→45-b): file ini OPT-IN — pemanggilan serializer
// yang BELUM men-thread money-view tetap memakai decryptJson lama
// (legacy-visible). JANGAN dipakai untuk query/sort SQL atau logika bisnis
// internal (payroll/loan engine tetap tenantCryptoForDb — dekripsi hanya
// di batas serializer, agregasi tetap in-memory).
import { isEncrypted, tenantCryptoForDb } from "./field-crypto";
import type { TenantDb } from "./tenant-db";
import { grantUserIds, vaultOpenState, type VaultActor } from "./money-vault";
import { SUPER_ADMIN_PLATFORM_ROLES } from "../services/access-scope";

// ============ tipe ============

export type MoneyViewReason = "legacy" | "open-admin" | "open-granted" | "vault-closed" | "no-grant";

export interface MoneyView {
  readonly canSee: boolean;
  readonly reason: MoneyViewReason;
  /** Bisa lihat → dekripsi angka uang (dispatch prefix field-crypto); masked → null
   *  (jalur PDF/email/ESS — dirender "—"; JANGAN dipakai utk UI admin uang,
   *  pakai dec0/json yang masked → 0). */
  dec(v: string | null | undefined): number | null;
  /** dec() ?? 0 — helper DTO angka (masked → 0: UI admin menampilkan Rp 0). */
  dec0(v: string | null | undefined): number;
  /** Walker JSON dalam (array+objek): nilai enc: diganti sesuai mode. */
  json<T>(payload: T): T;
}

// ============ walker ============

/** Segmen kind nilai terenkripsi ("t" | "n"); asumsi sudah isEncrypted. */
function encKind(v: string): string {
  return v.split(":")[2] ?? "";
}

/**
 * Walker mode MASKED (Task 56): kind t tetap didekripsi (PII tidak
 * dipengaruhi vault — jalur field-crypto dispatch prefix), kind n → 0
 * (keputusan pemilik produk: "belum masukkan kata sandi enkripsi → nilai 0";
 * bukan null — type kontrak frontend number pun cocok, tanpa "—").
 */
function maskedWalker(tc: { decryptText(v: string | null | undefined): string | null }) {
  const walk = (v: unknown): unknown => {
    if (v == null) return v;
    if (typeof v === "string") {
      if (!isEncrypted(v)) return v;
      if (encKind(v) === "n") return 0; // uang — masked → 0 (Task 56)
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
  const tc = tenantCryptoForDb(db);

  // ---- 1. LEGACY: belum ada vault → semua orang melihat (v1/plaintext) ----
  if (!vs.configured) {
    return {
      canSee: true,
      reason: "legacy",
      dec: (v) => tc.decryptMoney(v),
      dec0: (v) => tc.decryptMoney(v) ?? 0,
      json: <T,>(payload: T) => tc.decryptJson(payload),
    };
  }

  // ---- 2. VAULT CLOSED: open state hanya di memori proses → masked ----
  if (!vs.open) {
    const walk = maskedWalker(tc);
    return {
      canSee: false,
      reason: "vault-closed",
      dec: () => null,
      dec0: () => 0,
      json: <T,>(payload: T) => walk(payload) as T,
    };
  }

  // ---- 3. OPEN: admin (OWNER/ADMIN) ATAU grant aktif → lihat penuh ----
  const isAdmin =
    actor.membershipRole != null && SUPER_ADMIN_PLATFORM_ROLES.includes(actor.membershipRole);
  if (isAdmin) {
    return {
      canSee: true,
      reason: "open-admin",
      dec: (v) => tc.decryptMoney(v),
      dec0: (v) => tc.decryptMoney(v) ?? 0,
      json: <T,>(payload: T) => tc.decryptJson(payload),
    };
  }
  const grants = await grantUserIds(db);
  if (grants.has(actor.userId)) {
    return {
      canSee: true,
      reason: "open-granted",
      dec: (v) => tc.decryptMoney(v),
      dec0: (v) => tc.decryptMoney(v) ?? 0,
      json: <T,>(payload: T) => tc.decryptJson(payload),
    };
  }

  // ---- 4. OPEN tapi tanpa hak → masked ----
  const walk = maskedWalker(tc);
  return {
    canSee: false,
    reason: "no-grant",
    dec: () => null,
    dec0: () => 0,
    json: <T,>(payload: T) => walk(payload) as T,
  };
}
