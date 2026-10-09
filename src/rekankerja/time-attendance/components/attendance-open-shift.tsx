"use client";
// RekanKerja Attendance — Open Shift Marketplace (Task 100 F1, G19 — impl-E).
// =====================================================================
// Posting shift terbuka 30 hari ke depan + klaim karyawan (ESS). Admin:
// buat posting (dialog: tanggal + jadwal + tipe hari dari cycle jadwal +
// unit + slot + catatan), tutup / batalkan posting (AlertDialog — batal
// menolak otomatis klaim Pending), setujui klaim (AlertDialog — karyawan
// ditugaskan shift itu 1 hari, rekap absensi dihitung ulang), tolak klaim
// (dialog alasan wajib). Guard tombol: canOp attendance:assignment-schedule
// create/update. Kontrak response: api/open-shift.ts (impl-D).
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ApiErrorState, todayISO } from "@/rekankerja/time-attendance/components/attendance-ui";
import { ScheduleRow } from "@/rekankerja/time-attendance/components/attendance-types";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  Users, Plus, ChevronDown, ChevronRight, Lock, Ban, CheckCircle2, XCircle,
  CalendarClock, Loader2, HandHeart,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface OpenShiftClaim {
  id: string;
  status: string; // Pending|Approved|Rejected
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  employee: { id: string; employeeNo: string; fullName: string; photoUrl: string | null; status: string } | null;
}

interface OpenShiftPostRow {
  id: string;
  workDate: string;
  scheduleId: string;
  scheduleName: string;
  dayTypeId: string;
  dayTypeName: string;
  dayTypeCode: string;
  dayTypeColor: string | null;
  timeIn: string | null;
  timeOut: string | null;
  orgUnitName: string | null;
  slots: number;
  filled: number;
  notes: string | null;
  status: string; // Open|Filled|Closed|Cancelled
  createdAt: string;
  claims: OpenShiftClaim[];
}

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Open", label: "Terbuka" },
  { key: "Filled", label: "Terisi" },
  { key: "Closed", label: "Ditutup" },
  { key: "Cancelled", label: "Dibatalkan" },
];
const STATUS_FILTERS_EN: Record<string, string> = {
  all: "All", Open: "Open", Filled: "Filled", Closed: "Closed", Cancelled: "Cancelled",
};

/** Badge status posting "Filled" (tidak ada di STATUS_MAP global). */
function PostStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "Filled") {
    return (
      <Badge variant="outline" className="border-brand/25 bg-brand/10 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">
        {t("Terisi", "Filled")}
      </Badge>
    );
  }
  return <StatusPill status={status} />;
}

