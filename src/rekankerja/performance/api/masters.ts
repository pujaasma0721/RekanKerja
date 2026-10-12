import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  isMasterKind, listMasters, countMasters, upsertKpi, upsertCompetency, upsertScale, upsertTemplate,
  upsertMerit, newVersionMaster, archiveMaster, deleteMaster,
} from "@/rekankerja/performance/services/perf-master-service";

// ============================================================================
// PERFORMANCE — API master kinerja (P0 — DEVELOPMENT-PLAN-PERFORMANCE.md §17)
// Satu endpoint multi-kind: ?kind=kpi|competency|scale|template|meritMatrix
//   GET    ?kind=…                        → { rows }
//          ?kind=kpi&historyOf=KODE        → riwayat versi semua (§18.9)
//          (tanpa kind)                    → { counts } ringkasan
//   POST   { kind, id?, …field }           → create / update minor (nama/
//          deskripsi/aktif — definitif ditolak, wajib newVersion §18.9)
//   POST   { action:newVersion, kind:kpi|competency, id, changeNote,
//          effectiveYear, data:{…} }       → versi baru + lama Superseded
//   POST   { action:archive, kind, id, unarchive? } → arsip lembut
//   DELETE ?kind=…&id=…                    → hard delete DENGAN guard rujukan
//          baris penilaian (DILARANG §35-28)
// Guard menu: performance:masters. ActivityLog di setiap mutasi.
// ============================================================================

