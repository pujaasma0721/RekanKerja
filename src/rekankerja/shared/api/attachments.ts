// RekanKerja — API lampiran generik (T16-ATTACH). =============================
// =====================================================================
// POST /api/rekankerja/attachments        — upload (multipart: file,
//        entityType, entityId) → { id, fileName, sizeBytes, mimeType }
// GET  /api/rekankerja/attachments?entityType=&entityId= — metadata lampiran
//        (K-1 audit 42: guard menu/kepemilikan — dulu hanya requireTenant).
//
// entityType whitelist + peta menu terkait (guard ringan per aksi create):
//   TravelClaim → travel:travel-claim · MedicalClaim → medical:medical-claim
//   EmployeeDocument → hr:directory
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { UNAUTHORIZED_MSG, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction, resolveMenuPerms } from "@/rekankerja/shared/services/menu-access";
import type { MenusMap } from "@/rekankerja/shared/lib/menu-perms";
import { readVerifiedSession } from "@/rekankerja/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import {
  saveAttachment, listAttachmentsByEntity, sweepDraftAttachments, DRAFT_ENTITY_PREFIX,
} from "@/rekankerja/shared/services/attachment-service";
// Task 98 (F1-5) — ESS upload kwitansi klaim travel milik sendiri.
import { requireEss } from "@/rekankerja/ess/api/ess-auth";

/** entityType yang diizinkan + menu pemiliknya (guard upload = aksi create menu itu). */
export const ATTACHMENT_ENTITY_MENUS: Record<string, string> = {
  TravelClaim: "travel:travel-claim",
  MedicalClaim: "medical:medical-claim",
  EmployeeDocument: "hr:directory",
};

/** Aktor minimal untuk cek izin baca lampiran (subset MenuActor). */
interface AttachmentReadActor {
  userId: string;
  appUserId: string | null;
  employeeId: string | null;
}

/** Konteks resolusi menu (bentuk hasil resolveMenuPerms). */
export interface AttachmentReadCtx {
  db: TenantDb;
  actor: AttachmentReadActor;
  isSuperAdmin: boolean;
  all: boolean;
  perms: MenusMap;
}

/** Pesan 403 baca lampiran (gaya DELETE di attachments-id.ts). */
export const ATTACHMENT_READ_FORBIDDEN_MSG =
  "Akses ditolak: hanya pengunggah, pemilik proses, atau pemegang akses LIHAT menu terkait yang dapat membuka lampiran ini";

/**
 * K-1 (audit 42) — izin BACA lampiran (dipakai GET stream by id & GET list by
 * entity, mirror 4-level guard DELETE di attachments-id.ts):
 *   1. super admin / mode ALL;
 *   2. aksi LIHAT menu entitas (ATTACHMENT_ENTITY_MENUS — HR);
 *   3. pengunggahnya sendiri (uploadedBy = appUserId/userId aktor);
 *   4. pemilik proses: karyawan pemilik TravelClaim/MedicalClaim, ATAU
 *      karyawan pemilik EmployeeDocument (ESS unduh dokumennya sendiri).
 * Lampiran draf (entityId "draft:") hanya boleh diakses pengunggahnya (2/3)
 * — pemilik proses belum ada sebelum submit.
 */
export async function attachmentReadAllowed(
  ctx: AttachmentReadCtx,
  att: { entityType: string; entityId: string; uploadedBy: string | null },
): Promise<boolean> {
  // 1) super admin (AppUser.role Admin / platform OWNER|ADMIN) / mode ALL eksplisit
  if (ctx.isSuperAdmin || ctx.all) return true;

  // 2) aksi LIHAT menu terkait entityType (per pengguna — CUSTOM)
  const menuKey = ATTACHMENT_ENTITY_MENUS[att.entityType];
  if (menuKey && ctx.perms[menuKey]?.view) return true;

  // 3) pengunggah (AppUser tenant — fallback platform userId)
  if (
    att.uploadedBy &&
    (att.uploadedBy === ctx.actor.appUserId || att.uploadedBy === ctx.actor.userId)
  ) {
    return true;
  }

  // 4) pemilik proses (ESS: kwitansi klaim sendiri / dokumen karyawan sendiri)
  if (!att.entityId.startsWith(DRAFT_ENTITY_PREFIX) && ctx.actor.employeeId) {
    if (att.entityType === "TravelClaim") {
      const claim = await ctx.db.travelClaim.findUnique({
        where: { id: att.entityId },
        select: { employeeId: true },
      });
      return claim?.employeeId === ctx.actor.employeeId;
    }
    if (att.entityType === "MedicalClaim") {
      const claim = await ctx.db.medicalClaim.findUnique({
        where: { id: att.entityId },
        select: { employeeId: true },
      });
      return claim?.employeeId === ctx.actor.employeeId;
    }
    if (att.entityType === "EmployeeDocument") {
      const doc = await ctx.db.employeeDocument.findUnique({
        where: { id: att.entityId },
        select: { employeeId: true },
      });
      return doc?.employeeId === ctx.actor.employeeId;
    }
  }
  return false;
}

