"use client";
// OneVity Travel — Budget: period tahunan + rincian per cost center + progress
// (padanan TravelPeriod.jsp "Total Budget | Used | Unused" + Budget Per Cost
// Center). Over-budget = warning, bukan blokir (perilaku nyata oranHR MII).
import { useState } from "react";
import { useApi, apiSend } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
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

interface ItemForm {
  costCenter: string; amount: string; note: string;
}

export function TravelBudgetPage() {
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
    if (!Number.isFinite(year)) { toast.error("Tahun wajib valid"); return; }
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
      toast.success(`Budget ${year} ${editId ? "diperbarui" : "dibuat"}`);
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan budget");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="MODUL TRAVEL"
        title="Budget Perjalanan Dinas"
        description="Budget tahunan + rincian per cost center — pemakaian dihitung dari klaim Transferred/Paid. Over-budget memunculkan warning tanpa memblokir klaim (padanan Travel Budget oranHR)"
        actions={
          <Button onClick={() => openDialog()} className="gap-2 bg-orange-600 font-bold hover:bg-orange-700">
            <Plus className="h-4 w-4" /> Tahun Baru
          </Button>
        }
      />

      {api.loading && !api.data ? (
        <LoadingRows rows={4} />
      ) : budgets.length === 0 ? (
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-0">
            <EmptyState icon={Wallet} title="Belum ada budget travel" description="Buat budget tahunan untuk memantau pemakaian per cost center." />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {budgets.map((b) => {
            const pct = b.totalBudget > 0 ? Math.min(100, (b.used / b.totalBudget) * 100) : 0;
            const over = b.totalBudget > 0 && b.used > b.totalBudget;
            const itemTotal = b.items.reduce((s, i) => s + i.amount, 0);
            return (
              <Card key={b.id} className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base font-bold">
                      <Wallet className="h-4 w-4 text-orange-600" /> Budget {b.year}
                    </span>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => openDialog(b)}>
                      <Pencil className="h-3 w-3" /> Ubah
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-stone-50 py-2 dark:bg-stone-800/60">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">Total Budget</p>
                      <p className="text-sm font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(b.totalBudget)}</p>
                    </div>
                    <div className={cn("rounded-lg py-2", over ? "bg-rose-50 dark:bg-rose-950/30" : "bg-teal-50 dark:bg-teal-950/30")}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">Terpakai</p>
                      <p className={cn("text-sm font-black", over ? "text-rose-700 dark:text-rose-400" : "text-teal-700 dark:text-teal-400")}>{fmtIDRShort(b.used)}</p>
                    </div>
                    <div className="rounded-lg bg-stone-50 py-2 dark:bg-stone-800/60">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">Sisa</p>
                      <p className="text-sm font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(Math.max(0, b.remaining))}</p>
                    </div>
                  </div>

                  <div>
                    <Progress value={pct} className="h-2 [&>div]:bg-orange-600" />
                    <div className="mt-1 flex items-center justify-between text-[11px] text-stone-500">
                      <span>{b.claimCount} klaim dalam periode</span>
                      <span className="font-bold">{Math.round(pct)}%</span>
                    </div>
                  </div>

                  {over && (
                    <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Terpakai {fmtIDR(b.used - b.totalBudget)} melebihi budget — padanan oranHR: klaim tetap diproses, budget alat monitoring
                    </p>
                  )}
                  {!over && b.totalBudget > 0 && b.claimCount > 0 && (
                    <p className="flex items-center gap-1.5 rounded-lg bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700 dark:bg-teal-950/40 dark:text-teal-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Pemakaian masih dalam budget
                    </p>
                  )}

                  {b.items.length > 0 && (
                    <div>
                      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-stone-500">
                        <TrendingUp className="h-3 w-3" /> Rincian per Cost Center {itemTotal !== b.totalBudget && b.totalBudget > 0 ? "(jumlah ≠ total)" : ""}
                      </p>
                      <div className="space-y-1.5">
                        {b.items.map((i, x) => {
                          const iPct = b.totalBudget > 0 ? (i.amount / b.totalBudget) * 100 : 0;
                          return (
                            <div key={x} className="rounded-lg bg-stone-50 px-3 py-1.5 dark:bg-stone-800/60">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-stone-700 dark:text-stone-300">
                                  CC {i.costCenter}
                                  {i.note && <span className="ml-1.5 font-normal text-stone-500">{i.note}</span>}
                                </span>
                                <span className="font-bold text-stone-700 dark:text-stone-300">{fmtIDR(i.amount)}</span>
                              </div>
                              <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                                <div className="h-full bg-orange-400" style={{ width: `${Math.min(100, iPct)}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {b.note && <p className="text-[11px] text-stone-500">{b.note}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-orange-600" /> {editId ? `Ubah Budget ${form.year}` : "Budget Tahun Baru"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Tahun *</Label>
                <Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} disabled={Boolean(editId)} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Total Budget (Rp) *</Label>
                <Input type="number" min="0" value={form.totalBudget} onChange={(e) => setForm({ ...form, totalBudget: e.target.value })} placeholder="250000000" className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Catatan</Label>
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="text-sm" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">Rincian per Cost Center</Label>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => setItems([...items, { costCenter: "", amount: "", note: "" }])}>
                  <Plus className="h-3 w-3" /> Tambah
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2">
                    <Input value={it.costCenter} onChange={(e) => setItems(items.map((x, xi) => xi === i ? { ...x, costCenter: e.target.value } : x))} placeholder="CC (mis. OP)" className="h-8 text-sm" />
                    <Input type="number" min="0" value={it.amount} onChange={(e) => setItems(items.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))} placeholder="Rp" className="h-8 text-sm" />
                    <div className="flex gap-1">
                      <Input value={it.note} onChange={(e) => setItems(items.map((x, xi) => xi === i ? { ...x, note: e.target.value } : x))} placeholder="Catatan" className="h-8 text-sm" />
                      {items.length > 1 && (
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-600" onClick={() => setItems(items.filter((_, x) => x !== i))}>×</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-bold dark:bg-stone-800">
                <span className="text-stone-600 dark:text-stone-300">Jumlah item: {fmtIDR(items.reduce((s, i) => s + (Number(i.amount) || 0), 0))}</span>
                <Badge variant="secondary" className="text-[10px]">Optional — bisa kosong</Badge>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog(false)} className="font-bold">Batal</Button>
            <Button onClick={submit} disabled={busy} className="bg-orange-600 font-bold hover:bg-orange-700">
              {busy ? "Menyimpan…" : editId ? "Simpan Perubahan" : "Buat Budget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
