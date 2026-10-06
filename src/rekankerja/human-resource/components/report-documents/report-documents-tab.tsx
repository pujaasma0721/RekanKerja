"use client";
// T110 — tab "Reports": katalog 16 laporan + FORM PARAMETER sebelum generate ==
// Alur 3 tahap: (1) katalog grid → klik kartu; (2) form parameter awal
// (cakupan cabang/unit/status, periode bulan/tahun/rentang, filter khusus
// laporan) → "Generate Laporan"; (3) dokumen siap-cetak (ReportSheet A4) +
// toolbar. Data: GET /api/rekankerja/hr/reports/documents?<query> — filter
// diterapkan server-side; XLSX & Cetak mengikuti query yang sama.
//
// Cetak: node #rk-print-area di-clone ke body (class rk-printing) lalu
// window.print() — @media print di globals.css menyembunyikan semua anak body
// kecuali klon & melepas scroll container (.doc-scroll).
import { useState } from "react";
import {
  ArrowLeft, Printer, RefreshCw, FolderOpen, FileSpreadsheet,
  Users, Hourglass, TrendingUp, Landmark, ChevronRight, SlidersHorizontal,
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
  DocResponse, R11Data, R12Data, R13Data, R14Data, R15Data,
  R21Data, R22Data, R23Data, R31Data, R32Data, R33Data, R34Data,
  R41Data, R42Data, R43Data, R44Data,
} from "./types";
import {
  R11View, R12View, R13View, R14View, R15View, R21View, R22View, R23View,
} from "./report-views-g12";
import {
  R31View, R32View, R33View, R34View, R41View, R42View, R43View, R44View,
} from "./report-views-g34";

const GROUP_ICONS = [Users, Hourglass, TrendingUp, Landmark];

const DOC_BASE = "/api/rekankerja/hr/reports/documents";

/** Cetak dokumen: klon area cetak ke body → sembunyikan UI → window.print().
 * Laporan bertanda data-landscape (tabel lebar) dicetak A4 landscape via
 * <style> @page dinamis (di-inject sebelum print, dibuang saat cleanup). */
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
  window.setTimeout(cleanup, 60_000); // pengaman bila afterprint tak terpanggil
  window.setTimeout(() => window.print(), 60); // beri waktu style diterapkan
}

/** Router view dokumen per id. */
function ReportDocument({ doc }: { doc: DocResponse<unknown> }) {
  const meta = doc.meta;
  switch (doc.id) {
    case "r11": return <R11View data={doc.data as R11Data} meta={meta} />;
    case "r12": return <R12View data={doc.data as R12Data} meta={meta} />;
    case "r13": return <R13View data={doc.data as R13Data} meta={meta} />;
    case "r14": return <R14View data={doc.data as R14Data} meta={meta} />;
    case "r15": return <R15View data={doc.data as R15Data} meta={meta} />;
    case "r21": return <R21View data={doc.data as R21Data} meta={meta} />;
    case "r22": return <R22View data={doc.data as R22Data} meta={meta} />;
    case "r23": return <R23View data={doc.data as R23Data} meta={meta} />;
    case "r31": return <R31View data={doc.data as R31Data} meta={meta} />;
    case "r32": return <R32View data={doc.data as R32Data} meta={meta} />;
    case "r33": return <R33View data={doc.data as R33Data} meta={meta} />;
    case "r34": return <R34View data={doc.data as R34Data} meta={meta} />;
    case "r41": return <R41View data={doc.data as R41Data} meta={meta} />;
    case "r42": return <R42View data={doc.data as R42Data} meta={meta} />;
    case "r43": return <R43View data={doc.data as R43Data} meta={meta} />;
    default: return <R44View data={doc.data as R44Data} meta={meta} />;
  }
}

export function ReportDocumentsTab() {
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
            <div className="flex items-center gap-2">
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
    <div className="space-y-5">
      {REPORT_GROUPS.map((g, gi) => {
        const GroupIcon = GROUP_ICONS[gi] ?? Users;
        return (
          <section key={g.key}>
            <div className="mb-2.5 flex items-start gap-2.5">
              <div className="ov-tile flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                <GroupIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-extrabold tracking-tight text-slate-800 dark:text-slate-100">{t(g.labelId, g.labelEn)}</h3>
                <p className="text-[10.5px] leading-snug text-slate-400">{t(g.descId, g.descEn)}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                    className="group flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition-colors group-hover:bg-slate-800 group-hover:text-white dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-slate-700">
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge className="bg-slate-100 font-mono text-[9px] font-black text-slate-500 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400">{r.no}</Badge>
                    </div>
                    <p className="mt-3 text-[12.5px] font-extrabold leading-snug tracking-tight text-slate-800 dark:text-slate-100">{t(r.titleId, r.titleEn)}</p>
                    <p className="mt-1 flex-1 text-[10.5px] leading-snug text-slate-400">{t(r.descId, r.descEn)}</p>
                    <div className="mt-3 border-t border-dashed border-slate-100 pt-2.5 dark:border-slate-800">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                        {t("Penerima", "Audience")}: <span className="text-slate-500 dark:text-slate-300">{r.audience}</span>
                      </p>
                      <p className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-extrabold text-slate-700 transition-colors group-hover:text-slate-950 dark:text-slate-200 dark:group-hover:text-white">
                        {t("Atur Parameter & Generate", "Set Parameters & Generate")}
                        <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="flex items-start gap-2.5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-[10.5px] leading-relaxed text-slate-500 dark:text-slate-400">
          {t(
            "Setiap laporan dimulai dari form parameter (cakupan cabang/unit/status kepegawaian, periode bulan–tahun–rentang, hingga filter khusus seperti urgensi kontrak dan kategori sertifikasi) sebelum dokumen digenerate — filter diterapkan server-side. Dokumen siap distribusi: kop perusahaan + metadata (periode · parameter terpasang · tanggal cetak · pengunduh), tabel berformat, ringkasan, blok persetujuan (Disiapkan · Diperiksa · Disetujui) dan pemberitahuan kerahasiaan. Gunakan Cetak / PDF untuk menyimpan sebagai PDF (A4), atau XLSX untuk data mentah dengan cakupan yang sama.",
            "Every report starts from a parameter form (branch/unit/employment-status scope, month–year–range periods, plus report-specific filters such as contract urgency and certification category) before the document is generated — filters are applied server-side. Documents are distribution-ready: company letterhead + metadata (period · applied parameters · print date · downloaded-by), formatted tables, summaries, sign-off grid and confidentiality notice. Use Print / PDF to save as A4 PDF, or XLSX for raw data with the same scope.",
          )}
        </p>
      </div>
    </div>
  );
}
