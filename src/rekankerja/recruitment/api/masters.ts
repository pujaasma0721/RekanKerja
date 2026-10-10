import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  isMasterType, listMasters, countMasters, upsertMaster, deleteMaster, masterEntityOf,
} from "@/rekankerja/recruitment/services/recruitment-master-service";

// ============================================================================
// RECRUITMENT — API master rekrutmen (F0 — DEVELOPMENT-PLAN-RECRUITMENT.md §5)
// Satu endpoint multi-tipe: ?type=method|ad-media|agency|cost-item|skill|
// required-document|eval-category|eval-scale|sla-group|selection-process
//   GET    ?type=…          → { rows } (tanpa type = ringkasan jumlah semua tipe)
//   POST   { type, …field }  → upsert (id = update; tanpa id = create)
//   DELETE ?type=…&id=…      → hapus
// Guard menu: recruitment:masters (view/create/update/delete per pengguna;
// VIEWER platform 403 — pola Task 32-d). ActivityLog di setiap mutasi.
// ============================================================================

// GET /api/rekankerja/recruitment/masters?type=…
export async function GET(req: NextRequest) {
  try {
    // Ringkasan jumlah dipakai halaman Ringkasan modul → izin view salah satu.
    const m = await requireMenuViewAny(req, ["recruitment:masters", "recruitment:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const type = req.nextUrl.searchParams.get("type");
    if (type == null || type === "") {
      const counts = await countMasters(db);
      return NextResponse.json({ counts });
    }
    if (!isMasterType(type)) {
      return NextResponse.json({ error: `Tipe master tidak dikenal: ${type}` }, { status: 400 });
    }
    const rows = await listMasters(db, type);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/recruitment/masters — upsert master { type, id?, code, … }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const type = b.type;
    if (!isMasterType(type)) {
      return NextResponse.json({ error: `Tipe master tidak dikenal: ${String(type)}` }, { status: 400 });
    }
    const m = await requireMenuAction(req, "recruitment:masters", b.id ? "update" : "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = await upsertMaster(db, type, {
      id: b.id ? String(b.id) : undefined,
      code: String(b.code ?? ""),
      name: b.name != null ? String(b.name) : undefined,
      title: b.title != null ? String(b.title) : undefined,
      scope: b.scope != null ? String(b.scope) : undefined,
      description: b.description != null ? String(b.description) : undefined,
      address: b.address != null ? String(b.address) : undefined,
      contact: b.contact != null ? String(b.contact) : undefined,
      note: b.note != null ? String(b.note) : undefined,
      fileType: b.fileType != null ? String(b.fileType) : undefined,
      mandatory: b.mandatory === true,
      ranking: Number.isFinite(Number(b.ranking)) ? Number(b.ranking) : undefined,
      days: Number.isFinite(Number(b.days)) ? Number(b.days) : undefined,
      resultType: b.resultType != null ? String(b.resultType) : undefined,
      processOrder: Number.isFinite(Number(b.processOrder)) ? Number(b.processOrder) : undefined,
      slaDays: b.slaDays == null || b.slaDays === "" ? null : Number(b.slaDays),
      minResultPass: b.minResultPass == null || b.minResultPass === "" ? null : Number(b.minResultPass),
      needAcknowledgement: b.needAcknowledgement === true,
      appliesInternal: b.appliesInternal !== false,
      appliesExternal: b.appliesExternal !== false,
      mandatoryStep: b.mandatoryStep !== false,
      active: b.active !== false,
      sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : undefined,
    });

    const label = b.title ?? b.name ?? b.code;
    await db.activityLog.create({
      data: {
        action: b.id ? "Updated" : "Created",
        entity: masterEntityOf(type),
        entityId: id,
        detail: `Master rekrutmen (${type}) ${b.code} — ${label} ${b.id ? "diperbarui" : "dibuat"}`,
      },
    });
    return NextResponse.json({ id }, { status: b.id ? 200 : 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE /api/rekankerja/recruitment/masters?type=…&id=…
export async function DELETE(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type");
    const id = req.nextUrl.searchParams.get("id");
    if (!isMasterType(type)) {
      return NextResponse.json({ error: `Tipe master tidak dikenal: ${String(type)}` }, { status: 400 });
    }
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "recruitment:masters", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    try {
      await deleteMaster(db, type, id);
    } catch {
      return NextResponse.json({ error: "Master tidak ditemukan (atau sudah dihapus)" }, { status: 404 });
    }
    await db.activityLog.create({
      data: {
        action: "Deleted",
        entity: masterEntityOf(type),
        entityId: id,
        detail: `Master rekrutmen (${type}) dihapus`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
