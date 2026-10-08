"use client";
// TRAV-1-b — form parameter awal laporan Travel (sebelum generate) ============
// Mirror medical/report-documents/report-params-form.tsx (MED-1-b) & leave
// (T112): cakupan (cabang, unit, jenis perjalanan/template, jenis biaya, status
// pengajuan, status klaim) dan periode (tahun buku / rentang tanggal) LALU
// menekan "Generate Laporan". Nilai dikirim sebagai query string → difilter
// server-side. "Semua" memakai sentinel "all" (Radix SelectItem TIDAK BOLEH
// value="" — lihat fix T110).
import { ArrowLeft, RotateCcw, Play, Loader2, SlidersHorizontal } from "lucide-react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReportDef } from "./catalog";
import { REPORT_PARAMS, defaultsFor, summarizeParams, type ParamField, type ParamValues } from "./params";

/** Opsi filter dari server (?id=_params) — dipakai field select. */
interface FilterOptions {
  offices: { id: string; label: string }[];
  units: { id: string; label: string }[];
  templates: { id: string; label: string }[];
  expenseTypes: { id: string; label: string }[];
  statuses: { id: string; label: string }[];
  claimStatuses: { id: string; label: string }[];
  years: number[];
}

const monthLabelOf = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  const id = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return `${id[m - 1]} ${y}`;
};

const dateLabelOf = (d: string): string => {
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
};

/** Label tampil utk satu nilai field (select → label opsi; month/date → lokal). */
function labelOfValue(f: ParamField, value: string, opts: FilterOptions | null): string {
  if (f.type === "month") return monthLabelOf(value);
  if (f.type === "date") return dateLabelOf(value);
  if (f.type === "year") return value;
  const pool = f.optionsFrom === "offices" ? opts?.offices
    : f.optionsFrom === "units" ? opts?.units
    : f.optionsFrom === "templates" ? opts?.templates
    : f.optionsFrom === "expenseTypes" ? opts?.expenseTypes
    : f.optionsFrom === "statuses" ? opts?.statuses
    : f.optionsFrom === "claimStatuses" ? opts?.claimStatuses
    : null;
  return pool?.find((o) => o.id === value)?.label ?? value;
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

  if (field.type === "month" || field.type === "date") {
    return (
      <Input
        type={field.type === "month" ? "month" : "date"}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 bg-white text-[12.5px] font-semibold dark:bg-slate-900"
      />
    );
  }

  // select / year — dropdown dari opsi server (year: daftar angka).
  // "Semua" memakai sentinel "all" — Radix SelectItem TIDAK BOLEH value="".
  const pool: { id: string; label: string }[] = field.optionsFrom === "years"
    ? (options?.years ?? []).map((y) => ({ id: String(y), label: String(y) }))
    : field.optionsFrom === "offices" ? (options?.offices ?? [])
    : field.optionsFrom === "units" ? (options?.units ?? [])
    : field.optionsFrom === "templates" ? (options?.templates ?? [])
    : field.optionsFrom === "expenseTypes" ? (options?.expenseTypes ?? [])
    : field.optionsFrom === "statuses" ? (options?.statuses ?? [])
    : field.optionsFrom === "claimStatuses" ? (options?.claimStatuses ?? [])
    : [];
  const selectable = pool.filter((o) => o.id); // buang entri kosong (defensif)
  const placeholder = field.optionsFrom === "years"
    ? t("Pilih tahun", "Pick year")
    : t("Memuat opsi…", "Loading options…");
  return (
    <Select
      value={value ? value : "all"}
      onValueChange={(v) => onChange(v === "all" ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 w-full bg-white text-[12.5px] font-semibold dark:bg-slate-900">
        <SelectValue placeholder={selectable.length || field.optionsFrom === "years" ? t("Semua", "All") : placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {field.optionsFrom !== "years" && (
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
  const optsApi = useApi<FilterOptions>("/api/rekankerja/travel/reports/documents?id=_params");
  const opts = optsApi.data;

  const fromField = fields.find((f) => f.key === "from");
  const toField = fields.find((f) => f.key === "to");
  const badRange = !!(fromField && toField && values.from && values.to && values.from > values.to);

  const chips = summarizeParams(def.id, values, (f, id) => labelOfValue(f, id, opts));

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
        <Button size="sm" onClick={onGenerate} disabled={!!generating || badRange} className="gap-1.5 font-bold">
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
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
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-[10.5px] font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t(f.labelId, f.labelEn)}
                  </Label>
                  <FieldControl
                    field={f}
                    value={values[f.key] ?? ""}
                    onChange={(v) => onChange({ ...values, [f.key]: v })}
                    options={opts ?? null}
                    disabled={optsApi.loading && (f.type === "select" || f.type === "year")}
                  />
                  {f.hintId && <p className="text-[9.5px] leading-snug text-slate-400">{t(f.hintId, f.hintEn ?? f.hintId)}</p>}
                  {f.key === "to" && badRange && (
                    <p className="text-[9.5px] font-bold text-rose-500">
                      {t("Tanggal mulai harus ≤ tanggal akhir.", "From date must be ≤ to date.")}
                    </p>
                  )}
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
