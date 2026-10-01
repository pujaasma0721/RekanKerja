"use client";
// RekanKerja Medical — Jenis Benefit (master): kebijakan limit/frekuensi/unused/dependent
// (padanan MedicalBenefitTypeDetail.jsp ±60 atribut → atribut kunci).
import { useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useTableSort } from "@/rekankerja/shared/lib/use-table-sort";
import { EntityRulesButton, EntityRulesDialog, type EntityRuleTarget } from "@/rekankerja/shared/components/entity-rules-dialog";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  BenefitTypeUI, LIMIT_RULE_LABEL, LIMIT_RULE_LABEL_EN, UNUSED_RULE_LABEL, UNUSED_RULE_LABEL_EN, DEP_LIMIT_LABEL, DEP_LIMIT_LABEL_EN, FREQ_PERIOD_LABEL, FREQ_PERIOD_LABEL_EN,
  fmtIDR,
} from "./medical-types";
import { Boxes, Plus, Pencil, HeartPulse, Infinity as InfinityIcon } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

interface FormState {
  id?: string; code: string; name: string; description: string;
  limitRule: string; limitValue: string; wageCode: string;
  freqUnlimited: boolean; freqValue: string; freqPeriod: string;
  pctCompany: string; pctInsurance: string; insuranceCompany: string;
  unusedRule: string; cashWageCode: string; maxCarryOver: string;
  dependentEnabled: boolean; maxDependents: string; maxChildAge: string; depLimitRule: string;
  needReceipt: boolean; active: boolean;
}

const emptyForm: FormState = {
  code: "", name: "", description: "",
  limitRule: "NOMINAL", limitValue: "", wageCode: "",
  freqUnlimited: false, freqValue: "", freqPeriod: "YEAR",
  pctCompany: "100", pctInsurance: "0", insuranceCompany: "",
  unusedRule: "FORFEITED", cashWageCode: "", maxCarryOver: "",
  dependentEnabled: true, maxDependents: "2", maxChildAge: "21", depLimitRule: "SHARED",
  needReceipt: true, active: true,
};

