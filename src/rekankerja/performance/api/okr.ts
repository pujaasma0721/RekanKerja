import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  okrErrStatus, okrHrActor, okrFeatureOn,
  currentQuarter, listQuarters, listBoard, myObjectives, okrStats, objectiveDetail,
  searchOkrEmployees, alignOptions, createObjective, updateObjective,
  postObjective, closeObjective, updateKeyResult, deleteObjective,
  type OkrKrInput,
} from "@/rekankerja/performance/services/okr-service";

// ============================================================================
// PERFORMANCE — API OKR kuartalan (B1 — DEVELOPMENT-PLAN-BACKLOG.md §4 B1;
// D-BL1…D-BL5): board transparan + kelola objective.
//   GET  ?quarter=&status=&employeeId=   → board (default kuartal berjalan;
//                                          Draft hanya utk HR/pemilik — D-BL3)
//   GET  ?mine=1&quarter=                 → objective milik viewer
//   GET  ?id=                             → detail (+ anak align 1 level)
//   GET  ?employees=1&q=                  → picker owner (HR create)
//   GET  ?alignOptions=1&quarter=         → opsi align (Draft/Post same quarter)
//   POST {action:create}                  → objective Draft (HR utk siapa saja;
//                                          non-HR hanya utk dirinya)
//   POST {action:update}                  → edit penuh Draft (owner/HR)
//   POST {action:post}                    → Draft→Posted (owner/HR — board org)
//   POST {action:close}                   → Posted→Closed + closedScore final (HR)
//   POST {action:updateKr}                → progres KR: current/confidence/note
//                                          (owner/HR, hanya saat Posted)
//   POST {action:delete}                  → hapus Draft (owner/HR)
// Guard menu: performance:okr — op per aksi (lihat MENU_OPS). ESS memakai
// endpoint terpisah /api/rekankerja/ess/my-okr (self-scope anti-IDOR).
// Semua mutasi menolak 409 bila okrEnabled=false (D-BL2). ActivityLog di service.
// ============================================================================

function parseKrInput(raw: unknown): OkrKrInput[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return (raw as Record<string, unknown>[]).map((k) => ({
    title: String(k.title ?? ""),
    unit: String(k.unit ?? ""),
    polarity: String(k.polarity ?? "HigherIsBetter"),
    baseline: Number(k.baseline ?? 0),
    target: Number(k.target ?? 0),
    current: k.current == null ? undefined : Number(k.current),
    weight: Number(k.weight ?? 0),
    confidence: k.confidence == null ? undefined : String(k.confidence),
    note: k.note == null ? undefined : String(k.note),
  }));
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:okr", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    const id = sp.get("id");
    if (id) {
      const detail = await objectiveDetail(db, id);
      if (!detail) return NextResponse.json({ error: "Objective tidak ditemukan" }, { status: 404 });
      return NextResponse.json(detail);
    }
    if (sp.get("employees") === "1") {
      return NextResponse.json(await searchOkrEmployees(db, sp.get("q") || undefined));
    }
    if (sp.get("alignOptions") === "1") {
      return NextResponse.json(await alignOptions(db, sp.get("quarter") || currentQuarter(), sp.get("excludeId") || undefined));
    }
    if (sp.get("mine") === "1") {
      if (!m.actor.employeeId) return NextResponse.json({ rows: [], stats: okrStats([]) });
      const rows = await myObjectives(db, m.actor.employeeId, sp.get("quarter") || undefined);
      return NextResponse.json({ rows, stats: okrStats(rows) });
    }

    // board + meta (viewer flags utk tombol aksi UI)
    const viewerIsHr = okrHrActor(m.actor.role, m.actor.appUserRole);
    const [rows, quarters, okrEnabled] = await Promise.all([
      listBoard(db, {
        quarter: sp.get("quarter") || undefined,
        status: sp.get("status") || undefined,
        ownerEmployeeId: sp.get("employeeId") || undefined,
        viewerEmployeeId: m.actor.employeeId,
        viewerIsHr,
      }),
      listQuarters(db),
      okrFeatureOn(db),
    ]);
    return NextResponse.json({
      rows,
      okrEnabled,
      currentQuarter: currentQuarter(),
      quarters,
      viewer: { employeeId: m.actor.employeeId, isHr: viewerIsHr },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: okrErrStatus(e) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    // op per aksi — katalog MENU_OPS "performance:okr"
    // (create/update/updateKr/delete = aksi dasar; post/close = op khusus)
    const opKey: Record<string, string> = {
      create: "create",
      update: "update",
      updateKr: "update",
      delete: "delete",
      post: "op:post",
      close: "op:close",
    };
    const op = opKey[action];
    if (!op) return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    const m = await requireMenuAction(req, "performance:okr", op as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = {
      name: m.actor.name,
      employeeId: m.actor.employeeId,
      isHr: okrHrActor(m.actor.role, m.actor.appUserRole),
    };

    switch (action) {
      case "create": {
        const res = await createObjective(db, {
          quarter: String(b.quarter ?? ""),
          title: String(b.title ?? ""),
          ownerEmployeeId: String(b.ownerEmployeeId ?? ""),
          alignToId: b.alignToId ? String(b.alignToId) : null,
          keyResults: parseKrInput(b.keyResults) ?? [],
        }, actor);
        return NextResponse.json(res, { status: 201 });
      }
      case "update": {
        const res = await updateObjective(db, {
          id: String(b.id ?? ""),
          quarter: b.quarter != null ? String(b.quarter) : undefined,
          title: b.title != null ? String(b.title) : undefined,
          alignToId: b.alignToId === undefined ? undefined : (b.alignToId ? String(b.alignToId) : null),
          keyResults: parseKrInput(b.keyResults),
        }, actor);
        return NextResponse.json(res);
      }
      case "post": {
        const res = await postObjective(db, { id: String(b.id ?? "") }, actor);
        return NextResponse.json(res);
      }
      case "close": {
        const res = await closeObjective(db, { id: String(b.id ?? "") }, actor);
        return NextResponse.json(res);
      }
      case "updateKr": {
        const res = await updateKeyResult(db, {
          id: String(b.id ?? ""),
          current: b.current === undefined ? undefined : Number(b.current),
          confidence: b.confidence === undefined ? undefined : String(b.confidence),
          note: b.note === undefined ? undefined : (b.note == null ? null : String(b.note)),
        }, actor);
        return NextResponse.json(res);
      }
      case "delete": {
        const res = await deleteObjective(db, { id: String(b.id ?? "") }, actor);
        return NextResponse.json(res);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: okrErrStatus(e) });
  }
}
