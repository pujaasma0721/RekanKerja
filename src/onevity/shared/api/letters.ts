import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import {
  issueLetter,
  letterPdfBuffer,
  parseMeta,
  type LetterCategory,
} from "@/onevity/shared/services/letter-service";

// Penerbitan & pencetakan SURAT (Task 3-LETTERS):
//   · POST /api/onevity/letters/issue        — terbitkan (idempotent) dari
//     DisciplinaryRecord / PersonnelAction; templateKey resolusi otomatis
//     (DISC_<LEVEL> / PA_<TYPE>). Guard hr:directory create.
//   · GET  /api/onevity/letters/[id]/pdf     — PDF surat (kop perusahaan,
//     snapshot body). Guard hr:directory view.
//   · GET  /api/onevity/letters?employeeId=  — daftar surat terbaru. Guard
//     hr:directory view.

// ================= POST issue =================
export async function issueLetterRoute(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    const category = b.category as LetterCategory;
    if (category !== "Disciplinary" && category !== "PersonnelAction") {
      return NextResponse.json({ error: "category harus Disciplinary atau PersonnelAction" }, { status: 400 });
    }

    // resolusi templateKey + karyawan dari dokumen sumber
    let templateKey: string;
    let employeeId: string;
    let personnelActionId: string | null = null;
    let disciplinaryRecordId: string | null = null;

    if (category === "Disciplinary") {
      if (!b.disciplinaryRecordId) return NextResponse.json({ error: "disciplinaryRecordId wajib" }, { status: 400 });
      const rec = await db.disciplinaryRecord.findUnique({ where: { id: b.disciplinaryRecordId } });
      if (!rec) return NextResponse.json({ error: "Catatan disiplin tidak ditemukan" }, { status: 404 });
      templateKey = `DISC_${rec.warningLevel.toUpperCase()}`; // DISC_VERBAL | DISC_WRITTEN | DISC_FINAL
      employeeId = rec.employeeId;
      disciplinaryRecordId = rec.id;
    } else {
      if (!b.personnelActionId) return NextResponse.json({ error: "personnelActionId wajib" }, { status: 400 });
      const pa = await db.personnelAction.findUnique({ where: { id: b.personnelActionId } });
      if (!pa) return NextResponse.json({ error: "Dokumen pengajuan tidak ditemukan" }, { status: 404 });
      templateKey = `PA_${pa.type.toUpperCase()}`; // PA_PROMOTION | PA_RESIGNATION | ...
      employeeId = pa.employeeId;
      personnelActionId = pa.id;
    }

    try {
      const letter = await issueLetter(db, {
        category,
        templateKey,
        employeeId,
        personnelActionId,
        disciplinaryRecordId,
        actorId: actor.appUserId,
      });
      return NextResponse.json({ letter }, { status: 201 });
    } catch (e) {
      // pesan Error dari issueLetter sudah ramah pengguna (template nonaktif dst.)
      return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal menerbitkan surat" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= GET [id]/pdf =================
export async function letterPdfRoute(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const { id } = await ctx.params;
    const doc = await db.letterDocument.findUnique({ where: { id } });
    if (!doc) return NextResponse.json({ error: "Surat tidak ditemukan" }, { status: 404 });

    // kop: perusahaan pertama + kantor penempatan (disimpan di metaJson saat terbit)
    const company = await db.company.findFirst({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: { name: true, address: true, city: true, phone: true, taxId: true },
    });
    const officeId = parseMeta(doc.metaJson).officeId ?? null;
    const office = officeId
      ? await db.companyOffice.findUnique({ where: { id: officeId }, select: { name: true, city: true, npwp: true } })
      : null;

    const bytes = await letterPdfBuffer(doc, company, office);

    // nama file: "/" pada refNo tidak sah untuk filename → ganti "-"
    const filename = `Surat-${doc.refNo.replace(/\//g, "-")}.pdf`;
    const download = req.nextUrl.searchParams.get("download") === "1";

    if (download) {
      await db.activityLog.create({
        data: {
          action: "Exported", entity: "LetterDocument", entityId: doc.id,
          appUserId: actor.appUserId ?? undefined,
          detail: `Unduh PDF surat ${doc.refNo}`,
        },
      }).catch(() => { /* log tidak boleh menggagalkan unduhan */ });
    }

    const disposition = `${download ? "attachment" : "inline"}; filename="${filename}"`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
      },
    }) as NextResponse;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= GET list =================
export async function listLetters(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const letters = await m.db.letterDocument.findMany({
      where: employeeId ? { employeeId } : undefined,
      select: { id: true, refNo: true, category: true, templateKey: true, subject: true, issuedAt: true },
      orderBy: { issuedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ letters });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
