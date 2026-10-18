"use client";
// RekanKerja — Report Builder: tabel PIVOT 2 dimensi (P3.4-BM / D-BM26) ========
// =====================================================================
// Matriks rowKeys × colKeys dari runReport mode "pivot":
//   · kolom pertama STICKY (sticky left-0 — label dimensi baris tetap terlihat
//     saat scroll horizontal DI DALAM container tabel; halaman sendiri tidak
//     h-scroll (mobile 375 aman));
//   · angka rata kanan + tabular-nums;
//   · nilai uang ter-mask (pivot.masked — tanpa money-view) → "•••";
//   · sel kosong (0 tanpa data) → 0 tetap ditampilkan; sel null masked → •••.
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface PivotResult {
  rowField: { key: string; label: string; labelEn: string; type: string };
  colField: { key: string; label: string; labelEn: string; type: string };
  valueFn: "count" | "sum";
  valueField: { key: string; label: string; labelEn: string; type: string } | null;
  rowKeys: string[];
  colKeys: string[];
  cells: Record<string, Record<string, number | null>>;
  masked?: boolean;
}

export function ReportPivotTable({ pivot }: { pivot: PivotResult }) {
  const { t } = useI18n();
  const valueLabel = pivot.valueFn === "sum" && pivot.valueField
    ? `${t("Σ", "Σ")} ${t(pivot.valueField.label, pivot.valueField.labelEn)}`
    : t("Jumlah baris", "Row count");

  return (
    <div className="max-h-96 overflow-auto rounded-xl border border-slate-200 [scrollbar-width:thin] dark:border-slate-800">
      <Table className="min-w-full">
        <TableHeader className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
          <TableRow>
            <TableHead className="sticky left-0 z-30 min-w-[160px] bg-slate-50/95 text-[11px] backdrop-blur dark:bg-slate-900/95">
              {t(pivot.rowField.label, pivot.rowField.labelEn)}
              <span className="ml-1 font-normal text-slate-400">× {t(pivot.colField.label, pivot.colField.labelEn)}</span>
            </TableHead>
            {pivot.colKeys.map((ck) => (
              <TableHead key={ck} className="whitespace-nowrap text-[11px]">{ck}</TableHead>
            ))}
            <TableHead className="sticky right-0 z-30 bg-slate-100/95 text-right text-[11px] font-bold backdrop-blur dark:bg-slate-800/95">
              {t("Total", "Total")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pivot.rowKeys.map((rk) => {
            const rowTotal = pivot.colKeys.reduce((a, ck) => {
              const v = pivot.cells[rk]?.[ck];
              return a + (typeof v === "number" ? v : 0);
            }, 0);
            return (
              <TableRow key={rk} className="text-[12px]">
                <TableCell className="sticky left-0 z-10 min-w-[160px] bg-white font-semibold dark:bg-slate-900">
                  {rk}
                </TableCell>
                {pivot.colKeys.map((ck) => {
                  const v = pivot.cells[rk]?.[ck] ?? null;
                  return (
                    <TableCell key={ck} className={cn("text-right tabular-nums", v == null && "text-slate-300 dark:text-slate-600")}>
                      {pivot.masked && v == null
                        ? <span className="tracking-widest">•••</span>
                        : v == null
                          ? "—"
                          : new Intl.NumberFormat("id-ID").format(v)}
                    </TableCell>
                  );
                })}
                <TableCell className="sticky right-0 z-10 bg-slate-50 text-right font-bold tabular-nums dark:bg-slate-800/60">
                  {pivot.masked ? <span className="tracking-widest">•••</span> : new Intl.NumberFormat("id-ID").format(rowTotal)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="border-t border-slate-200 px-3 py-2 text-[10px] text-slate-400 dark:border-slate-800">
        {valueLabel} · {t("{r} baris × {c} kolom", "{r} rows × {c} columns", { r: pivot.rowKeys.length, c: pivot.colKeys.length })}
      </p>
    </div>
  );
}