export function AttendanceOpenShiftPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const api = useApi<{ posts: OpenShiftPostRow[] }>("/api/rekankerja/attendance/open-shift");
  // master utk dialog buka shift (jadwal + day type aktif — kontrak api/schedules.ts)
  const masterApi = useApi<{ schedules: ScheduleRow[] }>("/api/rekankerja/attendance/schedules");

  // dialog buka shift
  const [createDialog, setCreateDialog] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [form, setForm] = useState({ workDate: todayISO(), scheduleId: "", dayTypeId: "", orgUnitName: "", slots: "1", notes: "" });

  // aksi posting (tutup / batalkan)
  const [postAction, setPostAction] = useState<{ op: "close" | "cancel"; post: OpenShiftPostRow } | null>(null);
  const [postBusy, setPostBusy] = useState(false);

  // aksi klaim (setujui / tolak)
  const [approveTarget, setApproveTarget] = useState<{ claim: OpenShiftClaim; post: OpenShiftPostRow } | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{ claim: OpenShiftClaim; post: OpenShiftPostRow } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

  const canCreate = perms.canOp("attendance", "assignment-schedule", "create");
  const canUpdate = perms.canOp("attendance", "assignment-schedule", "update");

  const posts = useMemo(
    () => (api.data?.posts ?? []).filter((p) => statusFilter === "all" || p.status === statusFilter),
    [api.data, statusFilter],
  );

  // tipe hari relevan = yang terdaftar di cycle jadwal terpilih (validasi
  // server POST juga menolak day type di luar cycle — tampilkan hanya yang sah).
  const schedule = (masterApi.data?.schedules ?? []).find((s) => s.id === form.scheduleId) ?? null;
  const scheduleDayTypes = useMemo(() => {
    if (!schedule) return [];
    const seen = new Set<string>();
    const out: ScheduleRow["days"][number]["dayType"][] = [];
    for (const d of schedule.days) {
      if (seen.has(d.dayTypeId)) continue;
      seen.add(d.dayTypeId);
      out.push(d.dayType);
    }
    return out;
  }, [schedule]);

  const stats = useMemo(() => {
    const all = api.data?.posts ?? [];
    return {
      open: all.filter((p) => p.status === "Open").length,
      pendingClaims: all.reduce((s, p) => s + p.claims.filter((c) => c.status === "Pending").length, 0),
      filled: all.reduce((s, p) => s + p.filled, 0),
      slots: all.reduce((s, p) => s + p.slots, 0),
    };
  }, [api.data]);

  const submitCreate = async () => {
    setCreateBusy(true);
    try {
      await apiSend("/api/rekankerja/attendance/open-shift", "POST", {
        workDate: form.workDate,
        scheduleId: form.scheduleId,
        dayTypeId: form.dayTypeId,
        orgUnitName: form.orgUnitName.trim() || undefined,
        slots: parseInt(form.slots, 10) || 1,
        notes: form.notes.trim() || undefined,
      });
      toast.success(t("Open shift diposting — karyawan menerima notifikasi utk mengajukan klaim", "Open shift posted — employees are notified to submit claims"));
      setCreateDialog(false);
      setForm({ workDate: todayISO(), scheduleId: "", dayTypeId: "", orgUnitName: "", slots: "1", notes: "" });
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memposting open shift", "Failed to post open shift"));
    } finally {
      setCreateBusy(false);
    }
  };

  const runPostAction = async () => {
    if (!postAction) return;
    setPostBusy(true);
    try {
      const res = await apiSend<{ ok: boolean; rejectedClaims: number }>("/api/rekankerja/attendance/open-shift", "PATCH", { op: postAction.op, id: postAction.post.id });
      toast.success(
        postAction.op === "cancel"
          ? t("Posting dibatalkan — {n} klaim Pending otomatis ditolak", "Post cancelled — {n} pending claims automatically rejected", { n: res.rejectedClaims })
          : t("Posting ditutup — klaim yang sudah masuk tetap diproses", "Post closed — submitted claims are still processed"),
      );
      setPostAction(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal"));
    } finally {
      setPostBusy(false);
    }
  };

  const runApprove = async () => {
    if (!approveTarget) return;
    setApproveBusy(true);
    try {
      await apiSend("/api/rekankerja/attendance/open-shift", "PATCH", { op: "approve-claim", claimId: approveTarget.claim.id });
      toast.success(t("Klaim disetujui — {name} ditugaskan shift {date}", "Claim approved — {name} is assigned the {date} shift", { name: approveTarget.claim.employee?.fullName ?? "-", date: fmtDate(approveTarget.post.workDate) }));
      setApproveTarget(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyetujui klaim", "Failed to approve claim"));
    } finally {
      setApproveBusy(false);
    }
  };

  const runReject = async () => {
    if (!rejectTarget) return;
    setRejectBusy(true);
    try {
      await apiSend("/api/rekankerja/attendance/open-shift", "PATCH", { op: "reject-claim", claimId: rejectTarget.claim.id, reason: rejectReason.trim() });
      toast.success(t("Klaim ditolak — karyawan menerima notifikasi alasan", "Claim rejected — the employee receives the reason notification"));
      setRejectTarget(null);
      setRejectReason("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menolak klaim", "Failed to reject claim"));
    } finally {
      setRejectBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Open Shift (Marketplace Shift)", "Open Shift (Shift Marketplace)")}
        description={t("Posting shift terbuka 30 hari ke depan — karyawan mengajukan klaim dari ESS, admin menyetujui → penugasan 1 hari + rekap absensi dihitung ulang", "Post open shifts up to 30 days ahead — employees claim from ESS, admin approves → 1-day assignment + attendance recap recalculated")}
        actions={
          canCreate ? (
            <Button onClick={() => { setForm({ workDate: todayISO(), scheduleId: "", dayTypeId: "", orgUnitName: "", slots: "1", notes: "" }); setCreateDialog(true); }} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Buka Shift", "Post Open Shift")}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: t("Posting Terbuka", "Open Posts"), value: String(stats.open), icon: CalendarClock, tone: "text-brand dark:text-brand/85" },
          { label: t("Klaim Pending", "Pending Claims"), value: String(stats.pendingClaims), icon: HandHeart, tone: "text-amber-600 dark:text-amber-400" },
          { label: t("Slot Terisi", "Filled Slots"), value: t("{a}/{b}", "{a}/{b}", { a: stats.filled, b: stats.slots }), icon: Users, tone: "text-slate-700 dark:text-slate-300" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-slate-400" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p></div>
              <p className={cn("text-lg font-extrabold", k.tone)}>{k.value}</p>
            </div>
          );
        })}
      </div>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setStatusFilter(f.key)} className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-bold transition",
                  statusFilter === f.key ? "ov-fill shadow-sm" : "ov-tile hover:ov-soft text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white",
                )}>
                  {t(f.label, STATUS_FILTERS_EN[f.key] ?? f.label)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">{t("posting {n} hari ke depan", "posts for the next {n} days", { n: 30 })}</p>
          </div>
          {api.loading && !api.data ? (
            <div className="p-5"><LoadingRows rows={5} /></div>
          ) : api.error ? (
            <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />
          ) : posts.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={t("Belum ada posting open shift", "No open shift posts yet")}
                description={t("Posting shift terbuka utk tanggal sibuk — karyawan mengklaim dari Portal Karyawan (ESS).", "Post open shifts for busy dates — employees claim them from the employee portal (ESS).")}
                icon={<Users className="h-6 w-6" />}
              />
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {posts.map((p) => {
                const pending = p.claims.filter((c) => c.status === "Pending");
                const isOpen = p.status === "Open";
                return (
                  <div key={p.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-slate-50 text-center dark:bg-slate-900/60">
                          <span className="text-[15px] font-extrabold leading-none text-slate-800 dark:text-slate-100">{new Date(`${p.workDate}T00:00:00`).getDate()}</span>
                          <span className="text-[9px] font-bold uppercase text-slate-400">{new Date(`${p.workDate}T00:00:00`).toLocaleDateString(locale, { month: "short" })}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-800 dark:text-slate-200">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.dayTypeColor ?? "#E7E5E4" }} />
                              {p.dayTypeName}
                            </span>
                            {p.timeIn && <span className="font-mono text-[10px] text-slate-400">{p.timeIn}{p.timeOut ? `–${p.timeOut}` : ""}</span>}
                          </div>
                          <p className="truncate text-[11px] text-slate-400">
                            {p.scheduleName} · {p.orgUnitName ?? t("semua unit", "all units")} · {t("slot {a}/{b}", "slots {a}/{b}", { a: p.filled, b: p.slots })}
                          </p>
                          {p.notes && <p className="mt-0.5 max-w-md text-[11px] italic text-slate-400" title={p.notes}>{p.notes}</p>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {pending.length > 0 && (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                            {t("{n} klaim menunggu", "{n} awaiting claims", { n: pending.length })}
                          </Badge>
                        )}
                        <PostStatusBadge status={p.status} />
                        {isOpen && canUpdate && (
                          <>
                            <Button variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-[11px] font-bold" onClick={() => setPostAction({ op: "close", post: p })}>
                              <Lock className="h-3.5 w-3.5" /> {t("Tutup")}
                            </Button>
                            <Button variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10" onClick={() => setPostAction({ op: "cancel", post: p })}>
                              <Ban className="h-3.5 w-3.5" /> {t("Batalkan", "Cancel")}
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] font-bold" onClick={() => setExpanded(expanded === p.id ? null : p.id)} aria-expanded={expanded === p.id}>
                          {expanded === p.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {t("Klaim ({n})", "Claims ({n})", { n: p.claims.length })}
                        </Button>
                      </div>
                    </div>

                    {expanded === p.id && (
                      <div className="mt-3 rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
                        {p.claims.length === 0 ? (
                          <p className="py-2 text-center text-[11px] text-slate-400">{t("Belum ada klaim pada posting ini.", "No claims on this post yet.")}</p>
                        ) : (
                          <div className="space-y-1.5">
                            {p.claims.map((c) => (
                              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[12px] font-bold text-slate-800 dark:text-slate-200">{c.employee?.fullName ?? "—"}</p>
                                  <p className="font-mono text-[10px] text-slate-400">
                                    {c.employee?.employeeNo ?? "—"} · {t("diajukan {d}", "claimed {d}", { d: fmtDate(c.createdAt) })}
                                    {c.decidedBy ? t(" · diputus {by}", " · decided by {by}", { by: c.decidedBy }) : ""}
                                  </p>
                                </div>
                                <StatusPill status={c.status} />
                                {c.status === "Pending" && isOpen && canUpdate && (
                                  <div className="flex items-center gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Setujui klaim", "Approve claim")} onClick={() => setApproveTarget({ claim: c, post: p })} aria-label={t("Setujui klaim open shift", "Approve open shift claim")}>
                                      <CheckCircle2 className="h-4 w-4 text-brand" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Tolak klaim", "Reject claim")} onClick={() => { setRejectTarget({ claim: c, post: p }); setRejectReason(""); }} aria-label={t("Tolak klaim open shift", "Reject open shift claim")}>
                                      <XCircle className="h-4 w-4 text-rose-500" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog buka shift ===== */}
      <Dialog open={createDialog} onOpenChange={(v) => { if (!createBusy) setCreateDialog(v); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("Buka Shift (Open Shift)", "Post Open Shift")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tanggal Kerja *", "Work Date *")}</Label>
                <Input type="date" value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Jumlah Slot * (1–20)", "Slots * (1–20)")}</Label>
                <Input type="number" min={1} max={20} value={form.slots} onChange={(e) => setForm({ ...form, slots: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Jadwal *", "Schedule *")}</Label>
              <Select value={form.scheduleId} onValueChange={(v) => setForm({ ...form, scheduleId: v, dayTypeId: "" })}>
                <SelectTrigger className="text-sm"><SelectValue placeholder={t("Pilih jadwal cycle", "Select cycle schedule")} /></SelectTrigger>
                <SelectContent className="max-h-56">
                  {(masterApi.data?.schedules ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{t("{name} ({code}) — cycle {n} hari", "{name} ({code}) — {n}-day cycle", { name: s.name, code: s.code, n: s.cycleDays })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {masterApi.error && <p className="text-[10px] text-rose-500">{masterApi.error}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Tipe Hari *", "Day Type *")}</Label>
              <Select value={form.dayTypeId} onValueChange={(v) => setForm({ ...form, dayTypeId: v })} disabled={!schedule}>
                <SelectTrigger className="text-sm"><SelectValue placeholder={schedule ? t("Pilih tipe hari pada cycle jadwal", "Pick a day type in the schedule cycle") : t("Pilih jadwal dulu", "Pick a schedule first")} /></SelectTrigger>
                <SelectContent className="max-h-56">
                  {scheduleDayTypes.map((dt) => (
                    <SelectItem key={dt.id} value={dt.id}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dt.color }} />
                        {dt.name} ({dt.code})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">{t("Hanya tipe hari yang terdaftar di cycle jadwal — dipakai sebagai anchor rotasi saat klaim disetujui.", "Only day types registered in the schedule cycle — used as the rotation anchor when a claim is approved.")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Unit Kerja (opsional)", "Org Unit (optional)")}</Label>
              <Input value={form.orgUnitName} onChange={(e) => setForm({ ...form, orgUnitName: e.target.value })} placeholder={t("mis. Produksi Line 2", "e.g. Production Line 2")} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan", "Notes")}</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("mis. backorder ekspor — butuh tambahan regu malam", "e.g. export backorder — extra night crew needed")} className="min-h-16 text-sm" maxLength={500} />
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900/60">
              {t("Posting hanya bisa dibuat utk hari ini s.d. 30 hari ke depan. Karyawan menerima notifikasi in-app dan mengajukan klaim dari ESS → Open Shift.", "Posts can only be created for today up to 30 days ahead. Employees get an in-app notification and submit claims from ESS → Open Shift.")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(false)} disabled={createBusy}>{t("Batal")}</Button>
            <Button onClick={submitCreate} disabled={createBusy || !form.workDate || !form.scheduleId || !form.dayTypeId} className="gap-1.5 font-bold">
              {createBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Memposting…", "Posting…")}</> : <>{t("Posting Open Shift", "Post Open Shift")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== AlertDialog tutup / batalkan posting ===== */}
      <AlertDialog open={!!postAction} onOpenChange={(v) => { if (!v && !postBusy) setPostAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {postAction?.op === "cancel"
                ? t("Batalkan posting open shift {d}?", "Cancel the {d} open shift post?", { d: postAction ? fmtDate(postAction.post.workDate) : "" })
                : t("Tutup posting open shift {d}?", "Close the {d} open shift post?", { d: postAction ? fmtDate(postAction.post.workDate) : "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {postAction?.op === "cancel"
                ? t("Semua klaim Pending pada posting ini OTOMATIS DITOLAK dan karyawan menerima notifikasi pembatalan.", "All pending claims on this post are AUTOMATICALLY REJECTED and employees receive a cancellation notification.")
                : t("Posting ditutup utk klaim baru — klaim yang sudah masuk tetap bisa diproses admin.", "The post is closed to new claims — already submitted claims can still be processed by admins.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {postAction && (
            <div className="rounded-xl border border-slate-200 px-3.5 py-3 text-[12px] dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-800 dark:text-slate-200">{postAction.post.dayTypeName} · {postAction.post.scheduleName}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {fmtDate(postAction.post.workDate)} · {t("slot {a}/{b}", "slots {a}/{b}", { a: postAction.post.filled, b: postAction.post.slots })} · {postAction.post.claims.filter((c) => c.status === "Pending").length} {t("klaim pending", "pending claims")}
                  </p>
                </div>
                <PostStatusBadge status={postAction.post.status} />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={postBusy}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={postBusy}
              className={cn("gap-1.5 font-bold", postBusy && "opacity-70", postAction?.op === "cancel" && "bg-rose-600 hover:bg-rose-700")}
              onClick={(e) => { e.preventDefault(); void runPostAction(); }}
            >
              {postBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : postAction?.op === "cancel" ? <Ban className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {postAction?.op === "cancel" ? t("Ya, Batalkan Posting", "Yes, Cancel Post") : t("Ya, Tutup Posting", "Yes, Close Post")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== AlertDialog setujui klaim ===== */}
      <AlertDialog open={!!approveTarget} onOpenChange={(v) => { if (!v && !approveBusy) setApproveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Setujui klaim open shift {name}?", "Approve {name}'s open shift claim?", { name: approveTarget?.claim.employee?.fullName ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Karyawan ditugaskan shift itu 1 hari (override penugasan jadwal) — rekap absensi dihitung ulang. Slot terisi bertambah 1 dan posting otomatis tertutup bila penuh.", "The employee is assigned that shift for 1 day (a schedule assignment override) — the attendance recap is recalculated. The filled count increases by 1 and the post auto-closes when full.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {approveTarget && (
            <div className="rounded-xl border border-slate-200 px-3.5 py-3 text-[12px] dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-800 dark:text-slate-200">{approveTarget.post.dayTypeName} · {fmtDate(approveTarget.post.workDate)}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {approveTarget.post.scheduleName}
                    {approveTarget.post.timeIn ? ` · ${approveTarget.post.timeIn}${approveTarget.post.timeOut ? `–${approveTarget.post.timeOut}` : ""}` : ""}
                  </p>
                </div>
                <Users className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveBusy}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={approveBusy}
              className={cn("gap-1.5 font-bold", approveBusy && "opacity-70")}
              onClick={(e) => { e.preventDefault(); void runApprove(); }}
            >
              {approveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {t("Ya, Setujui Klaim", "Yes, Approve Claim")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== dialog tolak klaim (alasan wajib) ===== */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => { if (!v && !rejectBusy) setRejectTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Tolak Klaim — {name}", "Reject Claim — {name}", { name: rejectTarget?.claim.employee?.fullName ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2.5 py-1">
            {rejectTarget && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-900/60">
                {t("Klaim utk {shift} · {date} ({sched}).", "Claim for {shift} · {date} ({sched}).", { shift: rejectTarget.post.dayTypeName, date: fmtDate(rejectTarget.post.workDate), sched: rejectTarget.post.scheduleName })}
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Alasan penolakan *", "Rejection reason *")}</Label>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t("mis. slot sudah terisi karyawan lain / keahlian tidak sesuai", "e.g. slot taken by another employee / skills don't match")} className="min-h-20 text-sm" maxLength={300} />
              <p className="text-[10px] text-slate-400">{t("Alasan dikirim ke karyawan via notifikasi in-app dan dicatat di log aktivitas.", "The reason is sent to the employee via in-app notification and recorded in the activity log.")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={rejectBusy}>{t("Batal")}</Button>
            <Button onClick={runReject} disabled={rejectBusy || !rejectReason.trim()} className="gap-1.5 bg-rose-600 font-bold hover:bg-rose-700">
              {rejectBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Menolak…", "Rejecting…")}</> : <>{t("Tolak Klaim", "Reject Claim")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
