// OneVity ESS — guard aktor self-scoped ====================================
// ===========================================================================
// requireEssActor: resolusi sesi + WAJIB tertaut ke data karyawan
// (AppUser.employeeId). Semua endpoint /api/ess/* memakai guard ini sehingga
// data yang dikembalikan / diubah SELALU milik karyawan yang login — bukan
// parameter dari client (anti IDOR).
import type { NextRequest } from "next/server";
import { UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { resolveMenuPerms, type MenuActor } from "@/onevity/shared/services/menu-access";
import { viewListOf, type MenusMap } from "@/onevity/shared/lib/menu-perms";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";

export interface EssActor {
  db: TenantDb;
  actor: MenuActor;
  /** employee milik sendiri (self-scope) */
  employeeId: string;
  /** true bila pengguna boleh membuka aplikasi admin (mode ALL / super admin / punya menu admin) */
  canAdminApp: boolean;
  isSuperAdmin: boolean;
}

export type EssActorResult = { ok: true } & EssActor | { ok: false; status: number; error: string };

export async function requireEssActor(req: NextRequest | Request): Promise<EssActorResult> {
  const resolved = await resolveMenuPerms(req);
  if (!resolved) return { ok: false, status: 401, error: UNAUTHORIZED_MSG };
  const { db, actor, isSuperAdmin, all, perms } = resolved;
  if (!actor.employeeId) {
    return {
      ok: false,
      status: 403,
      error:
        "Akun ini belum tertaut ke data karyawan. Portal Karyawan menampilkan data milik sendiri — " +
        "hubungi admin HR agar akun Anda ditautkan ke profil karyawan.",
    };
  }
  const canAdminApp = all || viewListOf(perms as MenusMap).length > 0;
  return { ok: true, db, actor, employeeId: actor.employeeId, canAdminApp, isSuperAdmin };
}

/** Jumlah dokumen yang menunggu keputusan approver = karyawan ini (level saat ini). */
export async function countPendingApprovals(db: TenantDb, employeeId: string): Promise<number> {
  try {
    return await db.approvalStep.count({
      where: { status: "Current", approverEmployeeId: employeeId, chain: { status: "InProgress" } },
    });
  } catch {
    return 0;
  }
}
