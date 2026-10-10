"use client";
// RekanKerja Payroll — Komponen Upah: master komponen dgn klasifikasi standar industri
// (wageType 13-way, incomeTaxMethod, formula, prorata, iuran perusahaan)
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/rekankerja/shared/lib/api";
import { useTableSort } from "@/rekankerja/shared/lib/use-table-sort";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Coins, Plus, Pencil, Search, TrendingUp, TrendingDown, Info, Trash2, SlidersHorizontal } from "lucide-react";
import { WageCompFull, WAGE_TYPE_LABEL, WAGE_TYPE_LABEL_EN, TAX_METHOD_LABEL, TAX_METHOD_LABEL_EN, FORMULA_VARIABLES, FORMULA_VARIABLES_EN } from "@/rekankerja/payroll/components/payroll-types";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, num, sel, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";
import { ComponentRulesDialog } from "@/rekankerja/payroll/components/component-rules-dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

const WAGE_TYPE_OPTIONS = Object.entries(WAGE_TYPE_LABEL);
const TAX_METHOD_OPTIONS = Object.entries(TAX_METHOD_LABEL);

/** Task adv-search — opsi select dwibahasa dari peta label yang sudah ada. */
const WAGE_TYPE_ADV_OPTIONS: [string, string, string][] = Object.entries(WAGE_TYPE_LABEL).map(
  ([v, l]) => [v, l, WAGE_TYPE_LABEL_EN[v] ?? v],
);
const TAX_METHOD_ADV_OPTIONS: [string, string, string][] = Object.entries(TAX_METHOD_LABEL).map(
  ([v, l]) => [v, l, TAX_METHOD_LABEL_EN[v] ?? v],
);

/** Task adv-search — field Advance Search komponen upah (client-side, filter
 *  TAMBAHAN di atas filter tipe & query server yang sudah ada). */
const ADV_FIELDS: AdvFieldDef<WageCompFull>[] = [
  txt("code", "Kode", "Code"),
  txt("name", "Nama Komponen", "Component Name"),
  sel("type", "Kategori", "Category", [
    ["Earning", "Earning", "Earning"],
    ["Deduction", "Deduction", "Deduction"],
    ["Informational", "Informational", "Informational"],
  ]),
  sel("wageType", "Jenis Upah", "Wage Type", WAGE_TYPE_ADV_OPTIONS),
  sel("calcMethod", "Metode Kalkulasi", "Calculation Method", [
    ["Fixed", "Fixed (nilai tetap)", "Fixed (fixed value)"],
    ["Formula", "Formula (ekspresi)", "Formula (expression)"],
    ["Tax", "Dihitung engine", "Engine-calculated"],
  ]),
  num("amount", "Nilai Tetap", "Fixed Amount"),
  txt("formula", "Formula", "Formula", (c) => c.formula),
  sel("incomeTaxMethod", "Metode Pajak", "Tax Method", TAX_METHOD_ADV_OPTIONS),
  num("ruleCount", "Aturan", "Rules"),
  sel("includeInTHP", "Masuk THP", "Include in THP", [
    ["true", "Ya", "Yes"],
    ["false", "Tidak", "No"],
  ], (c) => String(c.includeInTHP)),
  sel("active", "Aktif", "Active", [
    ["true", "Aktif", "Active"],
    ["false", "Nonaktif", "Inactive"],
  ], (c) => String(c.active)),
];

