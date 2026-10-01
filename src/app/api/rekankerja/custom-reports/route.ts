// RekanKerja — Report Builder (Task 28-b) =====================================
// Laporan kustom TERSIMPAN (model CustomReport, kode RPT-KUSTOM-%04d):
//   · GET    /api/rekankerja/custom-reports — daftar tersimpan (requireTenant).
//   · POST   — simpan { name, description?, entity, fields[], filters[] }
//     (guard create hr:custom-reports; spesifikasi divalidasi katalog).
//   · PATCH  — ubah definisi { id, name, description, entity, fields, filters }
//     (guard update; payload penuh — UI selalu mengirim spesifikasi lengkap).
//   · DELETE ?id= — hapus laporan tersimpan (guard delete; bebas — laporan
//     ad-hoc bukan dokumen transaksi).
// Setiap mutasi menulis ActivityLog (entity CustomReport, detail kode+nama+aktor).
import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import {
  nextReportCode, ReportSpecError, serializeSaved, validateSpec,
  type NormalizedFilter,
} from "@/rekankerja/shared/services/report-builder";

export const runtime = "nodejs";

/** Nilai filter → teks persisten: Date → "YYYY-MM-DD" (roundtrip aman —
 *  parseScalar menerima format ini kembali saat laporan dijalankan). */
function filterValueText(v: NormalizedFilter["value"]): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map((x) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x))).join(", ");
  return String(v);
}

// ================= GET — daftar laporan tersimpan =================
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const rows = await db.customReport.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ reports: rows.map(serializeSaved) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST — simpan laporan baru =================
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:custom-reports", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;
    const b = await req.json().catch(() => ({}));

    const name = String(b.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Nama laporan wajib diisi" }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ error: "Nama laporan maksimal 120 karakter" }, { status: 400 });
    const description = b.description == null ? null : String(b.description).trim().slice(0, 500) || null;

    const spec = validateSpec({ entity: b.entity, fields: b.fields, filters: b.filters });
    const code = await nextReportCode(db);
    const filtersJson = JSON.stringify(
      spec.filters.map((f) => ({ field: f.field, op: f.op, value: filterValueText(f.value) })),
    );

    const saved = await db.customReport.create({
      data: {
        code,
        name,
        description,
        entity: spec.entity.key,
        fieldsJson: JSON.stringify(spec.fields.map((f) => f.key)),
        filtersJson,
        createdById: actor.appUserId,
      },
    });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Created", entity: "CustomReport", entityId: saved.id,
        detail: `Laporan kustom baru ${saved.code} — "${saved.name}" (entity ${spec.entity.key}, ${spec.fields.length} field, ${spec.filters.length} filter) oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    return NextResponse.json({ report: serializeSaved(saved) }, { status: 201 });
  } catch (e) {
    if (e instanceof ReportSpecError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= PATCH — ubah definisi laporan =================
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:custom-reports", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;
    const b = await req.json().catch(() => ({}));

    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id laporan wajib" }, { status: 400 });

    const existing = await db.customReport.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Laporan tersimpan tidak ditemukan" }, { status: 404 });

    const name = String(b.name ?? existing.name).trim();
    if (!name) return NextResponse.json({ error: "Nama laporan wajib diisi" }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ error: "Nama laporan maksimal 120 karakter" }, { status: 400 });
    const description = b.description === undefined
      ? existing.description
      : String(b.description).trim().slice(0, 500) || null;

    // payload penuh: entity + fields + filters selalu dikirim UI saat ubah
    const spec = validateSpec({ entity: b.entity, fields: b.fields, filters: b.filters });
    const filtersJson = JSON.stringify(
      spec.filters.map((f) => ({ field: f.field, op: f.op, value: filterValueText(f.value) })),
    );

    const updated = await db.customReport.update({
      where: { id },
      data: {
        name,
        description,
        entity: spec.entity.key,
        fieldsJson: JSON.stringify(spec.fields.map((f) => f.key)),
        filtersJson,
      },
    });

    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Updated", entity: "CustomReport", entityId: id,
        detail: `Laporan kustom ${updated.code} diubah — "${updated.name}" (entity ${spec.entity.key}, ${spec.fields.length} field, ${spec.filters.length} filter) oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    return NextResponse.json({ report: serializeSaved(updated) });
  } catch (e) {
    if (e instanceof ReportSpecError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= DELETE — hapus laporan tersimpan =================
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:custom-reports", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "Parameter id wajib" }, { status: 400 });

    const existing = await db.customReport.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Laporan tersimpan tidak ditemukan" }, { status: 404 });

    await db.customReport.delete({ where: { id } });
    await db.activityLog.create({
      data: {
        appUserId: actor.appUserId,
        action: "Deleted", entity: "CustomReport", entityId: id,
        detail: `Laporan kustom ${existing.code} — "${existing.name}" dihapus oleh ${actor.appUsername ?? actor.name}`,
      },
    }).catch(() => { /* audit tidak boleh menggagalkan mutasi */ });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
