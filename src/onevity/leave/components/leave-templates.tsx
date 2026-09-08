"use client";
// OneVity Leave — Jenis Cuti: master 12 jenis Indonesia (padanan LeaveTypeDetail.jsp)
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { EntityRulesButton, EntityRulesDialog, type EntityRuleTarget } from "@/onevity/shared/components/entity-rules-dialog";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { LeaveTypeRow } from "./leave-types";
import { Layers, Plus, Pencil, Ban, Search, CheckCircle2, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

const EMPTY_FORM = {
  code: "", name: "", description: "", unit: "DAY", entitlement: "12", maxPerRequest: "0",
  periodMode: "CALENDAR", carryOverMax: "0", waitingMonths: "0",
  paid: true, cashable: false, prorateMonthly: false, allowAdvance: false, allowHalfDay: true, needDocs: false,
};

// LABEL EN (peta paralel — render: t(label, POLICY_LABEL_EN[key]))
const POLICY_LABEL_EN: Record<string, string> = {
  paid: "Paid leave (paid absence)",
  prorateMonthly: "Monthly prorate (earned ÷12)",
  cashable: "Balance can be cashed out (UCT)",
  allowAdvance: "Allow negative balance (advance)",
  allowHalfDay: "Allow half day (AM/PM)",
  needDocs: "Requires supporting documents",
};

export function LeaveTypesPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<LeaveTypeRow | null>(null);
  const [rulesTarget, setRulesTarget] = useState<EntityRuleTarget | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const api = useApi<{ types: LeaveTypeRow[] }>("/api/onevity/leave/types?all=1");

  const types = useMemo(() => (api.data?.types ?? []).filter((ty) =>
    !query || ty.name.toLowerCase().includes(query.toLowerCase()) || ty.code.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setDialog(true); };
  const openEdit = (ty: LeaveTypeRow) => {
    setEditTarget(ty);
    setForm({
      code: ty.code, name: ty.name, description: ty.description ?? "", unit: ty.unit,
      entitlement: String(ty.entitlement), maxPerRequest: String(ty.maxPerRequest),
      periodMode: ty.periodMode, carryOverMax: String(ty.carryOverMax), waitingMonths: String(ty.waitingMonths),
      paid: ty.paid, cashable: ty.cashable, prorateMonthly: ty.prorateMonthly,
      allowAdvance: ty.allowAdvance, allowHalfDay: ty.allowHalfDay, needDocs: ty.needDocs,
    });
    setDialog(true);
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error(t("Kode & nama wajib diisi", "Code & name are required")); return; }
    setBusy(true);
    try {
      const body = {
        ...(editTarget ? { id: editTarget.id } : {}),
        code: form.code, name: form.name, description: form.description, unit: form.unit,
        entitlement: Number(form.entitlement), maxPerRequest: Number(form.maxPerRequest),
        periodMode: form.periodMode, carryOverMax: Number(form.carryOverMax), waitingMonths: Number(form.waitingMonths),
        paid: form.paid, cashable: form.cashable, prorateMonthly: form.prorateMonthly,
        allowAdvance: form.allowAdvance, allowHalfDay: form.allowHalfDay, needDocs: form.needDocs,
      };
      const res = await apiSend<{ type: LeaveTypeRow }>("/api/onevity/leave/types", editTarget ? "PATCH" : "POST", body);
      toast.success(editTarget ? t("Jenis {n} diperbarui", "Type {n} updated", { n: res.type.name }) : t("Jenis {n} dibuat", "Type {n} created", { n: res.type.name }));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan jenis cuti", "Failed to save the leave type"));
    } finally { setBusy(false); }
  };

  const toggleActive = async (ty: LeaveTypeRow) => {
    try {
      await apiSend("/api/onevity/leave/types", "PATCH", { id: ty.id, active: !ty.active });
      toast.success(ty.active ? t("{n} dinonaktifkan", "{n} deactivated", { n: ty.name }) : t("{n} diaktifkan kembali", "{n} reactivated", { n: ty.name }));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal"));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL LEAVE", "LEAVE MODULE")}
        title={t("Jenis Cuti")}
        description={t("Master jenis cuti & kebijakannya — hak, satuan, prorate, carry-over, waiting period, dokumen (padanan Leave Type)", "Leave type master & policies — entitlement, unit, prorate, carry-over, waiting period, documents (Leave Type equivalent)")}
        actions={
          <Button onClick={openCreate} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Jenis Cuti Baru", "New Leave Type")}
          </Button>
        }
      />

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <p className="text-xs font-bold text-stone-500 dark:text-stone-400">{t("{n} jenis — UU 13/2003 & PP 35/2021 + kebijakan perusahaan", "{n} types — Law 13/2003 & PP 35/2021 + company policy", { n: types.length })}</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari jenis cuti…", "Search leave types…")} className="h-8 w-52 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={8} /></div> : types.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada jenis cuti", "No leave types yet")} description={t("Buat master jenis cuti terlebih dahulu.", "Create the leave type master first.")} icon={<Layers className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Kode")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Jenis Cuti", "Leave Type")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Hak", "Entitlement")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Periode")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Kebijakan", "Policy")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Aturan", "Rules")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.map((ty) => (
                    <TableRow key={ty.id} className={cn("hover:bg-stone-50 dark:hover:bg-stone-900/60", !ty.active && "opacity-50")}>
                      <TableCell className="font-mono text-[11px] font-bold text-stone-500">{ty.code}</TableCell>
                      <TableCell>
                        <p className="text-xs font-bold text-stone-800 dark:text-stone-100">{ty.name}</p>
                        {ty.description && <p className="max-w-md text-[10px] text-stone-400">{ty.description}</p>}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-stone-700 dark:text-stone-200">
                        {ty.entitlement} {ty.unit === "MONTH" ? t("bln", "mo") : t("hr", "d")}
                      </TableCell>
                      <TableCell className="text-[11px] text-stone-500">
                        {ty.periodMode === "ANNIVERSARY" ? t("Anniversary") : t("Kalender", "Calendar")}
                        {ty.prorateMonthly && <span className="block text-[10px] text-stone-400">{t("prorate bulanan", "prorated monthly")}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {ty.paid && <Badge className="bg-emerald-100 text-[9px] font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400">{t("Dibayar", "Paid")}</Badge>}
                          {ty.cashable && <Badge className="bg-teal-100 text-[9px] font-bold text-teal-700 hover:bg-teal-100 dark:bg-teal-500/15 dark:text-teal-400">{t("Cashable")}</Badge>}
                          {ty.carryOverMax > 0 && <Badge className="bg-primary/10 text-[9px] font-bold text-primary">{t("Carry")} {ty.carryOverMax}</Badge>}
                          {ty.waitingMonths > 0 && <Badge className="bg-amber-100 text-[9px] font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">{t("Tunggu {n} bln", "Wait {n} mo", { n: ty.waitingMonths })}</Badge>}
                          {ty.allowAdvance && <Badge className="bg-rose-100 text-[9px] font-bold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400">{t("Advance")}</Badge>}
                          {ty.needDocs && <Badge className="bg-stone-100 text-[9px] font-bold text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300">{t("Dokumen", "Docs")}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <EntityRulesButton target={{ domain: "leave", id: ty.id, code: ty.code, name: ty.name }} ruleCount={ty.ruleCount ?? 0} onOpen={setRulesTarget} />
                      </TableCell>
                      <TableCell><StatusPill status={ty.active ? "Approved" : "Cancelled"} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(ty)} title={t("Ubah")}>
                            <Pencil className="h-3.5 w-3.5 text-stone-500" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleActive(ty)} title={ty.active ? t("Nonaktifkan", "Deactivate") : t("Aktifkan", "Activate")}>
                            {ty.active ? <Ban className="h-3.5 w-3.5 text-stone-400" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                          </Button>
                        </div>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4 ov-text-accent" />
              {editTarget ? t("Ubah: {n}", "Edit: {n}", { n: editTarget.name }) : t("Jenis Cuti Baru", "New Leave Type")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Kode *", "Code *")}</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} disabled={!!editTarget} placeholder="CT-THN" className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Nama *", "Name *")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cuti Tahunan" className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Deskripsi", "Description")}</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("Dasar hukum / ketentuan", "Legal basis / provisions")} className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Hak *", "Entitlement *")}</Label>
                <Input type="number" value={form.entitlement} onChange={(e) => setForm({ ...form, entitlement: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Satuan", "Unit")}</Label>
                <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAY">{t("Hari")}</SelectItem>
                    <SelectItem value="MONTH">{t("Bulan")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Max/Request")}</Label>
                <Input type="number" value={form.maxPerRequest} onChange={(e) => setForm({ ...form, maxPerRequest: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Periode")}</Label>
                <Select value={form.periodMode} onValueChange={(v) => setForm({ ...form, periodMode: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CALENDAR">{t("Kalender", "Calendar")}</SelectItem>
                    <SelectItem value="ANNIVERSARY">{t("Anniversary")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Max Carry-Over")}</Label>
                <Input type="number" value={form.carryOverMax} onChange={(e) => setForm({ ...form, carryOverMax: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Masa Tunggu (bln)", "Waiting Period (mo)")}</Label>
                <Input type="number" value={form.waitingMonths} onChange={(e) => setForm({ ...form, waitingMonths: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-stone-50 p-3 dark:bg-stone-900/60">
              {([
                ["paid", "Cuti dibayar (absen berbayar)"],
                ["prorateMonthly", "Prorate bulanan (earned ÷12)"],
                ["cashable", "Saldo bisa diuangkan (UCT)"],
                ["allowAdvance", "Boleh saldo minus (advance)"],
                ["allowHalfDay", "Izinkan setengah hari (AM/PM)"],
                ["needDocs", "Perlu dokumen pendukung"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-[11px] font-medium text-stone-600 dark:text-stone-300">
                  <Checkbox checked={form[key]} onCheckedChange={(v) => setForm({ ...form, [key]: Boolean(v) })} />
                  {t(label, POLICY_LABEL_EN[key])}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} className="text-xs font-bold">{t("Batal")}</Button>
            <Button onClick={save} disabled={busy} className="gap-1.5 text-xs font-bold">
              <Coins className="h-3.5 w-3.5" /> {editTarget ? t("Simpan") : t("Buat Jenis Cuti", "Create Leave Type")}
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