export function WageComponentsPage() {
  const { t } = useI18n();
  const [typeFilter, setTypeFilter] = useState("all");
  const [q, setQ] = useState("");
  // Task adv-search — kondisi advance search (filter tambahan di atas filter server).
  const [adv, setAdv] = useState<AdvSearch | null>(null);
  const url = `/api/rekankerja/wage-components${typeFilter !== "all" || q ? `?${new URLSearchParams({ ...(typeFilter !== "all" ? { type: typeFilter } : {}), ...(q ? { q } : {}) }).toString()}` : ""}`;
  const { data, loading, refresh } = useApi<{ components: WageCompFull[]; typeCounts: Record<string, number> }>(url);

  // Task adv-search — filter tambahan client-side di atas hasil query/tipe server.
  const components = useMemo(() => filterRowsByAdv(data?.components ?? [], adv, ADV_FIELDS), [data, adv]);

  // Task 72 — sorting kolom tabel komponen upah
  const sort = useTableSort(components, {
    code: (c) => c.code,
    name: (c) => c.name,
    type: (c) => c.type,
    value: (c) => c.calcMethod === "Formula" ? 0 : c.amount,
    tax: (c) => c.incomeTaxMethod,
    rules: (c) => c.ruleCount ?? 0,
    thp: (c) => (c.includeInTHP ? 0 : 1),
    active: (c) => (c.active ? 0 : 1),
  }, { defaultKey: "code", defaultDir: "asc" });
  const [dialog, setDialog] = useState<{ open: boolean; comp: WageCompFull | null }>({ open: false, comp: null });
  const [rulesDialog, setRulesDialog] = useState<{ open: boolean; comp: WageCompFull | null }>({ open: false, comp: null });

  const counts = data?.typeCounts ?? {};

  const toggleActive = async (c: WageCompFull) => {
    try {
      await apiSend("/api/rekankerja/wage-components", "PATCH", { id: c.id, active: !c.active });
      toast.success(t("{name} {v}", "{name} {v}", { name: c.name, v: c.active ? t("dinon-aktifkan", "deactivated") : t("diaktifkan", "activated") }));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const remove = async (c: WageCompFull) => {
    if (!window.confirm(t("Hapus komponen {name}?", "Delete component {name}?", { name: c.name }))) return;
    try {
      await apiSend(`/api/rekankerja/wage-components?id=${c.id}`, "DELETE");
      toast.success(t("{name} dihapus", "{name} deleted", { name: c.name }));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Komponen Upah")}
        description={t("Master komponen dengan klasifikasi upah, metode pajak, formula, dan aturan iuran — jantung perhitungan payroll", "Component master with wage classification, tax method, formula, and contribution rules — the heart of payroll calculation")}
        actions={
          <Button onClick={() => setDialog({ open: true, comp: null })} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Komponen Baru", "New Component")}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <TypeCard label="Earning" value={counts.Earning ?? 0} icon={TrendingUp} tone="emerald" active={typeFilter === "Earning"} onClick={() => setTypeFilter(typeFilter === "Earning" ? "all" : "Earning")} />
        <TypeCard label="Deduction" value={counts.Deduction ?? 0} icon={TrendingDown} tone="rose" active={typeFilter === "Deduction"} onClick={() => setTypeFilter(typeFilter === "Deduction" ? "all" : "Deduction")} />
        <TypeCard label="Informational" value={counts.Informational ?? 0} icon={Info} tone="stone" active={typeFilter === "Informational"} onClick={() => setTypeFilter(typeFilter === "Informational" ? "all" : "Informational")} />
      </div>

      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cari komponen upah…", "Search wage components…")} className="pl-9" />
            </div>
            <AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={setAdv} className="self-center" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : components.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    {sort.head("code", t("Kode"), "text-[11px] font-bold")}
                    {sort.head("name", t("Nama Komponen", "Component Name"), "text-[11px] font-bold")}
                    {sort.head("type", t("Klasifikasi", "Classification"), "text-[11px] font-bold")}
                    {sort.head("value", t("Nilai / Formula", "Value / Formula"), "text-[11px] font-bold")}
                    {sort.head("tax", t("Metode Pajak", "Tax Method"), "text-[11px] font-bold")}
                    {sort.head("rules", t("Aturan", "Rules"), "text-[11px] font-bold")}
                    {sort.head("thp", t("THP", "Net Pay"), "text-[11px] font-bold")}
                    {sort.head("active", t("Aktif"), "text-[11px] font-bold")}
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sort.sorted.map((c) => (
                    <TableRow key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell className="font-mono text-[11px] font-bold text-slate-500">{c.code}</TableCell>
                      <TableCell className="text-[13px] font-bold">{c.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusPill status={c.type} />
                          <Badge variant="outline" className="text-[9px] font-semibold">{t(WAGE_TYPE_LABEL[c.wageType] ?? c.wageType, WAGE_TYPE_LABEL_EN[c.wageType])}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-52">
                        {c.calcMethod === "Fixed" && c.amount > 0 && <span className="text-xs font-semibold">{fmtIDR(c.amount)}</span>}
                        {c.calcMethod === "Formula" && c.formula && (
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold ov-text-accent dark:bg-slate-800">{c.formula}</code>
                        )}
                        {c.calcMethod === "Tax" && <Badge variant="outline" className="text-[9px]">{t("dihitung engine", "engine-calculated")}</Badge>}
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-[11px] font-bold", c.incomeTaxMethod === "Regular" ? "text-brand dark:text-brand/85" : "text-slate-400")}>
                          {t(TAX_METHOD_LABEL[c.incomeTaxMethod] ?? c.incomeTaxMethod, TAX_METHOD_LABEL_EN[c.incomeTaxMethod])}
                        </span>
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => setRulesDialog({ open: true, comp: c })}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors",
                            c.ruleCount
                              ? "ov-soft ov-border-accent ov-text-accent hover:shadow-sm"
                              : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 dark:border-slate-700 dark:text-slate-500",
                          )}
                          title={t("Aturan diferensiasi besaran", "Amount differentiation rules")}
                        >
                          <SlidersHorizontal className="h-3 w-3" /> {c.ruleCount}
                        </button>
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-[11px] font-bold", c.includeInTHP ? "text-brand dark:text-brand/85" : "text-slate-300")}>{c.includeInTHP ? t("Ya") : t("Tidak")}</span>
                      </TableCell>
                      <TableCell>
                        <Switch checked={c.active} onCheckedChange={() => toggleActive(c)} aria-label={t("Toggle {name}", "Toggle {name}", { name: c.name })} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <button onClick={() => setDialog({ open: true, comp: c })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label={t("Ubah")}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => remove(c)} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label={t("Hapus")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4"><EmptyState title={t("Tidak ada komponen", "No components")} description={t("Buat komponen upah baru untuk mulai menghitung payroll.", "Create a new wage component to start calculating payroll.")} icon={<Coins className="h-6 w-6" />} /></div>
          )}
        </CardContent>
      </Card>

      <WageDialog open={dialog.open} comp={dialog.comp} onClose={() => { setDialog({ open: false, comp: null }); refresh(); }} />

      {rulesDialog.comp && (
        <ComponentRulesDialog
          key={rulesDialog.comp.id}
          open={rulesDialog.open}
          comp={rulesDialog.comp}
          onClose={() => { setRulesDialog({ open: false, comp: null }); refresh(); }}
        />
      )}
    </div>
  );
}

function TypeCard({ label, value, icon: Icon, tone, active, onClick }: { label: string; value: number; icon: React.ElementType; tone: string; active: boolean; onClick: () => void }) {
  const tones: Record<string, string> = {
    emerald: "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    stone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return (
    <button onClick={onClick} className={cn(
      "flex items-center gap-3 rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
      active ? "ov-soft ov-border-accent" : "border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    )}>
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", tones[tone])}><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-xl font-extrabold text-slate-900 dark:text-slate-50">{value}</p>
      </div>
    </button>
  );
}

function WageDialog({ open, comp, onClose }: { open: boolean; comp: WageCompFull | null; onClose: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("Earning");
  const [wageType, setWageType] = useState("Compensation");
  const [calcMethod, setCalcMethod] = useState("Fixed");
  const [amount, setAmount] = useState("0");
  const [formula, setFormula] = useState("");
  const [incomeTaxMethod, setIncomeTaxMethod] = useState("Regular");
  const [prorated, setProrated] = useState(false);
  // Task 64b — basis prorata: kalender (default) vs hari kerja jadwal attendance.
  const [prorateBasis, setProrateBasis] = useState<string>("Calendar");
  const [includeInTHP, setIncludeInTHP] = useState(true);
  const [displayInPaySlip, setDisplayInPaySlip] = useState(true);
  const [accountDebitCode, setAccountDebitCode] = useState("");
  const [accountCreditCode, setAccountCreditCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const compKey = comp?.id ?? "new";
  if (key !== compKey) {
    setKey(compKey);
    setCode(comp?.code ?? "");
    setName(comp?.name ?? "");
    setType(comp?.type ?? "Earning");
    setWageType(comp?.wageType ?? "Compensation");
    setCalcMethod(comp?.calcMethod ?? "Fixed");
    setAmount(String(comp?.amount ?? 0));
    setFormula(comp?.formula ?? "");
    setIncomeTaxMethod(comp?.incomeTaxMethod ?? "Regular");
    setProrated(comp?.prorated ?? false);
    setProrateBasis(comp?.prorateBasis === "WorkingDays" ? "WorkingDays" : "Calendar");
    setIncludeInTHP(comp?.includeInTHP ?? true);
    setDisplayInPaySlip(comp?.displayInPaySlip ?? true);
    setAccountDebitCode(comp?.accountDebitCode ?? "");
    setAccountCreditCode(comp?.accountCreditCode ?? "");
  }

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast.error(t("Kode & nama wajib diisi", "Code & name are required")); return; }
    if (calcMethod === "Formula" && !formula.trim()) { toast.error(t("Formula wajib diisi", "Formula is required")); return; }
    setBusy(true);
    const payload = {
      name, type, wageType, calcMethod,
      amount: Number(amount) || 0,
      formula: calcMethod === "Formula" ? formula.trim().toUpperCase() : null,
      incomeTaxMethod, prorated, includeInTHP, displayInPaySlip,
      prorateBasis: prorated && prorateBasis === "WorkingDays" ? "WorkingDays" : null,
      accountDebitCode: accountDebitCode.trim() || null,
      accountCreditCode: accountCreditCode.trim() || null,
    };
    try {
      if (comp) {
        await apiSend("/api/rekankerja/wage-components", "PATCH", { id: comp.id, ...payload });
        toast.success(t("Komponen diperbarui", "Component updated"));
      } else {
        await apiSend("/api/rekankerja/wage-components", "POST", { code: code.trim().toUpperCase(), ...payload });
        toast.success(t("Komponen dibuat", "Component created"));
      }
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] sm:max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Coins className="h-4 w-4 ov-text-accent" /> {comp ? t("Edit Komponen", "Edit Component") : t("Komponen Baru", "New Component")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {!comp && (
            <div>
              <Label className="text-xs">{t("Kode *", "Code *")}</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("cth: TLAHAN", "e.g. TLAHAN")} className="mt-1.5 font-mono uppercase" />
            </div>
          )}
          <div className={comp ? "sm:col-span-2" : ""}>
            <Label className="text-xs">{t("Nama *", "Name *")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("cth: Tunjangan Hari Raya", "e.g. Holiday Allowance")} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">{t("Kategori", "Category")}</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Earning">Earning</SelectItem>
                <SelectItem value="Deduction">Deduction</SelectItem>
                <SelectItem value="Informational">Informational</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Jenis Upah (13-way)", "Wage Type (13-way)")}</Label>
            <Select value={wageType} onValueChange={setWageType}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WAGE_TYPE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{t(l, WAGE_TYPE_LABEL_EN[v])}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Metode Kalkulasi", "Calculation Method")}</Label>
            <Select value={calcMethod} onValueChange={setCalcMethod}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Fixed">{t("Fixed (nilai tetap)", "Fixed (fixed value)")}</SelectItem>
                <SelectItem value="Formula">{t("Formula (ekspresi)", "Formula (expression)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Metode Pajak", "Tax Method")}</Label>
            <Select value={incomeTaxMethod} onValueChange={setIncomeTaxMethod}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAX_METHOD_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{t(l, TAX_METHOD_LABEL_EN[v])}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {calcMethod === "Fixed" && (
            <div className="sm:col-span-2">
              <Label className="text-xs">{t("Jumlah (Rp)", "Amount (Rp)")}</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5 font-mono" />
              {Number(amount) > 0 && <p className="mt-1 text-[11px] font-bold text-slate-500">{fmtIDR(Number(amount))}</p>}
            </div>
          )}
          {calcMethod === "Formula" && (
            <div className="sm:col-span-2">
              <Label className="text-xs">{t("Formula *", "Formula *")}</Label>
              <Input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder={t("cth: BASE_SALARY*0.1", "e.g. BASE_SALARY*0.1")} className="mt-1.5 font-mono uppercase" />
              <div className="mt-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Variabel tersedia", "Available variables")}</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {FORMULA_VARIABLES.map((v) => (
                    <p key={v.name} className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                      <code className="font-bold ov-text-accent">{v.name}</code> — {t(v.desc, FORMULA_VARIABLES_EN[v.name])}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
          {type === "Earning" && (
            <div>
              <Label className="text-xs">{t("Akun Beban (D)", "Expense Account (D)")}</Label>
              <Input value={accountDebitCode} onChange={(e) => setAccountDebitCode(e.target.value)} placeholder={t("default 5101/5102/5103", "default 5101/5102/5103")} className="mt-1.5 font-mono" />
            </div>
          )}
          {type === "Deduction" && (
            <div>
              <Label className="text-xs">{t("Akun Kewajiban (C)", "Liability Account (C)")}</Label>
              <Input value={accountCreditCode} onChange={(e) => setAccountCreditCode(e.target.value)} placeholder={t("default 2102/2103/2104", "default 2102/2103/2104")} className="mt-1.5 font-mono" />
            </div>
          )}
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold">{t("Prorata", "Pro-rata")}</p>
                <p className="text-[10px] text-slate-400">{t("Proporsional masa kerja period", "Proportional to period tenure")}</p>
              </div>
              <Switch checked={prorated} onCheckedChange={setProrated} />
            </div>
            {prorated && (
              <div className="mt-3 flex gap-1.5">
                {["Calendar", "WorkingDays"].map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setProrateBasis(b)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold transition-colors ${
                      prorateBasis === b
                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                        : "border-slate-200 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400"
                    }`}
                  >
                    {b === "Calendar" ? t("Hari Kalender", "Calendar days") : t("Hari Kerja (Jadwal)", "Working days (schedule)")}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div>
              <p className="text-xs font-bold">{t("Masuk THP", "Include in THP")}</p>
              <p className="text-[10px] text-slate-400">{t("Iuran perusahaan = non-THP", "Company contribution = non-THP")}</p>
            </div>
            <Switch checked={includeInTHP} onCheckedChange={setIncludeInTHP} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 sm:col-span-2 dark:border-slate-700">
            <div>
              <p className="text-xs font-bold">{t("Tampilkan di Payslip", "Show on Payslip")}</p>
              <p className="text-[10px] text-slate-400">{t("Komponen muncul pada slip gaji karyawan", "Component appears on employee payslips")}</p>
            </div>
            <Switch checked={displayInPaySlip} onCheckedChange={setDisplayInPaySlip} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
