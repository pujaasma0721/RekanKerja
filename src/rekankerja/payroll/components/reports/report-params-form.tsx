"use client";
// RekanKerja Payroll — FORM PARAMETER PER LAPORAN ==========================
// Dinamis dari PARAM_MATRIX: Select (run/period/tahun/bank/karyawan) + chips
// multi-pilih (unit kerja). Konvensi codebase: Radix SelectItem dilarang
// value="" → sentinel "all" (diterjemahkan kosong saat submit).
// Nilai default (run/period/tahun teratas, karyawan pertama) DIDERIVASI saat
// render — bukan setState dalam effect (aturan react-hooks/set-state-in-effect).
import { useMemo, useState } from "react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportDef } from "./catalog";
import { PARAM_MATRIX, type Pools, type EmployeeOpt } from "./params";

export type ParamValues = Record<string, string>;

export function ReportParamsForm({
  report, pools, onBack, onSubmit, submitting, error,
}: {
  report: ReportDef;
  pools: Pools | null;
  onBack: () => void;
  onSubmit: (values: ParamValues) => void;
  submitting: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const defs = PARAM_MATRIX[report.id];

  // ---- nilai eksplisit yang dipilih pengguna ----
  const [values, setValues] = useState<ParamValues>({});
  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));

  // pool karyawan mengikuti run (r11) atau tahun (r22)
  const employeeDeps = defs.find((d) => d.kind === "employee-by-run" || d.kind === "employee-by-year");
  const runId = values.run ?? pools?.runs[0]?.id ?? "";
  const periodId = values.period ?? pools?.periods[0]?.id ?? "";
  const year = values.year ?? (pools?.years[0] != null ? String(pools.years[0]) : "");
  const bank = values.bank ?? "all";
  const units = values.units ?? "";
  const empUrl = useMemo(() => {
    if (!employeeDeps || !pools) return null;
    if (employeeDeps.kind === "employee-by-run") return runId ? `/api/rekankerja/payroll-reports/documents?_params=employees&runId=${encodeURIComponent(runId)}` : null;
    return year ? `/api/rekankerja/payroll-reports/documents?_params=employees&year=${encodeURIComponent(year)}` : null;
  }, [employeeDeps, runId, year, pools]);
  const empApi = useApi<{ employees: EmployeeOpt[] }>(empUrl, [empUrl]);
  const empList = empApi.data?.employees ?? [];
  const employee = values.employee ?? (empList[0] ? (empList[0].lineId ?? empList[0].employeeId ?? "") : "");

  const effective: ParamValues = { run: runId, period: periodId, year, bank, units, employee };

  // validasi field wajib (pakai nilai efektif)
  const missing = defs.filter((d) => {
    if (!d.required) return false;
    if (d.kind === "run") return !effective.run;
    if (d.kind === "period") return !effective.period;
    if (d.kind === "year") return !effective.year;
    if (d.kind === "employee-by-run" || d.kind === "employee-by-year") return !effective.employee;
    return false;
  });
  const canSubmit = missing.length === 0 && !submitting;

  const selectedUnits = units.split(",").filter(Boolean);
  const toggleUnit = (name: string) => {
    const next = selectedUnits.includes(name)
      ? selectedUnits.filter((u) => u !== name)
      : [...selectedUnits, name];
    set("units", next.join(","));
  };

  const selCls = "h-9 w-full font-medium";

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2 text-muted-foreground" onClick={onBack}>
        <ChevronLeft className="mr-1 h-4 w-4" />
        {t("Kembali ke Katalog", "Back to Catalog")}
      </Button>

      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-start gap-4 border-b p-6">
          <div className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg",
            report.id.startsWith("r1") && "bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
            report.id.startsWith("r2") && "bg-rose-600/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
            report.id.startsWith("r3") && "bg-amber-600/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
            report.id.startsWith("r4") && "bg-teal-600/10 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400",
          )}>
            <report.icon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{report.no}</div>
            <h2 className="text-lg font-bold leading-tight">{t(report.titleId, report.titleEn)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t(report.descId, report.descEn)}</p>
          </div>
        </div>

        <div className="space-y-5 p-6">
          {!pools ? (
            <div className="space-y-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-9 w-1/2" />
            </div>
          ) : (
            <>
              {defs.map((d) => {
                const label = (
                  <Label className="text-[13px] font-semibold">
                    {t(d.labelId, d.labelEn)}
                    {d.required && <span className="ml-1 text-rose-600">*</span>}
                  </Label>
                );
                if (d.kind === "run") {
                  return (
                    <div key="run" className="space-y-1.5">
                      {label}
                      <Select value={runId || undefined} onValueChange={(v) => set("run", v)}>
                        <SelectTrigger className={selCls}><SelectValue placeholder={t("Pilih run…", "Select run…")} /></SelectTrigger>
                        <SelectContent>
                          {pools.runs.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.runNo} — {r.periodName} · {r.processTypeName} · {r.employeeCount} {t("kry.", "emp.")} ({r.status})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
                if (d.kind === "period") {
                  return (
                    <div key="period" className="space-y-1.5">
                      {label}
                      <Select value={periodId || undefined} onValueChange={(v) => set("period", v)}>
                        <SelectTrigger className={selCls}><SelectValue placeholder={t("Pilih periode…", "Select period…")} /></SelectTrigger>
                        <SelectContent>
                          {pools.periods.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} · {p.runCount} run final · {p.status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
                if (d.kind === "year") {
                  return (
                    <div key="year" className="space-y-1.5">
                      {label}
                      <Select value={year || undefined} onValueChange={(v) => set("year", v)}>
                        <SelectTrigger className={selCls}><SelectValue placeholder={t("Pilih tahun…", "Select year…")} /></SelectTrigger>
                        <SelectContent>
                          {pools.years.map((y) => (
                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
                if (d.kind === "bank") {
                  return (
                    <div key="bank" className="space-y-1.5">
                      {label}
                      <Select value={bank} onValueChange={(v) => set("bank", v)}>
                        <SelectTrigger className={selCls}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("Semua Bank", "All Banks")}</SelectItem>
                          {pools.banks.map((b) => (
                            <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
                if (d.kind === "employee-by-run" || d.kind === "employee-by-year") {
                  return (
                    <div key="employee" className="space-y-1.5">
                      {label}
                      {empApi.loading ? (
                        <Skeleton className="h-9 w-full" />
                      ) : empList.length === 0 ? (
                        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                          {t("Tidak ada karyawan pada sumber data terpilih.", "No employees for the selected source.")}
                        </p>
                      ) : (
                        <Select value={employee || undefined} onValueChange={(v) => set("employee", v)}>
                          <SelectTrigger className={selCls}><SelectValue placeholder={t("Pilih karyawan…", "Select employee…")} /></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {empList.map((e) => {
                              const v = e.lineId ?? e.employeeId ?? "";
                              return (
                                <SelectItem key={v} value={v}>
                                  {e.employeeNo} — {e.name}{e.unit ? ` · ${e.unit}` : ""}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  );
                }
                if (d.kind === "units") {
                  return (
                    <div key="units" className="space-y-1.5">
                      {label}
                      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2.5">
                        {pools.orgUnits.length === 0 && (
                          <span className="text-sm text-muted-foreground">{t("Tidak ada unit.", "No units.")}</span>
                        )}
                        {pools.orgUnits.map((u) => {
                          const on = selectedUnits.includes(u.name);
                          return (
                            <button
                              key={u.name}
                              type="button"
                              onClick={() => toggleUnit(u.name)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                                on
                                  ? "border-brand bg-brand text-white shadow-sm"
                                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                              )}
                            >
                              {u.name}
                            </button>
                          );
                        })}
                      </div>
                      {selectedUnits.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {t("{n} unit dipilih — laporan hanya mencakup karyawan unit tsb.", "{n} units selected — the report only covers employees of those units.", { n: String(selectedUnits.length) })}
                        </p>
                      )}
                    </div>
                  );
                }
                return null;
              })}

              {error && (
                <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                  {error}
                </div>
              )}

              <Button className="w-full" size="lg" disabled={!canSubmit} onClick={() => onSubmit(effective)}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                {submitting
                  ? t("Menyusun dokumen…", "Generating document…")
                  : t("Buat Dokumen Laporan", "Generate Report Document")}
              </Button>
              {missing.length > 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  {t("Lengkapi parameter wajib: {f}", "Fill in the required parameters: {f}", { f: missing.map((d) => t(d.labelId, d.labelEn)).join(", ") })}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
