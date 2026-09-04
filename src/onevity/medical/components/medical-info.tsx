"use client";
// OneVity Medical — Saldo Medis Karyawan: daftar per karyawan × jenis +
// generate per tahun (padanan Employee Medical Information +
// GenerateMedicalBenefitInfo.jsp).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  BalanceUI, BenefitTypeUI, EmployeeOption, LIMIT_RULE_LABEL, LIMIT_RULE_LABEL_EN,
  fmtIDR, fmtDateID,
} from "./medical-types";
import { HeartPulse, RefreshCw, Search, Wallet } from "lucide-react";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { cn } from "@/lib/utils";

export function MedicalInfoPage() {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [genOpen, setGenOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [genYear, setGenYear] = useState(String(currentYear + 1));
  const [genType, setGenType] = useState("all");
  const [genCorrection, setGenCorrection] = useState(false);

  const api = useApi<{ balances: BalanceUI[]; types: BenefitTypeUI[]; employees: EmployeeOption[]; years: number[] }>(
    `/api/onevity/medical/balances?year=${year}`,
  );

  const balances = useMemo(() => (api.data?.balances ?? []).filter((b) => {
    if (typeFilter !== "all" && b.typeCode !== typeFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return b.fullName.toLowerCase().includes(q) || b.employeeNo.toLowerCase().includes(q);
  }), [api.data, typeFilter, query]);

  const types = api.data?.types ?? [];
  const years = api.data?.years ?? [];

  const totals = useMemo(() => {
    const t = balances.reduce((acc, b) => ({
      limit: acc.limit + b.benefitAmount,
      used: acc.used + b.usedAmount,
      remaining: acc.remaining + b.remaining,
    }), { limit: 0, used: 0, remaining: 0 });
    return t;
  }, [balances]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ year: number; employees: number; created: number; updated: number }>(
        "/api/onevity/medical/balances", "POST",
        {
          year: Number(genYear),
          typeId: genType !== "all" ? genType : undefined,
          limitCorrection: genCorrection,
        },
      );
      toast.success(t("Generate {y}: {c} saldo baru, {u} dikoreksi ({e} karyawan)", "Generate {y}: {c} new balances, {u} corrected ({e} employees)", { y: res.year, c: res.created, u: res.updated, e: res.employees }));
      setGenOpen(false);
      setYear(genYear);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal generate saldo", "Failed to generate balances"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Medical · Saldo", "Medical · Balance")}
        title={t("Saldo Medis Karyawan")}
        description={t("Benefit limit per karyawan × jenis per tahun — dihitung dari kebijakan (faktor × gaji pokok / nominal), penyesuaian, dan pemakaian klaim settled (padanan Employee Medical Information)", "Benefit limit per employee × type per year — computed from policy (factor × base salary / nominal), adjustments, and settled claim usage (equivalent to Employee Medical Information)")}
        actions={(
          <Button onClick={() => setGenOpen(true)}>
            <RefreshCw className="h-4 w-4" /> {t("Generate Saldo", "Generate Balances")}
          </Button>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(years.length ? years : [currentYear]).map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder={t("Semua jenis", "All types")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua jenis", "All types")}</SelectItem>
            {types.map((t) => (
              <SelectItem key={t.id} value={t.code}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-stone-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan…", "Search employees…")} className="pl-8" />
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Total Limit</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{fmtIDR(totals.limit)}</p>
            <p className="mt-1 text-xs text-stone-500">{t("{n} baris saldo", "{n} balance rows", { n: balances.length })}{typeFilter !== "all" ? ` · ${typeFilter}` : ""}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{t("Terpakai", "Used")}</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{fmtIDR(totals.used)}</p>
            <p className="mt-1 text-xs text-stone-500">{t("klaim settled + initial dibawa", "settled claims + initial carried over")}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{t("Sisa", "Remaining")}</p>
            <p className="mt-1 text-2xl font-black ov-text-accent">{fmtIDR(totals.remaining)}</p>
            <p className="mt-1 text-xs text-stone-500">{t("jenis CASH ditarik tunai akhir tahun", "CASH types are cashed out at year-end")}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : balances.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={t("Belum ada saldo medis {y}", "No medical balances yet for {y}", { y: year })}
                description={t("Generate saldo per tahun — limit dihitung dari gaji pokok aktif (faktor) atau nominal per jenis.", "Generate balances per year — limits are computed from the active base salary (factor) or nominal per type.")}
                icon={HeartPulse}
              />
            </div>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                  <TableRow>
                    <TableHead>{t("Karyawan")}</TableHead>
                    <TableHead>{t("Jenis")}</TableHead>
                    <TableHead className="text-right">Limit</TableHead>
                    <TableHead className="text-right">{t("Penyesuaian", "Adjustment")}</TableHead>
                    <TableHead className="text-right">{t("Terpakai", "Used")}</TableHead>
                    <TableHead className="text-right">{t("Sisa", "Remaining")}</TableHead>
                    <TableHead className="text-right">{t("Sisa Dependent", "Dependent Remaining")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <p className="font-medium">{b.fullName}</p>
                        <p className="text-xs text-stone-500">{b.employeeNo}{b.orgUnitName ? ` · ${b.orgUnitName}` : ""}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{b.typeName}</p>
                        <p className="text-xs text-stone-500">
                          {t(LIMIT_RULE_LABEL[b.limitRule] ?? b.limitRule, LIMIT_RULE_LABEL_EN[b.limitRule])}{b.limitRule === "FACTOR" ? t(" × gaji {s}", " × salary {s}", { s: fmtIDR(b.baseSalary) }) : ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">{b.limitRule === "UNLIMITED" ? "∞" : fmtIDR(b.benefitAmount)}</TableCell>
                      <TableCell className={cn("text-right", b.adjustmentAmount !== 0 && "text-violet-600 dark:text-violet-400")}>
                        {b.adjustmentAmount !== 0 ? `${b.adjustmentAmount > 0 ? "+" : ""}${fmtIDR(b.adjustmentAmount)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtIDR(b.usedAmount)}
                        {b.initialUsed > 0 && <span className="block text-xs text-stone-400">+ {fmtIDR(b.initialUsed)} {t("dibawa", "carried over")}</span>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{b.limitRule === "UNLIMITED" ? "∞" : fmtIDR(b.remaining)}</TableCell>
                      <TableCell className="text-right text-stone-500">{b.depBenefitAmount > 0 ? fmtIDR(b.depRemaining) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* dialog generate */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 ov-text-accent" /> {t("Generate Saldo Medis", "Generate Medical Balances")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-600 dark:text-stone-300">
            {t("Padanan ", "Equivalent to ")}<span className="font-semibold">Generate Employee Medical Information</span>{t(" — membuat baris saldo karyawan aktif × jenis untuk tahun terpilih. Limit dihitung dari gaji pokok assignment aktif.", " — creates balance rows for active employees × types for the selected year. Limits are computed from the active assignment's base salary.")}
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Tahun *", "Year *")}</Label>
              <Input type="number" value={genYear} onChange={(e) => setGenYear(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Jenis Benefit")}</Label>
              <Select value={genType} onValueChange={setGenType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("Semua jenis aktif", "All active types")}</SelectItem>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={genCorrection} onCheckedChange={(v) => setGenCorrection(Boolean(v))} />
              Benefit Limit Correction — {t("tulis ulang limit existing", "overwrite existing limits")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>{t("Batal")}</Button>
            <Button onClick={generate} disabled={busy}>
              {busy ? t("Menggenerate…", "Generating…") : "Process"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