// GET /api/rekankerja/performance/masters?kind=…
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:masters", "performance:overview", "performance:goals", "performance:appraisals"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind");
    if (kind == null || kind === "") {
      const counts = await countMasters(db);
      return NextResponse.json({ counts });
    }
    if (!isMasterKind(kind)) {
      return NextResponse.json({ error: `Tipe master tidak dikenal: ${kind}` }, { status: 400 });
    }
    const rows = await listMasters(db, kind, {
      q: sp.get("q") ?? undefined,
      active: sp.get("active") ?? undefined,
      category: sp.get("category") ?? undefined,
      includeArchived: sp.get("includeArchived") === "true",
      historyOf: sp.get("historyOf") ?? undefined,
    });
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/performance/masters — upsert / newVersion / archive
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const action = String(b.action ?? "");
    const kind = b.kind;

    // ---- action verbs (versi baru / arsip — AMANDEMEN 2 §18.9) ----
    if (action === "newVersion") {
      if (kind !== "kpi" && kind !== "competency") {
        return NextResponse.json({ error: "Versi baru hanya untuk pustaka KPI dan kompetensi (§18.9)" }, { status: 400 });
      }
      const m = await requireMenuAction(req, "performance:masters", "op:newVersion");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const db = m.db;
      const id = await newVersionMaster(db, kind, {
        id: String(b.id ?? ""),
        changeNote: String(b.changeNote ?? ""),
        effectiveYear: Number(b.effectiveYear ?? new Date().getFullYear()),
        data: (b.data ?? {}) as Record<string, unknown>,
      });
      await db.activityLog.create({
        data: {
          action: "Updated",
          entity: kind === "kpi" ? "KpiDefinition" : "Competency",
          entityId: id,
          detail: `Pustaka ${kind} versi baru dibuat (tahun berlaku ${b.effectiveYear}) — versi lama jadi Superseded. Catatan: ${String(b.changeNote ?? "")}`,
        },
      });
      return NextResponse.json({ id }, { status: 201 });
    }
    if (action === "archive") {
      if (kind !== "kpi" && kind !== "competency") {
        return NextResponse.json({ error: "Arsip hanya untuk pustaka KPI dan kompetensi (§18.9)" }, { status: 400 });
      }
      const m = await requireMenuAction(req, "performance:masters", "op:archive");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const db = m.db;
      await archiveMaster(db, kind, String(b.id ?? ""), b.unarchive === true);
      await db.activityLog.create({
        data: {
          action: "Updated",
          entity: kind === "kpi" ? "KpiDefinition" : "Competency",
          entityId: String(b.id ?? ""),
          detail: `Pustaka ${kind} ${b.unarchive === true ? "diaktifkan kembali" : "diarsipkan (lembut — data historis tetap terbaca)"}`,
        },
      });
      return NextResponse.json({ ok: true });
    }

    // ---- upsert biasa ----
    if (!isMasterKind(kind)) {
      return NextResponse.json({ error: `Tipe master tidak dikenal: ${String(kind)}` }, { status: 400 });
    }
    const m = await requireMenuAction(req, "performance:masters", b.id ? "update" : "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    let id = "";
    if (kind === "kpi") {
      id = await upsertKpi(db, {
        id: b.id ? String(b.id) : undefined,
        code: String(b.code ?? ""),
        name: String(b.name ?? ""),
        category: b.category != null ? String(b.category) : undefined,
        polarity: b.polarity != null ? String(b.polarity) : undefined,
        unit: b.unit != null ? String(b.unit) : undefined,
        dataSource: b.dataSource != null ? String(b.dataSource) : undefined,
        sourceKey: b.sourceKey === undefined ? undefined : (b.sourceKey == null || b.sourceKey === "" ? null : String(b.sourceKey)),
        description: b.description === undefined ? undefined : (b.description == null || b.description === "" ? null : String(b.description)),
        active: b.active != null ? b.active === true : undefined,
        effectiveYear: Number.isFinite(Number(b.effectiveYear)) ? Number(b.effectiveYear) : undefined,
      }, m.actor.name);
    } else if (kind === "competency") {
      id = await upsertCompetency(db, {
        id: b.id ? String(b.id) : undefined,
        code: String(b.code ?? ""),
        name: String(b.name ?? ""),
        kind: b.compKind != null ? String(b.compKind) : undefined,
        levelsJson: b.levelsJson != null ? String(b.levelsJson) : undefined,
        active: b.active != null ? b.active === true : undefined,
        effectiveYear: Number.isFinite(Number(b.effectiveYear)) ? Number(b.effectiveYear) : undefined,
      }, m.actor.name);
    } else if (kind === "scale") {
      id = await upsertScale(db, {
        id: b.id ? String(b.id) : undefined,
        value: Number(b.value),
        labelId: String(b.labelId ?? ""),
        labelEn: String(b.labelEn ?? ""),
        minScore: Number(b.minScore),
        color: b.color != null ? String(b.color) : undefined,
        guideline: b.guideline === undefined ? undefined : (b.guideline == null || b.guideline === "" ? null : String(b.guideline)),
      });
    } else if (kind === "template") {
      id = await upsertTemplate(db, {
        id: b.id ? String(b.id) : undefined,
        code: String(b.code ?? ""),
        name: String(b.name ?? ""),
        weightsJson: b.weightsJson != null ? String(b.weightsJson) : undefined,
        items: Array.isArray(b.items)
          ? (b.items as { kind: string; refId: string; weight: number }[]).map((it) => ({
              kind: String(it.kind), refId: String(it.refId), weight: Number(it.weight),
            }))
          : undefined,
        active: b.active != null ? b.active === true : undefined,
      });
    } else {
      id = await upsertMerit(db, {
        id: b.id ? String(b.id) : undefined,
        code: String(b.code ?? ""),
        name: String(b.name ?? ""),
        gridJson: b.gridJson != null ? String(b.gridJson) : undefined,
        active: b.active != null ? b.active === true : undefined,
      });
    }

    const label = b.name ?? b.code ?? id;
    await db.activityLog.create({
      data: {
        action: b.id ? "Updated" : "Created",
        entity: kind === "kpi" ? "KpiDefinition" : kind === "competency" ? "Competency" : kind === "scale" ? "RatingScale" : kind === "template" ? "PerformanceTemplate" : "MeritMatrix",
        entityId: id,
        detail: `Master kinerja (${kind}) ${String(b.code ?? "")} — ${String(label)} ${b.id ? "diperbarui" : "dibuat"}`,
      },
    });
    return NextResponse.json({ id }, { status: b.id ? 200 : 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE /api/rekankerja/performance/masters?kind=…&id=…
export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind");
    const id = sp.get("id");
    if (!isMasterKind(kind)) {
      return NextResponse.json({ error: `Tipe master tidak dikenal: ${String(kind)}` }, { status: 400 });
    }
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "performance:masters", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    await deleteMaster(db, kind, id);
    await db.activityLog.create({
      data: {
        action: "Deleted",
        entity: kind === "kpi" ? "KpiDefinition" : kind === "competency" ? "Competency" : kind === "scale" ? "RatingScale" : kind === "template" ? "PerformanceTemplate" : "MeritMatrix",
        entityId: id,
        detail: `Master kinerja (${kind}) dihapus`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
