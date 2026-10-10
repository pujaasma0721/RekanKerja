"use client";
// RekanKerja Medical — Saldo Medis Karyawan: daftar per karyawan × jenis +
// generate per tahun (padanan Employee Medical Information +
// GenerateMedicalBenefitInfo.jsp).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
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
import { HeartPulse, RefreshCw, Search, Wallet, PencilLine } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, num, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";

/** Task adv-search — field Advance Search saldo medis karyawan (filter
 *  client-side TAMBAHAN di atas query & filter jenis). */
const BALANCE_ADV_FIELDS: AdvFieldDef<BalanceUI>[] = [
  txt("employeeNo", "No. Karyawan", "Employee No."),
  txt("fullName", "Nama Karyawan", "Employee Name"),
  txt("orgUnitName", "Unit Organisasi", "Org Unit"),
  txt("typeCode", "Kode Jenis", "Type Code"),
  txt("typeName", "Jenis", "Type"),
  num("year", "Tahun", "Year"),
  num("baseSalary", "Gaji Pokok", "Base Salary"),
  num("benefitAmount", "Limit", "Limit"),
  num("usedAmount", "Terpakai", "Used"),
  num("remaining", "Sisa", "Remaining"),
];

export function MedicalInfoPage() {
  const { t } = useI18n();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  // Task adv-search — kondisi advance search (filter tambahan di atas query).
  const [adv, setAdv] = useState<AdvSearch | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [genYear, setGenYear] = useState(String(currentYear + 1));
  const [genType, setGenType] = useState("all");
  const [genCorrection, setGenCorrection] = useState(false);
  // W3-2 (fix G-10): input migrasi saldo awal eksplisit (pad oranHR
  // InitialMedicalBenefit.jsp) — initialUsed per baris saldo.
  const [migOpen, setMigOpen] = useState(false);
  const [migTarget, setMigTarget] = useState<{ employeeId: string; typeId: string; year: number; label: string; current: number } | null>(null);
  const [migValue, setMigValue] = useState("");
  const [migBusy, setMigBusy] = useState(false);

  const api = useApi<{ balances: BalanceUI[]; types: BenefitTypeUI[]; employees: EmployeeOption[]; years: number[] }>(
    `/api/rekankerja/medical/balances?year=${year}`,
  );

  const balances = useMemo(() => filterRowsByAdv((api.data?.balances ?? []).filter((b) => {
    if (typeFilter !== "all" && b.typeCode !== typeFilter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return b.fullName.toLowerCase().includes(q) || b.employeeNo.toLowerCase().includes(q);
  }), adv, BALANCE_ADV_FIELDS), [api.data, typeFilter, query, adv]);

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

  // W3-2 (fix G-10): buka dialog migrasi utk satu baris saldo.
  const openMig = (b: BalanceUI) => {
    const tId = types.find((x) => x.code === b.typeCode)?.id ?? "";
    setMigTarget({ employeeId: b.employeeId, typeId: tId, year: b.year, label: `${b.fullName} — ${b.typeName} ${b.year}`, current: b.initialUsed });
    setMigValue(b.initialUsed > 0 ? String(b.initialUsed) : "");
    setMigOpen(true);
  };

  const saveMigration = async () => {
    if (!migTarget) return;
    if (!migTarget.typeId) { toast.error(t("Jenis benefit tidak dikenali", "Unknown benefit type")); return; }
    setMigBusy(true);
    try {
      const res = await apiSend<{ ok: boolean; remaining: number }>(
        "/api/rekankerja/medical/balances", "PATCH",
        { employeeId: migTarget.employeeId, typeId: migTarget.typeId, year: migTarget.year, initialUsed: Number(migValue) || 0 },
      );
      toast.success(t("Migrasi saldo awal tersimpan — sisa {r}", "Initial balance migration saved — remaining {r}", { r: fmtIDR(res.remaining) }));
      setMigOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan migrasi", "Failed to save migration"));
    } finally {
      setMigBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ year: number; employees: number; created: number; updated: number }>(
        "/api/rekankerja/medical/balances", "POST",
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
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan…", "Search employees…")} className="pl-8" />
          </div>
          <AdvSearchButton fields={BALANCE_ADV_FIELDS} value={adv} onChange={setAdv} />
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Total Limit", "Total Limit")}</p>
            <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{fmtIDR(totals.limit)}</p>
            <p className="mt-1 text-xs text-slate-500">{t("{n} baris saldo", "{n} balance rows", { n: balances.length })}{typeFilter !== "all" ? ` · ${typeFilter}` : ""}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Terpakai", "Used")}</p>
            <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{fmtIDR(totals.used)}</p>
            <p className="mt-1 text-xs text-slate-500">{t("klaim settled + initial dibawa", "settled claims + initial carried over")}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Sisa", "Remaining")}</p>
            <p className="mt-1 text-2xl font-black ov-text-accent">{fmtIDR(totals.remaining)}</p>
            <p className="mt-1 text-xs text-slate-500">{t("jenis CASH ditarik tunai akhir tahun", "CASH types are cashed out at year-end")}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
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
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead>{t("Karyawan")}</TableHead>
                    <TableHead>{t("Jenis")}</TableHead>
                    <TableHead className="text-right">{t("Limit", "Limit")}</TableHead>
                    <TableHead className="text-right">{t("Saldo Awal (Migrasi)", "Initial (Migration)")}</TableHead>
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
                        <p className="text-xs text-slate-500">{b.employeeNo}{b.orgUnitName ? ` · ${b.orgUnitName}` : ""}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{b.typeName}</p>
                        <p className="text-xs text-slate-500">
                          {t(LIMIT_RULE_LABEL[b.limitRule] ?? b.limitRule, LIMIT_RULE_LABEL_EN[b.limitRule])}{b.limitRule === "FACTOR" ? t(" × gaji {s}", " × salary {s}", { s: fmtIDR(b.baseSalary) }) : ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">{b.limitRule === "UNLIMITED" ? "∞" : fmtIDR(b.benefitAmount)}</TableCell>
                      {/* W3-2 (fix G-10): nilai migrasi + tombol input eksplisit */}
                      <TableCell className="text-right">
                        <span className="inline-flex items-center justify-end gap-1">
                          {b.initialUsed > 0 ? fmtIDR(b.initialUsed) : "—"}
                          <button
                            type="button"
                            onClick={() => openMig(b)}
                            title={t("Input migrasi saldo awal", "Enter initial balance migration")}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800"
                          >
                            <PencilLine className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </TableCell>
                      <TableCell className={cn("text-right", b.adjustmentAmount !== 0 && "text-brand dark:text-brand/85")}>
                        {b.adjustmentAmount !== 0 ? `${b.adjustmentAmount > 0 ? "+" : ""}${fmtIDR(b.adjustmentAmount)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtIDR(b.usedAmount)}
                        {b.initialUsed > 0 && <span className="block text-xs text-slate-400">+ {fmtIDR(b.initialUsed)} {t("dibawa", "carried over")}</span>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{b.limitRule === "UNLIMITED" ? "∞" : fmtIDR(b.remaining)}</TableCell>
                      <TableCell className="text-right text-slate-500">{b.depBenefitAmount > 0 ? fmtIDR(b.depRemaining) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* W3-2 (fix G-10): dialog migrasi saldo awal eksplisit */}
      <Dialog open={migOpen} onOpenChange={setMigOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PencilLine className="h-5 w-5 ov-text-accent" /> {t("Migrasi Saldo Awal", "Initial Balance Migration")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Padanan InitialMedicalBenefit.jsp: isi pemakaian medis karyawan SEBELUM sistem berjalan — sisa plafon langsung berkurang. Kosongkan/0 bila tidak ada.", "Equivalent to InitialMedicalBenefit.jsp: enter the employee's pre-system medical usage — remaining balance is reduced immediately. Leave empty/0 if none.")}
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Baris Saldo", "Balance Row")}</Label>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold dark:bg-slate-800/60">{migTarget?.label ?? "—"}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Terpakai sebelum sistem (Rp)", "Pre-system used (Rp)")}</Label>
              <Input type="number" min={0} value={migValue} onChange={(e) => setMigValue(e.target.value)} placeholder="0" />
              {migTarget && migTarget.current > 0 && (
                <p className="text-xs text-slate-500">{t("Nilai saat ini: {n}", "Current value: {n}", { n: fmtIDR(migTarget.current) })}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMigOpen(false)}>{t("Batal")}</Button>
            <Button onClick={saveMigration} disabled={migBusy}>
              {migBusy ? t("Menyimpan…", "Saving…") : t("Simpan Migrasi", "Save Migration")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog generate */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 ov-text-accent" /> {t("Generate Saldo Medis", "Generate Medical Balances")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
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
              {t("Koreksi Limit Benefit — ", "Benefit Limit Correction — ")}{t("tulis ulang limit existing", "overwrite existing limits")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>{t("Batal")}</Button>
            <Button onClick={generate} disabled={busy}>
              {busy ? t("Menggenerate…", "Generating…") : t("Proses", "Process")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
