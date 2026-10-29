// OneVity — API dokumen karyawan (T16-ATTACH). ============================
// =====================================================================
// GET    /api/onevity/employee-documents?employeeId=&expiring=30
//        — daftar dokumen (join nama karyawan; filter kedaluwarsa ≤ n hari,
//          termasuk yang sudah lewat). Guard pola employees.ts GET:
//          requireScoped + scopeWhere (skema akses data karyawan).
// POST   /api/onevity/employee-documents — multipart (employeeId, docType,
//          docNumber, issuedAt, expiresAt, notes + file opsional) —
//          guard hr:directory create. File → Attachment(entityType
//          EmployeeDocument) + tautkan attachmentId.
// PATCH  /api/onevity/employee-documents — JSON { id, docType?, docNumber?,
//          issuedAt?, expiresAt?, notes? } — guard hr:directory update.
// DELETE /api/onevity/employee-documents?id= — hapus dokumen + lampiran
//          (file + baris) — guard hr:directory delete.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { requireScoped, scopeWhere } from "@/onevity/shared/services/access-scope";
import { saveAttachment, deleteAttachmentByRow, MAX_ATTACHMENT_BYTES } from "@/onevity/shared/services/attachment-service";
import { tenantSlugOfSession } from "@/onevity/shared/api/attachments";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";

/** docType yang dikenal (label EN/ID ada di komponen UI). */
export const DOC_TYPES = ["KTP", "Paspor", "SIM", "KK", "NPWP", "Ijazah", "Sertifikat", "Kontrak", "Lainnya"] as const;

function parseDate(v: unknown, label: string): Date | null {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error(`Tanggal ${label} tidak valid`);
  return d;
}

function docMeta(
  d: {
    id: string; employeeId: string; docType: string; docNumber: string | null;
    issuedAt: Date | null; expiresAt: Date | null; notes: string | null;
    attachmentId: string | null; createdAt: Date; updatedAt: Date;
    employee: { employeeNo: string; fullName: string };
    attachment: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null;
  },
  tc?: { decryptText: (v: string | null) => string | null },
) {
  return {
    id: d.id, employeeId: d.employeeId,
    employeeNo: d.employee.employeeNo, employeeName: d.employee.fullName,
    docType: d.docType,
    // Task 52-d — no. dokumen (NIK KTP/KK/paspor = PII) terenkripsi di DB;
    // dekripsi di batas serializer (decryptText meloloskan plaintext legacy).
    docNumber: tc ? tc.decryptText(d.docNumber) : d.docNumber,
    issuedAt: d.issuedAt, expiresAt: d.expiresAt, notes: d.notes,
    attachment: d.attachment ? { id: d.attachment.id, fileName: d.attachment.fileName, mimeType: d.attachment.mimeType, sizeBytes: d.attachment.sizeBytes } : null,
    createdAt: d.createdAt, updatedAt: d.updatedAt,
  };
}

const INCLUDE = {
  employee: { select: { employeeNo: true, fullName: true } },
  attachment: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
} as const;

