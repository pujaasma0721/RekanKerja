// ESS — Surat layanan karyawan (Task 26-a). ================================
// GET  /api/onevity/ess/letters — daftar template EmployeeService aktif (kartu
//      pilihan) + riwayat permintaan SAYA (status timeline + refNo surat hasil
//      terbitan utk tombol unduh). Auth karyawan via requireEss.
// POST /api/onevity/ess/letters — ajukan permintaan surat { templateKey,
//      purpose?, notes? } → reqNo REQ-SURAT-%04d; validasi template aktif +
//      batas 1 permintaan Pending per jenis surat; ActivityLog + notifikasi
//      ke Admin/HR (notifyEvent to:"admins") — keputusan dua arah dikerjakan
//      HR di menu Template Surat → tab Permintaan Masuk.
import { NextResponse } from "next/server";
import { requireEss } from "@/onevity/ess/api/ess-auth";
import { notifyEvent } from "@/onevity/shared/services/notification-service";
import { sendWaBatch, approverPhonesOf } from "@/onevity/shared/services/wa-service";

// ================= GET =================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const [templates, requests] = await Promise.all([
      db.letterTemplate.findMany({
        where: { category: "EmployeeService", active: true },
        orderBy: { key: "asc" },
        select: { key: true, name: true, description: true, subject: true },
      }),
      db.letterRequest.findMany({
        where: { employeeId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    // nama template + refNo surat hasil terbitan (join manual — tanpa FK)
    const templateName = new Map(templates.map((t) => [t.key, t.name]));
    const docIds = requests.map((r) => r.letterDocumentId).filter((x): x is string => !!x);
    const docs = docIds.length
      ? await db.letterDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, refNo: true, issuedAt: true } })
      : [];
    const docById = new Map(docs.map((d) => [d.id, d]));

    return NextResponse.json({
      templates,
      requests: requests.map((r) => ({
        id: r.id,
        reqNo: r.reqNo,
        templateKey: r.templateKey,
        templateName: templateName.get(r.templateKey) ?? r.templateKey,
        purpose: r.purpose,
        notes: r.notes,
        status: r.status, // Pending | Approved | Rejected | Issued
        rejectReason: r.rejectReason,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        letterDocumentId: r.letterDocumentId,
        letterRefNo: r.letterDocumentId ? docById.get(r.letterDocumentId)?.refNo ?? null : null,
        issuedAt: r.letterDocumentId ? docById.get(r.letterDocumentId)?.issuedAt ?? null : null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST =================
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, fullName } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const templateKey = String(b.templateKey ?? "").trim();
    const purpose = String(b.purpose ?? "").trim();
    const notes = String(b.notes ?? "").trim();

    if (!templateKey) return NextResponse.json({ error: "Jenis surat wajib dipilih" }, { status: 400 });
    if (purpose.length > 200) return NextResponse.json({ error: "Keperluan maksimal 200 karakter" }, { status: 400 });
    if (notes.length > 300) return NextResponse.json({ error: "Catatan maksimal 300 karakter" }, { status: 400 });

    // template harus EmployeeService aktif (bukan template disipliner/PA)
    const tpl = await db.letterTemplate.findFirst({ where: { key: templateKey } });
    if (!tpl || !tpl.active || tpl.category !== "EmployeeService") {
      return NextResponse.json({ error: "Jenis surat tidak tersedia" }, { status: 400 });
    }

    // batasi 1 permintaan Pending per jenis surat per karyawan
    const pendingSame = await db.letterRequest.findFirst({
      where: { employeeId, templateKey, status: "Pending" },
      select: { reqNo: true },
    });
    if (pendingSame) {
      return NextResponse.json(
        { error: `Anda masih punya permintaan ${tpl.name} menunggu keputusan HR (${pendingSame.reqNo}).` },
        { status: 400 },
      );
    }

    // reqNo berurutan tenant: REQ-SURAT-0001
    const count = await db.letterRequest.count();
    const reqNo = `REQ-SURAT-${String(count + 1).padStart(4, "0")}`;

    const created = await db.letterRequest.create({
      data: {
        reqNo,
        employeeId,
        templateKey,
        purpose: purpose || null,
        notes: notes || null,
        status: "Pending",
      },
    });

    await db.activityLog.create({
      data: {
        action: "Created", entity: "LetterRequest", entityId: created.id,
        employeeId,
        detail: `Permintaan surat ${reqNo} (${tpl.name}) diajukan dari ESS${purpose ? ` — keperluan ${purpose}` : ""}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan pengajuan */ });

    // kabari Admin/HR (maks 5 — resolusi notifyEvent to:"admins")
    void notifyEvent(db, {
      to: "admins",
      docType: "LetterRequest",
      docNo: reqNo,
      title: `Permintaan surat baru ${reqNo}`,
      body: `${fullName} meminta ${tpl.name}${purpose ? ` — keperluan ${purpose}` : ""}. Buka Template Surat → Permintaan Masuk.`,
      kind: "letters",
    });

    // Task 28-a — notifikasi WhatsApp ke Admin/HR (fire-and-forget, never-throw)
    void sendWaBatch(db, {
      event: "letter.requested",
      recipients: (await approverPhonesOf(db)).map((phone) => ({
        phone,
        placeholders: { nama: fullName, jenisSurat: tpl.name, docNo: reqNo, keperluan: purpose ? ` — keperluan ${purpose}` : "" },
      })),
    });

    return NextResponse.json({ reqNo: created.reqNo, status: created.status }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
