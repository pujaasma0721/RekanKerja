// RekanKerja — MONEY VIEW GATE untuk route requireTenant (Task 45-b) ==========
// ===========================================================================
// Helper resolusi MoneyView untuk route yang guard-nya HANYA requireTenant
// (tanpa aktor — db saja). Pola resolusi sesi PERSIS tenant-db.ts:
// readVerifiedSession → membership (role workspace platform) → aktor vault.
//
//   const mv = await moneyViewForReq(req, db);
//   // mv.json / mv.dec / mv.dec0 / mv.canSee — lihat money-view.ts.
//
// Sesi tak ter-resolve ulang (race revokasi setelah requireTenant lolos) →
// aktor kosong → FAIL-CLOSED: bukan admin & tanpa grant → masked saat vault
// terkonfigurasi; legacy (vault belum dikonfigurasi) tetap melihat semua
// (perilaku lama — getMoneyView menangani legacy TANPA melihat aktor).
// Role TIDAK PERNAH di-invent — hanya dari baris membership platform.
import { readVerifiedSession, effectiveTidOfSession } from "./auth";
import { db as platformDb } from "@/lib/db";
import { getMoneyView, type MoneyView } from "./money-view";
import type { VaultActor } from "./money-vault";
import type { TenantDb } from "./tenant-db";

export async function moneyViewForReq(req: Request, db: TenantDb): Promise<MoneyView> {
  const payload = await readVerifiedSession(req);
  let actor: VaultActor = { userId: "", membershipRole: null };
  if (payload?.uid && payload.tid) {
    // QA F-06: role membership dibaca utk tenant EFEKTIF (host-aware) — bila
    // host subdomain asing/tak dikenal → actor tanpa role → masking fail-closed.
    const tid = await effectiveTidOfSession(req, payload);
    if (tid) {
      const membership = await platformDb.userTenant.findFirst({
        where: { userId: payload.uid, tenantId: tid },
        select: { role: true },
      });
      actor = { userId: payload.uid, membershipRole: membership?.role ?? null };
    }
  }
  return getMoneyView(db, actor);
}
