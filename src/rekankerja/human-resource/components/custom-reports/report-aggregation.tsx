"use client";
// RekanKerja — Report Builder: bagian AGREGASI (P3.4-BM / D-BM26) ================
// =====================================================================
// Ekstensi builder laporan kustom (D-BM26 "analytics pivot"):
//   · GROUP BY — satu field katalog (non-uang) sbg dimensi baris hasil.
//   · AGREGAT — baris dinamis {field angka, fn sum|avg|count, alias opsional}.
//   · PIVOT 2 DIMENSI — rowField × colField + valueFn count|sum (valueField
//     angka saat sum). Menyalakan pivot menyembunyikan group-by/agregat
//     (server menolak kombinasi — 400 "tidak dapat digabung").
// Uang (field terenkripsi): agregat tetap boleh dipilih — nilai hanya
// terdekripsi bila aktor punya money-view; selainnya sel hasil "•••" (null
// server-side, tidak difabrikasi). Validasi numerik dicek juga server-side.
import { Plus, Sigma, Table2, X } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface CatalogFieldLite {
  key: string;
  label: string;
  labelEn: string;
  type: "string" | "number" | "date" | "boolean";
}

export interface AggRowState { uid: number; field: string; fn: string; alias: string }

export interface AggregationState {
  groupBy: string;
  rows: AggRowState[];
  pivotOn: boolean;
  pivRow: string;
  pivCol: string;
  pivFn: "count" | "sum";
  pivField: string;
}

export const emptyAggregation = (): AggregationState => ({
  groupBy: "", rows: [], pivotOn: false, pivRow: "", pivCol: "", pivFn: "count", pivField: "",
});

/** true bila tidak ada agregasi aktif (perilaku builder lama). */
export const aggregationEmpty = (a: AggregationState): boolean =>
  !a.groupBy && a.rows.length === 0 && !a.pivotOn;

/** Payload run {groupBy, aggregates, pivot} dari state builder (kosong = {}). */
export function aggregationPayload(a: AggregationState): {
  groupBy?: string;
  aggregates?: { field: string; fn: string; alias?: string }[];
  pivot?: { rowField: string; colField: string; valueFn: string; valueField?: string };
} {
  if (a.pivotOn) {
    const p: { rowField: string; colField: string; valueFn: string; valueField?: string } = {
      rowField: a.pivRow, colField: a.pivCol, valueFn: a.pivFn,
    };
    if (a.pivFn === "sum" && a.pivField) p.valueField = a.pivField;
    return { pivot: p };
  }
  const out: { groupBy?: string; aggregates?: { field: string; fn: string; alias?: string }[] } = {};
  if (a.groupBy) out.groupBy = a.groupBy;
  const rows = a.rows.filter((r) => r.field && r.fn);
  if (rows.length > 0) {
    out.aggregates = rows.map((r) => (r.alias.trim() ? { field: r.field, fn: r.fn, alias: r.alias.trim() } : { field: r.field, fn: r.fn }));
  }
  return out;
}

interface Props {
  fields: CatalogFieldLite[];
  state: AggregationState;
  onChange: (next: AggregationState) => void;
  maxAggregates: number;
  aggFns: Record<string, { label: string; labelEn: string }>;
}

/** Opsi field per kebutuhan: dimensi (semua non-terenkripsi) / angka (sum+avg). */
const dimOptions = (fields: CatalogFieldLite[]) => fields;
const numOptions = (fields: CatalogFieldLite[]) => fields.filter((f) => f.type === "number");

