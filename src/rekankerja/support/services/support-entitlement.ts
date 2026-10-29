// RekanKerja — Online Support P5: entitlement & pemakaian layanan (platform).
// =====================================================================
// Ketentuan layanan (FEAT-SUPPORT-P5):
//   · Online Support = layanan ADD-ON berbayar — AKTIF hanya bila pemilik
//     aplikasi (User.isSuperadmin, via modul Platform Admin) membuat
//     SupportEntitlement berstatus TRIAL/ACTIVE utk tenant itu.
//   · SUSPENDED/INACTIVE/tanpa baris → seluruh API modul support menolak
//     (gate di support-auth.ts supportServiceDenied) + menu disembunyikan
//     dari shell (flag supportDeactivated di API me).
//   · Kuota: monthlyTurnQuota = jumlah giliran AI (balasan agent) per bulan
//     kalender; 0 = tanpa batas. Pemakaian dicatat per giliran di
//     SupportUsageLog → dasar penagihan & penghentian otomatis.
//
// Semua tabel hidup di PLATFORM DB (schema public) — TIDAK ada API tenant
// yang menulis tabel-tabel ini (menulis hanya modul Platform Admin yang
// diguard isSuperadmin). Isolasi data percakapan TETAP di schema tenant.
import { db as platformDb } from "@/lib/db";

export const SUPPORT_ENTITLEMENT_STATUSES = ["INACTIVE", "TRIAL", "ACTIVE", "SUSPENDED"] as const;
export type SupportEntitlementStatus = (typeof SUPPORT_ENTITLEMENT_STATUSES)[number];

/** Status yang membuat layanan LAYAK dipakai (gate utama). */
const PASSING_STATUSES: readonly string[] = ["TRIAL", "ACTIVE"];

export interface SupportEntitlementInfo {
  status: string;
  monthlyTurnQuota: number;
  notes: string | null;
}

/** Cache singkat (30s) hasil baca entitlement — API me & tiap route support
 *  memanggil ini tiap request; hemat round-trip platform DB. */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { val: SupportEntitlementInfo; exp: number }>();

function fromCache(tenantId: string): SupportEntitlementInfo | null {
  const hit = cache.get(tenantId);
  if (hit && hit.exp > Date.now()) return hit.val;
  return null;
}

/** Invalidate manual (dipanggil API Platform Admin setelah update supaya
 *  efek aktivasi/penangguhan terasa SEGERA, tanpa menunggu TTL). */
export function invalidateEntitlementCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** Baca entitlement tenant (default: tanpa baris → INACTIVE — layanan mati). */
export async function supportEntitlementOf(tenantId: string): Promise<SupportEntitlementInfo> {
  const hit = fromCache(tenantId);
  if (hit) return hit;
  let val: SupportEntitlementInfo = { status: "INACTIVE", monthlyTurnQuota: 0, notes: null };
  try {
    const row = await platformDb.supportEntitlement.findUnique({ where: { tenantId } });
    if (row) val = { status: row.status, monthlyTurnQuota: row.monthlyTurnQuota, notes: row.notes };
  } catch {
    // tabel belum ada (instance belum termigrasi) → konservatif: INACTIVE
  }
  cache.set(tenantId, { val, exp: Date.now() + CACHE_TTL_MS });
  return val;
}

/** Apakah layanan support AKTIF untuk tenant? (gate utama seluruh API support) */
export async function supportActivated(tenantId: string): Promise<boolean> {
  const e = await supportEntitlementOf(tenantId);
  return PASSING_STATUSES.includes(e.status);
}

/** Awal bulan kalender berjalan (UTC — jendela kuota & laporan bulanan). */
export function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface SupportUsageSummary {
  turns: number;
  llmSteps: number;
  tokensIn: number;
  tokensOut: number;
}

/** Ringkasan pemakaian bulan berjalan satu tenant (untuk cek kuota & UI admin). */
export async function supportUsageOfMonth(tenantId: string, now = new Date()): Promise<SupportUsageSummary> {
  try {
    const rows = await platformDb.supportUsageLog.findMany({
      where: { tenantId, createdAt: { gte: monthStartUtc(now) } },
      select: { llmSteps: true, tokensIn: true, tokensOut: true },
    });
    return rows.reduce(
      (acc, r) => ({
        turns: acc.turns + 1,
        llmSteps: acc.llmSteps + r.llmSteps,
        tokensIn: acc.tokensIn + r.tokensIn,
        tokensOut: acc.tokensOut + r.tokensOut,
      }),
      { turns: 0, llmSteps: 0, tokensIn: 0, tokensOut: 0 } as SupportUsageSummary,
    );
  } catch {
    return { turns: 0, llmSteps: 0, tokensIn: 0, tokensOut: 0 };
  }
}

/** Sisa kuota giliran bulan ini; null = tanpa batas (kuota 0). */
export async function supportQuotaLeft(tenantId: string): Promise<number | null> {
  const e = await supportEntitlementOf(tenantId);
  if (e.monthlyTurnQuota <= 0) return null;
  const used = await supportUsageOfMonth(tenantId);
  return Math.max(0, e.monthlyTurnQuota - used.turns);
}

export interface SupportTurnUsage {
  llmSteps: number;
  tokensIn: number;
  tokensOut: number;
  provider: string;
}

/** Catat satu giliran agent selesai (atribusi biaya per tenant — best effort,
 *  kegagalan log TIDAK boleh menggugurkan balasan yang sudah tersimpan). */
export async function logSupportTurn(
  tenantId: string,
  ticketNo: string,
  usage: SupportTurnUsage,
): Promise<void> {
  try {
    await platformDb.supportUsageLog.create({
      data: {
        tenantId,
        ticketNo,
        llmSteps: usage.llmSteps,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        provider: usage.provider,
      },
    });
  } catch (e) {
    console.warn("[support-entitlement] log pemakaian gagal:", e instanceof Error ? e.message : e);
  }
}