/** Slug tenant sesi (utk root folder penyimpanan uploads/{slug}/…). */
export async function tenantSlugOfSession(req: Request): Promise<string | null> {
  const payload = await readVerifiedSession(req);
  if (!payload?.tid) return null;
  const tenant = await platformDb.tenant.findUnique({
    where: { id: payload.tid },
    select: { slug: true },
  });
  return tenant?.slug ?? null;
}

/** Tebak MIME dari ekstensi bila klien tidak mengirim content-type file. */
function inferMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "jpg": case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    default: return "";
  }
}

// POST — upload lampiran (multipart/form-data: file, entityType, entityId).
// entityId biasanya "draft:{uuid}" (pra-submit klaim — di-rebind route submit)
// atau id entitas final (tambah dokumen klaim/dokumen karyawan oleh HR).
export async function POST(req: NextRequest) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Request harus multipart/form-data dengan field file" }, { status: 400 });
    }
    const entityType = String(form.get("entityType") ?? "");
    const entityId = String(form.get("entityId") ?? "");
    const file = form.get("file");

    if (!ATTACHMENT_ENTITY_MENUS[entityType]) {
      return NextResponse.json(
        { error: `entityType tidak dikenal (${entityType || "kosong"}) — gunakan ${Object.keys(ATTACHMENT_ENTITY_MENUS).join("|")}` },
        { status: 400 },
      );
    }
    if (!entityId.trim()) {
      return NextResponse.json({ error: "entityId wajib diisi" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Field file wajib berupa berkas" }, { status: 400 });
    }

    // Guard ringan: aksi create menu terkait entityType (per pengguna).
    // Task 98 (F1-5) — ESS boleh mengunggah kwitansi TravelClaim MILIK SENDIRI
    // (draft pra-submit, atau klaim final miliknya) tanpa menu admin travel:
    // menutup temuan VLM walkthrough 97 "critical issue" — karyawan menyimpan
    // struk di ponsel tapi harus menyerahkan fisik ke HR (audit trail hilang).
    let dbRef: TenantDb | null = null;
    let uploaderId: string | null = null;
    const m = await requireMenuAction(req, ATTACHMENT_ENTITY_MENUS[entityType]!, "create");
    if (m.ok) {
      dbRef = m.db;
      uploaderId = m.actor.appUserId ?? m.actor.userId;
    } else if (entityType === "TravelClaim") {
      const ess = await requireEss(req);
      if (!ess.ok) {
        return NextResponse.json({ error: ess.error }, { status: ess.status });
      }
      const { db: essDb, employeeId, appUserId, platformUserId } = ess.actor;
      // draf pra-submit bebas (klaim akan dibuat karyawan sendiri via POST ESS
      // yang me-rebind); id final = klaim harus milik karyawan aktor.
      if (!entityId.startsWith(DRAFT_ENTITY_PREFIX)) {
        const claim = await essDb.travelClaim.findUnique({
          where: { id: entityId },
          select: { employeeId: true },
        });
        if (!claim || claim.employeeId !== employeeId) {
          return NextResponse.json(
            { error: "Kwitansi hanya bisa diunggah untuk klaim travel milik Anda" },
            { status: 403 },
          );
        }
      }
      dbRef = essDb;
      uploaderId = appUserId ?? platformUserId;
    } else {
      return NextResponse.json({ error: m.error }, { status: m.status });
    }
    const db = dbRef;

    const slug = await tenantSlugOfSession(req);
    if (!slug) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const mime = file.type || inferMime(file.name);
    if (!mime) {
      return NextResponse.json({ error: "Jenis file tidak dikenal — unggah JPG/PNG/WEBP/PDF" }, { status: 400 });
    }

    // sapu draf yatim >24 jam (best-effort — tidak boleh menggagalkan upload)
    await sweepDraftAttachments(db);

    const row = await saveAttachment(db, slug, {
      file: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: mime,
      entityType,
      entityId: entityId.trim(),
      uploadedBy: uploaderId,
    });
    return NextResponse.json(
      { id: row.id, fileName: row.fileName, sizeBytes: row.sizeBytes, mimeType: row.mimeType },
      { status: 201 },
    );
  } catch (e) {
    // validasi (ukuran/mime/nama) → 400 ramah
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// GET — metadata lampiran sebuah entitas. Guard K-1 (audit 42): aksi LIHAT
// menu entitas / pengunggah / pemilik proses (dulu: user login tenant sama
// bisa mengenumerasi metadata lampiran entitas manapun).
export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveMenuPerms(req);
    if (!resolved) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const entityType = sp.get("entityType") ?? "";
    const entityId = sp.get("entityId") ?? "";
    if (!ATTACHMENT_ENTITY_MENUS[entityType]) {
      return NextResponse.json({ error: "entityType tidak dikenal" }, { status: 400 });
    }
    if (!entityId.trim()) {
      return NextResponse.json({ error: "entityId wajib diisi" }, { status: 400 });
    }
    const allowed = await attachmentReadAllowed(resolved, { entityType, entityId, uploadedBy: null });
    if (!allowed) {
      return NextResponse.json({ error: ATTACHMENT_READ_FORBIDDEN_MSG }, { status: 403 });
    }
    const attachments = await listAttachmentsByEntity(resolved.db, entityType, entityId);
    return NextResponse.json({ attachments });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
