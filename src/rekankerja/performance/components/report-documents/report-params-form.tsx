"use client";
// P8-PERF — form parameter awal laporan kinerja (sebelum generate) ============
// Mirror medical/report-documents/report-params-form.tsx: siklus/tahun/unit/
// status/kelompok/karyawan/sesi LALU "Generate Laporan" → filter diterapkan
// SERVER-SIDE. "Semua" memakai sentinel "all" (Radix SelectItem TIDAK BOLEH
// value="" — lihat fix T110). Field wajib (cycle pf12+, employee pf23) diisi
// otomatis dari pool (default cycle = aktif pertama / terbaru).
import { useEffect, useRef } from "react";
import { ArrowLeft, RotateCcw, Play, Loader2, SlidersHorizontal } from "lucide-react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReportDef } from "./catalog";
import { REPORT_PARAMS, defaultsFor, summarizeParams, type ParamField, type ParamValues } from "./params";

/** Opsi filter dari server (?id=_params) — dipakai field select. */
interface FilterOptions {
  cycles: { id: string; code: string; label: string }[];
  years: number[];
  units: { id: string; label: string }[];
  employees: { id: string; label: string }[];
  cycleStatuses: { id: string; label: string }[];
  appraisalStatuses: { id: string; label: string }[];
  meritStatuses: { id: string; label: string }[];
  pipStatuses: { id: string; label: string }[];
  sessions: { id: string; label: string }[];
  defaultCycleId: string | null;
}

const GROUPBY_OPTIONS: { id: string; labelId: string; labelEn: string }[] = [
  { id: "unit", labelId: "Unit Kerja", labelEn: "Work Unit" },
  { id: "atasan", labelId: "Atasan Penilai", labelEn: "Appraising Manager" },
];

/** Label tampil utk satu nilai field (select → label opsi). */
function labelOfValue(f: ParamField, value: string, opts: FilterOptions | null): string {
  if (f.key === "groupBy") return GROUPBY_OPTIONS.find((o) => o.id === value)?.labelId ?? value;
  const pool = f.optionsFrom === "cycles" ? opts?.cycles
    : f.optionsFrom === "units" ? opts?.units
    : f.optionsFrom === "employees" ? opts?.employees
    : f.optionsFrom === "cycleStatuses" ? opts?.cycleStatuses
    : f.optionsFrom === "appraisalStatuses" ? opts?.appraisalStatuses
    : f.optionsFrom === "meritStatuses" ? opts?.meritStatuses
    : f.optionsFrom === "pipStatuses" ? opts?.pipStatuses
    : f.optionsFrom === "sessions" ? opts?.sessions
    : null;
  if (pool) return pool.find((o) => o.id === value)?.label ?? value;
  if (f.type === "year") return value;
  return value;
}

// ===================== field tunggal =====================

