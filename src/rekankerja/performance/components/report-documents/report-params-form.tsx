"use client";
// P8-PERF — form parameter awal laporan Performance (sebelum generate) =========
// Mirror medical/report-documents/report-params-form.tsx (MED-1-b). Cakupan
// (siklus, unit) + peserta (karyawan) LALU "Generate Laporan". Nilai dikirim
// sebagai query string → difilter server-side. "Semua" memakai sentinel "all"
// (Radix SelectItem TIDAK BOLEH value="" — fix T110).
//
// Daftar karyawan mengikuti siklus terpilih: bila field cycle ada, opsi
// di-refetch dgn ?id=_params&cycleId=… (idem bila kosong → semua peserta).
import { ArrowLeft, RotateCcw, Play, Loader2, SlidersHorizontal } from "lucide-react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReportDef } from "./catalog";
import {
  REPORT_PARAMS, defaultsFor, summarizeParams, missingRequired,
  type ParamField, type ParamValues,
} from "./params";

/** Opsi filter dari server (?id=_params) — dipakai field select. */
interface FilterOptions {
  cycles: { id: string; label: string }[];
  units: { id: string; label: string }[];
  employees: { id: string; label: string }[];
}

/** Label tampil utk satu nilai field select (→ label opsi). */
function labelOfValue(f: ParamField, value: string, opts: FilterOptions | null): string {
  const pool = f.optionsFrom === "cycles" ? opts?.cycles
    : f.optionsFrom === "units" ? opts?.units
    : f.optionsFrom === "employees" ? opts?.employees
    : null;
  return pool?.find((o) => o.id === value)?.label ?? value;
}

// ===================== field tunggal =====================

function FieldControl({ field, value, onChange, options, disabled, required }: {
  field: ParamField;
  value: string;
  onChange: (v: string) => void;
  options: FilterOptions | null;
  disabled: boolean;
  required?: boolean;
}) {
  const { t } = useI18n();
  const pool: { id: string; label: string }[] = field.optionsFrom === "cycles" ? (options?.cycles ?? [])
    : field.optionsFrom === "units" ? (options?.units ?? [])
    : field.optionsFrom === "employees" ? (options?.employees ?? [])
    : [];
  const selectable = pool.filter((o) => o.id); // buang entri kosong (defensif)
  return (
    <Select
      value={value ? value : "all"}
      onValueChange={(v) => onChange(v === "all" ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 w-full bg-white text-[12.5px] font-semibold dark:bg-slate-900">
        <SelectValue placeholder={selectable.length ? t("Semua", "All") : t("Memuat opsi…", "Loading options…")} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {!required && (
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
  const hasEmployee = fields.some((f) => f.key === "employee");
  // Opsi karyawan mengikuti siklus terpilih — refetch saat cycle berubah.
  const cycleKey = (values.cycle ?? "").trim();
  const optsApi = useApi<FilterOptions>(
    `/api/rekankerja/performance/reports/documents?id=_params${cycleKey ? `&cycleId=${encodeURIComponent(cycleKey)}` : ""}`,
    [cycleKey],
  );
  const opts = optsApi.data;

  const missing = missingRequired(def.id, values);
  const chips = summarizeParams(def.id, values, (f, id) => labelOfValue(f, id, opts));
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
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={!!generating || missing.length > 0 || (hasEmployee && optsApi.loading && !opts)}
          className="gap-1.5 font-bold"
        >
          {generating || (hasEmployee && optsApi.loading && !opts) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {t("Generate Laporan", "Generate Report")}
        </Button>
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
            <Button variant="ghost" size="sm" onClick={() => onChange(defaultsFor(def.id))} className="ml-auto shrink-0 gap-1.5 text-[10.5px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-100">
              <RotateCcw className="h-3 w-3" /> {t("Reset", "Reset")}
            </Button>
          </div>

          {optsApi.error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-600">
              {t("Opsi filter gagal dimuat", "Failed to load filter options")}: {optsApi.error}
            </p>
          ) : fields.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-4 text-center text-[11px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
              {t("Laporan ini mencakup seluruh data — tidak perlu parameter.", "This report covers all data — no parameters needed.")}
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
                    disabled={optsApi.loading && f.type === "select"}
                    required={f.required}
                  />
                  {f.hintId && <p className="text-[9.5px] leading-snug text-slate-400">{t(f.hintId, f.hintEn ?? f.hintId)}</p>}
                </div>
              ))}
            </div>
          )}

          {missing.length > 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] font-bold text-amber-700">
              {t("Lengkapi parameter wajib (*) sebelum generate.", "Fill the required (*) parameters before generating.")}
            </p>
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
