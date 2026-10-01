"use client";
// OneVity Travel — Master: template (settlement day/metode), jenis biaya + limit
// + akun Debit/Kredit, zona wilayah (padanan General Setting oranHR: ClaimTmpl +
// ExpenseDefinition + Rules + DomesticZone + Expense Chart of Account).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { TemplateRowUI, ExpenseTypeRowUI, ZoneRowUI, EXPENSE_KIND_LABEL, fmtIDR } from "./travel-types";
import { LayoutTemplate, Boxes, MapPin, Pencil, Plus, Landmark, Clock, Globe2, CircleDollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface TemplateForm {
  id?: string; code: string; name: string; description: string;
  settlementDay: string; settlementMethod: string; isDefault: boolean;
}

interface ExpenseForm {
  id?: string; code: string; name: string; expenseKind: string; description: string;
  limitAmount: string; unlimited: boolean; needDocs: boolean;
  debitAccount: string; creditAccount: string;
}

const emptyTpl: TemplateForm = { code: "", name: "", description: "", settlementDay: "14", settlementMethod: "Kas", isDefault: false };
const emptyExp: ExpenseForm = { code: "", name: "", expenseKind: "GENERAL", description: "", limitAmount: "", unlimited: false, needDocs: false, debitAccount: "5105", creditAccount: "1101" };

export function TravelTemplatesPage() {
  const api = useApi<{ templates: TemplateRowUI[]; expenseTypes: ExpenseTypeRowUI[]; zones: ZoneRowUI[] }>("/api/onevity/travel/templates");
  const [tab, setTab] = useState<"template" | "expense" | "zone">("template");
  const [tplDialog, setTplDialog] = useState(false);
  const [expDialog, setExpDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tplForm, setTplForm] = useState<TemplateForm>(emptyTpl);
  const [expForm, setExpForm] = useState<ExpenseForm>(emptyExp);

  const templates = api.data?.templates ?? [];
  const expenseTypes = useMemo(() => (api.data?.expenseTypes ?? []).slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code)), [api.data]);
  const zones = api.data?.zones ?? [];
  const kindGroups = useMemo(() => {
    const g = new Map<string, ExpenseTypeRowUI[]>();
    for (const t of expenseTypes) {
      g.set(t.kind, [...(g.get(t.kind) ?? []), t]);
    }
    return [...g.entries()];
  }, [expenseTypes]);

  const saveTemplate = async () => {
    if (!tplForm.code.trim() || !tplForm.name.trim()) { toast.error("Kode & nama template wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/travel/templates", "POST", { kind: "template", ...tplForm, settlementDay: Number(tplForm.settlementDay) || 0 });
      toast.success(`Template ${tplForm.code} ${tplForm.id ? "diperbarui" : "dibuat"}`);
      setTplDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan template");
    } finally { setBusy(false); }
  };

  const saveExpense = async () => {
    if (!expForm.code.trim() || !expForm.name.trim()) { toast.error("Kode & nama jenis biaya wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/travel/templates", "POST", {
        kind: "expense", ...expForm, limitAmount: Number(expForm.limitAmount) || 0,
      });
      toast.success(`Jenis biaya ${expForm.code} ${expForm.id ? "diperbarui" : "dibuat"}`);
      setExpDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan jenis biaya");
    } finally { setBusy(false); }
  };

  const TABS = [
    { key: "template", label: "Template", icon: LayoutTemplate, count: templates.length },
    { key: "expense", label: "Jenis Biaya & Limit", icon: Boxes, count: expenseTypes.length },
    { key: "zone", label: "Zona Wilayah", icon: MapPin, count: zones.length },
  ] as const;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL TRAVEL"
        title="Master Perjalanan Dinas"
        description="Template (hari jatuh tempo settlement), jenis biaya + limit + akun jurnal, dan zona wilayah — padanan General Setting oranHR (12 halaman → 3 tab)"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-colors",
              tab === t.key ? "bg-orange-600 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label} <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", tab === t.key ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800")}>{t.count}</span>
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {tab === "template" && (
            <Button onClick={() => { setTplForm(emptyTpl); setTplDialog(true); }} className="gap-2 bg-orange-600 font-bold hover:bg-orange-700">
              <Plus className="h-4 w-4" /> Template Baru
            </Button>
          )}
          {tab === "expense" && (
            <Button onClick={() => { setExpForm(emptyExp); setExpDialog(true); }} className="gap-2 bg-orange-600 font-bold hover:bg-orange-700">
              <Plus className="h-4 w-4" /> Jenis Biaya Baru
            </Button>
          )}
        </div>
      </div>

      {api.loading && !api.data ? (
        <LoadingRows rows={6} />
      ) : tab === "template" ? (
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-0">
            {templates.length === 0 ? (
              <EmptyState icon={LayoutTemplate} title="Belum ada template" />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <TableHead>Kode</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead className="hidden md:table-cell">Deskripsi</TableHead>
                      <TableHead>Settlement</TableHead>
                      <TableHead className="text-center">Default</TableHead>
                      <TableHead className="text-right">Dipakai</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((t) => (
                      <TableRow key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <TableCell className="font-mono text-xs font-bold text-orange-700 dark:text-orange-400">{t.code}</TableCell>
                        <TableCell className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.name}</TableCell>
                        <TableCell className="hidden max-w-xs truncate text-xs text-slate-500 md:table-cell">{t.description ?? "—"}</TableCell>
                        <TableCell>
                          <p className="flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-300">
                            <Clock className="h-3 w-3" /> {t.settlementDay} hari
                          </p>
                          <p className="text-[11px] text-slate-500">{t.settlementMethod}</p>
                        </TableCell>
                        <TableCell className="text-center">
                          {t.isDefault ? <Badge className="bg-orange-100 text-[10px] font-bold text-orange-700 hover:bg-orange-100 dark:bg-orange-500/15 dark:text-orange-400">DEFAULT</Badge> : <span className="text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="text-right text-[11px] text-slate-500">{t.requestCount} req · {t.claimCount} klaim</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => {
                            setTplForm({
                              id: t.id, code: t.code, name: t.name, description: t.description ?? "",
                              settlementDay: String(t.settlementDay), settlementMethod: t.settlementMethod, isDefault: t.isDefault,
                            });
                            setTplDialog(true);
                          }}>
                            <Pencil className="h-3 w-3" /> Ubah
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
      ) : tab === "expense" ? (
        <div className="space-y-4">
          {kindGroups.map(([kind, list]) => (
            <Card key={kind} className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <CircleDollarSign className="h-4 w-4 text-orange-600" />
                  {EXPENSE_KIND_LABEL[kind] ?? kind}
                  <Badge variant="secondary" className="text-[10px] font-bold">{list.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <TableHead>Kode</TableHead>
                        <TableHead>Nama</TableHead>
                        <TableHead className="hidden md:table-cell">Deskripsi</TableHead>
                        <TableHead className="text-right">Limit</TableHead>
                        <TableHead className="hidden lg:table-cell">Akun (D/K)</TableHead>
                        <TableHead className="text-center">Dokumen</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.map((t) => (
                        <TableRow key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          <TableCell className="font-mono text-xs font-bold text-orange-700 dark:text-orange-400">{t.code}</TableCell>
                          <TableCell className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.name}</TableCell>
                          <TableCell className="hidden max-w-[200px] truncate text-xs text-slate-500 md:table-cell">{t.description ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {t.unlimited ? (
                              <Badge variant="secondary" className="text-[10px] font-bold">Tanpa limit</Badge>
                            ) : t.limitAmount > 0 ? (
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{fmtIDR(t.limitAmount)}</span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden font-mono text-[11px] text-slate-500 lg:table-cell">
                            {t.debitAccount ?? "—"}/{t.creditAccount ?? "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {t.needDocs ? <Badge variant="outline" className="text-[9px] font-bold">Perlu</Badge> : <span className="text-slate-300">—</span>}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => {
                              setExpForm({
                                id: t.id, code: t.code, name: t.name, expenseKind: t.kind, description: t.description ?? "",
                                limitAmount: t.limitAmount > 0 ? String(t.limitAmount) : "", unlimited: t.unlimited, needDocs: t.needDocs,
                                debitAccount: t.debitAccount ?? "", creditAccount: t.creditAccount ?? "",
                              });
                              setExpDialog(true);
                            }}>
                              <Pencil className="h-3 w-3" /> Ubah
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {zones.map((z) => (
            <Card key={z.id} className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="flex items-start justify-between p-4">
                <div>
                  <p className="font-mono text-xs font-bold text-orange-700 dark:text-orange-400">{z.code}</p>
                  <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">{z.name}</p>
                  <Badge variant="secondary" className="mt-1.5 text-[9px] font-bold">Zona dasar</Badge>
                </div>
                <div className={cn("rounded-xl p-2.5", z.overseas ? "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400" : "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400")}>
                  {z.overseas ? <Globe2 className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={tplDialog} onOpenChange={setTplDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-5 w-5 text-orange-600" /> {tplForm.id ? `Ubah Template ${tplForm.code}` : "Template Baru"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Kode *</Label>
                <Input value={tplForm.code} onChange={(e) => setTplForm({ ...tplForm, code: e.target.value })} disabled={Boolean(tplForm.id)} placeholder="TRAVEL-KA" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Nama *</Label>
                <Input value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} placeholder="Perjalanan Dinas Kereta" className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Deskripsi</Label>
              <Textarea value={tplForm.description} onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })} rows={2} className="text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Hari Jatuh Tempo Settlement</Label>
                <Input type="number" min="0" value={tplForm.settlementDay} onChange={(e) => setTplForm({ ...tplForm, settlementDay: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Metode Settlement</Label>
                <Select value={tplForm.settlementMethod} onValueChange={(v) => setTplForm({ ...tplForm, settlementMethod: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Kas" className="text-sm">Kas (Settled by Cash)</SelectItem>
                    <SelectItem value="Payroll" className="text-sm">Payroll</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tplForm.isDefault} onChange={(e) => setTplForm({ ...tplForm, isDefault: e.target.checked })} className="h-4 w-4 accent-orange-600" />
              <span className="font-semibold">Jadikan template default (padanan oranHR Is Default)</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTplDialog(false)} className="font-bold">Batal</Button>
            <Button onClick={saveTemplate} disabled={busy} className="bg-orange-600 font-bold hover:bg-orange-700">
              {busy ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={expDialog} onOpenChange={setExpDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-orange-600" /> {expForm.id ? `Ubah Jenis Biaya ${expForm.code}` : "Jenis Biaya Baru"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Kode *</Label>
                <Input value={expForm.code} onChange={(e) => setExpForm({ ...expForm, code: e.target.value })} disabled={Boolean(expForm.id)} placeholder="L-TRAIN" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Nama *</Label>
                <Input value={expForm.name} onChange={(e) => setExpForm({ ...expForm, name: e.target.value })} placeholder="Tiket Kereta" className="text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Kelompok (padanan tab oranHR)</Label>
                <Select value={expForm.expenseKind} onValueChange={(v) => setExpForm({ ...expForm, expenseKind: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GENERAL" className="text-sm">General Expense</SelectItem>
                    <SelectItem value="ALLOWANCE" className="text-sm">Allowance (uang saku)</SelectItem>
                    <SelectItem value="MILEAGE" className="text-sm">Mileage (jarak/BBM)</SelectItem>
                    <SelectItem value="ENTERTAINMENT" className="text-sm">Entertainment (+ tamu)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Limit Nominal (Rp)</Label>
                <Input type="number" min="0" value={expForm.limitAmount} onChange={(e) => setExpForm({ ...expForm, limitAmount: e.target.value })} placeholder="0 = tanpa limit" disabled={expForm.unlimited} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Deskripsi</Label>
              <Textarea value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} rows={2} className="text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs font-bold">
                  <Landmark className="h-3 w-3" /> Akun Debit (beban)
                </Label>
                <Input value={expForm.debitAccount} onChange={(e) => setExpForm({ ...expForm, debitAccount: e.target.value })} placeholder="5105" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs font-bold">
                  <Landmark className="h-3 w-3" /> Akun Credit (kas)
                </Label>
                <Input value={expForm.creditAccount} onChange={(e) => setExpForm({ ...expForm, creditAccount: e.target.value })} placeholder="1101" className="text-sm" />
              </div>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={expForm.unlimited} onChange={(e) => setExpForm({ ...expForm, unlimited: e.target.checked })} className="h-4 w-4 accent-orange-600" />
                <span className="font-semibold">Tanpa limit nominal (Unlimited)</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={expForm.needDocs} onChange={(e) => setExpForm({ ...expForm, needDocs: e.target.checked })} className="h-4 w-4 accent-orange-600" />
                <span className="font-semibold">Perlu dokumen pendukung (kwitansi)</span>
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExpDialog(false)} className="font-bold">Batal</Button>
            <Button onClick={saveExpense} disabled={busy} className="bg-orange-600 font-bold hover:bg-orange-700">
              {busy ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
