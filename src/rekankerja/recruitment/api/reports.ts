import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { toCsv, csvResponse, xlsxResponse, exportFilename, toXlsx, type ExportCell, type ExportColumn } from "@/rekankerja/shared/lib/export";
import { trFor } from "@/rekankerja/shared/lib/i18n-core";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  getRecruitmentDashboard, getMetricsCatalog, getAdverseImpact, getProjections,
  getSnapshotHistory,
} from "@/rekankerja/recruitment/services/analytics-service";

// ============================================================================
// RECRUITMENT F8 — API Analytics & Prediktif (DEVELOPMENT-PLAN-RECRUITMENT.md
// §7 F8 + HRX G1–G5 + P4 adverse-impact). Guard: menu recruitment:reports.
//   GET  ?section=dashboard|metrics|adverse-impact|projections|history[&metric=]
//   GET  ?views=1                       → tampilan tersimpan MILIK AKTOR
//   GET  ?export=dashboard|metrics|adverse-impact (op:export) → CSV
//        &format=xlsx|pdf → Excel (exceljs, shared util) / PDF tabel (pdf-lib)
//        — default csv (kompatibel mundur)
//   POST { action: view-save|view-delete|view-schedule (op:views) }
// SavedReportView selalu milik aktor (ownerId = actor.employeeId) — orang
// lain tidak bisa mengubah/menghapus tampilan milik orang lain.
// ============================================================================

const METRIC_KEY_RE = /^[a-z0-9_]{1,40}$/;
const VIEW_KEY_RE = /^[a-z0-9-]{1,40}$/;
const SCHEDULES = ["none", "weekly"] as const;

interface SavedViewRow {
  id: string;
  name: string;
  view: string;
  filters: Record<string, unknown>;
  schedule: string;
  createdAt: string;
  updatedAt: string;
}

