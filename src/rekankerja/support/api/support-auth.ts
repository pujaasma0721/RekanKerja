// RekanKerja — Online Support (FEAT-SUPPORT-P1): resolusi aktor & akses tiket.
// =====================================================================
// Konvensi guard modul ini (padanan pola whistleblow/api/report.ts):
//   · CHAT sendiri cukup SESI VALID + profil AppUser tenant — TANPA guard
//     menu (semua role boleh, termasuk platform VIEWER: bertanya ke support
//     bukan mutasi data HR). Pengguna hanya melihat/melanjutkan tiketnya.
//   · "Semua tiket" (scope=all / menangani tiket orang lain) = op khusus
//     support:service/manage (Pengaturan → Keamanan & Akses → Hak Akses).
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { readVerifiedSession, effectiveTidOfSession } from "@/rekankerja/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { supportActivated } from "@/rekankerja/support/services/support-entitlement";
import type { SupportTicket } from "@/generated/tenant";

export interface SupportActor {
  db: TenantDb;
  /** P5 — id Tenant platform (gate aktivasi layanan & atribusi pemakaian). */
  tenantId: string | null;
  /** AppUser id tenant (null → 403: tidak bisa berkorespondensi). */
  appUserId: string | null;
  /** Nama tampilan AppUser (snapshot utk pesan). */
  appUserName: string | null;
  email: string | null;
}

export const SUPPORT_PROFILE_MISSING_MSG = "Profil pengguna tidak ditemukan untuk tenant ini";

/** P5 — layanan berbayar belum diaktifkan pemilik aplikasi utk tenant ini. */
export const SUPPORT_NOT_ACTIVATED_MSG =
  "Layanan Online Support belum diaktifkan untuk workspace ini. Silakan hubungi tim RekanKerja untuk mengaktifkan layanan.";

/**
 * Resolusi aktor support dari sesi (tenant EFEKTIF host-aware — pola QA F-06).
 * null → sesi/tenant tidak valid (401). appUserId null → profil AppUser tidak
 * ada di tenant ini (403 di supportActorDenied).
 */
export async function resolveSupportActor(req: NextRequest | Request): Promise<SupportActor | null> {
  const db = await requireTenant(req);
  if (!db) return null;
  let payload: Awaited<ReturnType<typeof readVerifiedSession>> = null;
  try {
    payload = await readVerifiedSession(req);
  } catch {
    payload = null;
  }
  if (!payload?.uid) return null;
  let email: string | null = null;
  let tenantId: string | null = null;
  try {
    const tid = await effectiveTidOfSession(req, payload);
    tenantId = tid;
    const membership = tid
      ? await platformDb.userTenant.findFirst({
          where: { userId: payload.uid, tenantId: tid },
          select: { user: { select: { email: true } } },
        })
      : null;
    email = membership?.user.email ?? null;
  } catch {
    email = null;
  }
  let appUserId: string | null = null;
  let appUserName: string | null = null;
  if (email) {
    const me = await db.appUser.findFirst({
      where: { email },
      select: { id: true, fullName: true, username: true },
    });
    appUserId = me?.id ?? null;
    appUserName = me?.fullName ?? me?.username ?? null;
  }
  return { db, tenantId, appUserId, appUserName, email };
}

/** 401 standar bila aktor null; 403 bila tanpa profil AppUser (tidak bisa chat). */
export function supportActorDenied(a: SupportActor | null): NextResponse | null {
  if (!a) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
  if (!a.appUserId) return NextResponse.json({ error: SUPPORT_PROFILE_MISSING_MSG }, { status: 403 });
  return null;
}

/** P5 — GATE LAYANAN BERBAYAR: Online Support hanya untuk tenant yang
 *  diaktifkan pemilik aplikasi (SupportEntitlement TRIAL/ACTIVE di platform
 *  DB). Dipanggil di awal SETIAP route modul support (list, create, kirim
 *  pesan, giliran AI, lampiran, patch) — supaya deaktivasi memutus akses
 *  secara menyeluruh dari sisi server, apa pun yang terjadi di UI.
 *  Kode error stabil `SUPPORT_NOT_ACTIVATED` (UI bisa menampilkan kartu
 *  pemberitahuan ramah). Fail-closed: tenantId tak terurai → tolak. */
export async function supportServiceDenied(a: SupportActor): Promise<NextResponse | null> {
  const on = a.tenantId ? await supportActivated(a.tenantId) : false;
  if (!on) {
    return NextResponse.json(
      { error: SUPPORT_NOT_ACTIVATED_MSG, code: "SUPPORT_NOT_ACTIVATED" },
      { status: 403 },
    );
  }
  return null;
}

/** Apakah aktor memegang op khusus support:service/manage (lihat semua tiket)?
 *  Super admin & mode ALL lolos otomatis lewat requireMenuAction. */
export async function canManageAllTickets(req: NextRequest | Request): Promise<boolean> {
  const m = await requireMenuAction(req, "support:service", "op:manage");
  return m.ok;
}

/**
 * Guard akses satu tiket: pemilik (createdById) ATAU pemegang op manage.
 * Parameter `ticket` cukup baris dengan kolom createdById (hasil findUnique
 * polos MAUPUN findUnique select parsial — tipe struktural, bukan model
 * penuh, supaya route detail tak terpaksa memuat relasi messages).
 * Return `{ ok: true }` bila boleh — selain itu NextResponse error siap kirim.
 */
export async function ticketAccess(
  req: NextRequest | Request,
  a: SupportActor,
  ticket: { createdById: string | null } | null,
): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  if (!ticket) return { ok: false, res: NextResponse.json({ error: "Tiket tidak ditemukan" }, { status: 404 }) };
  const isOwner = !!a.appUserId && ticket.createdById === a.appUserId;
  if (isOwner) return { ok: true };
  if (await canManageAllTickets(req)) return { ok: true };
  return {
    ok: false,
    res: NextResponse.json(
      {
        error:
          "Akses ditolak: tiket ini bukan milik Anda dan Anda tidak memegang izin mengelola tiket seluruh pengguna",
      },
      { status: 403 },
    ),
  };
}
