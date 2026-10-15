import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import {
  okrErrStatus, okrFeatureOn, currentQuarter, listQuarters, listBoard,
  myObjectives, okrStats, alignOptions, createObjective, updateObjective,
  postObjective, updateKeyResult, deleteObjective,
  type OkrKrInput,
} from "@/rekankerja/performance/services/okr-service";

// ============================================================================
// ESS — "OKR Saya" (B1 — DEVELOPMENT-PLAN-BACKLOG.md §4 B1; D-BL3/D-BL5):
//   GET  → objective milik saya SEMUA kuartal (default: kuartal berjalan) +
//          statistik progres + board Posted/Closed kuartal berjalan (D-BL3 —
//          silang-tim) + meta { okrEnabled, quarters, currentQuarter }.
//   POST {action:create}    → objective Draft utk DIRI SENDIRI (guard: owner
//                             = session employee — anti-IDOR)
//   POST {action:update}     → edit penuh Draft milik saya
//   POST {action:post}       → post objective milik saya (owner boleh — D-BL3)
//   POST {action:updateKr}   → update progres KR milik saya saat Posted
//   POST {action:delete}     → hapus Draft milik saya
//   (CLOSE tidak diekspos — HR saja via /performance/okr)
// Guard: requireEss (self-scope anti-IDOR — hanya data karyawan sendiri).
// ============================================================================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;
  const url = new URL(req.url);
  const quarter = url.searchParams.get("quarter") || undefined;

  try {
    const okrEnabled = await okrFeatureOn(db);
    if (!okrEnabled) {
      // bukan error — ESS menyembunyikan menu (okrEnabled false); respons
      // tetap sah supaya state UI bisa render banner fitur-off.
      return NextResponse.json({
        okrEnabled: false, currentQuarter: currentQuarter(), quarters: [],
        rows: [], stats: okrStats([]), board: [],
      });
    }
    const [rows, quarters, board] = await Promise.all([
      myObjectives(db, employeeId, quarter),
      listQuarters(db),
      // board silang-tim: Posted/Closed kuartal terpilih (D-BL3 — ESS view
      // terbatas; Draft milik orang lain TIDAK ikut; milik sendiri sudah
      // lengkap di rows).
      listBoard(db, {
        quarter: quarter || currentQuarter(),
        status: undefined,
        viewerEmployeeId: employeeId,
        viewerIsHr: false,
      }),
    ]);
    return NextResponse.json({
      okrEnabled: true,
      currentQuarter: currentQuarter(),
      quarters,
      rows,
      stats: okrStats(rows),
      board,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: okrErrStatus(e) });
  }
}

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

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    // Aktor ESS: owner self-scope — isHr SELALU false di endpoint ESS ini
    // (HR mengelola objective siapa pun lewat /api/rekankerja/performance/okr
    // dgn menu-guard performance:okr; endpoint ini tetap self-scope penuh).
    const actor = {
      name: m.actor.fullName,
      employeeId,
      isHr: false,
    };

    switch (action) {
      case "create": {
        // guard anti-IDOR: owner SELALU session employee (ESS membuat utk
        // dirinya sendiri — D-BL3 ownership).
        const res = await createObjective(db, {
          quarter: String(b.quarter ?? currentQuarter()),
          title: String(b.title ?? ""),
          ownerEmployeeId: employeeId,
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
        // owner boleh memosting miliknya (D-BL3 — HR *atau* owner)
        const res = await postObjective(db, { id: String(b.id ?? "") }, actor);
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
      case "alignOptions": {
        // opsi align utk picker (objective Posted/Draft kuartal sama milik siapa
        // saja — board transparan lintas pemilik, D-BL4)
        const res = await alignOptions(db, String(b.quarter ?? currentQuarter()));
        return NextResponse.json(res);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: okrErrStatus(e) });
  }
}
