import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { tenantSlugOfSession } from "@/rekankerja/shared/api/attachments";
import { MAX_ATTACHMENT_BYTES } from "@/rekankerja/shared/services/attachment-service";
import {
  addApplicantDocument, deleteApplicantDocument, verifyApplicantDocument,
} from "@/rekankerja/recruitment/services/applicant-service";

// ============================================================================
// RECRUITMENT F2 — API dokumen pelamar (pattern employee-documents.ts):
// POST   multipart { applicantId, requiredDocumentId?, title?, file } → unggah
// PATCH  { id, verified } → tandai verifikasi dokumen (pre-employment F4)
// DELETE ?id= → hapus dokumen + file
// Guard menu: recruitment:applicants. Validasi MIME whitelist + magic number
// + ≤5MB di attachment-service (saveAttachment → validate).
// ============================================================================

// GET ?applicantId= — ringkasan (dipakai bila perlu refresh cepat)
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:applicants"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — unggah dokumen pelamar (multipart, file wajib)
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "recruitment:applicants", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Request harus multipart/form-data" }, { status: 400 });
    }

    const applicantId = String(form.get("applicantId") ?? "").trim();
    const requiredDocumentId = String(form.get("requiredDocumentId") ?? "").trim() || null;
    const title = String(form.get("title") ?? "").trim();
    const file = form.get("file");

    if (!applicantId) return NextResponse.json({ error: "Pelamar wajib dipilih" }, { status: 400 });
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ error: "File dokumen wajib dilampirkan" }, { status: 400 });
    }

    // validasi awal (mirror employee-documents; validate() di service tetap
    // otoritatif — magic number + whitelist MIME + ukuran)
    const buf = Buffer.from(await file.arrayBuffer());
    let mimeType = file.type;
    if (!mimeType) {
      const ext = file.name.toLowerCase().split(".").pop() ?? "";
      mimeType =
        ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "png" ? "image/png"
        : ext === "webp" ? "image/webp"
        : ext === "pdf" ? "application/pdf"
        : "";
    }
    if (!mimeType || buf.length > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: "Dokumen harus JPG/PNG/WEBP/PDF dan maksimum 5 MB" }, { status: 400 });
    }

    const slug = await tenantSlugOfSession(req);
    if (!slug) return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });

    try {
      const res = await addApplicantDocument(db, slug, {
        applicantId,
        requiredDocumentId,
        title: title || file.name,
        file: { buffer: buf, fileName: file.name, mimeType },
        uploadedBy: actor.appUserId ?? actor.userId,
      });
      return NextResponse.json({ ...res, fileName: file.name }, { status: 201 });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — verifikasi / batal verifikasi dokumen
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const m = await requireMenuAction(req, "recruitment:applicants", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await verifyApplicantDocument(m.db, id, b.verified === true, m.actor.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE ?id= — hapus dokumen (file fisik ikut)
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "recruitment:applicants", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const slug = await tenantSlugOfSession(req);
    if (!slug) return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });
    await deleteApplicantDocument(m.db, slug, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