function FieldControl({ field, value, onChange, options, disabled }: {
  field: ParamField;
  value: string;
  onChange: (v: string) => void;
  options: FilterOptions | null;
  disabled: boolean;
}) {
  const { t } = useI18n();

  // groupBy — opsi statis (unit | atasan)
  if (field.key === "groupBy") {
    return (
      <Select value={value || "unit"} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-9 w-full bg-white text-[12.5px] font-semibold dark:bg-slate-900">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {GROUPBY_OPTIONS.map((o) => (
            <SelectItem key={o.id} value={o.id} className="text-[12px] font-semibold">{t(o.labelId, o.labelEn)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // select / year — dropdown dari opsi server (year: daftar angka).
  // "Semua" memakai sentinel "all" — Radix SelectItem TIDAK BOLEH value="".
  const pool: { id: string; label: string }[] = field.optionsFrom === "years"
    ? (options?.years ?? []).map((y) => ({ id: String(y), label: String(y) }))
    : field.optionsFrom === "cycles" ? (options?.cycles ?? []).map((c) => ({ id: c.id, label: c.code }))
    : field.optionsFrom === "units" ? (options?.units ?? [])
    : field.optionsFrom === "employees" ? (options?.employees ?? [])
    : field.optionsFrom === "cycleStatuses" ? (options?.cycleStatuses ?? [])
    : field.optionsFrom === "appraisalStatuses" ? (options?.appraisalStatuses ?? [])
    : field.optionsFrom === "meritStatuses" ? (options?.meritStatuses ?? [])
    : field.optionsFrom === "pipStatuses" ? (options?.pipStatuses ?? [])
    : field.optionsFrom === "sessions" ? (options?.sessions ?? [])
    : [];
  const selectable = pool.filter((o) => o.id); // buang entri kosong (defensif)
  const isYears = field.optionsFrom === "years";
  const placeholder = isYears
    ? t("Pilih tahun", "Pick year")
    : t("Memuat opsi…", "Loading options…");
  return (
    <Select
      value={value ? value : "all"}
      onValueChange={(v) => onChange(v === "all" ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 w-full bg-white text-[12.5px] font-semibold dark:bg-slate-900">
        <SelectValue placeholder={selectable.length || isYears ? t("Semua", "All") : placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {!field.required && !isYears && (
          <SelectItem value="all" className="text-[12px] font-semibold">{t("Semua", "All")}</SelectItem>
        )}
        {selectable.map((o) => (
          <SelectItem key={o.id} value={o.id} className="text-[12px] font-semibold">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ===================== form utuh =====================

export function ReportParamsForm({ def, values, onChange, onGenerate, onBack, generating }: {
  def: ReportDef;
  values: ParamValues;
  onChange: (v: ParamValues) => void;
  onGenerate: () => void;
  onBack: () => void;
  generating?: boolean;
}) {
  const { t } = useI18n();
  const fields = REPORT_PARAMS[def.id] ?? [];
  const optsApi = useApi<FilterOptions>("/api/rekankerja/performance/reports/documents?id=_params");
  const opts = optsApi.data;

  // default cycle (aktif pertama / terbaru): pool dimuat SETELAH kartu diklik →
  // isi field cycle kosong sekali saja (ref guard — pilihan "Semua" pengguna
  // TIDAK boleh ditimpa balang oleh efek ini saat cycle dikosongkan).
  const defaultedRef = useRef(false);
  const needsDefault = fields.some((f) => f.key === "cycle" && !values.cycle);
  useEffect(() => {
    if (opts && needsDefault && !defaultedRef.current && opts.defaultCycleId) {
      defaultedRef.current = true;
      onChange({ ...values, cycle: opts.defaultCycleId });
    }
  }, [opts, needsDefault]);

  const chips = summarizeParams(def.id, values, (f, id) => labelOfValue(f, id, opts));
  const missingRequired = fields.filter((f) => f.required && !(values[f.key] ?? "").trim());
  const Icon = def.icon;

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 font-bold">
            <ArrowLeft className="h-3.5 w-3.5" /> {t("Katalog")}
          </Button>
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-xs font-extrabold text-slate-800 dark:text-slate-100">
              <span className="mr-1.5 rounded bg-slate-200 px-1.5 py-px font-mono text-[9px] dark:bg-slate-700">{def.no}</span>
              {t(def.titleId, def.titleEn)}
            </p>
            <p className="truncate text-[10px] text-slate-400">{t("Atur parameter lalu generate dokumen.", "Set parameters, then generate the document.")}</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-col items-end gap-1">
          <Button size="sm" onClick={onGenerate} disabled={!!generating || missingRequired.length > 0} className="gap-1.5 font-bold">
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {t("Generate Laporan", "Generate Report")}
          </Button>
          {missingRequired.length > 0 && (
            <p className="text-[9px] font-bold text-amber-600 dark:text-amber-400">
              {t("Lengkapi parameter wajib (*) terlebih dahulu.", "Complete the required (*) parameters first.")}
            </p>
          )}
        </div>
      </div>

      {/* panel parameter */}
      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold tracking-tight text-slate-800 dark:text-slate-100">
                {t("Parameter Laporan", "Report Parameters")}
              </h3>
              <p className="text-[10.5px] leading-snug text-slate-400">
                {t(
                  "Filter diterapkan server-side — tabel, ringkasan, XLSX dan cetak/PDF mengikuti cakupan yang dipilih.",
                  "Filters are applied server-side — tables, summaries, XLSX and print/PDF follow the selected scope.",
                )}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onChange(defaultsFor(def.id, opts?.defaultCycleId))} className="ml-auto shrink-0 gap-1.5 text-[10.5px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-100">
              <RotateCcw className="h-3 w-3" /> {t("Reset", "Reset")}
            </Button>
          </div>

          {optsApi.error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-600">
              {t("Opsi filter gagal dimuat", "Failed to load filter options")}: {optsApi.error}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-[10.5px] font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t(f.labelId, f.labelEn)}
                    {f.required && <span className="ml-1 text-rose-500">*</span>}
                  </Label>
                  <FieldControl
                    field={f}
                    value={values[f.key] ?? ""}
                    onChange={(v) => onChange({ ...values, [f.key]: v })}
                    options={opts ?? null}
                    disabled={optsApi.loading && (f.type === "select" || f.type === "year")}
                  />
                  {f.hintId && <p className="text-[9.5px] leading-snug text-slate-400">{t(f.hintId, f.hintEn ?? f.hintId)}</p>}
                </div>
              ))}
            </div>
          )}

          {/* pratinjau cakupan */}
          {chips.length > 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {t("Cakupan yang akan diterapkan", "Scope to be applied")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span key={c.key} className="inline-flex max-w-full items-center rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    <span className="truncate">{c.label}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
