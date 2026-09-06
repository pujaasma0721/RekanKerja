// OneVity — API lampiran generik (T16-ATTACH). =============================
// =====================================================================
// POST /api/onevity/attachments        — upload (multipart: file,
//        entityType, entityId) → { id, fileName, sizeBytes, mimeType }
// GET  /api/onevity/attachments?entityType=&entityId= — metadata lampiran
//
// entityType whitelist + peta menu terkait (guard ringan per aksi create):
//   TravelClaim → travel:travel-claim · MedicalClaim → medical:medical-claim
//   EmployeeDocument → hr:directory
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { readVerifiedSession } from "@/onevity/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import {
  saveAttachment, listAttachmentsByEntity, sweepDraftAttachments,
} from "@/onevity/shared/services/attachment-service";

/** entityType yang diizinkan + menu pemiliknya (guard upload = aksi create menu itu). */
export const ATTACHMENT_ENTITY_MENUS: Record<string, string> = {
  TravelClaim: "travel:travel-claim",
  MedicalClaim: "medical:medical-claim",
  EmployeeDocument: "hr:directory",
};

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
    const m = await requireMenuAction(req, ATTACHMENT_ENTITY_MENUS[entityType]!, "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });

    const slug = await tenantSlugOfSession(req);
    if (!slug) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const mime = file.type || inferMime(file.name);
    if (!mime) {
      return NextResponse.json({ error: "Jenis file tidak dikenal — unggah JPG/PNG/WEBP/PDF" }, { status: 400 });
    }

    // sapu draf yatim >24 jam (best-effort — tidak boleh menggagalkan upload)
    await sweepDraftAttachments(m.db);

    const row = await saveAttachment(m.db, slug, {
      file: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: mime,
      entityType,
      entityId: entityId.trim(),
      uploadedBy: m.actor.appUserId ?? m.actor.userId,
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

// GET — metadata lampiran sebuah entitas (autorisasi: user login tenant sama).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const entityType = sp.get("entityType") ?? "";
    const entityId = sp.get("entityId") ?? "";
    if (!ATTACHMENT_ENTITY_MENUS[entityType]) {
      return NextResponse.json({ error: "entityType tidak dikenal" }, { status: 400 });
    }
    if (!entityId.trim()) {
      return NextResponse.json({ error: "entityId wajib diisi" }, { status: 400 });
    }
    const attachments = await listAttachmentsByEntity(db, entityType, entityId);
    return NextResponse.json({ attachments });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