export function MedicalBenefitTypePage() {
  const { t } = useI18n();
  const api = useApi<{ types: BenefitTypeUI[] }>("/api/rekankerja/medical/types");
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [rulesTarget, setRulesTarget] = useState<EntityRuleTarget | null>(null);

  const types = api.data?.types ?? [];

  // Task 72 — sorting kolom tabel jenis benefit medis
  const sort = useTableSort(types, {
    name: (bt) => bt.name,
    code: (bt) => bt.code,
    limit: (bt) => (bt.limitRule === "NOMINAL" ? Number(bt.limitValue) || 0 : 0),
    freq: (bt) => (bt.freqUnlimited ? 0 : Number(bt.freqValue) || 0),
    active: (bt) => (bt.active ? 0 : 1),
  }, { defaultKey: "name", defaultDir: "asc" });

  const openNew = () => { setForm(emptyForm); setDialog(true); };
  const openEdit = (t: BenefitTypeUI) => {
    setForm({
      id: t.id, code: t.code, name: t.name, description: t.description ?? "",
      limitRule: t.limitRule, limitValue: t.limitRule === "UNLIMITED" ? "" : String(t.limitValue), wageCode: t.wageCode ?? "",
      freqUnlimited: t.freqUnlimited, freqValue: t.freqValue ? String(t.freqValue) : "", freqPeriod: t.freqPeriod,
      pctCompany: String(t.pctCompany), pctInsurance: String(t.pctInsurance), insuranceCompany: t.insuranceCompany ?? "",
      unusedRule: t.unusedRule, cashWageCode: t.cashWageCode ?? "", maxCarryOver: t.maxCarryOver ? String(t.maxCarryOver) : "",
      dependentEnabled: t.dependentEnabled, maxDependents: String(t.maxDependents), maxChildAge: String(t.maxChildAge), depLimitRule: t.depLimitRule,
      needReceipt: t.needReceipt, active: t.active,
    });
    setDialog(true);
  };

  const save = async () => {
    if (!form.name.trim() || (!form.id && !form.code.trim())) { toast.error(t("Kode & nama wajib", "Code & name are required")); return; }
    if (form.limitRule !== "UNLIMITED" && !(Number(form.limitValue) > 0)) {
      toast.error(t("Nominal / faktor harus > 0", "Nominal / factor must be > 0"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/medical/types", "POST", {
        id: form.id,
        code: form.code, name: form.name, description: form.description || undefined,
        limitRule: form.limitRule, limitValue: Number(form.limitValue) || 0,
        wageCode: form.wageCode || undefined,
        freqUnlimited: form.freqUnlimited, freqValue: Number(form.freqValue) || 0, freqPeriod: form.freqPeriod,
        pctCompany: Number(form.pctCompany) || 0, pctInsurance: Number(form.pctInsurance) || 0,
        insuranceCompany: form.insuranceCompany || undefined,
        unusedRule: form.unusedRule,
        cashWageCode: form.unusedRule === "CASH" ? (form.cashWageCode || "UMC") : undefined,
        maxCarryOver: Number(form.maxCarryOver) || 0,
        dependentEnabled: form.dependentEnabled,
        maxDependents: Number(form.maxDependents) || 0,
        maxChildAge: Number(form.maxChildAge) || 0,
        depLimitRule: form.depLimitRule,
        needReceipt: form.needReceipt, active: form.active,
      });
      toast.success(form.id ? t("Jenis benefit diperbarui", "Benefit type updated") : t("Jenis benefit ditambahkan", "Benefit type added"));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Medical · Master")}
        title={t("Jenis Benefit Medis", "Medical Benefit Types")}
        description={t("Kebijakan per jenis: limit (unlimited / nominal / faktor × gaji pokok), frekuensi klaim, pembagian company/asuransi, kebijakan sisa saldo akhir tahun, dan dependent (padanan Medical Benefit Type)", "Policy per type: limit (unlimited / nominal / salary factor), claim frequency, company/insurance split, year-end remaining balance rule, and dependents (equivalent to Medical Benefit Type)")}
        actions={(
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> {t("Jenis Baru", "New Type")}
          </Button>
        )}
      />

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : types.length === 0 ? (
            <div className="p-6"><EmptyState title={t("Belum ada jenis benefit", "No benefit types yet")} icon={Boxes} /></div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    {sort.head("name", t("Jenis"))}
                    {sort.head("limit", "Limit")}
                    {sort.head("freq", t("Frekuensi", "Frequency"))}
                    <TableHead>{t("Sisa Saldo", "Remaining Balance")}</TableHead>
                    <TableHead>Dependent</TableHead>
                    <TableHead className="text-right">{t("Saldo / Klaim", "Balances / Claims")}</TableHead>
                    <TableHead>{t("Aturan", "Rules")}</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sort.sorted.map((bt) => (
                    <TableRow key={bt.id} className={cn(!bt.active && "opacity-50")}>
                      <TableCell>
                        <p className="font-semibold">{bt.name}</p>
                        <p className="text-xs text-slate-500">{bt.code}</p>
                      </TableCell>
                      <TableCell>
                        {bt.limitRule === "UNLIMITED" ? (
                          <span className="flex items-center gap-1 font-semibold"><InfinityIcon className="h-3.5 w-3.5" /> Unlimited</span>
                        ) : bt.limitRule === "FACTOR" ? (
                          <span className="font-semibold">{bt.limitValue}× {t("gaji pokok", "base salary")}</span>
                        ) : (
                          <span className="font-semibold">{fmtIDR(bt.limitValue)}</span>
                        )}
                        <p className="text-xs text-slate-500">
                          {bt.pctCompany}% company{bt.pctInsurance > 0 ? ` · ${bt.pctInsurance}% ${t("asuransi", "insurance")}` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {bt.freqUnlimited ? "Unlimited" : `${bt.freqValue}× / ${t(FREQ_PERIOD_LABEL[bt.freqPeriod] ?? bt.freqPeriod, FREQ_PERIOD_LABEL_EN[bt.freqPeriod])}`}
                        {bt.needReceipt && <span className="block text-xs text-slate-500">{t("perlu kwitansi", "receipt required")}</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {t(UNUSED_RULE_LABEL[bt.unusedRule] ?? bt.unusedRule, UNUSED_RULE_LABEL_EN[bt.unusedRule])}
                        {bt.unusedRule === "CASH" && bt.cashWageCode && <span className="block text-xs text-slate-500">via {bt.cashWageCode}</span>}
                        {bt.unusedRule === "CARRY" && bt.maxCarryOver > 0 && <span className="block text-xs text-slate-500">max {fmtIDR(bt.maxCarryOver)}</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {bt.dependentEnabled ? t("{n} dep. · max {m} th", "{n} dep. · max {m} yrs", { n: bt.maxDependents, m: bt.maxChildAge }) : "—"}
                        {bt.dependentEnabled && <span className="block text-xs text-slate-500">{t(DEP_LIMIT_LABEL[bt.depLimitRule] ?? bt.depLimitRule, DEP_LIMIT_LABEL_EN[bt.depLimitRule])}</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-500">
                        {t("{n} saldo · {m} klaim", "{n} balances · {m} claims", { n: bt.balanceCount, m: bt.claimCount })}
                      </TableCell>
                      <TableCell>
                        <EntityRulesButton target={{ domain: "medical", id: bt.id, code: bt.code, name: bt.name }} ruleCount={bt.ruleCount ?? 0} onOpen={setRulesTarget} />
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(bt)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HeartPulse className="h-5 w-5 ov-text-accent" /> {form.id ? t("Ubah Jenis Benefit", "Edit Benefit Type") : t("Jenis Benefit Baru", "New Benefit Type")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Kode *", "Code *")}</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={Boolean(form.id)} placeholder={t("mis. RAWAT_INAP", "e.g. RAWAT_INAP")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Nama *", "Name *")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("mis. Rawat Inap", "e.g. Inpatient")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("Deskripsi", "Description")}</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("Aturan Limit *", "Limit Rule *")}</Label>
              <Select value={form.limitRule} onValueChange={(v) => setForm({ ...form, limitRule: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(LIMIT_RULE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{t(v, LIMIT_RULE_LABEL_EN[k])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{form.limitRule === "FACTOR" ? t("Faktor × gaji *", "Factor × salary *") : form.limitRule === "NOMINAL" ? "Nominal (Rp) *" : "—"}</Label>
              <Input
                type="number" min={0} disabled={form.limitRule === "UNLIMITED"}
                value={form.limitValue}
                onChange={(e) => setForm({ ...form, limitValue: e.target.value })}
                placeholder={form.limitRule === "FACTOR" ? t("mis. 1", "e.g. 1") : t("mis. 5000000", "e.g. 5000000")}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("Frekuensi", "Frequency")}</Label>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.freqUnlimited} onCheckedChange={(v) => setForm({ ...form, freqUnlimited: Boolean(v) })} />
                <Input
                  type="number" min={0} disabled={form.freqUnlimited} className="w-24"
                  value={form.freqValue} onChange={(e) => setForm({ ...form, freqValue: e.target.value })} placeholder="×"
                />
                <Select value={form.freqPeriod} onValueChange={(v) => setForm({ ...form, freqPeriod: v })} disabled={form.freqUnlimited}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YEAR">{t("per tahun", "per year")}</SelectItem>
                    <SelectItem value="MEDICAL">{t("per period medis", "per medical period")}</SelectItem>
                    <SelectItem value="WORK">{t("per masa kerja", "per length of service")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Company / Asuransi (%)", "Company / Insurance (%)")}</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min={0} max={100} value={form.pctCompany} onChange={(e) => setForm({ ...form, pctCompany: e.target.value })} />
                <span className="text-slate-400">/</span>
                <Input type="number" min={0} max={100} value={form.pctInsurance} onChange={(e) => setForm({ ...form, pctInsurance: e.target.value })} />
              </div>
              {/* Task 82-b (audit T9): pctCompany/pctInsurance tersimpan tapi belum
                  dieksekusi — settlement & jurnal memakai 100% beban perusahaan. */}
              <p className="text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                {t(
                  "Saat ini informatif — settlement & jurnal memakai 100% beban perusahaan",
                  "Currently informative — settlement & journal use 100% company expense",
                )}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>{t("Sisa Saldo Akhir Tahun", "Year-End Remaining Balance")}</Label>
              <Select value={form.unusedRule} onValueChange={(v) => setForm({ ...form, unusedRule: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(UNUSED_RULE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{t(v, UNUSED_RULE_LABEL_EN[k])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{form.unusedRule === "CASH" ? t("Wage Code Tunai", "Cash Wage Code") : form.unusedRule === "CARRY" ? "Max Carry-Over (Rp)" : "—"}</Label>
              {form.unusedRule === "CASH" ? (
                <Input value={form.cashWageCode} onChange={(e) => setForm({ ...form, cashWageCode: e.target.value })} placeholder="UMC" />
              ) : form.unusedRule === "CARRY" ? (
                <Input type="number" min={0} value={form.maxCarryOver} onChange={(e) => setForm({ ...form, maxCarryOver: e.target.value })} />
              ) : (
                <Input disabled />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>{t("Max Dependent", "Max Dependents")}</Label>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.dependentEnabled} onCheckedChange={(v) => setForm({ ...form, dependentEnabled: Boolean(v) })} />
                <Input type="number" min={0} disabled={!form.dependentEnabled} className="w-20" value={form.maxDependents} onChange={(e) => setForm({ ...form, maxDependents: e.target.value })} />
                <span className="text-xs text-slate-500">{t("anak max", "child max")}</span>
                <Input type="number" min={0} disabled={!form.dependentEnabled} className="w-20" value={form.maxChildAge} onChange={(e) => setForm({ ...form, maxChildAge: e.target.value })} />
                <span className="text-xs text-slate-500">{t("th", "yr")}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Limit Dependent", "Dependent Limit")}</Label>
              <Select value={form.depLimitRule} onValueChange={(v) => setForm({ ...form, depLimitRule: v })} disabled={!form.dependentEnabled}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DEP_LIMIT_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{t(v, DEP_LIMIT_LABEL_EN[k])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.needReceipt} onCheckedChange={(v) => setForm({ ...form, needReceipt: Boolean(v) })} />
              {t("Wajib kwitansi", "Receipt required")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: Boolean(v) })} />
              {t("Aktif")}
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal")}</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? t("Menyimpan…", "Saving…") : t("Simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rulesTarget && (
        <EntityRulesDialog
          key={rulesTarget.id}
          open={!!rulesTarget}
          target={rulesTarget}
          onClose={() => { setRulesTarget(null); api.refresh(); }}
        />
      )}
    </div>
  );
}
