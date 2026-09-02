"use client";
// OneVity Leave — Jenis Cuti: master 12 jenis Indonesia (padanan LeaveTypeDetail.jsp)
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
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

const EMPTY_FORM = {
  code: "", name: "", description: "", unit: "DAY", entitlement: "12", maxPerRequest: "0",
  periodMode: "CALENDAR", carryOverMax: "0", waitingMonths: "0",
  paid: true, cashable: false, prorateMonthly: false, allowAdvance: false, allowHalfDay: true, needDocs: false,
};

export function LeaveTypesPage() {
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<LeaveTypeRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const api = useApi<{ types: LeaveTypeRow[] }>("/api/onevity/leave/types?all=1");

  const types = useMemo(() => (api.data?.types ?? []).filter((t) =>
    !query || t.name.toLowerCase().includes(query.toLowerCase()) || t.code.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setDialog(true); };
  const openEdit = (t: LeaveTypeRow) => {
    setEditTarget(t);
    setForm({
      code: t.code, name: t.name, description: t.description ?? "", unit: t.unit,
      entitlement: String(t.entitlement), maxPerRequest: String(t.maxPerRequest),
      periodMode: t.periodMode, carryOverMax: String(t.carryOverMax), waitingMonths: String(t.waitingMonths),
      paid: t.paid, cashable: t.cashable, prorateMonthly: t.prorateMonthly,
      allowAdvance: t.allowAdvance, allowHalfDay: t.allowHalfDay, needDocs: t.needDocs,
    });
    setDialog(true);
  };

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error("Kode & nama wajib diisi"); return; }
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
      toast.success(editTarget ? `Jenis ${res.type.name} diperbarui` : `Jenis ${res.type.name} dibuat`);
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan jenis cuti");
    } finally { setBusy(false); }
  };

  const toggleActive = async (t: LeaveTypeRow) => {
    try {
      await apiSend("/api/onevity/leave/types", "PATCH", { id: t.id, active: !t.active });
      toast.success(t.active ? `${t.name} dinonaktifkan` : `${t.name} diaktifkan kembali`);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="MODUL LEAVE"
        title="Jenis Cuti"
        description="Master jenis cuti & kebijakannya — hak, satuan, prorate, carry-over, waiting period, dokumen (padanan Leave Type oranHR)"
        actions={
          <Button onClick={openCreate} className="gap-2 bg-orange-600 font-bold hover:bg-orange-700">
            <Plus className="h-4 w-4" /> Jenis Cuti Baru
          </Button>
        }
      />

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <p className="text-xs font-bold text-stone-500 dark:text-stone-400">{types.length} jenis — UU 13/2003 & PP 35/2021 + kebijakan perusahaan</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari jenis cuti…" className="h-8 w-52 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={8} /></div> : types.length === 0 ? (
            <div className="p-5"><EmptyState title="Belum ada jenis cuti" description="Buat master jenis cuti terlebih dahulu." icon={<Layers className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Kode</TableHead>
                    <TableHead className="text-[11px] font-bold">Jenis Cuti</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Hak</TableHead>
                    <TableHead className="text-[11px] font-bold">Periode</TableHead>
                    <TableHead className="text-[11px] font-bold">Kebijakan</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.map((t) => (
                    <TableRow key={t.id} className={cn("hover:bg-stone-50 dark:hover:bg-stone-900/60", !t.active && "opacity-50")}>
                      <TableCell className="font-mono text-[11px] font-bold text-stone-500">{t.code}</TableCell>
                      <TableCell>
                        <p className="text-xs font-bold text-stone-800 dark:text-stone-100">{t.name}</p>
                        {t.description && <p className="max-w-md text-[10px] text-stone-400">{t.description}</p>}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-stone-700 dark:text-stone-200">
                        {t.entitlement} {t.unit === "MONTH" ? "bln" : "hr"}
                      </TableCell>
                      <TableCell className="text-[11px] text-stone-500">
                        {t.periodMode === "ANNIVERSARY" ? "Anniversary" : "Kalender"}
                        {t.prorateMonthly && <span className="block text-[10px] text-stone-400">prorate bulanan</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {t.paid && <Badge className="bg-emerald-100 text-[9px] font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400">Dibayar</Badge>}
                          {t.cashable && <Badge className="bg-teal-100 text-[9px] font-bold text-teal-700 hover:bg-teal-100 dark:bg-teal-500/15 dark:text-teal-400">Cashable</Badge>}
                          {t.carryOverMax > 0 && <Badge className="bg-orange-100 text-[9px] font-bold text-orange-700 hover:bg-orange-100 dark:bg-orange-500/15 dark:text-orange-400">Carry {t.carryOverMax}</Badge>}
                          {t.waitingMonths > 0 && <Badge className="bg-amber-100 text-[9px] font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">Tunggu {t.waitingMonths} bln</Badge>}
                          {t.allowAdvance && <Badge className="bg-rose-100 text-[9px] font-bold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400">Advance</Badge>}
                          {t.needDocs && <Badge className="bg-stone-100 text-[9px] font-bold text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300">Dokumen</Badge>}
                        </div>
                      </TableCell>
                      <TableCell><StatusPill status={t.active ? "Approved" : "Cancelled"} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)} title="Ubah">
                            <Pencil className="h-3.5 w-3.5 text-stone-500" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleActive(t)} title={t.active ? "Nonaktifkan" : "Aktifkan"}>
                            {t.active ? <Ban className="h-3.5 w-3.5 text-stone-400" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
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
              <Layers className="h-4 w-4 text-orange-600" />
              {editTarget ? `Ubah: ${editTarget.name}` : "Jenis Cuti Baru"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Kode *</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} disabled={!!editTarget} placeholder="CT-THN" className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Nama *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cuti Tahunan" className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Deskripsi</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Dasar hukum / ketentuan" className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Hak *</Label>
                <Input type="number" value={form.entitlement} onChange={(e) => setForm({ ...form, entitlement: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Satuan</Label>
                <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAY">Hari</SelectItem>
                    <SelectItem value="MONTH">Bulan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Max/Request</Label>
                <Input type="number" value={form.maxPerRequest} onChange={(e) => setForm({ ...form, maxPerRequest: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Periode</Label>
                <Select value={form.periodMode} onValueChange={(v) => setForm({ ...form, periodMode: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CALENDAR">Kalender</SelectItem>
                    <SelectItem value="ANNIVERSARY">Anniversary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Max Carry-Over</Label>
                <Input type="number" value={form.carryOverMax} onChange={(e) => setForm({ ...form, carryOverMax: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Masa Tunggu (bln)</Label>
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
                  {label}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} className="text-xs font-bold">Batal</Button>
            <Button onClick={save} disabled={busy} className="gap-1.5 bg-orange-600 text-xs font-bold hover:bg-orange-700">
              <Coins className="h-3.5 w-3.5" /> {editTarget ? "Simpan" : "Buat Jenis Cuti"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
