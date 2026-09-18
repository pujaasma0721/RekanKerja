"use client";
// OneVity Medical — Jenis Benefit (master): kebijakan limit/frekuensi/unused/dependent
// (padanan MedicalBenefitTypeDetail.jsp ±60 atribut → atribut kunci).
import { useState } from "react";
import { useApi, apiSend } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
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
  BenefitTypeUI, LIMIT_RULE_LABEL, UNUSED_RULE_LABEL, DEP_LIMIT_LABEL, FREQ_PERIOD_LABEL,
  fmtIDR,
} from "./medical-types";
import { Boxes, Plus, Pencil, HeartPulse, Infinity as InfinityIcon } from "lucide-react";
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
  const api = useApi<{ types: BenefitTypeUI[] }>("/api/onevity/medical/types");
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const types = api.data?.types ?? [];

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
    if (!form.name.trim() || (!form.id && !form.code.trim())) { toast.error("Kode & nama wajib"); return; }
    if (form.limitRule !== "UNLIMITED" && !(Number(form.limitValue) > 0)) {
      toast.error("Nominal / faktor harus > 0");
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/onevity/medical/types", "POST", {
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
      toast.success(form.id ? "Jenis benefit diperbarui" : "Jenis benefit ditambahkan");
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="MEDICAL · MASTER"
        title="Jenis Benefit Medis"
        description="Kebijakan per jenis: limit (unlimited / nominal / faktor × gaji pokok), frekuensi klaim, pembagian company/asuransi, kebijakan sisa saldo akhir tahun, dan dependent (padanan Medical Benefit Type oranHR)"
        actions={(
          <Button onClick={openNew} className="bg-rose-600 hover:bg-rose-700">
            <Plus className="h-4 w-4" /> Jenis Baru
          </Button>
        )}
      />

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : types.length === 0 ? (
            <div className="p-6"><EmptyState title="Belum ada jenis benefit" icon={Boxes} /></div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                  <TableRow>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Limit</TableHead>
                    <TableHead>Frekuensi</TableHead>
                    <TableHead>Sisa Saldo</TableHead>
                    <TableHead>Dependent</TableHead>
                    <TableHead className="text-right">Saldo / Klaim</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.map((t) => (
                    <TableRow key={t.id} className={cn(!t.active && "opacity-50")}>
                      <TableCell>
                        <p className="font-semibold">{t.name}</p>
                        <p className="text-xs text-stone-500">{t.code}</p>
                      </TableCell>
                      <TableCell>
                        {t.limitRule === "UNLIMITED" ? (
                          <span className="flex items-center gap-1 font-semibold"><InfinityIcon className="h-3.5 w-3.5" /> Unlimited</span>
                        ) : t.limitRule === "FACTOR" ? (
                          <span className="font-semibold">{t.limitValue}× gaji pokok</span>
                        ) : (
                          <span className="font-semibold">{fmtIDR(t.limitValue)}</span>
                        )}
                        <p className="text-xs text-stone-500">
                          {t.pctCompany}% company{t.pctInsurance > 0 ? ` · ${t.pctInsurance}% asuransi` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.freqUnlimited ? "Unlimited" : `${t.freqValue}× / ${FREQ_PERIOD_LABEL[t.freqPeriod] ?? t.freqPeriod}`}
                        {t.needReceipt && <span className="block text-xs text-stone-500">perlu kwitansi</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {UNUSED_RULE_LABEL[t.unusedRule] ?? t.unusedRule}
                        {t.unusedRule === "CASH" && t.cashWageCode && <span className="block text-xs text-stone-500">via {t.cashWageCode}</span>}
                        {t.unusedRule === "CARRY" && t.maxCarryOver > 0 && <span className="block text-xs text-stone-500">max {fmtIDR(t.maxCarryOver)}</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.dependentEnabled ? `${t.maxDependents} dep. · max ${t.maxChildAge} th` : "—"}
                        {t.dependentEnabled && <span className="block text-xs text-stone-500">{DEP_LIMIT_LABEL[t.depLimitRule] ?? t.depLimitRule}</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm text-stone-500">
                        {t.balanceCount} saldo · {t.claimCount} klaim
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>
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
              <HeartPulse className="h-5 w-5 text-rose-600" /> {form.id ? "Ubah Jenis Benefit" : "Jenis Benefit Baru"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Kode *</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={Boolean(form.id)} placeholder="mis. RAWAT_INAP" />
            </div>
            <div className="space-y-1.5">
              <Label>Nama *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Rawat Inap" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Deskripsi</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>

            <div className="space-y-1.5">
              <Label>Aturan Limit *</Label>
              <Select value={form.limitRule} onValueChange={(v) => setForm({ ...form, limitRule: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(LIMIT_RULE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{form.limitRule === "FACTOR" ? "Faktor × gaji *" : form.limitRule === "NOMINAL" ? "Nominal (Rp) *" : "—"}</Label>
              <Input
                type="number" min={0} disabled={form.limitRule === "UNLIMITED"}
                value={form.limitValue}
                onChange={(e) => setForm({ ...form, limitValue: e.target.value })}
                placeholder={form.limitRule === "FACTOR" ? "mis. 1" : "mis. 5000000"}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Frekuensi</Label>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.freqUnlimited} onCheckedChange={(v) => setForm({ ...form, freqUnlimited: Boolean(v) })} />
                <Input
                  type="number" min={0} disabled={form.freqUnlimited} className="w-24"
                  value={form.freqValue} onChange={(e) => setForm({ ...form, freqValue: e.target.value })} placeholder="×"
                />
                <Select value={form.freqPeriod} onValueChange={(v) => setForm({ ...form, freqPeriod: v })} disabled={form.freqUnlimited}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YEAR">per tahun</SelectItem>
                    <SelectItem value="MEDICAL">per period medis</SelectItem>
                    <SelectItem value="WORK">per masa kerja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Company / Asuransi (%)</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min={0} max={100} value={form.pctCompany} onChange={(e) => setForm({ ...form, pctCompany: e.target.value })} />
                <span className="text-stone-400">/</span>
                <Input type="number" min={0} max={100} value={form.pctInsurance} onChange={(e) => setForm({ ...form, pctInsurance: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Sisa Saldo Akhir Tahun</Label>
              <Select value={form.unusedRule} onValueChange={(v) => setForm({ ...form, unusedRule: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(UNUSED_RULE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{form.unusedRule === "CASH" ? "Wage Code Tunai" : form.unusedRule === "CARRY" ? "Max Carry-Over (Rp)" : "—"}</Label>
              {form.unusedRule === "CASH" ? (
                <Input value={form.cashWageCode} onChange={(e) => setForm({ ...form, cashWageCode: e.target.value })} placeholder="UMC" />
              ) : form.unusedRule === "CARRY" ? (
                <Input type="number" min={0} value={form.maxCarryOver} onChange={(e) => setForm({ ...form, maxCarryOver: e.target.value })} />
              ) : (
                <Input disabled />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Max Dependent</Label>
              <div className="flex items-center gap-2">
                <Checkbox checked={form.dependentEnabled} onCheckedChange={(v) => setForm({ ...form, dependentEnabled: Boolean(v) })} />
                <Input type="number" min={0} disabled={!form.dependentEnabled} className="w-20" value={form.maxDependents} onChange={(e) => setForm({ ...form, maxDependents: e.target.value })} />
                <span className="text-xs text-stone-500">anak max</span>
                <Input type="number" min={0} disabled={!form.dependentEnabled} className="w-20" value={form.maxChildAge} onChange={(e) => setForm({ ...form, maxChildAge: e.target.value })} />
                <span className="text-xs text-stone-500">th</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Limit Dependent</Label>
              <Select value={form.depLimitRule} onValueChange={(v) => setForm({ ...form, depLimitRule: v })} disabled={!form.dependentEnabled}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DEP_LIMIT_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.needReceipt} onCheckedChange={(v) => setForm({ ...form, needReceipt: Boolean(v) })} />
              Wajib kwitansi
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: Boolean(v) })} />
              Aktif
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
            <Button onClick={save} disabled={busy} className="bg-rose-600 hover:bg-rose-700">
              {busy ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