function serializeSaved(r: {
  id: string; name: string; view: string; filtersJson: string; schedule: string;
  createdAt: Date; updatedAt: Date;
}): SavedViewRow {
  let filters: Record<string, unknown> = {};
  try { filters = JSON.parse(r.filtersJson) as Record<string, unknown>; } catch { filters = {}; }
  return {
    id: r.id,
    name: r.name,
    view: r.view,
    filters,
    schedule: r.schedule,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function listMyViews(db: TenantDb, ownerId: string): Promise<SavedViewRow[]> {
  const rows = await db.savedReportView.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return rows.map(serializeSaved);
}

// ============ CSV builders (data sama dengan section JSON) ============
// BL-REC-CORE: builder bilingual — label dibangun per bahasa (pola BL-5 tier-2,
// eksplisit di dalam builder) supaya CSV/XLSX/PDF tiga format sama-sama ikut
// ?lang= tanpa bergantung exact-match kamus global (aman dari konteks ganda
// mis. "Jumlah"=Amount vs Count, "Masuk"=In vs Entered).

/** Helper bilingual lokal builder ekspor rekrutmen. */
function tt(lang: "id" | "en", id: string, en: string): string {
  return lang === "en" ? en : id;
}

function dashboardCsv(d: Awaited<ReturnType<typeof getRecruitmentDashboard>>, lang: "id" | "en" = "id"): { columns: ExportColumn[]; rows: ExportCell[][] } {
  const columns: ExportColumn[] = [
    { header: tt(lang, "Seksi", "Section"), width: 22 }, { header: tt(lang, "Item", "Item"), width: 34 }, { header: tt(lang, "Nilai 1", "Value 1"), width: 18 },
    { header: tt(lang, "Nilai 2", "Value 2"), width: 18 }, { header: tt(lang, "Nilai 3", "Value 3"), width: 18 }, { header: tt(lang, "Keterangan", "Notes"), width: 42 },
  ];
  const rows: ExportCell[][] = [];
  rows.push([tt(lang, "Kesehatan PR", "PR Health"), tt(lang, "PR terbuka", "Open requisitions"), d.prHealth.open, "", "", tt(lang, `Umur rata-rata ${d.prHealth.avgAgeDays ?? "—"} hari`, `Average age ${d.prHealth.avgAgeDays ?? "—"} days`)]);
  rows.push([tt(lang, "Kesehatan PR", "PR Health"), tt(lang, "PR tertua", "Oldest requisition"), d.prHealth.oldest?.prNo ?? "—", d.prHealth.oldest?.days ?? "—", "", tt(lang, "hari sejak requestDate", "days since requestDate")]);
  rows.push([tt(lang, "Kesehatan PR", "PR Health"), tt(lang, "Ditutup bulan ini", "Closed this month"), d.prHealth.closedThisPeriod, "", "", "Fulfilled/Closed/Cancelled"]);
  rows.push([tt(lang, "Kesehatan PR", "PR Health"), tt(lang, "PR at-risk (lebih dari SLA target)", "At-risk requisitions (over SLA target)"), d.prHealth.atRisk.length, "", "", tt(lang, "slaTargetDays terisi & umur > target", "slaTargetDays set & age > target")]);
  for (const r of d.prHealth.atRisk.slice(0, 20)) {
    rows.push([tt(lang, "Kesehatan PR — at-risk", "PR Health — at-risk"), r.prNo, r.positionTitle ?? "—", r.ageDays, r.targetDays, tt(lang, "umur / target (hari)", "age / target (days)")]);
  }
  for (const r of d.recruiterLoad) {
    rows.push([tt(lang, "Beban recruiter", "Recruiter Load"), r.name, r.activeCandidates, r.activePrs, "", tt(lang, "kandidat aktif / PR aktif", "active candidates / active requisitions")]);
  }
  rows.push([tt(lang, "Kepatuhan SLA", "SLA Compliance"), tt(lang, "Tahap tepat waktu", "On-time stages"), d.slaCompliance.onTime, d.slaCompliance.late, d.slaCompliance.rate ?? "—", "onTime / late / rate %"]);
  if (d.slaCompliance.latestStage) {
    rows.push([tt(lang, "Kepatuhan SLA", "SLA Compliance"), tt(lang, "Tahap terlambat terbanyak", "Stage with the most late"), d.slaCompliance.latestStage.name, d.slaCompliance.latestStage.late, "", tt(lang, "jumlah terlambat", "late count")]);
  }
  rows.push([tt(lang, "ROI sumber", "Source ROI"), tt(lang, "Sumber", "Source"), tt(lang, "Belanja (IDR)", "Spend (IDR)"), tt(lang, "Hire", "Hires"), tt(lang, "Cost per hire (IDR)", "Cost per hire (IDR)"), ""]);
  for (const r of d.sourceRoi) {
    rows.push([tt(lang, "ROI sumber", "Source ROI"), r.source, r.spend ?? 0, r.hires, r.costPerHire ?? "—", ""]);
  }
  rows.push([tt(lang, "Funnel", "Funnel"), tt(lang, "Tahap", "Stage"), tt(lang, "Jumlah", "Count"), "", "", ""]);
  for (const s of d.funnel.stages) {
    rows.push([tt(lang, "Funnel", "Funnel"), s.label, s.count, "", "", ""]);
  }
  rows.push([tt(lang, "Funnel", "Funnel"), tt(lang, "Tingkat penerimaan offer", "Offer acceptance rate"), `${d.funnel.offerAcceptanceRate ?? "—"}%`, "", "", ""]);
  return { columns, rows };
}

function metricsCsv(m: Awaited<ReturnType<typeof getMetricsCatalog>>, lang: "id" | "en" = "id"): { columns: ExportColumn[]; rows: ExportCell[][] } {
  const columns: ExportColumn[] = [
    { header: tt(lang, "Metrik", "Metric"), width: 28 }, { header: tt(lang, "Label", "Label"), width: 30 }, { header: tt(lang, "Nilai", "Value"), width: 14 },
    { header: tt(lang, "Satuan", "Unit"), width: 8 }, { header: tt(lang, "Keterangan", "Notes"), width: 60 },
  ];
  const rows: ExportCell[][] = m.map((x) => [
    x.key,
    lang === "en" ? x.labelEn : x.labelId,
    x.value ?? "—",
    lang === "en" ? x.unitEn : x.unit,
    lang === "en" ? (x.hintEn ?? x.hint) : x.hint,
  ]);
  for (const x of m) {
    const label = lang === "en" ? x.labelEn : x.labelId;
    for (const b of x.breakdown ?? []) {
      rows.push([x.key, `${label} — ${b.source}`, b.rate ?? "—", "%", tt(lang, `${b.hires} hire dari ${b.applicants} pelamar`, `${b.hires} hire(s) from ${b.applicants} applicants`)]);
    }
  }
  return { columns, rows };
}

function adverseCsv(a: Awaited<ReturnType<typeof getAdverseImpact>>, lang: "id" | "en" = "id"): { columns: ExportColumn[]; rows: ExportCell[][] } {
  const columns: ExportColumn[] = [
    { header: tt(lang, "Tahap", "Stage"), width: 24 }, { header: tt(lang, "Dimensi", "Dimension"), width: 12 }, { header: tt(lang, "Kelompok", "Group"), width: 16 },
    { header: tt(lang, "Masuk", "Entered"), width: 8 }, { header: tt(lang, "Lulus", "Passed"), width: 8 }, { header: tt(lang, "Rate %", "Rate %"), width: 10 },
    { header: tt(lang, "4/5ths", "4/5ths"), width: 10 }, { header: tt(lang, "n kecil", "small n"), width: 8 },
  ];
  const rows: ExportCell[][] = [];
  for (const st of a.stages) {
    for (const dim of st.dims) {
      for (const g of dim.groups) {
        rows.push([
          st.stage, dim.dim, g.label, g.entered, g.passed, g.rate ?? "—",
          g.flag ? "FLAG" : "", g.small ? tt(lang, "ya", "yes") : "",
        ]);
      }
      rows.push([st.stage, dim.dim, tt(lang, `(impact ratio: ${dim.impactRatio ?? "—"}${dim.flagged ? " — FLAG < 0,8" : ""})`, `(impact ratio: ${dim.impactRatio ?? "—"}${dim.flagged ? " — FLAG < 0.8" : ""})`), "", "", "", "", ""]);
    }
  }
  return { columns, rows };
}

// ============ PDF tabel sederhana (pdf-lib — F8 amandemen: format CSV/XLSX/PDF) ============
// A4 landscape, Helvetica, grid garis tipis, header bold abu — cukup untuk
// laporan tabular internal (bukan surat resmi — itu jalur letter-service).
// Sanitasi WinAnsi pola letter-service (karakter eksotis → "?").

const PDF_CHAR_MAP: Record<string, string> = {
  "\u2013": "-", "\u2014": "-", "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"',
  "\u2026": "...", "\u00B7": "\u00B7", "\u2022": "-", "\u00A0": " ", "\u2212": "-",
  "\u2264": "<=", "\u2265": ">=", "\u00D7": "x", "\u2011": "-",
};

function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    if (PDF_CHAR_MAP[ch] !== undefined) out += PDF_CHAR_MAP[ch];
    else {
      const code = ch.codePointAt(0) ?? 63;
      out += code >= 0x20 && code <= 0xff ? ch : "?";
    }
  }
  return out;
}

