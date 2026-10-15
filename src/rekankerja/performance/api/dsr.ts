import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { toXlsxMulti, xlsxResponse, exportFilename } from "@/rekankerja/shared/lib/export";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import type { Lang } from "@/rekankerja/shared/lib/i18n-core";
import {
  DsrError, ensureDsrInfrastructure, searchDsrEmployees, listEmployeeDsr,
  createEmployeeDsr, updateEmployeeDsr, buildDsrPackageSheets,
} from "@/rekankerja/performance/services/perf-dsr-service";
import {
  DEFAULT_RETENTION_YEARS, jobPerfRetentionScan, retentionSummary, archiveRestore,
} from "@/rekankerja/performance/services/perf-retention-service";

// ============================================================================
// PERFORMANCE — API Kepatuhan UU PDP (P9 — §20 P9; §7.3/§37): DSR KARYAWAN
// (data kinerja; perluasan DataSubjectRequest F9-REC) + retensi arsip hasil
// penilaian.
//   GET                          → { list: DSR karyawan, stats: ringkasan }
//        stats: activeCount | overdueCount | completed30d | retentionYears |
//               archivedCount | pendingArchiveCount | archivedSample (20)
//   GET  ?id=                    → detail satu DSR (dialog)
//   GET  ?employees=1&q=         → opsi karyawan Active (picker Buat DSR)
//   GET  ?retention=1            → ringkasan retensi (panel arsip)
//   POST {action:create, employeeId, type, note}      → catat DSR (SLA 7 hari)
//   POST {action:start, id}                            → New → InProgress
//   POST {action:complete, id, resultNote}             → selesai (wajib ringkasan)
//   POST {action:reject, id, resultNote}               → tolak (alasan ≥10 kar)
//   POST {action:update, id, status, resultNote}       → transisi generik (port)
//   POST {action:export|package, id, lang}             → XLSX paket data DSR
//        (identitas PII limited + 5 sheet riwayat PP 35/2021 §7.2)
//   POST {action:retentionScan}                        → jalankan scan retensi
//   POST {action:archiveRestore, docNo}               → pulihkan dari arsip
// Guard menu: performance:compliance — create = CRUD dasar; aksi DSR = op:dsr;
// retensi (scan/pulihkan) = op:retention (pola pip.ts/probation.ts).
// ============================================================================

function errStatus(e: unknown): number {
  if (e instanceof DsrError) return e.status;
  return 400;
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:compliance"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    if (sp.get("employees") === "1") {
      return NextResponse.json(await searchDsrEmployees(db, sp.get("q") || undefined));
    }
    if (sp.get("retention") === "1") {
      return NextResponse.json(await retentionSummary(db));
    }

    await ensureDsrInfrastructure(db); // self-heal tenant lama (idempoten)
    const [list, retention] = await Promise.all([
      listEmployeeDsr(db),
      retentionSummary(db),
    ]);
    const id = sp.get("id");
    if (id) {
      const row = list.find((r) => r.id === id);
      if (!row) return NextResponse.json({ error: "Permintaan data (DSR) tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ row });
    }
    const now = Date.now();
    const since30d = now - 30 * 86_400_000;
    return NextResponse.json({
      list,
      stats: {
        activeCount: list.filter((r) => r.status === "New" || r.status === "InProgress").length,
        overdueCount: list.filter((r) => r.overdue).length,
        completed30d: list.filter((r) => r.status === "Completed" && r.handledAt && new Date(r.handledAt).getTime() >= since30d).length,
        selfSubmittedCount: list.filter((r) => r.selfSubmitted && (r.status === "New" || r.status === "InProgress")).length,
        retentionYears: retention.retentionYears,
        archivedCount: retention.archivedCount,
        pendingArchiveCount: retention.pendingArchiveCount,
        archivedSample: retention.archivedSample,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: errStatus(e) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");
    // op per aksi — katalog MENU_OPS "performance:compliance"
    // (create = aksi dasar; aksi DSR = op:dsr; retensi scan/pulihkan = op:retention)
    const opKey: Record<string, string> = {
      create: "create",
      start: "op:dsr",
      complete: "op:dsr",
      reject: "op:dsr",
      update: "op:dsr",
      package: "op:dsr",
      export: "op:dsr",
      retentionScan: "op:retention",
      archiveRestore: "op:retention",
    };
    const op = opKey[action];
    if (!op) return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    const m = await requireMenuAction(req, "performance:compliance", op as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = { employeeId: m.actor.employeeId ?? null, name: m.actor.name };

    switch (action) {
      case "create": {
        const res = await createEmployeeDsr(db, {
          employeeId: String(b.employeeId ?? ""),
          type: String(b.type ?? ""),
          note: b.note != null ? String(b.note) : null,
        }, actor);
        return NextResponse.json({ ok: true, id: res.id }, { status: 201 });
      }
      case "start": {
        await updateEmployeeDsr(db, { id: String(b.id ?? ""), status: "InProgress" }, actor);
        return NextResponse.json({ ok: true });
      }
      case "complete": {
        await updateEmployeeDsr(db, {
          id: String(b.id ?? ""), status: "Completed",
          resultNote: b.resultNote != null ? String(b.resultNote) : null,
        }, actor);
        return NextResponse.json({ ok: true });
      }
      case "reject": {
        await updateEmployeeDsr(db, {
          id: String(b.id ?? ""), status: "Rejected",
          resultNote: b.resultNote != null ? String(b.resultNote) : null,
        }, actor);
        return NextResponse.json({ ok: true });
      }
      case "update": {
        await updateEmployeeDsr(db, {
          id: String(b.id ?? ""), status: String(b.status ?? ""),
          resultNote: b.resultNote != null ? String(b.resultNote) : null,
        }, actor);
        return NextResponse.json({ ok: true });
      }
      case "package":
      case "export": {
        // BL-4: bahasa ekspor — default EN (frontend selalu mengirim lang)
        const lang: Lang = b.lang === "id" ? "id" : "en";
        const mv = await moneyViewForReq(req, db); // §37 vault gating nominal merit
        const sheets = await buildDsrPackageSheets(db, String(b.id ?? ""), lang, (v) => mv.dec(v), actor);
        const buf = await toXlsxMulti(sheets, { lang });
        const empNo = typeof sheets[0]?.rows[0]?.[0] === "string" && sheets[0].rows[0][0] ? sheets[0].rows[0][0] : "karyawan";
        return xlsxResponse(buf, exportFilename(`rekankerja-dsr-package-${empNo}`, "xlsx"));
      }
      case "retentionScan": {
        const r = await jobPerfRetentionScan(db);
        return NextResponse.json({ ok: true, ...r });
      }
      case "archiveRestore": {
        await archiveRestore(db, String(b.docNo ?? ""), actor);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: errStatus(e) });
  }
}
