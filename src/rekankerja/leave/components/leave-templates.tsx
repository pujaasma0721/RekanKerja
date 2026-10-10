"use client";
// RekanKerja Leave — Jenis Cuti: master 12 jenis Indonesia (padanan LeaveTypeDetail.jsp)
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { EntityRulesButton, EntityRulesDialog, type EntityRuleTarget } from "@/rekankerja/shared/components/entity-rules-dialog";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
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
import { LeaveTypeRow, parseBlackoutDates } from "./leave-types";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, num, sel, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";
import { Layers, Plus, Pencil, Ban, Search, CheckCircle2, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

/** Baris form periode sibuk (belum terserialisasi). */
type BlackoutFormRow = { from: string; to: string; note: string };

const EMPTY_FORM = {
  code: "", name: "", description: "", unit: "DAY", entitlement: "12", maxPerRequest: "0",
  periodMode: "CALENDAR", carryOverMax: "0", waitingMonths: "0",
  paid: true, cashable: false, prorateMonthly: false, allowAdvance: false, allowHalfDay: true, needDocs: false,
  // Task 99 — policy v2 ringan: notice period, batas hari berturut, blackout.
  noticeDays: "0", maxConsecutiveDays: "0", blackouts: [] as BlackoutFormRow[],
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

/** Task adv-search — field Advance Search master jenis cuti (client-side,
 *  filter TAMBAHAN di atas query yang sudah ada; `active` boolean dikonversi
 *  jadi pilihan "true"/"false" via getter). */
const ADV_FIELDS: AdvFieldDef<LeaveTypeRow>[] = [
  txt("code", "Kode", "Code"),
  txt("name", "Jenis Cuti", "Leave Type"),
  sel("unit", "Satuan", "Unit", [["DAY", "Hari", "Day"], ["MONTH", "Bulan", "Month"]]),
  num("entitlement", "Hak", "Entitlement"),
  num("noticeDays", "Notice (hari)", "Notice (days)"),
  sel("active", "Status", "Status", [["true", "Aktif", "Active"], ["false", "Nonaktif", "Inactive"]], (ty) => String(ty.active)),
];

export function LeaveTypesPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  // Task adv-search — kondisi advance search (filter tambahan di atas query).
  const [adv, setAdv] = useState<AdvSearch | null>(null);
  const [dialog, setDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<LeaveTypeRow | null>(null);
  const [rulesTarget, setRulesTarget] = useState<EntityRuleTarget | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const api = useApi<{ types: LeaveTypeRow[] }>("/api/rekankerja/leave/types?all=1");

  const types = useMemo(() => filterRowsByAdv((api.data?.types ?? []).filter((ty) =>
    !query || ty.name.toLowerCase().includes(query.toLowerCase()) || ty.code.toLowerCase().includes(query.toLowerCase())
  ), adv, ADV_FIELDS), [api.data, query, adv]);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setDialog(true); };
  const openEdit = (ty: LeaveTypeRow) => {
    setEditTarget(ty);
    setForm({
      code: ty.code, name: ty.name, description: ty.description ?? "", unit: ty.unit,
      entitlement: String(ty.entitlement), maxPerRequest: String(ty.maxPerRequest),
      periodMode: ty.periodMode, carryOverMax: String(ty.carryOverMax), waitingMonths: String(ty.waitingMonths),
      paid: ty.paid, cashable: ty.cashable, prorateMonthly: ty.prorateMonthly,
      allowAdvance: ty.allowAdvance, allowHalfDay: ty.allowHalfDay, needDocs: ty.needDocs,
      noticeDays: String(ty.noticeDays ?? 0), maxConsecutiveDays: String(ty.maxConsecutiveDays ?? 0),
      // prefill blackout — parse aman (fallback []) dari JSON string master
      blackouts: parseBlackoutDates(ty.blackoutDates).map((bo) => ({ from: bo.from, to: bo.to, note: bo.note ?? "" })),
    });
    setDialog(true);
  };

  const setBlackout = (i: number, key: keyof BlackoutFormRow, value: string) => {
    setForm((f) => ({ ...f, blackouts: f.blackouts.map((bo, j) => (j === i ? { ...bo, [key]: value } : bo)) }));
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error(t("Kode & nama wajib diisi", "Code & name are required")); return; }
    setBusy(true);
    try {
      // serialisasi blackout: hanya pasangan lengkap (dari+sampai) yang disimpan
      const blackouts = form.blackouts
        .filter((bo) => bo.from && bo.to)
        .map((bo) => ({ from: bo.from, to: bo.to, ...(bo.note.trim() ? { note: bo.note.trim() } : {}) }));
      const body = {
        ...(editTarget ? { id: editTarget.id } : {}),
        code: form.code, name: form.name, description: form.description, unit: form.unit,
        entitlement: Number(form.entitlement), maxPerRequest: Number(form.maxPerRequest),
        periodMode: form.periodMode, carryOverMax: Number(form.carryOverMax), waitingMonths: Number(form.waitingMonths),
        paid: form.paid, cashable: form.cashable, prorateMonthly: form.prorateMonthly,
        allowAdvance: form.allowAdvance, allowHalfDay: form.allowHalfDay, needDocs: form.needDocs,
        noticeDays: Math.max(0, Number(form.noticeDays) || 0),
        maxConsecutiveDays: Math.max(0, Number(form.maxConsecutiveDays) || 0),
        blackoutDates: JSON.stringify(blackouts),
      };
      const res = await apiSend<{ type: LeaveTypeRow }>("/api/rekankerja/leave/types", editTarget ? "PATCH" : "POST", body);
      toast.success(editTarget ? t("Jenis {n} diperbarui", "Type {n} updated", { n: res.type.name }) : t("Jenis {n} dibuat", "Type {n} created", { n: res.type.name }));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan jenis cuti", "Failed to save the leave type"));
    } finally { setBusy(false); }
  };

  const toggleActive = async (ty: LeaveTypeRow) => {
    try {
      await apiSend("/api/rekankerja/leave/types", "PATCH", { id: ty.id, active: !ty.active });
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

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{t("{n} jenis — UU 13/2003 & PP 35/2021 + kebijakan perusahaan", "{n} types — Law 13/2003 & PP 35/2021 + company policy", { n: types.length })}</p>
            <div className="flex items-center gap-2">
              <AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={setAdv} />
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari jenis cuti…", "Search leave types…")} className="h-8 w-52 pl-8 text-xs" />
              </div>
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={8} /></div> : types.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada jenis cuti", "No leave types yet")} description={t("Buat master jenis cuti terlebih dahulu.", "Create the leave type master first.")} icon={<Layers className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
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
                    <TableRow key={ty.id} className={cn("hover:bg-slate-50 dark:hover:bg-slate-900/60", !ty.active && "opacity-50")}>
                      <TableCell className="font-mono text-[11px] font-bold text-slate-500">{ty.code}</TableCell>
                      <TableCell>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{ty.name}</p>
                        {ty.description && <p className="max-w-md text-[10px] text-slate-400">{ty.description}</p>}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
                        {ty.entitlement} {ty.unit === "MONTH" ? t("bln", "mo") : t("hr", "d")}
                      </TableCell>
                      <TableCell className="text-[11px] text-slate-500">
                        {ty.periodMode === "ANNIVERSARY" ? t("Anniversary") : t("Kalender", "Calendar")}
                        {ty.prorateMonthly && <span className="block text-[10px] text-slate-400">{t("prorate bulanan", "prorated monthly")}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {ty.paid && <Badge className="bg-brand/15 text-[9px] font-bold text-brand-deep hover:bg-brand/15 dark:bg-brand/15 dark:text-brand/85">{t("Dibayar", "Paid")}</Badge>}
                          {ty.cashable && <Badge className="bg-brand/15 text-[9px] font-bold text-brand-deep hover:bg-brand/15 dark:bg-brand/15 dark:text-brand/85">{t("Bisa Diuangkan", "Cashable")}</Badge>}
                          {ty.carryOverMax > 0 && <Badge className="bg-primary/10 text-[9px] font-bold text-primary">{t("Bawa", "Carry")} {ty.carryOverMax}</Badge>}
                          {ty.waitingMonths > 0 && <Badge className="bg-amber-100 text-[9px] font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">{t("Tunggu {n} bln", "Wait {n} mo", { n: ty.waitingMonths })}</Badge>}
                          {ty.allowAdvance && <Badge className="bg-rose-100 text-[9px] font-bold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400">{t("Advance", "Advance")}</Badge>}
                          {ty.needDocs && <Badge className="bg-slate-100 text-[9px] font-bold text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300">{t("Dokumen", "Docs")}</Badge>}
                          {/* Task 99 — policy v2: notice, hari berturut, blackout */}
                          {ty.noticeDays > 0 && <Badge className="bg-primary/10 text-[9px] font-bold text-primary">{t("Notice {n}hr", "Notice {n}d", { n: ty.noticeDays })}</Badge>}
                          {ty.maxConsecutiveDays > 0 && <Badge className="bg-amber-100 text-[9px] font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">{t("Maks {n}hr berturut", "Max {n}d consecutive", { n: ty.maxConsecutiveDays })}</Badge>}
                          {parseBlackoutDates(ty.blackoutDates).length > 0 && (
                            <Badge className="bg-rose-100 text-[9px] font-bold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400">
                              {t("Blackout ×{k}", "Blackout ×{k}", { k: parseBlackoutDates(ty.blackoutDates).length })}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <EntityRulesButton target={{ domain: "leave", id: ty.id, code: ty.code, name: ty.name }} ruleCount={ty.ruleCount ?? 0} onOpen={setRulesTarget} />
                      </TableCell>
                      <TableCell><StatusPill status={ty.active ? "Approved" : "Cancelled"} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(ty)} title={t("Ubah")}>
                            <Pencil className="h-3.5 w-3.5 text-slate-500" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleActive(ty)} title={ty.active ? t("Nonaktifkan", "Deactivate") : t("Aktifkan", "Activate")}>
                            {ty.active ? <Ban className="h-3.5 w-3.5 text-slate-400" /> : <CheckCircle2 className="h-3.5 w-3.5 text-brand" />}
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
        <DialogContent className="sm:max-w-2xl">
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
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("Cuti Tahunan", "Annual Leave")} className="h-8 text-xs" />
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
                <Label className="text-xs font-bold">{t("Maks/Pengajuan", "Max/Request")}</Label>
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
                <Label className="text-xs font-bold">{t("Maks Carry-Over", "Max Carry-Over")}</Label>
                <Input type="number" value={form.carryOverMax} onChange={(e) => setForm({ ...form, carryOverMax: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Masa Tunggu (bln)", "Waiting Period (mo)")}</Label>
                <Input type="number" value={form.waitingMonths} onChange={(e) => setForm({ ...form, waitingMonths: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>
            {/* Task 99 — policy v2 ringan: notice period + batas hari berturut */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Notice Period (hari)", "Notice Period (days)")}</Label>
                <Input type="number" value={form.noticeDays} onChange={(e) => setForm({ ...form, noticeDays: e.target.value })} className="h-8 text-xs" />
                <p className="text-[10px] text-slate-400">{t("0 = bebas", "0 = unrestricted")}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Maks Hari Kerja Berturut", "Max Consecutive Working Days")}</Label>
                <Input type="number" value={form.maxConsecutiveDays} onChange={(e) => setForm({ ...form, maxConsecutiveDays: e.target.value })} className="h-8 text-xs" />
                <p className="text-[10px] text-slate-400">{t("termasuk permintaan berdampingan; 0 = bebas", "includes adjacent requests; 0 = unrestricted")}</p>
              </div>
            </div>
            {/* Task 99 — periode sibuk (blackout): repeater pasangan tanggal */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">{t("Periode Sibuk (Blackout)", "Busy Period (Blackout)")}</Label>
                <Button
                  type="button" size="sm" variant="outline"
                  disabled={form.blackouts.length >= 6}
                  onClick={() => setForm({ ...form, blackouts: [...form.blackouts, { from: "", to: "", note: "" }] })}
                  className="h-6 gap-1 px-2 text-[10px] font-bold"
                >
                  <Plus className="h-3 w-3" /> {t("Tambah periode", "Add period")}
                </Button>
              </div>
              {form.blackouts.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-400 dark:bg-slate-900/60">
                  {t("Tidak ada periode sibuk — cuti bisa diajukan kapan saja.", "No busy period — leave can be requested anytime.")}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {form.blackouts.map((bo, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                      <Input type="date" value={bo.from} onChange={(e) => setBlackout(i, "from", e.target.value)} className="h-7 w-36 text-xs" aria-label={t("Dari", "From")} />
                      <span className="text-[10px] font-bold text-slate-400">→</span>
                      <Input type="date" value={bo.to} onChange={(e) => setBlackout(i, "to", e.target.value)} className="h-7 w-36 text-xs" aria-label={t("Sampai", "Until")} />
                      <Input value={bo.note} onChange={(e) => setBlackout(i, "note", e.target.value)} placeholder={t("catatan (opsional)", "note (optional)")} className="h-7 min-w-24 flex-1 text-xs" />
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setForm({ ...form, blackouts: form.blackouts.filter((_, j) => j !== i) })} title={t("Hapus periode", "Remove period")}>
                        <Ban className="h-3.5 w-3.5 text-rose-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-400">{t("Cuti pada rentang ini ditolak saat pengajuan (mis. tutup buku / produksi puncak).", "Leave within these ranges is rejected at submission (e.g. year-end close / peak production).")}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
              {([
                ["paid", "Cuti dibayar (absen berbayar)"],
                ["prorateMonthly", "Prorate bulanan (earned ÷12)"],
                ["cashable", "Saldo bisa diuangkan (UCT)"],
                ["allowAdvance", "Boleh saldo minus (advance)"],
                ["allowHalfDay", "Izinkan setengah hari (AM/PM)"],
                ["needDocs", "Perlu dokumen pendukung"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
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