async function tablePdf(
  title: string,
  columns: ExportColumn[],
  rows: ExportCell[][],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(title));
  doc.setCreator("RekanKerja HRIS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4L = { w: 841.89, h: 595.28 };
  const margin = 32;
  const fontSize = 7.5;
  const headFontSize = 7.5;
  const rowH = 16;
  const headH = 20;
  const INK = rgb(0.15, 0.18, 0.23);
  const MUTED = rgb(0.45, 0.5, 0.56);

  const cellText = (v: ExportCell): string =>
    v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

  // lebar kolom proporsional width (fallback 16) dinormalisasi ke area cetak
  const widths = columns.map((c) => c.width ?? 16);
  const totalW = widths.reduce((a, b) => a + b, 0);
  const printable = A4L.w - margin * 2;
  const colW = widths.map((w) => (w / totalW) * printable);

  const clip = (s: string, max: number, f: typeof font): string => {
    if (f.widthOfTextAtSize(s, fontSize) <= max) return s;
    let out = s;
    while (out.length > 1 && f.widthOfTextAtSize(out + "...", fontSize) > max) {
      out = out.slice(0, -1);
    }
    return out + "...";
  };

  let page = doc.addPage([A4L.w, A4L.h]);
  let y = A4L.h - margin;
  // judul laporan (sekali di halaman pertama)
  page.drawText(pdfSafe(title), { x: margin, y: y - 10, size: 13, font: bold, color: INK });
  y -= 30;

  const drawHeader = () => {
    let x = margin;
    page.drawRectangle({
      x: margin, y: y - headH + 5, width: printable, height: headH - 2,
      color: rgb(0.93, 0.94, 0.96),
    });
    columns.forEach((c, i) => {
      page.drawText(pdfSafe(clip(c.header, colW[i] - 6, bold)), {
        x: x + 3, y: y - headH + 11, size: headFontSize, font: bold, color: INK,
      });
      x += colW[i];
    });
    y -= headH;
  };
  drawHeader();

  for (const r of rows) {
    if (y < margin + rowH + 12) { // halaman baru: ulangi header tabel
      page = doc.addPage([A4L.w, A4L.h]);
      y = A4L.h - margin;
      drawHeader();
    }
    let x = margin;
    r.forEach((cell, i) => {
      page.drawText(pdfSafe(clip(cellText(cell), colW[i] - 6, font)), {
        x: x + 3, y: y - rowH + 4, size: fontSize, font, color: MUTED,
      });
      x += colW[i];
    });
    y -= rowH;
    // garis pemisah tipis antar baris
    page.drawLine({
      start: { x: margin, y: y + rowH - 2 }, end: { x: A4L.w - margin, y: y + rowH - 2 },
      thickness: 0.4, color: rgb(0.87, 0.89, 0.91),
    });
  }

  // footer kecil: stamp cetak
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(pdfSafe(`${title} — ${new Date().toLocaleDateString("id-ID")} · ${i + 1}/${pages.length}`), {
      x: margin, y: 18, size: 6.5, font, color: MUTED,
    });
  });

  return doc.save();
}

