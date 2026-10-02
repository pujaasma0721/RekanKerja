"use client";
// RekanKerja ESS — Pengajuan: dua formulir — Izin Tidak Masuk (Work Off:
// tanggal dari-sampai, setengah hari, berbayar, alasan) & Lembur (tanggal,
// jam mulai-selesai, alasan) + status terakhir masing-masing (dari feed
// pengajuan terbaru dashboard). Intent "workoff"/"overtime" dari aksi cepat
// dashboard membuka dialog terkait langsung.
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Clock, Plus, Send, Loader2, AlertTriangle, CalendarOff, History } from "lucide-react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ESS_BASE, submitWorkoff, submitOvertime, essDocTypeLabel, essDocTypeLabelEn } from "./ess-api";
import type { EssDashboard } from "./ess-types";
// Task 98 (F1-4) — pengajuan dinis self-service (kartu + dialog + daftar).
import { EssTravelRequest } from "./ess-travel-request";

const todayISO = () => new Date().toISOString().slice(0, 10);

interface EssRequestsProps { intent: string | null }

interface ReqCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  cta: string;
  onOpen: () => void;
  latest?: { docType: string; docNo: string; status: string; dateLabel: string | null } | null;
}

function RequestCard({ title, description, icon: Icon, cta, onOpen, latest }: ReqCardProps) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          {title}
        </CardTitle>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">{description}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-3 pt-1">
        {/* status terakhir pengajuan jenis ini */}
        <div className="rounded-xl border border-dashed border-slate-200 p-3 dark:border-slate-800">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <History className="h-3 w-3" aria-hidden /> {t("Pengajuan Terakhir", "Latest Request")}
          </p>
          {latest ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-[12px] font-semibold text-slate-600 dark:text-slate-300">{latest.docNo}</span>
              <StatusPill status={latest.status} />
              <span className="text-[11px] text-slate-400">{latest.dateLabel ?? "—"}</span>
            </div>
          ) : (
            <p className="text-[12px] text-slate-400">{t("Belum ada — Anda belum pernah mengajukan.", "None yet — you have never submitted this.")}</p>
          )}
        </div>
        <Button onClick={onOpen} className="w-full gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
          <Plus className="h-4 w-4" /> {cta}
        </Button>
      </CardContent>
    </Card>
  );
}

function FormError({ message }: { message: string | null }) {
  const { t } = useI18n();
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="break-words">{message}</span>
    </div>
  );
}

