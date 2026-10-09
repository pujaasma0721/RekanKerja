"use client";
// T112 — tab "Reports" modul Leave: katalog 12 laporan + FORM PARAMETER =========
// sebelum generate + viewer dokumen siap-cetak. Alur 3 tahap (mirror HR T110):
// (1) katalog grid → klik kartu; (2) form parameter awal → "Generate Laporan";
// (3) dokumen (ReportSheet A4) + toolbar. Data: GET /api/rekankerja/leave/
// reports/documents?<query> — filter diterapkan server-side; XLSX & Cetak
// mengikuti query yang sama.
//
// Katalog memakai identitas warna per grup (mirror T111 HR): emerald/amber/
// rose/violet — strip aksen, ubin ikon solid, badge bertinting, hover terarah.
//
// Cetak: node #rk-print-area di-clone ke body (class rk-printing) lalu
// window.print() — @media print di globals.css (global, lintas modul).
import { useState } from "react";
import {
  ArrowLeft, Printer, RefreshCw, FolderOpen, FileSpreadsheet,
  Scale, ScrollText, Activity, Baby, ChevronRight, SlidersHorizontal,
} from "lucide-react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { REPORT_GROUPS, reportById } from "./catalog";
import { defaultsFor, buildQuery, type ParamValues } from "./params";
import { ReportParamsForm } from "./report-params-form";
import type {
  DocResponse, LR11Data, LR12Data, LR13Data, LR21Data, LR22Data, LR23Data,
  LR31Data, LR32Data, LR33Data, LR41Data, LR42Data, LR43Data,
} from "./types";
import { LR11View, LR12View, LR13View, LR21View, LR22View, LR23View } from "./report-views-g12";
import { LR31View, LR32View, LR33View, LR41View, LR42View, LR43View } from "./report-views-g34";

const GROUP_ICONS = [Scale, ScrollText, Activity, Baby];

// T111 — palet identitas per grup katalog (mirror HR tab Reports).
const GROUP_THEMES = [
  { // G1 — Saldo & Hak Cuti (emerald)
    headerTile: "bg-emerald-600 text-white dark:bg-emerald-500/20 dark:text-emerald-300",
    strip: "from-emerald-400 via-emerald-500 to-teal-500",
    iconTile: "bg-emerald-600 text-white dark:bg-emerald-500/20 dark:text-emerald-300",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    hover: "hover:border-emerald-300 hover:shadow-emerald-500/15 dark:hover:border-emerald-500/40",
    cta: "text-emerald-700 group-hover:text-emerald-800 dark:text-emerald-300 dark:group-hover:text-emerald-200",
    blob: "bg-emerald-400",
    divider: "border-emerald-100 dark:border-emerald-500/15",
  },
  { // G2 — Transaksi & Riwayat (amber)
    headerTile: "bg-amber-600 text-white dark:bg-amber-500/20 dark:text-amber-300",
    strip: "from-amber-400 via-amber-500 to-orange-500",
    iconTile: "bg-amber-600 text-white dark:bg-amber-500/20 dark:text-amber-300",
    badge: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    hover: "hover:border-amber-300 hover:shadow-amber-500/15 dark:hover:border-amber-500/40",
    cta: "text-amber-700 group-hover:text-amber-800 dark:text-amber-300 dark:group-hover:text-amber-200",
    blob: "bg-amber-400",
    divider: "border-amber-100 dark:border-amber-500/15",
  },
  { // G3 — Analisis Ketidakhadiran (rose)
    headerTile: "bg-rose-600 text-white dark:bg-rose-500/20 dark:text-rose-300",
    strip: "from-rose-400 via-rose-500 to-pink-500",
    iconTile: "bg-rose-600 text-white dark:bg-rose-500/20 dark:text-rose-300",
    badge: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
    hover: "hover:border-rose-300 hover:shadow-rose-500/15 dark:hover:border-rose-500/40",
    cta: "text-rose-700 group-hover:text-rose-800 dark:text-rose-300 dark:group-hover:text-rose-200",
    blob: "bg-rose-400",
    divider: "border-rose-100 dark:border-rose-500/15",
  },
  { // G4 — Kepatuhan & Cuti Khusus (violet)
    headerTile: "bg-violet-600 text-white dark:bg-violet-500/20 dark:text-violet-300",
    strip: "from-violet-400 via-violet-500 to-purple-500",
    iconTile: "bg-violet-600 text-white dark:bg-violet-500/20 dark:text-violet-300",
    badge: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
    hover: "hover:border-violet-300 hover:shadow-violet-500/15 dark:hover:border-violet-500/40",
    cta: "text-violet-700 group-hover:text-violet-800 dark:text-violet-300 dark:group-hover:text-violet-200",
    blob: "bg-violet-400",
    divider: "border-violet-100 dark:border-violet-500/15",
  },
];