export function ReportAggregation({ fields, state, onChange, maxAggregates, aggFns }: Props) {
  const { t } = useI18n();
  const set = (patch: Partial<AggregationState>) => onChange({ ...state, ...patch });

  const addRow = () => {
    const firstNum = numOptions(fields)[0];
    set({
      rows: [...state.rows, { uid: Date.now() + state.rows.length, field: firstNum?.key ?? "", fn: "sum", alias: "" }],
    });
  };

  return (
    <Collapsible defaultOpen={false}>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800">
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/60">
          <Sigma className="h-4 w-4 text-brand dark:text-brand/85" aria-hidden />
          {t("Agregasi", "Aggregation")}
          <Badge variant="outline" className={cn(
            "ml-auto text-[10px] font-bold tabular-nums",
            state.pivotOn || state.groupBy || state.rows.length > 0
              ? "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25"
              : "bg-slate-100 text-slate-500 border-slate-200",
          )}>
            {state.pivotOn ? t("Pivot", "Pivot") : state.groupBy || state.rows.length > 0 ? state.rows.length + (state.groupBy ? "+1" : "") : "—"}
          </Badge>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-800">

          {/* toggle pivot 2 dimensi */}
          <label className="flex cursor-pointer items-center gap-2.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
            <Switch
              checked={state.pivotOn}
              onCheckedChange={(on) => set({ pivotOn: on })}
              aria-label={t("Pivot 2 dimensi (baris × kolom)", "2-dimensional pivot (rows × columns)")}
            />
            <Table2 className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            {t("Pivot 2 dimensi (baris × kolom)", "2-dimensional pivot (rows × columns)")}
          </label>

          {state.pivotOn ? (
            <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="w-[74px] shrink-0 text-[11px]">{t("Baris", "Rows")}</Label>
                <Select value={state.pivRow || undefined} onValueChange={(v) => set({ pivRow: v })}>
                  <SelectTrigger className="h-8 w-[190px] flex-1 text-[12px]" aria-label={t("Field baris pivot", "Pivot row field")}>
                    <SelectValue placeholder={t("Field dimensi baris…", "Row dimension field…")} />
                  </SelectTrigger>
                  <SelectContent>
                    {dimOptions(fields).map((f) => (
                      <SelectItem key={f.key} value={f.key}>{t(f.label, f.labelEn)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="w-[74px] shrink-0 text-[11px]">{t("Kolom", "Columns")}</Label>
                <Select value={state.pivCol || undefined} onValueChange={(v) => set({ pivCol: v })}>
                  <SelectTrigger className="h-8 w-[190px] flex-1 text-[12px]" aria-label={t("Field kolom pivot", "Pivot column field")}>
                    <SelectValue placeholder={t("Field dimensi kolom…", "Column dimension field…")} />
                  </SelectTrigger>
                  <SelectContent>
                    {dimOptions(fields).map((f) => (
                      <SelectItem key={f.key} value={f.key}>{t(f.label, f.labelEn)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[10px] leading-snug text-slate-400">
                {t(
                  "Maks 30 nilai unik pada kolom — lebih dari itu di tolak server (persempit filter).",
                  "Max 30 unique values on the column dimension — beyond that the server refuses (narrow the filters).",
                )}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="w-[74px] shrink-0 text-[11px]">{t("Nilai", "Value")}</Label>
                <Select value={state.pivFn} onValueChange={(v) => set({ pivFn: v === "sum" ? "sum" : "count", pivField: v === "sum" ? state.pivField : "" })}>
                  <SelectTrigger className="h-8 w-[130px] text-[12px]" aria-label={t("Fungsi nilai pivot", "Pivot value function")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">{t("Hitung baris", "Count rows")}</SelectItem>
                    <SelectItem value="sum">{t("Jumlah (Σ)", "Sum")}</SelectItem>
                  </SelectContent>
                </Select>
                {state.pivFn === "sum" && (
                  <Select value={state.pivField || undefined} onValueChange={(v) => set({ pivField: v })}>
                    <SelectTrigger className="h-8 w-[170px] flex-1 text-[12px]" aria-label={t("Field nilai pivot", "Pivot value field")}>
                      <SelectValue placeholder={t("Field angka…", "Numeric field…")} />
                    </SelectTrigger>
                    <SelectContent>
                      {numOptions(fields).map((f) => (
                        <SelectItem key={f.key} value={f.key}>{t(f.label, f.labelEn)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* group by */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="w-[74px] shrink-0 text-[11px]">{t("Kelompok", "Group by")}</Label>
                <Select value={state.groupBy || undefined} onValueChange={(v) => set({ groupBy: v === state.groupBy ? "" : v })}>
                  <SelectTrigger className="h-8 w-[190px] flex-1 text-[12px]" aria-label={t("Field kelompok hasil", "Result grouping field")}>
                    <SelectValue placeholder={t("Tanpa kelompok", "No grouping")} />
                  </SelectTrigger>
                  <SelectContent>
                    {dimOptions(fields).map((f) => (
                      <SelectItem key={f.key} value={f.key}>{t(f.label, f.labelEn)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* baris agregat */}
              {state.rows.map((r, idx) => {
                const def = fields.find((f) => f.key === r.field);
                const numericOnly = r.fn === "sum" || r.fn === "avg";
                const fieldList = numericOnly ? numOptions(fields) : fields;
                // field terpilih sebelumnya bisa jadi tak relevan utk fn baru —
                // server memvalidasi ulang (400) dan UI men-disable tombol Jalankan.
                const fnMismatch = numericOnly && def != null && def.type !== "number";
                return (
                  <div key={r.uid} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-900/40">
                    <span className="w-4 shrink-0 text-center text-[10px] font-bold tabular-nums text-slate-400">{idx + 1}</span>
                    <Select
                      value={r.field || undefined}
                      onValueChange={(v) => set({ rows: state.rows.map((x) => (x.uid === r.uid ? { ...x, field: v } : x)) })}
                    >
                      <SelectTrigger className="h-8 w-[160px] text-[12px]" aria-label={t("Field agregat baris {n}", "Aggregate field row {n}", { n: idx + 1 })}>
                        <SelectValue placeholder={t("Field…", "Field…")} />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldList.map((f) => (
                          <SelectItem key={f.key} value={f.key}>{t(f.label, f.labelEn)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={r.fn}
                      onValueChange={(v) => set({ rows: state.rows.map((x) => (x.uid === r.uid ? { ...x, fn: v } : x)) })}
                    >
                      <SelectTrigger className="h-8 w-[120px] text-[12px]" aria-label={t("Fungsi agregat baris {n}", "Aggregate function row {n}", { n: idx + 1 })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(aggFns).map(([k, meta]) => (
                          <SelectItem key={k} value={k}>{t(meta.label, meta.labelEn)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={r.alias}
                      onChange={(e) => set({ rows: state.rows.map((x) => (x.uid === r.uid ? { ...x, alias: e.target.value } : x)) })}
                      placeholder={t("nama kolom (ops.)", "column name (opt.)")}
                      className="h-8 w-[150px] flex-1 text-[12px]"
                      maxLength={60}
                      aria-label={t("Alias kolom agregat baris {n}", "Aggregate column alias row {n}", { n: idx + 1 })}
                    />
                    {fnMismatch && (
                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        {t("fn ini butuh field angka", "this fn needs a numeric field")}
                      </span>
                    )}
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => set({ rows: state.rows.filter((x) => x.uid !== r.uid) })}
                      aria-label={t("Hapus agregat baris {n}", "Remove aggregate row {n}", { n: idx + 1 })}
                      className="ml-auto h-8 w-8 shrink-0 text-rose-500 hover:text-rose-600"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                );
              })}
              <Button
                variant="outline" size="sm" onClick={addRow}
                disabled={state.rows.length >= maxAggregates}
                className="h-8 gap-1 text-[12px]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah Agregat", "Add Aggregate")}
              </Button>
              <p className="text-[10px] leading-snug text-slate-400">
                {t(
                  "Field uang (bruto/net dsb.) hanya menampilkan angka bila Anda punya hak lihat nominal — selain itu hasil agregat disembunyikan (•••).",
                  "Money fields (gross/net etc.) show numbers only if you hold the money-view permission — otherwise the aggregate is masked (•••).",
                )}
              </p>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