export function EssRequests({ intent }: EssRequestsProps) {
  const { t } = useI18n();
  // feed pengajuan terbaru → status terakhir work off & lembur
  const dash = useApi<EssDashboard>(`${ESS_BASE}/dashboard`);
  const recents = dash.data?.recentRequests ?? [];
  const latestWorkoff = recents.find((r) => /work.?off|izin/i.test(r.docType)) ?? null;
  const latestOvertime = recents.find((r) => /overtime|lembur/i.test(r.docType)) ?? null;

  // dialog — intent dari aksi cepat dashboard
  const [workoffOpen, setWorkoffOpen] = useState(() => intent === "workoff");
  const [overtimeOpen, setOvertimeOpen] = useState(() => intent === "overtime");

  // form work off
  const [wForm, setWForm] = useState({ dateFrom: todayISO(), dateTo: todayISO(), halfDay: false, paid: false, reason: "" });
  const [wBusy, setWBusy] = useState(false);
  const [wError, setWError] = useState<string | null>(null);

  // form lembur
  const [oForm, setOForm] = useState({ date: todayISO(), planStart: "18:00", planEnd: "20:00", reason: "" });
  const [oBusy, setOBusy] = useState(false);
  const [oError, setOError] = useState<string | null>(null);

  const submitWorkoffReq = async () => {
    if (wBusy) return;
    if (!wForm.dateFrom || !wForm.dateTo) { setWError(t("Tanggal mulai dan selesai wajib diisi.", "Start and end dates are required.")); return; }
    if (wForm.dateTo < wForm.dateFrom) { setWError(t("Tanggal selesai tidak boleh sebelum tanggal mulai.", "The end date cannot precede the start date.")); return; }
    if (!wForm.reason.trim()) { setWError(t("Alasan wajib diisi.", "A reason is required.")); return; }
    setWBusy(true);
    setWError(null);
    try {
      const res = await submitWorkoff({
        dateFrom: wForm.dateFrom,
        dateTo: wForm.dateTo,
        halfDay: wForm.halfDay || undefined,
        paid: wForm.paid,
        reason: wForm.reason.trim(),
      });
      toast.success(t("{doc} diajukan — status {status}", "{doc} submitted — status {status}", { doc: res.docNo, status: res.status }));
      setWorkoffOpen(false);
      setWForm({ dateFrom: todayISO(), dateTo: todayISO(), halfDay: false, paid: false, reason: "" });
      dash.refresh();
    } catch (e) {
      setWError(e instanceof Error ? e.message : t("Gagal mengajukan izin.", "Failed to submit the permit."));
    } finally {
      setWBusy(false);
    }
  };

  const submitOvertimeReq = async () => {
    if (oBusy) return;
    if (!oForm.date) { setOError(t("Tanggal lembur wajib diisi.", "The overtime date is required.")); return; }
    if (!oForm.planStart || !oForm.planEnd) { setOError(t("Jam mulai dan selesai wajib diisi.", "Start and end times are required.")); return; }
    if (oForm.planEnd <= oForm.planStart) { setOError(t("Jam selesai harus setelah jam mulai.", "The end time must be after the start time.")); return; }
    if (!oForm.reason.trim()) { setOError(t("Alasan lembur wajib diisi.", "An overtime reason is required.")); return; }
    setOBusy(true);
    setOError(null);
    try {
      const res = await submitOvertime({
        date: oForm.date,
        planStart: oForm.planStart,
        planEnd: oForm.planEnd,
        reason: oForm.reason.trim(),
      });
      toast.success(t("{doc} diajukan — status {status}", "{doc} submitted — status {status}", { doc: res.docNo, status: res.status }));
      setOvertimeOpen(false);
      setOForm({ date: todayISO(), planStart: "18:00", planEnd: "20:00", reason: "" });
      dash.refresh();
    } catch (e) {
      setOError(e instanceof Error ? e.message : t("Gagal mengajukan lembur.", "Failed to submit the overtime request."));
    } finally {
      setOBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Pengajuan", "Requests")}
        description={t("Izin tidak masuk (work off), rencana lembur, dan perjalanan dinas — semuanya mengikuti approval atasan.", "Work off permits, overtime plans, and business trips — all follow manager approval.")}
      />

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <RequestCard
          title={t("Izin Tidak Masuk (Work Off)", "Work Off Permit")}
          description={t("Ajukan izin absen untuk rentang tanggal — pilih setengah hari atau penuh, berbayar atau tidak.", "Request an absence for a date range — half day or full, paid or unpaid.")}
          icon={CalendarOff}
          cta={t("Ajukan Izin", "Request Permit")}
          onOpen={() => { setWError(null); setWorkoffOpen(true); }}
          latest={latestWorkoff}
        />
        <RequestCard
          title={t("Lembur (Overtime)", "Overtime")}
          description={t("Rencanakan lembur di luar jam kerja — jam mulai & selesai akan diverifikasi dengan clock aktual.", "Plan overtime beyond working hours — planned times are verified against actual clocks.")}
          icon={Clock}
          cta={t("Ajukan Lembur", "Request Overtime")}
          onOpen={() => { setOError(null); setOvertimeOpen(true); }}
          latest={latestOvertime}
        />
      </div>

      {/* Task 98 (F1-4) — pengajuan dinis self-service: kartu + dialog multi-destinasi
          + estimasi SBI + daftar permintaan dinis SAYA (status approval berjenjang). */}
      <EssTravelRequest />

      {/* riwayat ringkas gabungan */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <ClipboardList className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden /> {t("Riwayat Terbaru", "Recent History")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-1">
          {dash.loading && !dash.data ? (
            <p className="py-4 text-center text-[12px] text-slate-400">{t("Memuat…")}</p>
          ) : recents.filter((r) => /work.?off|overtime|lembur|izin/i.test(r.docType)).length === 0 ? (
            <EmptyState
              title={t("Belum ada riwayat", "No history yet")}
              description={t("Pengajuan izin & lembur Anda akan tampil di sini.", "Your permit & overtime submissions will appear here.")}
              icon={History}
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {recents.filter((r) => /work.?off|overtime|lembur|izin/i.test(r.docType)).map((r) => (
                <li key={r.docNo + r.docType} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
                      {t(essDocTypeLabel(r.docType), essDocTypeLabelEn(r.docType))}
                      <span className="ml-1.5 font-mono text-[11px] font-semibold text-slate-400">{r.docNo}</span>
                    </p>
                    <p className="text-[11px] text-slate-400">{r.dateLabel ?? "—"}</p>
                  </div>
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog izin work off ===== */}
      <Dialog open={workoffOpen} onOpenChange={(v) => { if (!wBusy) setWorkoffOpen(v); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("Ajukan Izin Tidak Masuk", "Request Work Off")}</DialogTitle>
            <DialogDescription>
              {t("Izin absen mengikuti kebijakan work off perusahaan & approval atasan.", "Absence permits follow company work-off policy & manager approval.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ess-wo-from">{t("Tanggal Mulai", "Start Date")}</Label>
                <Input id="ess-wo-from" type="date" value={wForm.dateFrom} onChange={(e) => setWForm((f) => ({ ...f, dateFrom: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ess-wo-to">{t("Tanggal Selesai", "End Date")}</Label>
                <Input id="ess-wo-to" type="date" value={wForm.dateTo} min={wForm.dateFrom} onChange={(e) => setWForm((f) => ({ ...f, dateTo: e.target.value }))} />
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
              <Checkbox
                id="ess-wo-half"
                checked={wForm.halfDay}
                onCheckedChange={(v) => setWForm((f) => ({ ...f, halfDay: v === true }))}
              />
              <Label htmlFor="ess-wo-half" className="cursor-pointer text-[12.5px] font-semibold">
                {t("Setengah hari", "Half day")}
              </Label>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
              <div>
                <Label htmlFor="ess-wo-paid" className="cursor-pointer text-[12.5px] font-semibold">
                  {t("Berbayar", "Paid")}
                </Label>
                <p className="text-[11px] font-normal text-slate-400">
                  {t("Gaji tetap dibayarkan untuk hari izin.", "Salary remains paid for the permit days.")}
                </p>
              </div>
              <Switch id="ess-wo-paid" checked={wForm.paid} onCheckedChange={(v) => setWForm((f) => ({ ...f, paid: v }))} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ess-wo-reason">{t("Alasan (wajib)", "Reason (required)")}</Label>
              <Textarea
                id="ess-wo-reason"
                value={wForm.reason}
                onChange={(e) => setWForm((f) => ({ ...f, reason: e.target.value }))}
                rows={3}
                maxLength={300}
                placeholder={t("mis. urusan keluarga, keperluan resmi…", "e.g. family matters, official business…")}
              />
            </div>

            <FormError message={wError} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={wBusy} onClick={() => setWorkoffOpen(false)} className="rounded-xl font-bold">{t("Batal")}</Button>
            <Button onClick={() => void submitWorkoffReq()} disabled={wBusy} className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
              {wBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {wBusy ? t("Menyimpan…") : t("Ajukan", "Submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog lembur ===== */}
      <Dialog open={overtimeOpen} onOpenChange={(v) => { if (!oBusy) setOvertimeOpen(v); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("Ajukan Lembur", "Request Overtime")}</DialogTitle>
            <DialogDescription>
              {t("Rencana lembur diverifikasi terhadap clock in/out aktual saat settlement.", "Planned overtime is verified against actual clock in/out at settlement.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ess-ot-date">{t("Tanggal Lembur", "Overtime Date")}</Label>
              <Input id="ess-ot-date" type="date" value={oForm.date} onChange={(e) => setOForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ess-ot-start">{t("Jam Mulai (Rencana)", "Planned Start")}</Label>
                <Input id="ess-ot-start" type="time" value={oForm.planStart} onChange={(e) => setOForm((f) => ({ ...f, planStart: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ess-ot-end">{t("Jam Selesai (Rencana)", "Planned End")}</Label>
                <Input id="ess-ot-end" type="time" value={oForm.planEnd} onChange={(e) => setOForm((f) => ({ ...f, planEnd: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ess-ot-reason">{t("Alasan Lembur (wajib)", "Overtime Reason (required)")}</Label>
              <Textarea
                id="ess-ot-reason"
                value={oForm.reason}
                onChange={(e) => setOForm((f) => ({ ...f, reason: e.target.value }))}
                rows={3}
                maxLength={300}
                placeholder={t("mis. closing bulanan, rilis produksi…", "e.g. month-end closing, production release…")}
              />
            </div>
            <FormError message={oError} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={oBusy} onClick={() => setOvertimeOpen(false)} className="rounded-xl font-bold">{t("Batal")}</Button>
            <Button onClick={() => void submitOvertimeReq()} disabled={oBusy} className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
              {oBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {oBusy ? t("Menyimpan…") : t("Ajukan", "Submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
