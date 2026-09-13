"use client";
// OneVity ESS — Cuti Saya: tabel saldo (hak/terpakai/pending/tersedia), daftar
// permintaan dengan badge jenjang approval, dan dialog pengajuan
// (jenis dari saldo, tanggal dari-sampai, half-day, alasan wajib; error 400
// server tampil inline di dalam dialog).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Palmtree, Plus, Send, Loader2, AlertTriangle, Clock3, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, fmtDate } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ESS_BASE, submitLeave, pickNum } from "./ess-api";
import type { EssLeaveData } from "./ess-types";

const todayISO = () => new Date().toISOString().slice(0, 10);

interface EssLeavePageProps { intent: string | null }

export function EssLeavePage({ intent }: EssLeavePageProps) {
  const { t } = useI18n();
  const api = useApi<EssLeaveData>(`${ESS_BASE}/leave`);
  // intent "new" dari aksi cepat dashboard → dialog langsung terbuka
  const [dialog, setDialog] = useState(() => intent === "new");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    typeId: "",
    dateFrom: todayISO(),
    dateTo: todayISO(),
    halfDay: false,
    reason: "",
  });

  const balances = api.data?.balances ?? [];
  const requests = api.data?.requests ?? [];

  // jenis yang bisa diajukan — butuh id/typeId utk submit { typeId }
  const submitTypes = useMemo(
    () => balances.map((b) => ({ id: (b.id ?? b.typeId ?? "") as string, name: b.name, available: b.available ?? 0 })).filter((x) => x.id),
    [balances],
  );

  const daysHint = useMemo(() => {
    const a = new Date(form.dateFrom);
    const b = new Date(form.dateTo);
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  }, [form.dateFrom, form.dateTo]);

  const submit = async () => {
    if (busy) return;
    if (!form.typeId) { setFormError(t("Pilih jenis cuti terlebih dahulu.", "Please choose a leave type first.")); return; }
    if (!form.dateFrom || !form.dateTo) { setFormError(t("Tanggal mulai dan selesai wajib diisi.", "Start and end dates are required.")); return; }
    if (form.dateTo < form.dateFrom) { setFormError(t("Tanggal selesai tidak boleh sebelum tanggal mulai.", "The end date cannot precede the start date.")); return; }
    if (!form.reason.trim()) { setFormError(t("Alasan cuti wajib diisi.", "A leave reason is required.")); return; }
    setBusy(true);
    setFormError(null);
    try {
      const res = await submitLeave({
        typeId: form.typeId,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
        halfDay: form.halfDay || undefined,
        reason: form.reason.trim(),
      });
      toast.success(t("{doc} diajukan — status {status}", "{doc} submitted — status {status}", { doc: res.docNo, status: res.status }));
      setDialog(false);
      setForm({ typeId: "", dateFrom: todayISO(), dateTo: todayISO(), halfDay: false, reason: "" });
      api.refresh();
    } catch (e) {
      // error 400 validasi server → inline di dialog (bukan toast)
      setFormError(e instanceof Error ? e.message : t("Gagal mengajukan cuti.", "Failed to submit the leave request."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Cuti Saya", "My Leave")}
        description={t("Saldo cuti Anda beserta riwayat & status pengajuan.", "Your leave balances along with request history & status.")}
        actions={
          <Button onClick={() => { setDialog(true); setFormError(null); }} className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
            <Plus className="h-4 w-4" /> {t("Ajukan Cuti", "Request Leave")}
          </Button>
        }
      />

      {/* ===== saldo — kartu visual (tahunan menonjol) ===== */}
      {api.loading && !api.data ? (
        <LoadingRows rows={4} />
      ) : balances.length === 0 ? (
        <EmptyState title={t("Saldo cuti belum tersedia", "Leave balance unavailable")} description={t("Saldo muncul setelah kebijakan & jenis cuti ditetapkan oleh admin.", "Balances appear once leave policy & types are configured by admin.")} icon={Palmtree} />
      ) : (() => {
        // jenis tahunan (kode CT-THN/CT-ANNIV) tampil besar; sisanya grid ringkas
        const annual = balances.filter((b) => ["CT-THN", "CT-ANNIV"].includes(String(b.code ?? "")));
        const others = balances.filter((b) => !["CT-THN", "CT-ANNIV"].includes(String(b.code ?? "")));
        const read = (b: (typeof balances)[number]) => ({
          entitlement: b.entitlement ?? pickNum(b as unknown as Record<string, unknown>, ["entitlement", "quota", "hak"]) ?? 0,
          used: b.taken ?? b.used ?? pickNum(b as unknown as Record<string, unknown>, ["taken", "used"]) ?? 0,
          pending: b.applied ?? b.pending ?? pickNum(b as unknown as Record<string, unknown>, ["applied", "pending"]) ?? 0,
          avail: b.available ?? 0,
          // Task 52-a — satuan saldo (bln utk cuti melahirkan/keguguran UU KIA).
          unit: String((b as { unit?: string }).unit ?? "DAY") === "MONTH" ? t("bln", "mo") : t("hari", "days"),
        });
        return (
          <div className="space-y-4">
            {annual.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2">
                {annual.map((b, i) => {
                  const r = read(b);
                  const pct = r.entitlement > 0 ? Math.max(4, Math.min(100, (r.avail / r.entitlement) * 100)) : 0;
                  return (
                    <motion.div
                      key={(b.code ?? "") + b.name}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-bold text-stone-800 dark:text-stone-100">{b.name}</p>
                        <p className="text-2xl font-extrabold tabular-nums text-amber-700 dark:text-amber-400">
                          {r.avail}
                          <span className="ml-1 text-xs font-bold text-stone-400">/ {r.entitlement} {r.unit}</span>
                        </p>
                      </div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600"
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-stone-500 dark:text-stone-400">
                        <span>{t("Terpakai", "Used")}: <b className="text-stone-700 dark:text-stone-200">{r.used}</b></span>
                        <span>{t("Pending", "Pending")}: <b className={r.pending > 0 ? "text-amber-600 dark:text-amber-400" : "text-stone-700 dark:text-stone-200"}>{r.pending}</b></span>
                        {b.code && <span className="font-mono text-stone-400">{b.code}</span>}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
            {others.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {others.map((b, i) => {
                  const r = read(b);
                  return (
                    <motion.div
                      key={(b.code ?? "") + b.name}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(0.2 + i * 0.03, 0.45) }}
                      className="rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-sm transition-colors hover:border-amber-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-amber-500/40"
                    >
                      <p className="truncate text-[11px] font-semibold text-stone-500 dark:text-stone-400" title={b.name}>{b.name}</p>
                      <p className="mt-1 text-lg font-extrabold tabular-nums text-stone-800 dark:text-stone-100">
                        {r.avail}
                        <span className="ml-1 text-[10px] font-bold text-stone-400">/ {r.entitlement} {r.unit}</span>
                      </p>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                        <div className="h-full rounded-full bg-amber-500" style={{ width: `${r.entitlement > 0 ? Math.max(4, Math.min(100, (r.avail / r.entitlement) * 100)) : 0}%` }} />
                      </div>
                      {r.pending > 0 && <p className="mt-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">{r.pending} {t("pending", "pending")}</p>}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ===== daftar permintaan ===== */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <CalendarRange className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden /> {t("Permintaan Cuti Saya", "My Leave Requests")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-2 pt-0">
          {api.loading && !api.data ? (
            <div className="px-6"><LoadingRows rows={5} /></div>
          ) : api.error && !api.data ? (
            <div className="px-6 pb-2">
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-6 py-10 text-center dark:border-stone-700 dark:bg-stone-900/30">
                <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
                <p className="text-[13px] font-semibold text-stone-700 dark:text-stone-300">{t("Gagal memuat data cuti", "Failed to load leave data")}</p>
                <Button onClick={api.refresh} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
                  <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
                </Button>
              </div>
            </div>
          ) : requests.length === 0 ? (
            <div className="px-6 pb-2">
              <EmptyState title={t("Belum ada permintaan cuti", "No leave requests yet")} description={t("Ajukan cuti pertama Anda lewat tombol Ajukan Cuti.", "Submit your first request via the Request Leave button.")} icon={Palmtree} />
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800/70">
              {requests.map((r) => {
                // jenjang approval — bentuk aktual backend: approval {level,total,currentApproverName};
                // fallback flat (approvalStep/approvalLevels/currentApprover) utk bentuk legacy
                const step = r.approval?.level ?? r.approvalStep ?? null;
                const levels = r.approval?.total ?? r.approvalLevels ?? null;
                const approver = r.approval?.currentApproverName ?? r.currentApprover ?? null;
                const waiting = ["Submitted", "Pending", "Prepared"].includes(r.status);
                const dateText = r.dateLabel
                  ?? (r.dateFrom ? `${fmtDate(r.dateFrom)}${r.dateTo && r.dateTo !== r.dateFrom ? ` – ${fmtDate(r.dateTo)}` : ""}` : null);
                return (
                  <li key={r.docNo} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold text-stone-800 dark:text-stone-100">
                        {r.typeName ?? t("Cuti", "Leave")}
                        <span className="ml-1.5 font-mono text-[11px] font-semibold text-stone-400">{r.docNo}</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-stone-400">
                        <span>{dateText ?? "—"}</span>
                        {r.days != null && <span>· {t("{n} hari", "{n} days", { n: r.days })}</span>}
                      </p>
                      {waiting && (step != null || levels != null || approver) && (
                        <p className="mt-1 flex flex-wrap items-center gap-1.5">
                          {(step != null && levels != null) && (
                            <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 px-1.5 text-[10px] font-bold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                              <Clock3 className="h-3 w-3" aria-hidden />
                              {t("Jenjang {a}/{b}", "Tier {a}/{b}", { a: step, b: levels })}
                            </Badge>
                          )}
                          {approver && (
                            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                              {t("menunggu {approver}", "awaiting {approver}", { approver })}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <StatusPill status={r.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog ajukan cuti ===== */}
      <Dialog open={dialog} onOpenChange={(v) => { if (!busy) setDialog(v); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Ajukan Cuti", "Request Leave")}</DialogTitle>
            <DialogDescription>
              {t("Pengajuan mengikuti alur approval berjenjang per kebijakan cuti.", "Requests follow the tiered approval flow of your leave policy.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ess-leave-type">{t("Jenis Cuti", "Leave Type")}</Label>
              <Select value={form.typeId} onValueChange={(v) => setForm((f) => ({ ...f, typeId: v }))}>
                <SelectTrigger id="ess-leave-type" className="w-full">
                  <SelectValue placeholder={t("Pilih jenis cuti…", "Choose leave type…")} />
                </SelectTrigger>
                <SelectContent>
                  {submitTypes.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-stone-400">{t("Jenis cuti belum tersedia", "No leave types available")}</p>
                  ) : submitTypes.map((ty) => (
                    <SelectItem key={ty.id} value={ty.id}>
                      {ty.name} · {t("sisa {n}", "{n} left", { n: ty.available })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ess-leave-from">{t("Tanggal Mulai", "Start Date")}</Label>
                <Input id="ess-leave-from" type="date" value={form.dateFrom} onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ess-leave-to">{t("Tanggal Selesai", "End Date")}</Label>
                <Input id="ess-leave-to" type="date" value={form.dateTo} min={form.dateFrom} onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))} />
              </div>
            </div>

            {/* ===== panel estimasi live ===== */}
            <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/50">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("Estimasi Pengajuan", "Request Estimate")}</p>
              {(() => {
                const sel = submitTypes.find((x) => x.id === form.typeId);
                const estAvail = sel?.available ?? null;
                const estLeft = estAvail != null ? estAvail - daysHint : null;
                const valid = daysHint > 0;
                return valid ? (
                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-lg font-extrabold tabular-nums text-stone-800 dark:text-stone-100">{daysHint}</p>
                      <p className="text-[10px] text-stone-400">{t("hari kalender", "calendar days")}</p>
                    </div>
                    <div>
                      <p className={cn("text-lg font-extrabold tabular-nums", estLeft != null && estLeft < 0 ? "text-rose-600 dark:text-rose-400" : "text-amber-700 dark:text-amber-400")}>
                        {estLeft != null ? estLeft : "—"}
                      </p>
                      <p className="text-[10px] text-stone-400">{t("sisa est. setelahnya", "est. remaining")}</p>
                    </div>
                    <div>
                      <p className="text-[13px] font-extrabold text-stone-800 dark:text-stone-100">{estAvail != null ? estAvail : "—"}</p>
                      <p className="text-[10px] text-stone-400">{t("sisa saat ini", "current balance")}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] text-stone-400">{t("Pilih jenis & tanggal untuk melihat estimasi.", "Pick a type & dates to see the estimate.")}</p>
                );
              })()}
              <p className="mt-2 text-[10px] leading-relaxed text-stone-400">
                {t("Hari kerja final dihitung sistem sesuai jadwal & hari libur nasional saat pengajuan diproses.", "Final working days are computed by the system per your schedule & national holidays upon submission.")}
              </p>
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-stone-200 px-3.5 py-2.5 dark:border-stone-800">
              <Checkbox
                id="ess-leave-half"
                checked={form.halfDay}
                onCheckedChange={(v) => setForm((f) => ({ ...f, halfDay: v === true }))}
              />
              <Label htmlFor="ess-leave-half" className="cursor-pointer text-[12.5px] font-semibold leading-snug">
                {t("Setengah hari (half-day)", "Half day")}
                <span className="block text-[11px] font-normal text-stone-400">{t("Berlaku untuk pengajuan satu hari.", "Applies to a single-day request.")}</span>
              </Label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ess-leave-reason">{t("Alasan (wajib)", "Reason (required)")}</Label>
              <Textarea
                id="ess-leave-reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                rows={3}
                maxLength={300}
                placeholder={t("Tuliskan alasan cuti Anda…", "Write your leave reason…")}
              />
            </div>

            {formError && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="break-words">{formError}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(false)} className="rounded-xl font-bold">
              {t("Batal")}
            </Button>
            <Button onClick={() => void submit()} disabled={busy} className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? t("Menyimpan…") : t("Ajukan", "Submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
