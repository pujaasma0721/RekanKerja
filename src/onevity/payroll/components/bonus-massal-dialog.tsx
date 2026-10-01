"use client";
// OneVity Payroll — Dialog Bonus / THR Massal (T19)
// =====================================================================
// Buka dari halaman Proses & Hasil (koordinator wire): pilih period × jenis
// proses (BONUS/THR) × komponen pendapatan Irregular → target karyawan
// (semua / unit organisasi + turunannya / status kepegawaian / pilih manual)
// → mode nominal atau % gaji pokok (+ prorata masa kerja tahun berjalan utk
// THR PMK 168) → PREVIEW (dryRun: daftar + jumlah + total + estimasi pajak
// ireguler ringan) → KOMIT (assignment Specific + run dihitung otomatis).
// Guard server: payroll:runs op:calculate.
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi, apiSend, initials, avatarColor, fmtIDR } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import type { PeriodRow, ProcessTypeRow, WageCompFull } from "@/onevity/payroll/components/payroll-types";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Coins, Loader2, Calculator, PartyPopper, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmpOpt {
  id: string;
  employeeNo: string;
  fullName: string;
  position: { title: string; code: string } | null;
  orgUnit: { name: string; code: string } | null;
  baseSalary: number;
  employmentStatus: string;
}

interface PreviewRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  orgUnitName: string | null;
  positionName: string | null;
  joinDate: string;
  baseSalary: number;
  prorateFactor: number;
  amount: number;
  taxStatus: string;
}

interface BonusMassalPreview {
  preview: boolean;
  period: { code: string; name: string };
  processType: { code: string; name: string };
  component: { code: string; name: string };
  amountMode: "nominal" | "percent-salary";
  amount?: number;
  percent?: number;
  prorateJoin: boolean;
  count: number;
  employees: PreviewRow[];
  total: number;
  taxEstimate: { perEmployee: Record<string, number>; total: number } | null;
}

interface BonusMassalCommit extends BonusMassalPreview {
  created: number;
  createdAssignments: { id: string; employeeId: string; amount: number }[];
  skipped: { employeeNo: string; fullName: string }[];
  run: { id: string; runNo: string; status: string; employeeCount: number; totalBruto: number; totalTax: number; totalNet: number } | null;
  calculated: boolean;
}

const EMP_STATUSES = ["Permanent", "Contract", "Probation", "Outsourcing"];

type TargetMode = "all" | "unit" | "status" | "custom";

