import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { toXlsxMulti, xlsxResponse, exportFilename } from "@/rekankerja/shared/lib/export";
import type { Lang } from "@/rekankerja/shared/lib/i18n-core";
import {
  ensureDsrInfrastructure, searchDsrEmployees, listEmployeeDsr, createEmployeeDsr,
  updateEmployeeDsr, buildDsrPackageSheets,
} from "@/rekankerja/performance/services/dsr-service";
import { DEFAULT_RETENTION_YEARS } from "@/rekankerja/performance/services/retention-service";

// ============================================================================
// PERFORMANCE — API Kepatuhan UU PDP (P9 — §20 P9; §7.3/§37): DSR KARYAWAN
// (data kinerja; perluasan DataSubjectRequest F9-REC) + ringkasan retensi arsip.
//   GET  ?employees=1&q=   → opsi karyawan Active (picker dialog Buat DSR)
//   GET                     → { list: DSR karyawan, stats: ringkasan kepatuhan }
//        stats: activeCount | overdueCount | completed30d | retentionYears |
//               archivedCount | archivedSample (20 data terarsip terbaru)
//   POST {action:create, employeeId, type, note}     → catat DSR (SLA 7 hari)
//   POST {action:update, id, status, resultNote}      → transisi status sah
//   POST {action:package, id, lang}                   → XLSX paket data DSR
//        Export (identitas dasar + riwayat kinerja PP 35/2021 §7.2)
// Guard menu: performance:compliance — mutasi + paket = op "dsr".
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:compliance"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    if (sp.get("employees") === "1") {
      return NextResponse.json(await searchDsrEmployees(db, sp.get("q") || undefined));
    }

    await ensureDsrInfrastructure(db); // self-heal tenant lama (idempoten)
    const now = new Date();
    const since30d = new Date(Date.now() - 30 * 86_400_000);
    const [list, setting, activeCount, overdueCount, completed30d, archivedCount, archivedSample] = await Promise.all([
      listEmployeeDsr(db),
      db.performanceSetting.findFirst({ select: { retentionYears: true } }),
      db.dataSubjectRequest.count({ where: { employeeId: { not: null }, status: { in: ["New", "InProgress"] } } }),
      db.dataSubjectRequest.count({ where: { employeeId: { not: null }, status: { in: ["New", "InProgress"] }, dueAt: { lt: now } } }),
      db.dataSubjectRequest.count({ where: { employeeId: { not: null }, status: "Completed", handledAt: { gte: since30d } } }),
      db.appraisalRecord.count({ where: { archivedAt: { not: null } } }),
      db.appraisalRecord.findMany({
        where: { archivedAt: { not: null }, cycle: { status: "Closed" } },
        include: {
          employee: { select: { employeeNo: true, fullName: true } },
          cycle: { select: { code: true, periodEnd: true } },
        },
        orderBy: { archivedAt: "desc" },
        take: 20,
      }),
    ]);
    return NextResponse.json({
      list,
      stats: {
        activeCount,
        overdueCount,
        completed30d,
        retentionYears: setting?.retentionYears ?? DEFAULT_RETENTION_YEARS,
        archivedCount,
        archivedSample: archivedSample.map((r) => ({
          docNo: r.docNo,
          employeeNo: r.employee.employeeNo,
          employeeName: r.employee.fullName,
          cycleCode: r.cycle.code,
          periodEnd: r.cycle.periodEnd.toISOString(),
          archivedAt: (r.archivedAt as Date).toISOString(),
        })),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");
    if (action !== "create" && action !== "update" && action !== "package") {
      return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
    // op katalog MENU_OPS "performance:compliance" (dsr — pola requireMutator
    // pip.ts/merit.ts: satu op utk semua mutasi DSR + unduh paket)
    const m = await requireMenuAction(req, "performance:compliance", "op:dsr");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = { employeeId: m.actor.employeeId, name: m.actor.name };

    switch (action) {
      case "create": {
        const res = await createEmployeeDsr(db, {
          employeeId: String(b.employeeId ?? ""),
          type: String(b.type ?? ""),
          note: b.note != null ? String(b.note) : null,
        }, actor);
        return NextResponse.json({ ok: true, id: res.id }, { status: 201 });
      }
      case "update": {
        await updateEmployeeDsr(db, {
          id: String(b.id ?? ""),
          status: String(b.status ?? ""),
          resultNote: b.resultNote != null ? String(b.resultNote) : null,
        }, actor);
        return NextResponse.json({ ok: true });
      }
      case "package": {
        const lang: Lang = b.lang === "id" ? "id" : "en"; // BL-4: default EN utk ekspor
        const sheets = await buildDsrPackageSheets(db, String(b.id ?? ""), lang, actor);
        const buf = await toXlsxMulti(sheets, { lang });
        const empNo = sheets[0]?.rows[0]?.[0];
        return xlsxResponse(buf, exportFilename(`rekankerja-dsr-package-${typeof empNo === "string" && empNo ? empNo : "karyawan"}`, "xlsx"));
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