function pdfResponse(bytes: Uint8Array, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ============ GET ============

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const exportSection = sp.get("export");

    // ---- export CSV/XLSX/PDF (guard op:export; default csv — kompatibel mundur) ----
    if (exportSection) {
      const m = await requireMenuAction(req, "recruitment:reports", "op:export");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const db = m.db;
      const format = (sp.get("format") ?? "csv").toLowerCase();
      if (format !== "csv" && format !== "xlsx" && format !== "pdf") {
        return NextResponse.json({ error: `Format ekspor tidak dikenal: ${format} (csv|xlsx|pdf)` }, { status: 400 });
      }
      const lang = sp.get("lang") === "en" ? "en" : "id";
      let built: { columns: ExportColumn[]; rows: ExportCell[][] };
      let name: string;
      let titleId: string;
      if (exportSection === "dashboard") { built = dashboardCsv(await getRecruitmentDashboard(db), lang); name = "rekankerja-reports-dashboard"; titleId = "Dashboard Rekrutmen"; }
      else if (exportSection === "metrics") { built = metricsCsv(await getMetricsCatalog(db), lang); name = "rekankerja-reports-metrics"; titleId = "Katalog Metrik Rekrutmen"; }
      else if (exportSection === "adverse-impact") { built = adverseCsv(await getAdverseImpact(db), lang); name = "rekankerja-reports-adverse-impact"; titleId = "Adverse Impact 4/5ths"; }
      else return NextResponse.json({ error: `Bagian ekspor tidak dikenal: ${exportSection}` }, { status: 400 });
      // judul ikut bahasa (kamus BASE_EN; "Adverse Impact 4/5ths" netral)
      const title = trFor(lang, titleId);
      if (format === "xlsx") {
        // nama sheet Excel tak boleh mengandung * ? : \ / [ ] — sanitasi ringan
        const sheetName = title.replace(/[*?:\\/\[\]]/g, "-").slice(0, 31);
        const buf = await toXlsx(sheetName, built.columns, built.rows, { title, lang });
        return xlsxResponse(buf, exportFilename(name, "xlsx"));
      }
      if (format === "pdf") {
        // builder sudah bilingual → kolom/baris tinggal dirender; judul diterjemahkan
        const bytes = await tablePdf(title, built.columns, built.rows);
        return pdfResponse(bytes, exportFilename(name, "pdf"));
      }
      return csvResponse(toCsv(built.columns, built.rows, lang), exportFilename(name, "csv"));
    }

    // ---- section JSON (guard view) ----
    const m = await requireMenuViewAny(req, ["recruitment:reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    if (sp.get("views")) {
      if (!m.actor.employeeId) return NextResponse.json({ views: [] });
      return NextResponse.json({ views: await listMyViews(db, m.actor.employeeId) });
    }

    const section = sp.get("section") ?? "dashboard";
    switch (section) {
      case "dashboard":
        return NextResponse.json({ dashboard: await getRecruitmentDashboard(db) });
      case "metrics":
        return NextResponse.json({ metrics: await getMetricsCatalog(db) });
      case "adverse-impact":
        return NextResponse.json({ adverseImpact: await getAdverseImpact(db) });
      case "projections":
        return NextResponse.json({ projections: await getProjections(db) });
      case "history": {
        const metric = sp.get("metric") ?? "time_to_fill";
        if (!METRIC_KEY_RE.test(metric)) {
          return NextResponse.json({ error: "Kunci metrik tidak valid" }, { status: 400 });
        }
        const limitRaw = Number(sp.get("limit") ?? 24);
        const limit = Number.isFinite(limitRaw) ? limitRaw : 24;
        return NextResponse.json({ history: await getSnapshotHistory(db, metric, limit) });
      }
      default:
        return NextResponse.json({ error: `Bagian tidak dikenal: ${section}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ POST — saved views milik aktor ============

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const action = String(b.action ?? "");
    const m = await requireMenuAction(req, "recruitment:reports", "op:views");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    switch (action) {
      case "view-save": {
        if (!m.actor.employeeId) {
          return NextResponse.json({ error: "Akun Anda tidak tertaut karyawan — tampilan tersimpan tidak tersedia" }, { status: 400 });
        }
        const name = String(b.name ?? "").trim();
        const view = String(b.view ?? "").trim();
        if (name.length < 1 || name.length > 80) {
          return NextResponse.json({ error: "Nama tampilan wajib 1–80 karakter" }, { status: 400 });
        }
        if (!VIEW_KEY_RE.test(view)) {
          return NextResponse.json({ error: "Key view tidak valid (huruf kecil/angka/tanda hubung)" }, { status: 400 });
        }
        const filters = (b.filters && typeof b.filters === "object" && !Array.isArray(b.filters)) ? b.filters : {};
        const filtersJson = JSON.stringify(filters);
        if (filtersJson.length > 4000) {
          return NextResponse.json({ error: "Filter terlalu panjang (maks ±4000 karakter)" }, { status: 400 });
        }
        const row = await db.savedReportView.create({
          data: { ownerId: m.actor.employeeId, name, view, filtersJson },
        });
        await db.activityLog.create({
          data: {
            actorType: "user", employeeId: m.actor.employeeId, action: "Created",
            entity: "SavedReportView", entityId: row.id,
            detail: `Tampilan laporan "${name}" (${view}) disimpan oleh ${m.actor.name}`,
          },
        }).catch(() => {});
        return NextResponse.json({ view: serializeSaved(row) }, { status: 201 });
      }
      case "view-delete": {
        if (!m.actor.employeeId) return NextResponse.json({ error: "Akun Anda tidak tertaut karyawan" }, { status: 400 });
        const id = String(b.id ?? "");
        const row = await db.savedReportView.findUnique({ where: { id } });
        if (!row || row.ownerId !== m.actor.employeeId) {
          return NextResponse.json({ error: "Tampilan tidak ditemukan" }, { status: 404 });
        }
        await db.savedReportView.delete({ where: { id } });
        await db.activityLog.create({
          data: {
            actorType: "user", employeeId: m.actor.employeeId, action: "Deleted",
            entity: "SavedReportView", entityId: id,
            detail: `Tampilan laporan "${row.name}" dihapus oleh ${m.actor.name}`,
          },
        }).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      case "view-schedule": {
        if (!m.actor.employeeId) return NextResponse.json({ error: "Akun Anda tidak tertaut karyawan" }, { status: 400 });
        const id = String(b.id ?? "");
        const schedule = String(b.schedule ?? "");
        if (!(SCHEDULES as readonly string[]).includes(schedule)) {
          return NextResponse.json({ error: "Jadwal harus \"none\" atau \"weekly\"" }, { status: 400 });
        }
        const row = await db.savedReportView.findUnique({ where: { id } });
        if (!row || row.ownerId !== m.actor.employeeId) {
          return NextResponse.json({ error: "Tampilan tidak ditemukan" }, { status: 404 });
        }
        const updated = await db.savedReportView.update({ where: { id }, data: { schedule } });
        await db.activityLog.create({
          data: {
            actorType: "user", employeeId: m.actor.employeeId, action: "Updated",
            entity: "SavedReportView", entityId: id,
            detail: `Jadwal tampilan "${row.name}" = ${schedule} (oleh ${m.actor.name})`,
          },
        }).catch(() => {});
        return NextResponse.json({ view: serializeSaved(updated) });
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
