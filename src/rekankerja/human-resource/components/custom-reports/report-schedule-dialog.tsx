"use client";
// RekanKerja — Report Builder: dialog JADWAL kirim laporan (P3.4-BM / D-BM26) ==
// =====================================================================
// Manajemen ReportSchedule satu laporan tersimpan (upsert by reportId):
//   · frekuensi Harian / Mingguan (hari 0–6, 0=Minggu) / Bulanan (tanggal 1–28);
//   · jam kirim 0–23 WIB (default 07:00);
//   · penerima: email dipisah koma/titik-koma (divalidasi klien ringan +
//     server ketat, maks 20);
//   · saklar aktif; simpan (schedule-save) + hapus (schedule-delete) — keduanya
//     digerbang op menu hr:custom-reports:schedule dan menulis ActivityLog.
// Eksekusi kirim dilakukan job scheduler (report-schedule-delivery).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2, Save, Trash2 } from "lucide-react";
import { apiSend, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

const SCHEDULE_URL = "/api/rekankerja/custom-reports/schedule";

export interface ScheduleInfo {
  id: string;
  reportId: string;
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number;
  recipients: string[];
  active: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
}

const DOW = [
  { v: "0", id: "Minggu", en: "Sunday" },
  { v: "1", id: "Senin", en: "Monday" },
  { v: "2", id: "Selasa", en: "Tuesday" },
  { v: "3", id: "Rabu", en: "Wednesday" },
  { v: "4", id: "Kamis", en: "Thursday" },
  { v: "5", id: "Jumat", en: "Friday" },
  { v: "6", id: "Sabtu", en: "Saturday" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: { id: string; code: string; name: string };
  schedule: ScheduleInfo | null;
  onSaved: (schedule: ScheduleInfo) => void;
  onDeleted: () => void;
}

export function ReportScheduleDialog({ open, onOpenChange, report, schedule, onSaved, onDeleted }: Props) {
  const { t } = useI18n();
  const [frequency, setFrequency] = useState("Daily");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [hour, setHour] = useState("7");
  const [recipients, setRecipients] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // muat nilai jadwal existing tiap dialog dibuka / target berganti
  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setFrequency(schedule.frequency);
      setDayOfWeek(String(schedule.dayOfWeek ?? 1));
      setDayOfMonth(String(schedule.dayOfMonth ?? 1));
      setHour(String(schedule.hour));
      setRecipients(schedule.recipients.join(", "));
      setActive(schedule.active);
    } else {
      setFrequency("Daily");
      setDayOfWeek("1");
      setDayOfMonth("1");
      setHour("7");
      setRecipients("");
      setActive(true);
    }
  }, [open, schedule, report.id]);

  const doSave = async () => {
    const emails = recipients.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (emails.length === 0) {
      toast.error(t("Minimal 1 email penerima wajib diisi", "At least 1 recipient email is required"));
      return;
    }
    const bad = emails.find((r) => !EMAIL_RE.test(r));
    if (bad) {
      toast.error(t("Alamat email tidak valid: \"{a}\"", "Invalid email address: \"{a}\"", { a: bad }));
      return;
    }
    setSaving(true);
    try {
      const res = await apiSend<{ schedule: ScheduleInfo }>(SCHEDULE_URL, "POST", {
        action: "schedule-save",
        reportId: report.id,
        frequency,
        ...(frequency === "Weekly" ? { dayOfWeek: Number(dayOfWeek) } : {}),
        ...(frequency === "Monthly" ? { dayOfMonth: Number(dayOfMonth) } : {}),
        hour: Number(hour),
        recipients: emails.join(", "),
        active,
      });
      onSaved(res.schedule);
      toast.success(t("Jadwal {code} tersimpan", "Schedule for {code} saved", { code: report.code }));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await apiSend(SCHEDULE_URL, "POST", { action: "schedule-delete", reportId: report.id });
      onDeleted();
      toast.success(t("Jadwal dihapus", "Schedule deleted"));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] sm:max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-brand dark:text-brand/85" aria-hidden />
            {t("Jadwal Kirim Laporan", "Report Delivery Schedule")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Laporan ini dikirim otomatis sebagai lampiran Excel (XLSX) ke penerima berikut sesuai jadwal (jam WIB).",
              "This report is automatically delivered as an Excel (XLSX) attachment to the recipients below per the schedule (WIB hours).",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
            {report.code} — {report.name}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rs-freq">{t("Frekuensi", "Frequency")}</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger id="rs-freq" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Daily">{t("Harian", "Daily")}</SelectItem>
                  <SelectItem value="Weekly">{t("Mingguan", "Weekly")}</SelectItem>
                  <SelectItem value="Monthly">{t("Bulanan", "Monthly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {frequency === "Weekly" && (
              <div className="space-y-1.5">
                <Label htmlFor="rs-dow">{t("Hari kirim", "Send day")}</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger id="rs-dow" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOW.map((d) => (
                      <SelectItem key={d.v} value={d.v}>{t(d.id, d.en)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {frequency === "Monthly" && (
              <div className="space-y-1.5">
                <Label htmlFor="rs-dom">{t("Tanggal kirim", "Send date")}</Label>
                <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
                  <SelectTrigger id="rs-dom" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="rs-hour">{t("Jam kirim (WIB)", "Send hour (WIB)")}</Label>
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger id="rs-hour" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {Array.from({ length: 24 }, (_, i) => String(i)).map((h) => (
                    <SelectItem key={h} value={h}>{`${h.padStart(2, "0")}:00`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rs-rcpt">{t("Penerima (email, pisah koma)", "Recipients (emails, comma-separated)")}</Label>
            <Input
              id="rs-rcpt"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder={t("mis. hrd@mii.co.id, finance@mii.co.id", "e.g. hrd@company.co.id, finance@company.co.id")}
              maxLength={1000}
            />
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
              {t("Jadwal aktif", "Schedule active")}
            </span>
            <Switch checked={active} onCheckedChange={setActive} aria-label={t("Jadwal aktif", "Schedule active")} />
          </label>

          {schedule && (
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {t("Kirim terakhir", "Last delivery")}:
              {schedule.lastRunAt ? (
                <>
                  <span>{fmtDateTime(schedule.lastRunAt)}</span>
                  <Badge variant="outline" className={schedule.lastStatus === "OK"
                    ? "bg-emerald-50 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                    : "bg-amber-50 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"}>
                    {schedule.lastStatus ?? "—"}
                  </Badge>
                </>
              ) : (
                <span>{t("belum pernah", "never yet")}</span>
              )}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          {schedule && (
            <Button
              variant="outline"
              onClick={() => void doDelete()}
              disabled={deleting || saving}
              className="mr-auto gap-1.5 border-rose-200 text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              {t("Hapus Jadwal", "Delete Schedule")}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
            {t("Batal", "Cancel")}
          </Button>
          <Button onClick={() => void doSave()} disabled={saving || deleting} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {t("Simpan Jadwal", "Save Schedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
