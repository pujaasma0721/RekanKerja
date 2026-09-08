"use client";
// OneVity Leave — Cuti Massal (SKB cuti bersama, padanan MassLeave.jsp):
// generate baris permintaan per karyawan org + exclude hari non-kerja & bentrok.
import { useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { LeaveTypeRow, MassLeaveRowUI } from "./leave-types";
import { Users, Plus, Megaphone, CalendarDays, ShieldCheck } from "lucide-react";
import { useI18n } from "@/onevity/shared/lib/i18n";

const todayISO = () => new Date().toISOString().slice(0, 10);

export function LeaveMassPage() {
  const { navigate } = useNav();
  const { t, locale } = useI18n();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    leaveTypeId: "", letterNo: "", dateFrom: todayISO(), dateTo: todayISO(),
    amount: "1", orgUnitName: "", excludeNonWorking: true, excludeConflicted: true, note: "",
  });

  const api = useApi<{ massLeaves: MassLeaveRowUI[] }>("/api/onevity/leave/mass");
  const typesApi = useApi<{ types: LeaveTypeRow[] }>("/api/onevity/leave/types");

  const submit = async () => {
    if (!form.leaveTypeId) { toast.error(t("Jenis cuti wajib dipilih", "Leave type is required")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; employees: number; generated: number; skippedConflict: number; skippedBalance: number; totalDays: number }>(
        "/api/onevity/leave/mass", "POST",
        {
          leaveTypeId: form.leaveTypeId, letterNo: form.letterNo || undefined,
          dateFrom: form.dateFrom, dateTo: form.dateTo,
          amount: Number(form.amount), orgUnitName: form.orgUnitName || undefined,
          excludeNonWorking: form.excludeNonWorking, excludeConflicted: form.excludeConflicted,
          note: form.note || undefined,
        },
      );
      toast.success(
        t("{doc}: {g}/{e} karyawan ter-generate ({d} hari)", "{doc}: {g}/{e} employees generated ({d} days)", { doc: res.docNo, g: res.generated, e: res.employees, d: res.totalDays }) +
        (res.skippedConflict ? t(", {n} dilewati bentrok", ", {n} skipped due to conflict", { n: res.skippedConflict }) : "") +
        (res.skippedBalance ? t(", {n} saldo tidak cukup", ", {n} with insufficient balance", { n: res.skippedBalance }) : ""),
        { duration: 7000 },
      );
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membuat cuti massal", "Failed to create the mass leave"));
    } finally { setBusy(false); }
  };

  const rows = api.data?.massLeaves ?? [];

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL LEAVE", "LEAVE MODULE")}
        title={t("Cuti Massal (SKB Cuti Bersama)", "Mass Leave (Joint SKB)")}
        description={t("Cuti bersama pemerintah / lockdown per organisasi — baris permintaan cuti dibuat otomatis per karyawan (padanan Mass Leave)", "Government joint leave / lockdown per organization — leave request rows are created automatically per employee (Mass Leave equivalent)")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("leave", "leave-request")} className="gap-2 font-bold">
              <CalendarDays className="h-4 w-4" /> {t("Lihat Baris Ter-generate", "View Generated Rows")}
            </Button>
            <Button onClick={() => {
              setForm({
                leaveTypeId: (typesApi.data?.types ?? []).find((ty) => ty.code === "CT-THN")?.id ?? "",
                letterNo: "", dateFrom: todayISO(), dateTo: todayISO(),
                amount: "1", orgUnitName: "", excludeNonWorking: true, excludeConflicted: true, note: "",
              });
              setDialog(true);
            }} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Cuti Massal Baru", "New Mass Leave")}
            </Button>
          </div>
        }
      />

      <div className="mb-4 rounded-2xl border ov-border-accent ov-soft p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl ov-tile p-2"><Megaphone className="h-5 w-5" /></div>
          <div>
            <p className="text-sm font-bold text-stone-800 dark:text-stone-100">{t("Mekanisme SKB 3 Menteri", "SKB 3-Minister Joint Decree Mechanism")}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
              {t("Cuti bersama resmi (mis. menjelang Idulfitri) dijalankan lewat cuti massal: pilih tanggal + jenis cuti penanggung saldo, sistem membuat baris permintaan ", "Official joint leave (e.g. ahead of Eid) is run as mass leave: pick the dates + the balance-bearing leave type, and the system creates request rows ")}<b>{t("status Cuti Massal", "with Mass Leave status")}</b>{t(" untuk setiap karyawan organisasi — hari non-kerja & yang sudah punya cuti otomatis dilewati. Contoh nyata MII: 3 tanggal SKB ditanggung saldo Cuti Besar.", " for every employee in the organization — non-working days and those already on leave are skipped automatically. Real MII example: 3 SKB dates charged to the Cuti Besar balance.")}
            </p>
          </div>
        </div>
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <p className="text-xs font-bold text-stone-500 dark:text-stone-400">{t("Riwayat cuti massal — {n} entri", "Mass leave history — {n} entries", { n: rows.length })}</p>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={4} /></div> : rows.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada cuti massal", "No mass leave yet")} description={t("Buat cuti massal untuk cuti bersama SKB atau kebijakan perusahaan.", "Create mass leave for SKB joint leave or company policy.")} icon={<Users className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Dokumen", "Document")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Jenis")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Rentang", "Range")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Hari/Kry", "Days/Emp")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Cakupan", "Scope")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Catatan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((m) => (
                    <TableRow key={m.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-stone-700 dark:text-stone-200">{m.docNo}</p>
                        <p className="text-[10px] text-stone-400">{m.letterNo ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-xs text-stone-700 dark:text-stone-200">{m.leaveTypeName}</TableCell>
                      <TableCell className="text-[11px] font-semibold text-stone-700 dark:text-stone-200">
                        {new Date(m.dateFrom).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
                        {m.dateTo !== m.dateFrom && ` → ${new Date(m.dateTo).toLocaleDateString(locale, { day: "2-digit", month: "short" })}`}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-stone-700 dark:text-stone-200">{m.amount}</TableCell>
                      <TableCell className="text-right">
                        <p className="text-xs font-extrabold ov-text-accent">{m.generated}</p>
                        <p className="text-[10px] text-stone-400">{t("ter-generate", "generated")}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-[11px] text-stone-600 dark:text-stone-300">{m.orgUnitName ?? t("Seluruh organisasi", "Entire organization")}</p>
                        <div className="mt-0.5 flex gap-1">
                          {m.excludeNonWorking && <Badge className="bg-stone-100 text-[9px] font-bold text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300">{t("Lewati non-kerja", "Skip non-working")}</Badge>}
                          {m.excludeConflicted && <Badge className="bg-stone-100 text-[9px] font-bold text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300">{t("Lewati bentrok", "Skip conflicts")}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-64 text-[10px] text-stone-400">{m.note ?? "—"}</TableCell>
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
              <Users className="h-4 w-4 ov-text-accent" /> {t("Cuti Massal Baru", "New Mass Leave")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Jenis Cuti *", "Leave Type *")}</Label>
                <Select value={form.leaveTypeId} onValueChange={(v) => setForm({ ...form, leaveTypeId: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("Penanggung saldo", "Balance-bearing type")} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(typesApi.data?.types ?? []).map((ty) => (
                      <SelectItem key={ty.id} value={ty.id}>{ty.name} ({ty.entitlement} {ty.unit === "MONTH" ? t("bln", "mo") : t("hr", "d")})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("No. Surat (SKB)", "Letter No. (SKB)")}</Label>
                <Input value={form.letterNo} onChange={(e) => setForm({ ...form, letterNo: e.target.value })} placeholder={t("mis. SKB-3M-2026-17", "e.g. SKB-3M-2026-17")} className="h-8 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tanggal Mulai *", "Start Date *")}</Label>
                <Input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tanggal Selesai *", "End Date *")}</Label>
                <Input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Hari / Karyawan", "Days / Employee")}</Label>
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Organisasi (kosong = semua)", "Organization (empty = all)")}</Label>
              <Input value={form.orgUnitName} onChange={(e) => setForm({ ...form, orgUnitName: e.target.value })} placeholder={t("mis. PRODUKSI (termasuk sub-org)", "e.g. PRODUCTION (incl. sub-orgs)")} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan")}</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t("mis. SKB cuti bersama 17 Sep", "e.g. SKB joint leave Sep 17")} className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-stone-50 p-3 dark:bg-stone-900/60">
              <label className="flex items-center gap-2 text-[11px] font-medium text-stone-600 dark:text-stone-300">
                <Checkbox checked={form.excludeNonWorking} onCheckedChange={(v) => setForm({ ...form, excludeNonWorking: Boolean(v) })} />
                {t("Lewati hari non-kerja (jadwal)", "Skip non-working days (schedule)")}
              </label>
              <label className="flex items-center gap-2 text-[11px] font-medium text-stone-600 dark:text-stone-300">
                <Checkbox checked={form.excludeConflicted} onCheckedChange={(v) => setForm({ ...form, excludeConflicted: Boolean(v) })} />
                {t("Lewati karyawan bentrok cuti", "Skip employees with conflicting leave")}
              </label>
            </div>
            <div className="flex items-start gap-2 rounded-lg ov-soft p-2.5 text-[11px] leading-relaxed">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>{t("Baris cuti massal langsung berstatus ", "Mass leave rows are immediately set to ")}<b>{t("Cuti Massal", "Mass Leave")}</b>{t(" (efektif, tanpa approval per karyawan) — karyawan dengan saldo tidak cukup otomatis dilewati agar saldo tidak minus.", " (effective, without per-employee approval) — employees with insufficient balance are skipped automatically to keep balances non-negative.")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} className="text-xs font-bold">{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy} className="gap-1.5 text-xs font-bold">
              <Users className="h-3.5 w-3.5" /> {t("Generate Cuti Massal", "Generate Mass Leave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