export function BonusMassalDialog({
  open,
  onOpenChange,
  onCommitted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** dipanggil setelah komit sukses (refresh daftar run/period) */
  onCommitted?: (res: BonusMassalCommit) => void;
}) {
  const { t } = useI18n();
  const periodsApi = useApi<{ periods: PeriodRow[] }>(open ? "/api/onevity/payroll-periods" : null);
  const typesApi = useApi<{ processTypes: ProcessTypeRow[] }>(open ? "/api/onevity/process-types" : null);
  const compsApi = useApi<{ components: WageCompFull[] }>(open ? "/api/onevity/wage-components?type=Earning" : null);
  const unitsApi = useApi<{ orgUnits: { id: string; code: string; name: string }[] }>(open ? "/api/onevity/employee-options" : null);

  const [periodId, setPeriodId] = useState("");
  const [processTypeId, setProcessTypeId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [targetMode, setTargetMode] = useState<TargetMode>("all");
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [empStatus, setEmpStatus] = useState("Permanent");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [amountMode, setAmountMode] = useState<"nominal" | "percent-salary">("nominal");
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState("");
  const [prorateJoin, setProrateJoin] = useState(false);

  const [preview, setPreview] = useState<BonusMassalPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [empOpen, setEmpOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // dimuat hanya saat mode pilih manual (URL berganti → useApi fetch ulang)
  const employeesApi = useApi<{ employees: EmpOpt[]; total: number }>(open && targetMode === "custom" ? "/api/onevity/employees?limit=200&status=Active" : null);

  const openPeriods = (periodsApi.data?.periods ?? []).filter((p) => p.status !== "Closed" && p.status !== "Locked");
  const bonusTypes = (typesApi.data?.processTypes ?? []).filter((p) => p.code === "BONUS" || p.code === "THR");
  const irregularComps = (compsApi.data?.components ?? []).filter((c) => c.incomeTaxMethod === "Irregular" && c.active);
  const units = useMemo(() => (unitsApi.data?.orgUnits ?? []).slice().sort((a, b) => a.code.localeCompare(b.code)), [unitsApi.data]);
  const employees = employeesApi.data?.employees ?? [];
  const selectedEmployees = employees.filter((e) => employeeIds.includes(e.id));

  const missing =
    !periodId || !processTypeId || !componentId ||
    (targetMode === "unit" && unitIds.length === 0) ||
    (targetMode === "custom" && employeeIds.length === 0) ||
    (amountMode === "nominal" && !(Number(amount) > 0)) ||
    (amountMode === "percent-salary" && !(Number(percent) > 0 && Number(percent) <= 100));

  const reset = () => {
    setPeriodId(""); setProcessTypeId(""); setComponentId("");
    setTargetMode("all"); setUnitIds([]); setEmployeeIds([]); setEmpStatus("Permanent");
    setAmountMode("nominal"); setAmount(""); setPercent(""); setProrateJoin(false);
    setPreview(null); setConfirming(false); setEmpOpen(false);
  };

  const body = (dryRun: boolean) => ({
    periodId,
    processTypeId,
    wageComponentId: componentId,
    target: {
      mode: targetMode,
      ...(targetMode === "unit" ? { unitIds } : {}),
      ...(targetMode === "status" ? { status: empStatus } : {}),
      ...(targetMode === "custom" ? { employeeIds } : {}),
    },
    amountMode,
    ...(amountMode === "nominal" ? { amount: Number(amount) } : { percent: Number(percent) }),
    prorateJoin,
    dryRun,
  });

  const doPreview = async () => {
    if (missing) return;
    setBusy("preview");
    setPreview(null);
    try {
      const res = await apiSend<BonusMassalPreview>("/api/onevity/payroll-bonus-massal", "POST", body(true));
      setPreview(res);
    } catch (e) {
      toast.error(t("Preview gagal", "Preview failed"), { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const doCommit = async () => {
    if (missing) return;
    setBusy("commit");
    try {
      const res = await apiSend<BonusMassalCommit>("/api/onevity/payroll-bonus-massal", "POST", body(false));
      toast.success(
        t("Bonus massal dikomit — {n} karyawan, total {v}", "Mass bonus committed — {n} employees, total {v}", { n: res.created, v: fmtIDR(res.total) }),
        {
          description: res.run
            ? t(
                `Run ${res.run.runNo} ${res.calculated ? "dihitung otomatis" : "tersedia (Draft)"} · ${res.run.employeeCount} karyawan · THP ${fmtIDR(res.run.totalNet)}${res.skipped.length ? ` · ${res.skipped.length} dilewati (assignment sudah ada)` : ""}`,
                `Run ${res.run.runNo} ${res.calculated ? "calculated automatically" : "available (Draft)"} · ${res.run.employeeCount} employees · net ${fmtIDR(res.run.totalNet)}${res.skipped.length ? ` · ${res.skipped.length} skipped (assignment already exists)` : ""}`,
              )
            : undefined,
        },
      );
      onCommitted?.(res);
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(t("Komit gagal", "Commit failed"), { description: (e as Error).message });
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  const toggleUnit = (id: string) =>
    setUnitIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleEmployee = (id: string) =>
    setEmployeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const period = openPeriods.find((p) => p.id === periodId);
  const procType = bonusTypes.find((p) => p.id === processTypeId);
  const comp = irregularComps.find((c) => c.id === componentId);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl ov-fill ov-glow">
              <PartyPopper className="h-5 w-5" />
            </span>
            {t("Bonus / THR Massal", "Mass Bonus / THR")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Jadwalkan komponen pendapatan iregular untuk banyak karyawan sekaligus — komponen dibuat sebagai assignment Specific pada period × jenis proses, lalu dihitung dalam run payroll.",
              "Schedule an irregular income component for many employees at once — components are created as Specific assignments on the period × process type, then calculated in a payroll run.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* period */}
          <div className="space-y-2">
            <Label>{t("Period Payroll", "Payroll Period")} <span className="text-rose-500">*</span></Label>
            <Select value={periodId} onValueChange={(v) => { setPeriodId(v); setPreview(null); }}>
              <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Pilih period terbuka", "Select an open period")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {openPeriods.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">{t("Tidak ada period terbuka", "No open periods")}</p>}
                {openPeriods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} <Badge variant="outline" className="ml-1.5 h-4 rounded px-1.5 text-[9px] font-bold text-slate-400">{p.status}</Badge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* process type */}
          <div className="space-y-2">
            <Label>{t("Jenis Proses", "Process Type")} <span className="text-rose-500">*</span></Label>
            <Select value={processTypeId} onValueChange={(v) => { setProcessTypeId(v); setPreview(null); }}>
              <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("BONUS / THR", "BONUS / THR")} /></SelectTrigger>
              <SelectContent>
                {bonusTypes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} <span className="ml-1 font-mono text-[10px] text-slate-400">{p.code}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* wage component */}
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("Komponen Pendapatan (Iregular)", "Income Component (Irregular)")} <span className="text-rose-500">*</span></Label>
            <Select value={componentId} onValueChange={(v) => { setComponentId(v); setPreview(null); }}>
              <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Pilih komponen pendapatan pajak ireguler", "Select an irregular-tax income component")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {irregularComps.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="font-mono text-xs text-slate-400">{c.code}</span> · {c.name}
                    <Badge variant="outline" className="ml-1.5 h-4 rounded px-1.5 text-[9px] font-bold text-brand dark:text-brand/85">Iregular</Badge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {comp && (
              <p className="text-[11px] text-slate-400">
                {t("Pajak dihitung engine payroll (PMK 168/2023 — jalur suplemental dengan konteks YTD).", "Tax computed by the payroll engine (PMK 168/2023 — supplemental path with YTD context).")}
              </p>
            )}
          </div>

          {/* target mode */}
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("Target Karyawan", "Employee Target")} <span className="text-rose-500">*</span></Label>
            <RadioGroup value={targetMode} onValueChange={(v) => { setTargetMode(v as TargetMode); setPreview(null); }} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["all", t("Semua Karyawan", "All Employees")],
                ["unit", t("Unit Organisasi", "Org Unit")],
                ["status", t("Status Kepegawaian", "Employment Status")],
                ["custom", t("Pilih Manual", "Manual Selection")],
              ] as [TargetMode, string][]).map(([v, label]) => (
                <label
                  key={v}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors",
                    targetMode === v
                      ? "border-slate-400 bg-slate-100 dark:border-slate-500 dark:bg-slate-800"
                      : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60",
                  )}
                >
                  <RadioGroupItem value={v} className="h-3.5 w-3.5" />
                  {label}
                </label>
              ))}
            </RadioGroup>
          </div>

          {/* target: unit */}
          {targetMode === "unit" && (
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("Unit (termasuk turunannya)", "Units (including descendants)")} <span className="text-rose-500">*</span></Label>
              <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2.5 dark:border-slate-800 sm:grid-cols-2">
                {units.map((u) => (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <Checkbox checked={unitIds.includes(u.id)} onCheckedChange={() => toggleUnit(u.id)} className="h-3.5 w-3.5" />
                    <span className="font-mono text-[10px] text-slate-400">{u.code}</span>
                    <span className="truncate">{u.name}</span>
                  </label>
                ))}
              </div>
              {unitIds.length > 0 && (
                <p className="text-[11px] font-bold text-slate-400">{t("{n} unit dipilih — karyawan aktif di unit ini & seluruh turunannya", "{n} units selected — active employees in these units & all descendants", { n: unitIds.length })}</p>
              )}
            </div>
          )}

          {/* target: status */}
          {targetMode === "status" && (
            <div className="space-y-2">
              <Label>{t("Status Kepegawaian", "Employment Status")} <span className="text-rose-500">*</span></Label>
              <Select value={empStatus} onValueChange={setEmpStatus}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* target: custom */}
          {targetMode === "custom" && (
            <div className="space-y-2 sm:col-span-2">
              <Label>{t("Karyawan", "Employees")} <span className="text-rose-500">*</span></Label>
              <Popover open={empOpen} onOpenChange={setEmpOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={empOpen} className="h-11 w-full justify-between font-normal">
                    {selectedEmployees.length > 0
                      ? <span className="flex items-center gap-2 truncate"><Users className="h-4 w-4 text-slate-400" />{t("{n} karyawan dipilih", "{n} employees selected", { n: selectedEmployees.length })}</span>
                      : <span className="text-slate-400">{t("Cari dan pilih karyawan…", "Search and select employees…")}</span>}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter>
                    <CommandInput placeholder={t("Ketik nama atau nomor karyawan…", "Type an employee name or number…")} />
                    <CommandList className="max-h-64">
                      <CommandEmpty>{t("Tidak ditemukan.", "No results found.")}</CommandEmpty>
                      <CommandGroup>
                        {employees.map((e) => (
                          <CommandItem
                            key={e.id}
                            value={`${e.fullName} ${e.employeeNo}`}
                            onSelect={() => toggleEmployee(e.id)}
                            className="gap-2.5"
                          >
                            <Checkbox checked={employeeIds.includes(e.id)} onCheckedChange={() => toggleEmployee(e.id)} className="h-3.5 w-3.5" />
                            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold", avatarColor(e.fullName))}>{initials(e.fullName)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold">{e.fullName}</span>
                              <span className="block truncate text-[11px] text-slate-400">{e.employeeNo} · {e.position?.title ?? "—"}</span>
                            </span>
                            {employeeIds.includes(e.id) && <Check className="h-4 w-4 ov-text-accent" />}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* amount mode */}
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("Mode Jumlah", "Amount Mode")} <span className="text-rose-500">*</span></Label>
            <RadioGroup value={amountMode} onValueChange={(v) => { setAmountMode(v as "nominal" | "percent-salary"); setPreview(null); }} className="grid grid-cols-2 gap-2">
              <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors", amountMode === "nominal" ? "border-slate-400 bg-slate-100 dark:border-slate-500 dark:bg-slate-800" : "border-slate-200 dark:border-slate-800")}>
                <RadioGroupItem value="nominal" className="h-3.5 w-3.5" />
                {t("Nominal (Rp per karyawan)", "Fixed Amount (Rp per employee)")}
              </label>
              <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors", amountMode === "percent-salary" ? "border-slate-400 bg-slate-100 dark:border-slate-500 dark:bg-slate-800" : "border-slate-200 dark:border-slate-800")}>
                <RadioGroupItem value="percent-salary" className="h-3.5 w-3.5" />
                {t("% Gaji Pokok", "% of Base Salary")}
              </label>
            </RadioGroup>
          </div>

          {amountMode === "nominal" ? (
            <div className="space-y-2">
              <Label>{t("Nominal per Karyawan", "Amount per Employee")} <span className="text-rose-500">*</span></Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">Rp</span>
                <Input type="number" min={0} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="h-11 pl-9" />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>{t("Persentase Gaji Pokok", "Percentage of Base Salary")} <span className="text-rose-500">*</span></Label>
              <div className="relative">
                <Input type="number" min={0} max={100} step="0.5" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="0" className="h-11 pr-8" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">%</span>
              </div>
            </div>
          )}

          {/* prorate */}
          <div className="flex items-end pb-1.5">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
              <Checkbox checked={prorateJoin} onCheckedChange={(v) => { setProrateJoin(v === true); setPreview(null); }} className="mt-0.5 h-4 w-4" />
              <span className="text-xs leading-relaxed">
                <span className="font-bold">{t("Prorata masa kerja tahun berjalan", "Prorate current-year tenure")}</span>
                <span className="block text-[10px] text-slate-400">{t("Bulan kerja/12 × nominal (THR — PMK 168/2023, karyawan baru)", "Months worked/12 × amount (THR — PMK 168/2023, new hires)")}</span>
              </span>
            </label>
          </div>
        </div>

        {/* ===== preview table ===== */}
        {preview && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-2.5 text-[11px] dark:border-slate-800 dark:bg-slate-900/40">
              <span className="flex items-center gap-2 font-bold text-slate-500">
                <Coins className="h-3.5 w-3.5" />
                {preview.period.name} × {preview.processType.code} · {preview.component.code}
              </span>
              <span>
                {t("{n} karyawan · total", "{n} employees · total", { n: preview.count })}{" "}
                <b className="text-sm text-slate-800 dark:text-slate-100">{fmtIDR(preview.total)}</b>
                {preview.taxEstimate && (
                  <span className="text-slate-400"> · {t("est. PPh21 ireguler", "est. irregular income tax")} <b className="text-brand dark:text-brand/85">{fmtIDR(preview.taxEstimate.total)}</b></span>
                )}
              </span>
            </div>
            <div className="max-h-56 overflow-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[10px] font-bold">{t("Karyawan", "Employee")}</TableHead>
                    <TableHead className="text-[10px] font-bold">{t("Unit", "Unit")}</TableHead>
                    <TableHead className="text-right text-[10px] font-bold">{t("Gaji Pokok", "Base Salary")}</TableHead>
                    {prorateJoin && <TableHead className="text-right text-[10px] font-bold">{t("Prorata", "Prorate")}</TableHead>}
                    <TableHead className="text-right text-[10px] font-bold">{t("Jumlah", "Amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.employees.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="py-2 text-xs">
                        <span className="block font-semibold">{r.fullName}</span>
                        <span className="block font-mono text-[10px] text-slate-400">{r.employeeNo}</span>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate py-2 text-xs text-slate-500">{r.orgUnitName ?? "—"}</TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums text-slate-500">{fmtIDR(r.baseSalary)}</TableCell>
                      {prorateJoin && <TableCell className="py-2 text-right text-xs tabular-nums text-slate-500">{(r.prorateFactor * 100).toFixed(0)}%</TableCell>}
                      <TableCell className="py-2 text-right text-xs font-bold tabular-nums">{fmtIDR(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              {t(
                "Estimasi pajak ringan = PMK 168/2023 disetahunkan dari gaji profil saat ini (bruto + bonus − PTKP − biaya jabatan). Angka final dihitung engine payroll saat run di-Hitung — memakai konteks YTD run gaji nyata.",
                "Light tax estimate = PMK 168/2023 annualized from the current profile salary (gross + bonus − PTKP − occupational deduction). Final figures are computed by the payroll engine when the run is calculated — using real salary-run YTD context.",
              )}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null} className="h-11 px-5">{t("Batal")}</Button>
          <Button variant="outline" onClick={() => void doPreview()} disabled={missing || busy !== null} className="h-11 gap-2 px-5 font-bold">
            {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            {t("Pratinjau", "Preview")}
          </Button>
          <Button onClick={() => setConfirming(true)} disabled={missing || busy !== null || !preview} className="h-11 gap-2 px-6 font-bold">
            {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PartyPopper className="h-4 w-4" />}
            {t("Komit Bonus Massal", "Commit Mass Bonus")}
          </Button>
        </DialogFooter>

        {/* konfirmasi komit */}
        {confirming && (
          <div className="rounded-xl border border-brand/40 bg-brand/10/80 p-4 dark:border-brand/40 dark:bg-brand/10">
            <p className="text-sm font-bold text-brand-deep dark:text-brand/75">
              {t("Komit bonus massal untuk {n} karyawan?", "Commit mass bonus for {n} employees?", { n: preview?.count ?? 0 })}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-brand-deep dark:text-brand/75">
              {t(
                `Total ${fmtIDR(preview?.total ?? 0)} akan dibuat sebagai assignment Specific pada ${period?.name ?? "-"} × ${procType?.code ?? "-"}${amountMode === "nominal" ? "" : ` (${percent}% gaji pokok)`}, lalu run dihitung otomatis. Karyawan yang sudah punya assignment akan dilewati.`,
                `Total ${fmtIDR(preview?.total ?? 0)} will be created as Specific assignments on ${period?.name ?? "-"} × ${procType?.code ?? "-"}${amountMode === "nominal" ? "" : ` (${percent}% of base salary)`}, then the run is calculated automatically. Employees with existing assignments are skipped.`,
              )}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy !== null} className="h-9 px-4">{t("Periksa Lagi", "Review Again")}</Button>
              <Button size="sm" onClick={() => void doCommit()} disabled={busy !== null} className="h-9 gap-2 bg-brand px-5 font-bold text-white hover:bg-brand/90">
                {busy === "commit" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("Ya, Komit", "Yes, Commit")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default BonusMassalDialog;
