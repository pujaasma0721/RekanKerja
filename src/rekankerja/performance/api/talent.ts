import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import {
  listAttritionRisk, talentHrActor, talentErrStatus, TalentForbiddenError,
} from "@/rekankerja/performance/services/talent-service";
import {
  listSuccession, positionsForPicker, suggestCandidates, upsertPosition, deletePosition,
  addCandidate, updateCandidate, removeCandidate, refreshAllRisk, exportSuccessionXlsx,
  successionHrActor, successionViewerOk, successionSummary, successionErrStatus, SuccessionError,
  toggleDevNote, type DevNoteItem,
} from "@/rekankerja/performance/services/succession-service";
import { xlsxResponse } from "@/rekankerja/shared/lib/export";
import type { Lang } from "@/rekankerja/shared/lib/i18n-core";

// ============================================================================
// PERFORMANCE — API Talent (B3 attrisi D-BL10…12 + B4 succession D-BL13…15).
//   GET  ?unitId=&q=&onlyHigh=1          → { rows, stats, disclaimer, scope,
//                                           succession?{positions,candidates,uncovered} }
//                                          (field succession hanya utk aktor
//                                          HR/Direksi — overview kartu Talent)
//   GET  ?succession=1                    → register succession lengkap
//   GET  ?positions=1                     → picker posisi (dialog tambah peran)
//   POST {action:upsertPosition}           → daftar/ubah peran kritis
//   POST {action:deletePosition}           → hapus register (409 bila ada kandidat)
//   POST {action:suggest}                  → saran kandidat 9-box (D-BL13)
//   POST {action:addCandidate}             → tambah kandidat (guard duplikat 409,
//                                           pemegang jabatan 400, snapshot otomatis)
//   POST {action:updateCandidate}          → ubah readiness/devNotes (+refreshRisk;
//                                           P3.5: devNotesItems [{action,done}] →
//                                           simpan TER-STRUKTUR JSON v1 — D-BM27)
//   POST {action:toggleDevNote}            → centang/buka satu aksi pengembangan
//                                           terstruktur (P3.5 — D-BM27, HR/admin)
//   POST {action:removeCandidate}         → hapus kandidat
//   POST {action:refreshAllRisk}          → refresh flightRisk satu peran
//   POST {action:exportXlsx&lang=}         → XLSX dwibahasa (D-BL15 — binary)
// Guard menu: performance:talent (view utk GET; op per aksi POST — katalog
// MENU_OPS position/manage, candidate/manage, export). Guard baris D-BL12
// tetap di service (attrisi team-scope; succession HR/Direksi + mutasi HR).
// GET ?legacy tetap attrisi murni (kompatibel — tanpa field succession).
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:talent"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const actor = {
      name: m.actor.name,
      employeeId: m.actor.employeeId,
      isHr: talentHrActor(m.actor.role, m.actor.appUserRole),
    };

    // ---- B4: register succession lengkap (HR/Direksi — D-BL12) ----
    if (sp.get("succession") === "1") {
      return NextResponse.json(await listSuccession(db, actor));
    }
    // ---- B4: picker posisi utk dialog tambah peran ----
    if (sp.get("positions") === "1") {
      return NextResponse.json(await positionsForPicker(db, actor));
    }

    const res = await listAttritionRisk(db, actor, {
      unitId: sp.get("unitId") || undefined,
      q: sp.get("q") || undefined,
      onlyHigh: sp.get("onlyHigh") === "1",
    });

    // B4: ringkasan succession utk overview — HANYA utk aktor HR/Direksi
    // (field tidak dikirim utk cakupan tim atasan — tab admin-only D-BL12).
    if (sp.get("legacy") !== "1" && (await successionViewerOk(db, actor))) {
      const succession = await successionSummary(db);
      return NextResponse.json({ ...res, succession });
    }
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof TalentForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e instanceof SuccessionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: talentErrStatus(e) },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    // op per aksi — katalog MENU_OPS "performance:talent" (B4)
    const opKey: Record<string, string> = {
      upsertPosition: "op:position/manage",
      deletePosition: "op:position/manage",
      suggest: "op:candidate/manage",
      addCandidate: "op:candidate/manage",
      updateCandidate: "op:candidate/manage",
      toggleDevNote: "op:candidate/manage",
      removeCandidate: "op:candidate/manage",
      refreshAllRisk: "op:candidate/manage",
      exportXlsx: "op:export",
    };
    const op = opKey[action];
    if (!op) return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    const m = await requireMenuAction(req, "performance:talent", op as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = {
      name: m.actor.name,
      employeeId: m.actor.employeeId,
      isHr: successionHrActor(m.actor.role, m.actor.appUserRole),
    };

    switch (action) {
      case "upsertPosition": {
        const res = await upsertPosition(db, actor, {
          id: b.id ? String(b.id) : undefined,
          positionId: b.positionId ? String(b.positionId) : undefined,
          critical: b.critical == null ? undefined : Boolean(b.critical),
          targetSuccessors: b.targetSuccessors == null ? undefined : Number(b.targetSuccessors),
          note: b.note === undefined ? undefined : (b.note == null ? null : String(b.note)),
        });
        return NextResponse.json(res);
      }
      case "deletePosition": {
        const res = await deletePosition(db, actor, String(b.id ?? ""));
        return NextResponse.json(res);
      }
      case "suggest": {
        const res = await suggestCandidates(db, actor, String(b.positionId ?? ""), b.q ? String(b.q) : undefined);
        return NextResponse.json(res);
      }
      case "addCandidate": {
        const res = await addCandidate(db, actor, {
          successionPositionId: String(b.successionPositionId ?? ""),
          employeeId: String(b.employeeId ?? ""),
          readiness: b.readiness == null ? undefined : String(b.readiness),
          devNotes: b.devNotes === undefined ? undefined : (b.devNotes == null ? null : String(b.devNotes)),
        });
        return NextResponse.json(res);
      }
      case "updateCandidate": {
        const res = await updateCandidate(db, actor, {
          id: String(b.id ?? ""),
          readiness: b.readiness == null ? undefined : String(b.readiness),
          devNotes: b.devNotes === undefined ? undefined : (b.devNotes == null ? null : String(b.devNotes)),
          // P3.5-BM (D-BM27): aksi pengembangan TER-STRUKTUR — array {action, done}
          devNotesItems: b.devNotesItems === undefined ? undefined : (b.devNotesItems as DevNoteItem[]),
          refreshRisk: b.refreshRisk === true,
        });
        return NextResponse.json(res);
      }
      case "toggleDevNote": {
        const res = await toggleDevNote(db, actor, {
          id: String(b.id ?? ""),
          index: Number(b.index),
          done: b.done === true,
        });
        return NextResponse.json(res);
      }
      case "removeCandidate": {
        const res = await removeCandidate(db, actor, String(b.id ?? ""));
        return NextResponse.json(res);
      }
      case "refreshAllRisk": {
        const res = await refreshAllRisk(db, actor, String(b.successionPositionId ?? ""));
        return NextResponse.json(res);
      }
      case "exportXlsx": {
        // bahasa ekspor: body (pola ess/my-appraisal) — fallback query ?lang=
        const langRaw = b.lang != null ? String(b.lang) : req.nextUrl.searchParams.get("lang");
        const lang: Lang = langRaw === "id" ? "id" : "en";
        const { buffer, filename } = await exportSuccessionXlsx(db, actor, lang);
        return xlsxResponse(buffer, filename);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof SuccessionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: successionErrStatus(e) });
  }
}