// GET — daftar dokumen (filter employeeId & kedaluwarsa ≤ n hari).
export async function GET(req: NextRequest) {
  try {
    const s = await requireScoped(req);
    if (!s.ok) return NextResponse.json({ error: s.error }, { status: s.status });
    const db = s.db;
    const sp = req.nextUrl.searchParams;

    const employeeId = sp.get("employeeId")?.trim() || undefined;
    const expiringRaw = sp.get("expiring");

    let expiresAt: { lte: Date } | undefined;
    if (expiringRaw !== null && expiringRaw !== "") {
      const days = Number(expiringRaw);
      if (!Number.isFinite(days) || days < 0) {
        return NextResponse.json({ error: "Parameter expiring harus angka hari (mis. 30)" }, { status: 400 });
      }
      const cutoff = new Date();
      cutoff.setHours(23, 59, 59, 999);
      cutoff.setDate(cutoff.getDate() + Math.floor(days));
      expiresAt = { lte: cutoff };
    }

    // scoping akses data (pola employees.ts) — dokumen milik karyawan dalam scope
    const employeeWhere = scopeWhere(s.scope);
    const where = {
      ...(employeeId ? { employeeId } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(Object.keys(employeeWhere).length > 0 ? { employee: employeeWhere } : {}),
    };

    const [docs, totalAll, expired, soon30] = await Promise.all([
      db.employeeDocument.findMany({ where, include: INCLUDE, orderBy: [{ employee: { employeeNo: "asc" } }, { docType: "asc" }] }),
      db.employeeDocument.count({ where: { employee: employeeWhere } }),
      db.employeeDocument.count({
        where: { AND: [{ employee: employeeWhere }, { expiresAt: { lte: new Date() } }] },
      }),
      db.employeeDocument.count({
        where: {
          AND: [
            { employee: employeeWhere },
            { expiresAt: { gte: new Date() } },
            { expiresAt: { lte: dayEndPlus(30) } },
          ],
        },
      }),
    ]);

    return NextResponse.json({
      documents: docs.map((d) => docMeta(d, tenantCryptoForDb(db))),
      stats: { total: totalAll, expired, expiring30: soon30 },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

function dayEndPlus(days: number): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  d.setDate(d.getDate() + days);
  return d;
}

// POST — tambah dokumen (multipart; file opsional → lampiran).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Request harus multipart/form-data" }, { status: 400 });
    }

    const employeeId = String(form.get("employeeId") ?? "").trim();
    const docType = String(form.get("docType") ?? "").trim();
    const docNumber = String(form.get("docNumber") ?? "").trim() || null;
    const notes = String(form.get("notes") ?? "").trim() || null;
    const file = form.get("file");

    if (!employeeId) return NextResponse.json({ error: "Karyawan wajib dipilih" }, { status: 400 });
    if (!(DOC_TYPES as readonly string[]).includes(docType)) {
      return NextResponse.json({ error: `Jenis dokumen tidak dikenal — gunakan ${DOC_TYPES.join("|")}` }, { status: 400 });
    }

    const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeNo: true, fullName: true } });
    if (!emp) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 400 });

    let issuedAt: Date | null;
    let expiresAt: Date | null;
    try {
      issuedAt = parseDate(form.get("issuedAt"), "terbit");
      expiresAt = parseDate(form.get("expiresAt"), "kedaluwarsa");
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
    }
    if (issuedAt && expiresAt && expiresAt < issuedAt) {
      return NextResponse.json({ error: "Tanggal kedaluwarsa tidak boleh mendahului tanggal terbit" }, { status: 400 });
    }

    // file opsional — validasi awal sebelum baris dibuat (rollback manual bila gagal)
    let buf: Buffer | null = null;
    let fileName = "";
    let mimeType = "";
    if (file instanceof File && file.size > 0) {
      buf = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
      mimeType = file.type;
      if (!mimeType) {
        const ext = fileName.toLowerCase().split(".").pop() ?? "";
        mimeType =
          ext === "jpg" || ext === "jpeg" ? "image/jpeg"
          : ext === "png" ? "image/png"
          : ext === "webp" ? "image/webp"
          : ext === "pdf" ? "application/pdf"
          : "";
      }
      if (!mimeType || buf.length > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: "Lampiran harus JPG/PNG/WEBP/PDF dan maksimum 5 MB" }, { status: 400 });
      }
    }

    const slug = await tenantSlugOfSession(req);
    if (buf && !slug) return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });

    // Task 52-d — no. dokumen (NIK/paspor/KK) dienkripsi sebelum persist.
    const tcDoc = tenantCryptoForDb(db);
    const doc = await db.employeeDocument.create({
      data: { employeeId, docType, docNumber: docNumber != null ? tcDoc.encryptText(docNumber) : null, issuedAt, expiresAt, notes },
    });

    if (buf && slug) {
      try {
        const att = await saveAttachment(db, slug, {
          file: buf, fileName, mimeType,
          entityType: "EmployeeDocument", entityId: doc.id,
          uploadedBy: actor.appUserId ?? actor.userId,
        });
        await db.employeeDocument.update({ where: { id: doc.id }, data: { attachmentId: att.id } });
      } catch (e) {
        // gagal menyimpan file → batalkan baris dokumen (tanpa lampiran yatim)
        await db.employeeDocument.delete({ where: { id: doc.id } }).catch(() => undefined);
        return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
      }
    }

    void db.activityLog
      .create({
        data: {
          appUserId: actor.appUserId ?? undefined, employeeId,
          action: "Created", entity: "EmployeeDocument", entityId: doc.id,
          detail: `Dokumen ${docType}${docNumber ? ` ${docNumber}` : ""} karyawan ${emp.fullName} (${emp.employeeNo}) oleh ${actor.appUsername ?? actor.name}`,
        },
      })
      .catch(() => undefined);

    const created = await db.employeeDocument.findUnique({ where: { id: doc.id }, include: INCLUDE });
    return NextResponse.json({ document: created ? docMeta(created, tcDoc) : null }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — ubah metadata dokumen (JSON).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    const existing = await db.employeeDocument.findUnique({ where: { id }, include: INCLUDE });
    if (!existing) return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (b.docType !== undefined) {
      const docType = String(b.docType).trim();
      if (!(DOC_TYPES as readonly string[]).includes(docType)) {
        return NextResponse.json({ error: "Jenis dokumen tidak dikenal" }, { status: 400 });
      }
      data.docType = docType;
    }
    // Task 52-d — docNumber terenkripsi di DB: tulis terenkripsi, log/tampilkan
    // plaintext (dekripsi di batas; plaintext legacy diloloskan apa adanya).
    const tcUpd = tenantCryptoForDb(db);
    if (b.docNumber !== undefined) {
      const plain = String(b.docNumber).trim() || null;
      data.docNumber = plain != null ? tcUpd.encryptText(plain) : null;
    }
    if (b.notes !== undefined) data.notes = String(b.notes).trim() || null;
    if (b.issuedAt !== undefined || b.expiresAt !== undefined) {
      let issuedAt: Date | null;
      let expiresAt: Date | null;
      try {
        issuedAt = b.issuedAt !== undefined ? parseDate(b.issuedAt, "terbit") : existing.issuedAt;
        expiresAt = b.expiresAt !== undefined ? parseDate(b.expiresAt, "kedaluwarsa") : existing.expiresAt;
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
      }
      if (issuedAt && expiresAt && expiresAt < issuedAt) {
        return NextResponse.json({ error: "Tanggal kedaluwarsa tidak boleh mendahului tanggal terbit" }, { status: 400 });
      }
      data.issuedAt = issuedAt;
      data.expiresAt = expiresAt;
    }

    const updated = await db.employeeDocument.update({ where: { id }, data, include: INCLUDE });
    const updatedDocNo = tcUpd.decryptText(updated.docNumber);

    void db.activityLog
      .create({
        data: {
          appUserId: m.actor.appUserId ?? undefined, employeeId: updated.employeeId,
          action: "Updated", entity: "EmployeeDocument", entityId: id,
          detail: `Ubah dokumen ${updated.docType}${updatedDocNo ? ` ${updatedDocNo}` : ""} (${updated.employee.fullName}) oleh ${m.actor.appUsername ?? m.actor.name}`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ document: docMeta(updated, tcUpd) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE — hapus dokumen + lampirannya (?id=).
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "Parameter id wajib" }, { status: 400 });

    const doc = await db.employeeDocument.findUnique({
      where: { id },
      include: { ...INCLUDE, attachment: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, storagePath: true } } },
    });
    if (!doc) return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });

    // hapus lampiran dulu (file + baris) — FK SetNull aman, tapi bersihkan total
    if (doc.attachmentId && doc.attachment) {
      await deleteAttachmentByRow(db, doc.attachment);
    }
    await db.employeeDocument.delete({ where: { id } });

    // Task 52-d — tampilkan no. dokumen terdekripsi di jejak (bukan ciphertext).
    const delDocNo = tenantCryptoForDb(db).decryptText(doc.docNumber);
    void db.activityLog
      .create({
        data: {
          appUserId: m.actor.appUserId ?? undefined, employeeId: doc.employeeId,
          action: "Deleted", entity: "EmployeeDocument", entityId: id,
          detail: `Hapus dokumen ${doc.docType}${delDocNo ? ` ${delDocNo}` : ""} (${doc.employee.fullName}) oleh ${m.actor.appUsername ?? m.actor.name}`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
