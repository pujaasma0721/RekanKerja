"use client";
// OneVity Travel — Master: template (settlement day/metode), jenis biaya + limit
// + akun Debit/Kredit, zona wilayah (padanan General Setting: ClaimTmpl +
// ExpenseDefinition + Rules + DomesticZone + Expense Chart of Account).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { EntityRulesButton, EntityRulesDialog, type EntityRuleTarget } from "@/onevity/shared/components/entity-rules-dialog";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
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
import { useI18n } from "@/onevity/shared/lib/i18n";

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
  const { t } = useI18n();
  const api = useApi<{ templates: TemplateRowUI[]; expenseTypes: ExpenseTypeRowUI[]; zones: ZoneRowUI[] }>("/api/onevity/travel/templates");
  const [tab, setTab] = useState<"template" | "expense" | "zone">("template");
  const [tplDialog, setTplDialog] = useState(false);
  const [expDialog, setExpDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tplForm, setTplForm] = useState<TemplateForm>(emptyTpl);
  const [expForm, setExpForm] = useState<ExpenseForm>(emptyExp);
  const [rulesTarget, setRulesTarget] = useState<EntityRuleTarget | null>(null);

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
    if (!tplForm.code.trim() || !tplForm.name.trim()) { toast.error(t("Kode & nama template wajib diisi", "Template code & name are required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/travel/templates", "POST", { kind: "template", ...tplForm, settlementDay: Number(tplForm.settlementDay) || 0 });
      toast.success(t("Template {c} {v}", "Template {c} {v}", { c: tplForm.code, v: tplForm.id ? t("diperbarui", "updated") : t("dibuat", "created") }));
      setTplDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan template", "Failed to save the template"));
    } finally { setBusy(false); }
  };

  const saveExpense = async () => {
    if (!expForm.code.trim() || !expForm.name.trim()) { toast.error(t("Kode & nama jenis biaya wajib diisi", "Expense type code & name are required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/travel/templates", "POST", {
        kind: "expense", ...expForm, limitAmount: Number(expForm.limitAmount) || 0,
      });
      toast.success(t("Jenis biaya {c} {v}", "Expense type {c} {v}", { c: expForm.code, v: expForm.id ? t("diperbarui", "updated") : t("dibuat", "created") }));
      setExpDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan jenis biaya", "Failed to save the expense type"));
    } finally { setBusy(false); }
  };

  const TABS = [
    { key: "template", label: "Template", icon: LayoutTemplate, count: templates.length },
    { key: "expense", label: t("Jenis Biaya & Limit", "Expense Types & Limits"), icon: Boxes, count: expenseTypes.length },
    { key: "zone", label: t("Zona Wilayah", "Zones"), icon: MapPin, count: zones.length },
  ] as const;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL TRAVEL", "TRAVEL MODULE")}
        title={t("Master Perjalanan Dinas", "Business Travel Master")}
        description={t("Template (hari jatuh tempo settlement), jenis biaya + limit + akun jurnal, dan zona wilayah — padanan General Setting (12 halaman → 3 tab)", "Templates (settlement due days), expense types + limits + journal accounts, and zones — General Setting equivalent (12 pages → 3 tabs)")}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-colors",
              tab === tb.key ? "ov-fill shadow-sm" : "bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800",
            )}
          >
            <tb.icon className="h-3.5 w-3.5" /> {tb.label} <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", tab === tb.key ? "bg-white/20" : "bg-stone-100 dark:bg-stone-800")}>{tb.count}</span>
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {tab === "template" && (
            <Button onClick={() => { setTplForm(emptyTpl); setTplDialog(true); }} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Template Baru", "New Template")}
            </Button>
          )}
          {tab === "expense" && (
            <Button onClick={() => { setExpForm(emptyExp); setExpDialog(true); }} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Jenis Biaya Baru", "New Expense Type")}
            </Button>
          )}
        </div>
      </div>

      {api.loading && !api.data ? (
        <LoadingRows rows={6} />
      ) : tab === "template" ? (
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-0">
            {templates.length === 0 ? (
              <EmptyState icon={LayoutTemplate} title={t("Belum ada template", "No templates yet")} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-stone-50 dark:hover:bg-stone-800/60">
                      <TableHead>{t("Kode")}</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead className="hidden md:table-cell">{t("Deskripsi", "Description")}</TableHead>
                      <TableHead>Settlement</TableHead>
                      <TableHead className="text-center">Default</TableHead>
                      <TableHead className="text-right">{t("Dipakai", "Used")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((tpl) => (
                      <TableRow key={tpl.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/60">
                        <TableCell className="font-mono text-xs font-bold ov-text-accent">{tpl.code}</TableCell>
                        <TableCell className="text-sm font-semibold text-stone-900 dark:text-stone-100">{tpl.name}</TableCell>
                        <TableCell className="hidden max-w-xs truncate text-xs text-stone-500 md:table-cell">{tpl.description ?? "—"}</TableCell>
                        <TableCell>
                          <p className="flex items-center gap-1 text-xs font-bold text-stone-700 dark:text-stone-300">
                            <Clock className="h-3 w-3" /> {t("{n} hari", "{n} days", { n: tpl.settlementDay })}
                          </p>
                          <p className="text-[11px] text-stone-500">{tpl.settlementMethod}</p>
                        </TableCell>
                        <TableCell className="text-center">
                          {tpl.isDefault ? <Badge className="bg-primary/10 text-[10px] font-bold text-primary">DEFAULT</Badge> : <span className="text-stone-300">—</span>}
                        </TableCell>
                        <TableCell className="text-right text-[11px] text-stone-500">{t("{n} req · {m} klaim", "{n} req · {m} claims", { n: tpl.requestCount, m: tpl.claimCount })}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => {
                            setTplForm({
                              id: tpl.id, code: tpl.code, name: tpl.name, description: tpl.description ?? "",
                              settlementDay: String(tpl.settlementDay), settlementMethod: tpl.settlementMethod, isDefault: tpl.isDefault,
                            });
                            setTplDialog(true);
                          }}>
                            <Pencil className="h-3 w-3" /> {t("Ubah")}
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
            <Card key={kind} className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <CircleDollarSign className="h-4 w-4 ov-text-accent" />
                  {EXPENSE_KIND_LABEL[kind] ?? kind}
                  <Badge variant="secondary" className="text-[10px] font-bold">{list.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-stone-50 dark:hover:bg-stone-800/60">
                        <TableHead>{t("Kode")}</TableHead>
                        <TableHead>{t("Nama")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("Deskripsi", "Description")}</TableHead>
                        <TableHead className="text-right">Limit</TableHead>
                        <TableHead className="hidden lg:table-cell">{t("Akun (D/K)", "Account (D/C)")}</TableHead>
                        <TableHead className="text-center">{t("Dokumen", "Docs")}</TableHead>
                        <TableHead>{t("Aturan", "Rules")}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.map((et) => (
                        <TableRow key={et.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/60">
                          <TableCell className="font-mono text-xs font-bold ov-text-accent">{et.code}</TableCell>
                          <TableCell className="text-sm font-semibold text-stone-900 dark:text-stone-100">{et.name}</TableCell>
                          <TableCell className="hidden max-w-[200px] truncate text-xs text-stone-500 md:table-cell">{et.description ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {et.unlimited ? (
                              <Badge variant="secondary" className="text-[10px] font-bold">{t("Tanpa limit", "Unlimited")}</Badge>
                            ) : et.limitAmount > 0 ? (
                              <span className="text-xs font-bold text-stone-700 dark:text-stone-300">{fmtIDR(et.limitAmount)}</span>
                            ) : (
                              <span className="text-xs text-stone-400">—</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden font-mono text-[11px] text-stone-500 lg:table-cell">
                            {et.debitAccount ?? "—"}/{et.creditAccount ?? "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {et.needDocs ? <Badge variant="outline" className="text-[9px] font-bold">{t("Perlu", "Required")}</Badge> : <span className="text-stone-300">—</span>}
                          </TableCell>
                          <TableCell>
                            <EntityRulesButton target={{ domain: "travel", id: et.id, code: et.code, name: et.name }} ruleCount={et.ruleCount ?? 0} onOpen={setRulesTarget} />
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => {
                              setExpForm({
                                id: et.id, code: et.code, name: et.name, expenseKind: et.kind, description: et.description ?? "",
                                limitAmount: et.limitAmount > 0 ? String(et.limitAmount) : "", unlimited: et.unlimited, needDocs: et.needDocs,
                                debitAccount: et.debitAccount ?? "", creditAccount: et.creditAccount ?? "",
                              });
                              setExpDialog(true);
                            }}>
                              <Pencil className="h-3 w-3" /> {t("Ubah")}
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
            <Card key={z.id} className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
              <CardContent className="flex items-start justify-between p-4">
                <div>
                  <p className="font-mono text-xs font-bold ov-text-accent">{z.code}</p>
                  <p className="mt-1 text-sm font-bold text-stone-900 dark:text-stone-100">{z.name}</p>
                  <Badge variant="secondary" className="mt-1.5 text-[9px] font-bold">{t("Zona dasar", "Base zone")}</Badge>
                </div>
                <div className={cn("rounded-xl p-2.5", z.overseas ? "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400" : "ov-tile")}>
                  {z.overseas ? <Globe2 className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={tplDialog} onOpenChange={setTplDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-5 w-5 ov-text-accent" /> {tplForm.id ? t("Ubah Template {c}", "Edit Template {c}", { c: tplForm.code }) : t("Template Baru", "New Template")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Kode *", "Code *")}</Label>
                <Input value={tplForm.code} onChange={(e) => setTplForm({ ...tplForm, code: e.target.value })} disabled={Boolean(tplForm.id)} placeholder="TRAVEL-KA" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Nama *", "Name *")}</Label>
                <Input value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} placeholder={t("Perjalanan Dinas Kereta", "Business Travel by Train")} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Deskripsi", "Description")}</Label>
              <Textarea value={tplForm.description} onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })} rows={2} className="text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Hari Jatuh Tempo Settlement", "Settlement Due Days")}</Label>
                <Input type="number" min="0" value={tplForm.settlementDay} onChange={(e) => setTplForm({ ...tplForm, settlementDay: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Metode Settlement", "Settlement Method")}</Label>
                <Select value={tplForm.settlementMethod} onValueChange={(v) => setTplForm({ ...tplForm, settlementMethod: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Kas" className="text-sm">{t("Kas (Settled by Cash)", "Cash (Settled by Cash)")}</SelectItem>
                    <SelectItem value="Payroll" className="text-sm">Payroll</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tplForm.isDefault} onChange={(e) => setTplForm({ ...tplForm, isDefault: e.target.checked })} className="h-4 w-4 accent-primary" />
              <span className="font-semibold">{t("Jadikan template default (padanan Is Default)", "Make this the default template (equivalent to Is Default)")}</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTplDialog(false)} className="font-bold">{t("Batal")}</Button>
            <Button onClick={saveTemplate} disabled={busy} className="font-bold">
              {busy ? t("Menyimpan…") : t("Simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={expDialog} onOpenChange={setExpDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 ov-text-accent" /> {expForm.id ? t("Ubah Jenis Biaya {c}", "Edit Expense Type {c}", { c: expForm.code }) : t("Jenis Biaya Baru", "New Expense Type")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Kode *", "Code *")}</Label>
                <Input value={expForm.code} onChange={(e) => setExpForm({ ...expForm, code: e.target.value })} disabled={Boolean(expForm.id)} placeholder="L-TRAIN" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Nama *", "Name *")}</Label>
                <Input value={expForm.name} onChange={(e) => setExpForm({ ...expForm, name: e.target.value })} placeholder={t("Tiket Kereta", "Train Ticket")} className="text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Kelompok (padanan tab)", "Group (tab equivalent)")}</Label>
                <Select value={expForm.expenseKind} onValueChange={(v) => setExpForm({ ...expForm, expenseKind: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GENERAL" className="text-sm">General Expense</SelectItem>
                    <SelectItem value="ALLOWANCE" className="text-sm">{t("Allowance (uang saku)", "Allowance")}</SelectItem>
                    <SelectItem value="MILEAGE" className="text-sm">{t("Mileage (jarak/BBM)", "Mileage (distance/fuel)")}</SelectItem>
                    <SelectItem value="ENTERTAINMENT" className="text-sm">{t("Entertainment (+ tamu)", "Entertainment (+ guests)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Limit Nominal (Rp)", "Amount Limit (Rp)")}</Label>
                <Input type="number" min="0" value={expForm.limitAmount} onChange={(e) => setExpForm({ ...expForm, limitAmount: e.target.value })} placeholder={t("0 = tanpa limit", "0 = no limit")} disabled={expForm.unlimited} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Deskripsi", "Description")}</Label>
              <Textarea value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} rows={2} className="text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs font-bold">
                  <Landmark className="h-3 w-3" /> {t("Akun Debit (beban)", "Debit Account (expense)")}
                </Label>
                <Input value={expForm.debitAccount} onChange={(e) => setExpForm({ ...expForm, debitAccount: e.target.value })} placeholder="5105" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs font-bold">
                  <Landmark className="h-3 w-3" /> {t("Akun Credit (kas)", "Credit Account (cash)")}
                </Label>
                <Input value={expForm.creditAccount} onChange={(e) => setExpForm({ ...expForm, creditAccount: e.target.value })} placeholder="1101" className="text-sm" />
              </div>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={expForm.unlimited} onChange={(e) => setExpForm({ ...expForm, unlimited: e.target.checked })} className="h-4 w-4 accent-primary" />
                <span className="font-semibold">{t("Tanpa limit nominal (Unlimited)", "No amount limit (Unlimited)")}</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={expForm.needDocs} onChange={(e) => setExpForm({ ...expForm, needDocs: e.target.checked })} className="h-4 w-4 accent-primary" />
                <span className="font-semibold">{t("Perlu dokumen pendukung (kwitansi)", "Requires supporting documents (receipts)")}</span>
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExpDialog(false)} className="font-bold">{t("Batal")}</Button>
            <Button onClick={saveExpense} disabled={busy} className="font-bold">
              {busy ? t("Menyimpan…") : t("Simpan")}
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