const DOC_BASE = "/api/rekankerja/leave/reports/documents";

/** Cetak dokumen: klon area cetak ke body → sembunyikan UI → window.print(). */
function printDocument() {
  const area = document.getElementById("rk-print-area");
  if (!area) return;
  const clone = area.cloneNode(true) as HTMLElement;
  clone.id = "rk-print-clone";
  document.body.appendChild(clone);
  document.body.classList.add("rk-printing");
  const pageStyle = document.createElement("style");
  pageStyle.id = "rk-print-page";
  pageStyle.textContent = area.dataset.landscape === "1" ? "@page { size: A4 landscape; margin: 9mm; }" : "@page { size: A4 portrait; margin: 11mm; }";
  document.head.appendChild(pageStyle);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clone.remove();
    pageStyle.remove();
    document.body.classList.remove("rk-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.setTimeout(cleanup, 60_000);
  window.setTimeout(() => window.print(), 60);
}

/** Router view dokumen per id. */
function ReportDocument({ doc }: { doc: DocResponse<unknown> }) {
  const meta = doc.meta;
  switch (doc.id) {
    case "lr11": return <LR11View data={doc.data as LR11Data} meta={meta} />;
    case "lr12": return <LR12View data={doc.data as LR12Data} meta={meta} />;
    case "lr13": return <LR13View data={doc.data as LR13Data} meta={meta} />;
    case "lr21": return <LR21View data={doc.data as LR21Data} meta={meta} />;
    case "lr22": return <LR22View data={doc.data as LR22Data} meta={meta} />;
    case "lr23": return <LR23View data={doc.data as LR23Data} meta={meta} />;
    case "lr31": return <LR31View data={doc.data as LR31Data} meta={meta} />;
    case "lr32": return <LR32View data={doc.data as LR32Data} meta={meta} />;
    case "lr33": return <LR33View data={doc.data as LR33Data} meta={meta} />;
    case "lr41": return <LR41View data={doc.data as LR41Data} meta={meta} />;
    case "lr42": return <LR42View data={doc.data as LR42Data} meta={meta} />;
    default: return <LR43View data={doc.data as LR43Data} meta={meta} />;
  }
}

export function LeaveReportDocumentsTab() {
  const { t } = useI18n();
  // Tahap: null = katalog · selected + showParams = form parameter ·
  // query terisi & !showParams = dokumen hasil generate.
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<ParamValues>({});
  const [showParams, setShowParams] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const api = useApi<DocResponse<unknown>>(
    selected && query && !showParams ? `${DOC_BASE}?${query}` : null,
  );
  const def = selected ? reportById(selected) : null;

  // ===================== FORM PARAMETER =====================
  if (selected && def && showParams) {
    return (
      <ReportParamsForm
        def={def}
        values={values}
        onChange={setValues}
        onGenerate={() => { setQuery(buildQuery(selected, values)); setShowParams(false); }}
        onBack={() => { setSelected(null); setQuery(null); setShowParams(false); }}
      />
    );
  }

  // ===================== VIEWER DOKUMEN =====================
  if (selected && def && query) {
    return (
      <div className="space-y-4">
        {/* Toolbar dokumen — di luar area cetak */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/70 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Button variant="outline" size="sm" onClick={() => { setSelected(null); setQuery(null); setShowParams(false); }} className="gap-1.5 font-bold">
                <ArrowLeft className="h-3.5 w-3.5" /> {t("Katalog")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowParams(true)} className="gap-1.5 font-bold">
                <SlidersHorizontal className="h-3.5 w-3.5" /> {t("Ubah Parameter", "Change Parameters")}
              </Button>
              <div className="hidden min-w-0 md:block">
                <p className="truncate text-xs font-extrabold text-slate-800 dark:text-slate-100">
                  <span className="mr-1.5 rounded bg-slate-200 px-1.5 py-px font-mono text-[9px] dark:bg-slate-700">{def.no}</span>
                  {t(def.titleId, def.titleEn)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => api.refresh()} disabled={api.loading} className="gap-1.5 font-bold">
                <RefreshCw className={cn("h-3.5 w-3.5", api.loading && "animate-spin")} /> {t("Segarkan")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { window.location.href = `${DOC_BASE}?${query}&export=xlsx`; }} className="gap-1.5 font-bold">
                <FileSpreadsheet className="h-3.5 w-3.5" /> {t("XLSX")}
              </Button>
              <Button size="sm" onClick={printDocument} disabled={!api.data} className="gap-1.5 font-bold">
                <Printer className="h-3.5 w-3.5" /> {t("Cetak / PDF")}
              </Button>
            </div>
          </div>
          {/* chip parameter terpasang — mirror kop dokumen */}
          {api.data?.meta.filters?.length ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-4 py-2 dark:border-slate-800">
              <span className="text-[8.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{t("Parameter", "Parameters")}:</span>
              {api.data.meta.filters.map((f) => (
                <span key={`${f.label}-${f.value}`} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9.5px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <span className="text-slate-400">{f.label}:</span> {f.value}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {api.loading && !api.data ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-16 dark:border-slate-800 dark:bg-slate-900">
            <LoadingRows rows={10} />
          </div>
        ) : !api.data ? (
          <Card className="rounded-2xl"><CardContent className="p-5">
            <EmptyState title={t("Laporan gagal dimuat")} description={api.error ?? undefined} icon={<FolderOpen className="h-6 w-6" />} />
          </CardContent></Card>
        ) : (
          <ReportDocument doc={api.data} />
        )}
      </div>
    );
  }

  // ===================== KATALOG =====================
  return (
    <div className="space-y-6">
      {REPORT_GROUPS.map((g, gi) => {
        const GroupIcon = GROUP_ICONS[gi] ?? Scale;
        const th = GROUP_THEMES[gi] ?? GROUP_THEMES[0];
        return (
          <section key={g.key}>
            <div className="mb-3 flex items-center gap-3">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm", th.headerTile)}>
                <GroupIcon className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-extrabold tracking-tight text-slate-900 dark:text-slate-50">{t(g.labelId, g.labelEn)}</h3>
                  <span className={cn("rounded-full border px-2 py-px font-mono text-[9px] font-black uppercase tracking-wider", th.badge)}>
                    {g.reports.length} {t("LAPORAN", "REPORTS")}
                  </span>
                </div>
                <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500 dark:text-slate-400">{t(g.descId, g.descEn)}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {g.reports.map((r) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelected(r.id);
                      setValues(defaultsFor(r.id));
                      setQuery(null);
                      setShowParams(true);
                    }}
                    className={cn(
                      "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 pt-5 text-left shadow-sm transition-all duration-200",
                      "hover:-translate-y-1 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900",
                      th.hover,
                    )}
                  >
                    {/* strip aksen atas — identitas warna grup */}
                    <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r", th.strip)} />
                    {/* glow lembut pojok kanan-atas — menguat saat hover */}
                    <span aria-hidden className={cn("pointer-events-none absolute -right-7 -top-7 h-24 w-24 rounded-full opacity-[0.08] blur-2xl transition-opacity duration-300 group-hover:opacity-20", th.blob)} />
                    <div className="flex items-start justify-between gap-2">
                      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform duration-200 group-hover:-rotate-3 group-hover:scale-105", th.iconTile)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge className={cn("rounded-md border font-mono text-[9px] font-black tracking-wide", th.badge)}>{r.no}</Badge>
                    </div>
                    <p className="mt-3 text-[13px] font-extrabold leading-snug tracking-tight text-slate-900 dark:text-slate-50">{t(r.titleId, r.titleEn)}</p>
                    <p className="mt-1 flex-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{t(r.descId, r.descEn)}</p>
                    <div className={cn("mt-3 border-t border-dashed pt-2.5", th.divider)}>
                      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {t("Penerima", "Audience")}: <span className="font-extrabold text-slate-700 dark:text-slate-200">{r.audience}</span>
                      </p>
                      <p className={cn("mt-1.5 inline-flex items-center gap-1 text-[11px] font-extrabold transition-colors", th.cta)}>
                        {t("Atur Parameter & Generate", "Set Parameters & Generate")}
                        <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white p-4 dark:border-slate-700 dark:from-slate-900/60 dark:to-slate-900/30">
        <div className="ov-tile flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
          <SlidersHorizontal className="h-4 w-4" />
        </div>
        <p className="text-[10.5px] leading-relaxed text-slate-600 dark:text-slate-300">
          {t(
            "Setiap laporan dimulai dari form parameter (cakupan cabang/unit/jenis cuti/status pengajuan, periode bulan–tahun–rentang, hingga filter khusus seperti audit SKD) sebelum dokumen digenerate — filter diterapkan server-side. Dokumen siap distribusi: kop perusahaan + metadata (periode · parameter terpasang · tanggal cetak · pengunduh), tabel berformat, ringkasan, blok persetujuan (Disiapkan · Diperiksa · Disetujui) dan pemberitahuan kerahasiaan. Gunakan Cetak / PDF untuk menyimpan sebagai PDF (A4), atau XLSX untuk data mentah dengan cakupan yang sama.",
            "Every report starts from a parameter form (branch/unit/leave-type/request-status scope, month–year–range periods, plus report-specific filters such as the SKD audit) before the document is generated — filters are applied server-side. Documents are distribution-ready: company letterhead + metadata (period · applied parameters · print date · downloaded-by), formatted tables, summaries, sign-off grid and confidentiality notice. Use Print / PDF to save as A4 PDF, or XLSX for raw data with the same scope.",
          )}
        </p>
      </div>
    </div>
  );
}
