import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  isPerfMasterType, listMasters, countMasters, masterEntityOf,
  upsertKpi, upsertCompetency, upsertRatingScale, upsertTemplate, upsertMeritMatrix,
  archiveMaster, versionHistory,
} from "@/rekankerja/performance/services/perf-master-service";

// ============================================================================
// PERFORMANCE — API master kinerja (P0 — DEVELOPMENT-PLAN-PERFORMANCE.md §17)
// Satu endpoint multi-tipe: ?type=kpi|competency|rating-scale|template|merit-matrix
//   GET    ?type=…[&allVersions=1]     → { rows } (tanpa type = ringkasan jumlah)
//   GET    ?type=kpi|competency&history=CODE → { versions } (riwayat versi §18.9)
//   POST   { type, …field }            → upsert (id = update; tanpa id = create;
//                                        asNewVersion=true → versi baru §18.9)
//   DELETE ?type=…&id=…                → arsip/hapus (guard §35-28 di service)
// Guard menu: performance:masters (view/create/update/delete per pengguna;
// VIEWER platform 403). ActivityLog di setiap mutasi.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:masters", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const type = req.nextUrl.searchParams.get("type");
    if (type == null || type === "") {
      const counts = await countMasters(db);
      return NextResponse.json({ counts });
    }
    if (!isPerfMasterType(type)) {
      return NextResponse.json({ error: `Tipe master tidak dikenal: ${type}` }, { status: 400 });
    }

    // Riwayat versi pustaka (§18.9)
    const histCode = req.nextUrl.searchParams.get("history");
    if (histCode) {
      if (type !== "kpi" && type !== "competency") {
        return NextResponse.json({ error: "Riwayat versi hanya untuk KPI & kompetensi" }, { status: 400 });
      }
      const versions = await versionHistory(db, type, histCode);
      return NextResponse.json({ versions });
    }

    const allVersions = req.nextUrl.searchParams.get("allVersions") === "1";
    const rows = await listMasters(db, type, allVersions);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const type = b.type;
    if (!isPerfMasterType(type)) {
      return NextResponse.json({ error: `Tipe master tidak dikenal: ${String(type)}` }, { status: 400 });
    }
    const m = await requireMenuAction(req, "performance:masters", b.id ? "update" : "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const str = (v: unknown) => (v != null ? String(v) : undefined);
    const nnum = (v: unknown) => (v == null || v === "" ? null : Number(v));

    let id: string;
    let label: string;
    switch (type) {
      case "kpi":
        id = await upsertKpi(db, {
          id: b.id ? String(b.id) : undefined,
          code: String(b.code ?? ""),
          name: String(b.name ?? ""),
          category: str(b.category),
          polarity: str(b.polarity),
          unit: str(b.unit),
          dataSource: str(b.dataSource),
          sourceKey: b.sourceKey != null && b.sourceKey !== "" ? String(b.sourceKey) : null,
          description: b.description != null ? String(b.description) : null,
          active: b.active !== false,
          asNewVersion: b.asNewVersion === true,
          effectiveYear: nnum(b.effectiveYear) ?? undefined,
          changeNote: b.changeNote != null ? String(b.changeNote) : null,
        });
        label = `${b.code} — ${b.name}`;
        break;
      case "competency":
        id = await upsertCompetency(db, {
          id: b.id ? String(b.id) : undefined,
          code: String(b.code ?? ""),
          name: String(b.name ?? ""),
          kind: str(b.kind),
          levelsJson: typeof b.levelsJson === "string" ? b.levelsJson : JSON.stringify(b.levels ?? []),
          active: b.active !== false,
          asNewVersion: b.asNewVersion === true,
          effectiveYear: nnum(b.effectiveYear) ?? undefined,
          changeNote: b.changeNote != null ? String(b.changeNote) : null,
        });
        label = `${b.code} — ${b.name}`;
        break;
      case "rating-scale":
        id = await upsertRatingScale(db, {
          id: b.id ? String(b.id) : undefined,
          value: Number(b.value),
          labelId: String(b.labelId ?? ""),
          labelEn: String(b.labelEn ?? ""),
          minScore: Number(b.minScore),
          color: str(b.color),
          guideline: b.guideline != null ? String(b.guideline) : null,
        });
        label = `${b.value} — ${b.labelId}`;
        break;
      case "template":
        id = await upsertTemplate(db, {
          id: b.id ? String(b.id) : undefined,
          code: String(b.code ?? ""),
          name: String(b.name ?? ""),
          weightsJson: typeof b.weightsJson === "string" ? b.weightsJson : JSON.stringify(b.weights ?? { kpi: 70, competency: 20, core: 10 }),
          items: Array.isArray(b.items)
            ? b.items.map((i: { kind: string; refId: string; weight: number }) => ({ kind: String(i.kind), refId: String(i.refId), weight: Number(i.weight) }))
            : undefined,
          active: b.active !== false,
        });
        label = `${b.code} — ${b.name}`;
        break;
      case "merit-matrix":
        id = await upsertMeritMatrix(db, {
          id: b.id ? String(b.id) : undefined,
          code: String(b.code ?? ""),
          name: String(b.name ?? ""),
          gridJson: typeof b.gridJson === "string" ? b.gridJson : JSON.stringify(b.grid ?? {}),
          active: b.active !== false,
        });
        label = `${b.code} — ${b.name}`;
        break;
    }

    await db.activityLog.create({
      data: {
        action: b.id ? "Updated" : "Created",
        entity: masterEntityOf(type),
        entityId: id,
        detail: `Master kinerja (${type}) ${label} ${b.id ? "diperbarui" : "dibuat"}`,
      },
    });
    return NextResponse.json({ id }, { status: b.id ? 200 : 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type");
    const id = req.nextUrl.searchParams.get("id");
    if (!isPerfMasterType(type) || !id) {
      return NextResponse.json({ error: "type & id wajib" }, { status: 400 });
    }
    const m = await requireMenuAction(req, "performance:masters", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    await archiveMaster(db, type, id);
    await db.activityLog.create({
      data: {
        action: "Archived",
        entity: masterEntityOf(type),
        entityId: id,
        detail: `Master kinerja (${type}) diarsipkan/dihapus (guard §35-28)`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
