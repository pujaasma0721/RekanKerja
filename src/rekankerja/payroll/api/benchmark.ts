import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import {
  listBenchmarks, listSources, upsertBenchmark, deleteBenchmark,
  buildBenchmarkTemplateXlsx, importBenchmarkPreview, importBenchmarkCommit,
  compaDashboard, exportBenchmarkXlsx, positionsForPicker,
  benchmarkHrActor, benchmarkErrStatus, BenchmarkError,
  type BenchmarkImportCells,
} from "@/rekankerja/payroll/services/benchmark-service";
import { xlsxResponse } from "@/rekankerja/shared/lib/export";
import type { Lang } from "@/rekankerja/shared/lib/i18n-core";

// ============================================================================
// PAYROLL — API Benchmark Pasar Gaji (B5-BL; D-BL16/D-BL17/D-BL18).
//   GET  ?list=1&year=&sourceLabel=      → register master benchmark
//   GET  ?template=1&lang=                → unduh template .xlsx dwibahasa
//   GET  ?dashboard=1&year=&sourceLabel= → kompa-ratio seluruh karyawan
//                                          {stats, rows, context{year,
//                                          sourceLabel, sources[]}} (nominal
//                                          gaji hanya aktor money-view)
//   GET  ?sources=1                       → daftar {year, sourceLabel} selector
//   POST multipart {action:importPreview, file} → pratinjau impor per sel (D16)
//   POST {action:importCommit, rows}      → commit HANYA baris valid
//   POST {action:upsert}                  → tambah/ubah entri (409 duplikat)
//   POST {action:delete}                  → hapus entri
//   POST {action:exportXlsx, lang, year?, sourceLabel?} → XLSX dwibahasa
// Guard menu: payroll:benchmark (admin-only — ESS 403 lebih dulu di menu
// guard; D-BL17 "ESS tidak melihat benchmark"). requireMenuViewAny utk GET;
// requireMenuAction op per aksi POST (katalog MENU_OPS import/manage/export).
// Guard baris di service: baca HR/Direksi; mutasi HR saja (Direksi read-only).
// Money-view di-thread dari aktor menu-guard (getMoneyView — Task 45-b).
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["payroll:benchmark"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const actor = {
      name: m.actor.name,
      employeeId: m.actor.employeeId,
      isHr: benchmarkHrActor(m.actor.role, m.actor.appUserRole),
    };

    // ---- unduh template impor (D-BL16) ----
    if (sp.get("template") === "1") {
      const lang: Lang = sp.get("lang") === "id" ? "id" : "en";
      const buf = await buildBenchmarkTemplateXlsx(lang);
      await db.activityLog.create({
        data: {
          action: "Exported", entity: "SalaryBenchmark",
          detail: `Template impor benchmark gaji (${lang === "en" ? "EN" : "ID"}) diunduh (D-BL16)`,
        },
      }).catch(() => { /* ActivityLog opsional */ });
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="template-benchmark-${lang}.xlsx"`,
        },
      });
    }

    // ---- daftar sumber utk selector konteks ----
    if (sp.get("sources") === "1") {
      return NextResponse.json(await listSources(db, actor));
    }

    // ---- picker posisi aktif utk dialog upsert kunci posisi ----
    if (sp.get("positions") === "1") {
      return NextResponse.json(await positionsForPicker(db, actor));
    }

    // ---- dashboard kompa-ratio (D-BL17) ----
    if (sp.get("dashboard") === "1") {
      const yearRaw = sp.get("year");
      const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
      const res = await compaDashboard(db, actor, {
        year: yearRaw && Number.isInteger(Number(yearRaw)) ? Number(yearRaw) : undefined,
        sourceLabel: sp.get("sourceLabel") || undefined,
      }, mv);
      return NextResponse.json(res);
    }

    // ---- default: register master ----
    const yearRaw = sp.get("year");
    const res = await listBenchmarks(db, actor, {
      year: yearRaw && Number.isInteger(Number(yearRaw)) ? Number(yearRaw) : undefined,
      sourceLabel: sp.get("sourceLabel") || undefined,
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof BenchmarkError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: benchmarkErrStatus(e) });
  }
}

export async function POST(req: NextRequest) {
  try {
    // multipart → pratinjau impor Excel (D16)
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const action = String(form.get("action") ?? "");
      if (action !== "importPreview") {
        return NextResponse.json({ error: `Aksi multipart tidak dikenal: ${action}` }, { status: 400 });
      }
      const m = await requireMenuAction(req, "payroll:benchmark", "op:import");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Berkas .xlsx wajib diunggah" }, { status: 400 });
      if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "Ukuran file melebihi 2 MB (D16)" }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      const actor = {
        name: m.actor.name,
        employeeId: m.actor.employeeId,
        isHr: benchmarkHrActor(m.actor.role, m.actor.appUserRole),
      };
      const preview = await importBenchmarkPreview(m.db, actor, { buffer: buf, name: file.name, type: file.type });
      await m.db.activityLog.create({
        data: {
          action: "Processed", entity: "SalaryBenchmark",
          detail: `Pratinjau impor benchmark ${file.name} oleh ${actor.name}: ${preview.summary.valid} valid · ${preview.summary.error} error · ${preview.summary.dup} duplikat (D16)`,
        },
      });
      return NextResponse.json(preview);
    }

    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    // op per aksi — katalog MENU_OPS "payroll:benchmark" (B5)
    const opKey: Record<string, string> = {
      importCommit: "op:import",
      upsert: "op:manage",
      delete: "op:manage",
      exportXlsx: "op:export",
    };
    const op = opKey[action];
    if (!op) return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    const m = await requireMenuAction(req, "payroll:benchmark", op as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = {
      name: m.actor.name,
      employeeId: m.actor.employeeId,
      isHr: benchmarkHrActor(m.actor.role, m.actor.appUserRole),
    };

    switch (action) {
      case "importCommit": {
        const rows = Array.isArray(b.rows) ? (b.rows as BenchmarkImportCells[]) : [];
        if (rows.length === 0) return NextResponse.json({ error: "Tidak ada baris untuk di-commit" }, { status: 400 });
        const res = await importBenchmarkCommit(db, actor, rows);
        return NextResponse.json(res);
      }
      case "upsert": {
        const res = await upsertBenchmark(db, actor, {
          id: b.id ? String(b.id) : undefined,
          year: Number(b.year),
          sourceLabel: String(b.sourceLabel ?? ""),
          gradeCode: b.gradeCode === undefined ? undefined : (b.gradeCode == null || b.gradeCode === "" ? null : String(b.gradeCode)),
          positionId: b.positionId === undefined ? undefined : (b.positionId == null || b.positionId === "" ? null : String(b.positionId)),
          currency: b.currency == null ? undefined : String(b.currency),
          p25: Number(b.p25),
          p50: Number(b.p50),
          p75: Number(b.p75),
        });
        return NextResponse.json(res);
      }
      case "delete": {
        const res = await deleteBenchmark(db, actor, String(b.id ?? ""));
        return NextResponse.json(res);
      }
      case "exportXlsx": {
        const langRaw = b.lang != null ? String(b.lang) : req.nextUrl.searchParams.get("lang");
        const lang: Lang = langRaw === "id" ? "id" : "en";
        const yearRaw = b.year != null ? Number(b.year) : undefined;
        const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
        const { buffer, filename } = await exportBenchmarkXlsx(db, actor, lang, mv, {
          year: yearRaw != null && Number.isInteger(yearRaw) ? yearRaw : undefined,
          sourceLabel: b.sourceLabel != null && String(b.sourceLabel) !== "" ? String(b.sourceLabel) : undefined,
        });
        return xlsxResponse(buffer, filename);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof BenchmarkError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: benchmarkErrStatus(e) });
  }
}
