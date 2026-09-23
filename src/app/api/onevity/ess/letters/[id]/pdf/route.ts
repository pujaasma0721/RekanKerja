// ESS — unduh PDF surat hasil permintaan (Task 26-a).
// Otorisasi: hanya PEMILIK permintaan (LetterRequest.employeeId = aktor) dan
// hanya saat status Issued. Kop perusahaan + snapshot body (letter-service).
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { requireEss } from "@/onevity/ess/api/ess-auth";
import { letterPdfBuffer, parseMeta } from "@/onevity/shared/services/letter-service";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, appUserId } = m.actor;

  try {
    const { id } = await ctx.params;
    const request = await db.letterRequest.findUnique({ where: { id } });
    if (!request || request.employeeId !== employeeId) {
      return NextResponse.json({ error: "Permintaan surat tidak ditemukan" }, { status: 404 });
    }
    if (request.status !== "Issued" || !request.letterDocumentId) {
      return NextResponse.json({ error: "Surat belum diterbitkan" }, { status: 400 });
    }
    const doc = await db.letterDocument.findUnique({ where: { id: request.letterDocumentId } });
    if (!doc) return NextResponse.json({ error: "Surat tidak ditemukan" }, { status: 404 });

    // kop perusahaan + kantor penempatan (disimpan metaJson saat terbit)
    const company = await db.company.findFirst({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: { name: true, address: true, city: true, phone: true, taxId: true },
    });
    const officeId = parseMeta(doc.metaJson).officeId ?? null;
    const office = officeId
      ? await db.companyOffice.findUnique({ where: { id: officeId }, select: { name: true, city: true, npwp: true } })
      : null;

    // Task 80b: stempel e-Sign + QR verifikasi bila surat sudah ditandatangani
    const { pdfStampFor } = await import("@/onevity/shared/services/esign-service");
    const esign = await pdfStampFor(db, "LetterDocument", doc.id, req).catch((e) => {
      console.error("[esign-stamp] gagal:", e instanceof Error ? e.message : e);
      return null;
    });
    const bytes = await letterPdfBuffer(doc, company, office, esign);

    await db.activityLog.create({
      data: {
        action: "Exported", entity: "LetterDocument", entityId: doc.id,
        employeeId,
        appUserId: appUserId ?? undefined,
        detail: `Karyawan mengunduh PDF surat ${doc.refNo} (permintaan ${request.reqNo})`,
      },
    }).catch(() => { /* log tidak boleh menggagalkan unduhan */ });

    const filename = `Surat-${doc.refNo.replace(/\//g, "-")}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    }) as NextResponse;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
