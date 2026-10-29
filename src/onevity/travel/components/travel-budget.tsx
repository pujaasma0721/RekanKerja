"use client";
// OneVity Travel — Budget: period tahunan + rincian per cost center + progress
// (padanan TravelPeriod.jsp "Total Budget | Used | Unused" + Budget Per Cost
// Center). Over-budget = warning, bukan blokir (perilaku nyata MII).
import { useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { BudgetRowUI, fmtIDR, fmtIDRShort } from "./travel-types";
import { Wallet, Plus, Pencil, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

interface ItemForm {
  costCenter: string; amount: string; note: string;
}

export function TravelBudgetPage() {
  const { t } = useI18n();
  const api = useApi<{ budgets: BudgetRowUI[] }>("/api/onevity/travel/budget");
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ year: String(new Date().getFullYear()), totalBudget: "", note: "" });
  const [items, setItems] = useState<ItemForm[]>([{ costCenter: "", amount: "", note: "" }]);

  const budgets = api.data?.budgets ?? [];

  const openDialog = (b?: BudgetRowUI) => {
    setEditId(b?.id ?? null);
    setForm({
      year: String(b?.year ?? new Date().getFullYear()),
      totalBudget: b ? String(b.totalBudget) : "",
      note: b?.note ?? "",
    });
    setItems(b && b.items.length > 0 ? b.items.map((i) => ({ costCenter: i.costCenter, amount: String(i.amount), note: i.note ?? "" })) : [{ costCenter: "", amount: "", note: "" }]);
    setDialog(true);
  };

  const submit = async () => {
    const year = parseInt(form.year, 10);
    if (!Number.isFinite(year)) { toast.error(t("Tahun wajib valid", "Year must be valid")); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/travel/budget", "POST", {
        id: editId ?? undefined,
        year,
        totalBudget: Number(form.totalBudget) || 0,
        note: form.note || undefined,
        items: items.filter((i) => i.costCenter.trim()).map((i) => ({
          costCenter: i.costCenter.trim(),
          amount: Number(i.amount) || 0,
          note: i.note || undefined,
        })),
      });
      toast.success(t("Budget {y} {v}", "Budget {y} {v}", { y: year, v: editId ? t("diperbarui", "updated") : t("dibuat", "created") }));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan budget", "Failed to save the budget"));
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL TRAVEL", "TRAVEL MODULE")}
        title={t("Budget Perjalanan Dinas", "Business Travel Budget")}
        description={t("Budget tahunan + rincian per cost center — pemakaian dihitung dari klaim Transferred/Paid. Over-budget memunculkan warning tanpa memblokir klaim (padanan Travel Budget)", "Annual budget + breakdown per cost center — usage computed from Transferred/Paid claims. Over-budget raises a warning without blocking claims (Travel Budget equivalent)")}
        actions={
          <Button onClick={() => openDialog()} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Tahun Baru", "New Budget Year")}
          </Button>
        }
      />

      {api.loading && !api.data ? (
        <LoadingRows rows={4} />
      ) : budgets.length === 0 ? (
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-0">
            <EmptyState icon={Wallet} title={t("Belum ada budget travel", "No travel budget yet")} description={t("Buat budget tahunan untuk memantau pemakaian per cost center.", "Create an annual budget to monitor usage per cost center.")} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {budgets.map((b) => {
            const pct = b.totalBudget > 0 ? Math.min(100, (b.used / b.totalBudget) * 100) : 0;
            const over = b.totalBudget > 0 && b.used > b.totalBudget;
            const itemTotal = b.items.reduce((s, i) => s + i.amount, 0);
            return (
              <Card key={b.id} className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base font-bold">
                      <Wallet className="h-4 w-4 ov-text-accent" /> Budget {b.year}
                    </span>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => openDialog(b)}>
                      <Pencil className="h-3 w-3" /> {t("Ubah")}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800/60">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total Budget</p>
                      <p className="text-sm font-black text-slate-900 dark:text-slate-100">{fmtIDRShort(b.totalBudget)}</p>
                    </div>
                    <div className={cn("rounded-lg py-2", over ? "bg-rose-50 dark:bg-rose-950/30" : "bg-brand/10 dark:bg-brand/90/30")}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t("Terpakai", "Used")}</p>
                      <p className={cn("text-sm font-black", over ? "text-rose-700 dark:text-rose-400" : "text-brand-deep dark:text-brand/85")}>{fmtIDRShort(b.used)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 py-2 dark:bg-slate-800/60">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t("Sisa", "Remaining")}</p>
                      <p className="text-sm font-black text-slate-900 dark:text-slate-100">{fmtIDRShort(Math.max(0, b.remaining))}</p>
                    </div>
                  </div>

                  <div>
                    <Progress value={pct} className="h-2 [&>div]:ov-bar" />
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                      <span>{t("{n} klaim dalam periode", "{n} claims in the period", { n: b.claimCount })}</span>
                      <span className="font-bold">{Math.round(pct)}%</span>
                    </div>
                  </div>

                  {over && (
                    <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t("Terpakai {amt} melebihi budget — padanan: klaim tetap diproses, budget alat monitoring", "Usage of {amt} exceeds budget — equivalent: claims are still processed, budget is a monitoring tool", { amt: fmtIDR(b.used - b.totalBudget) })}
                    </p>
                  )}
                  {!over && b.totalBudget > 0 && b.claimCount > 0 && (
                    <p className="flex items-center gap-1.5 rounded-lg bg-brand/10 px-3 py-2 text-xs font-semibold text-brand-deep dark:bg-brand/90/40 dark:text-brand/85">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t("Pemakaian masih dalam budget", "Usage is still within budget")}
                    </p>
                  )}

                  {b.items.length > 0 && (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-slate-500">
                        <TrendingUp className="h-3 w-3" /> {t("Rincian per Cost Center", "Breakdown per Cost Center")} {itemTotal !== b.totalBudget && b.totalBudget > 0 ? t("(jumlah ≠ total)", "(sum ≠ total)") : ""}
                      </p>
                      <div className="space-y-1.5">
                        {b.items.map((i, x) => {
                          const iPct = b.totalBudget > 0 ? (i.amount / b.totalBudget) * 100 : 0;
                          return (
                            <div key={x} className="rounded-lg bg-slate-50 px-3 py-1.5 dark:bg-slate-800/60">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-slate-700 dark:text-slate-300">
                                  CC {i.costCenter}
                                  {i.note && <span className="ml-1.5 font-normal text-slate-500">{i.note}</span>}
                                </span>
                                <span className="font-bold text-slate-700 dark:text-slate-300">{fmtIDR(i.amount)}</span>
                              </div>
                              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                <div className="h-full ov-bar" style={{ width: `${Math.min(100, iPct)}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {b.note && <p className="text-[11px] text-slate-500">{b.note}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 ov-text-accent" /> {editId ? t("Ubah Budget {y}", "Edit Budget {y}", { y: form.year }) : t("Budget Tahun Baru", "New Budget Year")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tahun *", "Year *")}</Label>
                <Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} disabled={Boolean(editId)} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Total Budget (Rp) *")}</Label>
                <Input type="number" min="0" value={form.totalBudget} onChange={(e) => setForm({ ...form, totalBudget: e.target.value })} placeholder="250000000" className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan")}</Label>
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="text-sm" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">{t("Rincian per Cost Center", "Breakdown per Cost Center")}</Label>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => setItems([...items, { costCenter: "", amount: "", note: "" }])}>
                  <Plus className="h-3 w-3" /> {t("Tambah")}
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2">
                    <Input value={it.costCenter} onChange={(e) => setItems(items.map((x, xi) => xi === i ? { ...x, costCenter: e.target.value } : x))} placeholder={t("CC (mis. OP)", "CC (e.g. OP)")} className="h-8 text-sm" />
                    <Input type="number" min="0" value={it.amount} onChange={(e) => setItems(items.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))} placeholder="Rp" className="h-8 text-sm" />
                    <div className="flex gap-1">
                      <Input value={it.note} onChange={(e) => setItems(items.map((x, xi) => xi === i ? { ...x, note: e.target.value } : x))} placeholder={t("Catatan")} className="h-8 text-sm" />
                      {items.length > 1 && (
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-600" onClick={() => setItems(items.filter((_, x) => x !== i))}>×</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold dark:bg-slate-800">
                <span className="text-slate-600 dark:text-slate-300">{t("Jumlah item: {amt}", "Item total: {amt}", { amt: fmtIDR(items.reduce((s, i) => s + (Number(i.amount) || 0), 0)) })}</span>
                <Badge variant="secondary" className="text-[10px]">{t("Optional — bisa kosong", "Optional — can be empty")}</Badge>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog(false)} className="font-bold">{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy} className="font-bold">
              {busy ? t("Menyimpan…") : editId ? t("Simpan Perubahan", "Save Changes") : t("Buat Budget", "Create Budget")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
