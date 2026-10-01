"use client";
// RekanKerja ESS — Dashboard: sapaan personal, KPI cuti/pengajuan/presensi, widget
// CLOCK IN/OUT menonjol (geolokasi opsional + catatan), aksi cepat pengajuan,
// pengajuan terbaru, ringkas saldo cuti, slip gaji terakhir, feed notifikasi.
import { useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Palmtree, ClipboardList, Clock, ReceiptText, Bell, MapPin, LogIn, LogOut,
  Fingerprint, TrendingUp, Inbox, CheckCircle2, ArrowRight, Loader2, AlertTriangle, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, fmtIDR, fmtDateLong } from "@/rekankerja/shared/lib/api";
import { useI18n, loc, locActivity } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingCards, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ESS_BASE, essDocTypeLabel, essDocTypeLabelEn, fmtClockTime, submitClock } from "./ess-api";
import type { EssDashboard, EssMe, EssView } from "./ess-types";

interface EssDashboardProps {
  me: EssMe;
  go: (v: EssView, intent?: string | null) => void;
}

// ============ kartu KPI (pola ui-kit admin, aksen amber) ============
function EssKpi({ label, value, sub, icon: Icon, hero = false }: {
  label: string; value: string; sub?: string; icon: React.ElementType; hero?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden rounded-2xl border-slate-200/80 shadow-sm transition-all hover:shadow-md hover:shadow-amber-100/60 dark:border-slate-800 dark:hover:shadow-slate-900/60">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</p>
            <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">{value}</p>
            {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
          </div>
          <div className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
            hero ? "bg-amber-500 text-white shadow-lg shadow-amber-500/30" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
          )}>
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function EssDashboard({ me, go }: EssDashboardProps) {
  const { t, locale } = useI18n();
  const dash = useApi<EssDashboard>(`${ESS_BASE}/dashboard`);
  const [note, setNote] = useState("");
  const [clockBusy, setClockBusy] = useState<"IN" | "OUT" | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "ok" | "off">("idle");
  // 27-a: pesan error presensi (geofence / validasi) tampil menetap di widget clock,
  // bukan hanya toast sekilas.
  const [clockError, setClockError] = useState<string | null>(null);

  // ===== sapaan sesuai jam =====
  const hour = new Date().getHours();
  const greet =
    hour < 11 ? t("Selamat pagi", "Good morning")
    : hour < 15 ? t("Selamat siang", "Good afternoon")
    : hour < 18 ? t("Selamat sore", "Good afternoon")
    : t("Selamat malam", "Good evening");
  const firstName = me.employee.fullName.split(" ")[0] ?? me.employee.fullName;

  // ===== clock in/out — geolokasi opsional dgn fallback mulus =====
  // 27-a: bila Geofencing Ketat aktif dan lokasi ditolak, server menolak clock —
  // pesan error server ditampilkan toast + banner menetap di widget.
  const doClock = async (direction: "IN" | "OUT") => {
    if (clockBusy) return;
    setClockBusy(direction);
    setClockError(null);
    let latitude: number | undefined;
    let longitude: number | undefined;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (typeof navigator === "undefined" || !navigator.geolocation) { reject(new Error("unsupported")); return; }
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60_000 });
      });
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
      setGeoState("ok");
    } catch {
      setGeoState("off"); // izin ditolak / tidak tersedia → kirim tanpa koordinat
    }
    try {
      const res = await submitClock({ direction, latitude, longitude, note: note.trim() || undefined });
      toast.success(
        direction === "IN"
          ? t("Clock in tercatat pukul {time}", "Clock in recorded at {time}", { time: fmtClockTime(res.time, locale) })
          : t("Clock out tercatat pukul {time}", "Clock out recorded at {time}", { time: fmtClockTime(res.time, locale) }),
      );
      setNote("");
      dash.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("Gagal mencatat presensi", "Failed to record attendance");
      toast.error(msg, { duration: 8000 });
      setClockError(msg);
    } finally {
      setClockBusy(null);
    }
  };

  // ===== loading / error =====
  if (dash.loading && !dash.data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-36 w-full rounded-3xl" />
        <LoadingCards cards={4} />
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>
        <LoadingRows rows={4} />
      </div>
    );
  }
  if (!dash.data) {
    return (
      <div>
        <PageHeader title={t("Dashboard", "Dashboard")} description={t("Ringkasan aktivitas kekaryawanan Anda.", "A summary of your employee activity.")} />
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900/30">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-500/10">
            <AlertTriangle className="h-6 w-6 text-rose-500 dark:text-rose-400" aria-hidden />
          </div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t("Gagal memuat dashboard", "Failed to load dashboard")}</p>
          <p className="max-w-sm break-words text-xs text-slate-500">{dash.error ?? t("Server tidak dapat dijangkau.", "The server could not be reached.")}</p>
          <Button onClick={dash.refresh} variant="outline" className="gap-2 rounded-xl font-bold">
            <Loader2 className="h-4 w-4" /> {t("Coba Lagi", "Try Again")}
          </Button>
        </div>
      </div>
    );
  }

  const d = dash.data;
  const k = d.kpi;
  const clock = d.clockToday;
  const clocked = clock != null && clock.in != null;
  const doneForToday = clocked && clock!.out != null;

  const quickActions = [
    { label: t("Ajukan Cuti", "Request Leave"), icon: Palmtree, onClick: () => go("leave", "new"), cls: "text-amber-700 dark:text-amber-400" },
    { label: t("Izin Tidak Masuk", "Work Off Permit"), icon: ClipboardList, onClick: () => go("requests", "workoff"), cls: "text-brand-deep dark:text-brand/85" },
    { label: t("Ajukan Lembur", "Request Overtime"), icon: Clock, onClick: () => go("requests", "overtime"), cls: "text-orange-700 dark:text-orange-400" },
  ];

  const maxBalance = Math.max(1, ...d.leaveBalances.map((b) => b.available ?? 0));

  return (
    <div className="space-y-5">
      {/* ===== hero sapaan ===== */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="relative overflow-hidden rounded-3xl ov-hero p-6 text-white ov-glow sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 right-24 h-48 w-48 rounded-full bg-white/5 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white ring-1 ring-white/15 backdrop-blur">
                <Sparkles className="h-3 w-3" aria-hidden /> {t("Employee Self Service", "Employee Self Service")}
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                {greet}, {firstName} 👋
              </h1>
              <p className="mt-1.5 text-sm text-white/85">
                {fmtDateLong(new Date())}
                {me.employee.positionTitle ? ` · ${me.employee.positionTitle}` : ""}
                {me.employee.orgUnitName ? ` · ${me.employee.orgUnitName}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button onClick={() => go("profile")} variant="outline" className="gap-2 border-white/25 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white backdrop-blur">
                <Fingerprint className="h-4 w-4" /> {t("Profil Saya", "My Profile")}
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ===== KPI ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EssKpi hero label={t("Saldo Cuti Tersedia", "Leave Balance Available")} value={String(k.leaveAvailable ?? 0)} sub={t("hari cuti bisa dipakai", "days of leave available")} icon={Palmtree} />
        <EssKpi label={t("Pengajuan Saya Menunggu", "My Pending Requests")} value={String(k.pendingMine ?? 0)} sub={t("menunggu keputusan approver", "awaiting approver decision")} icon={Inbox} />
        {(k.waitingApproval ?? 0) > 0 && (
          <EssKpi label={t("Menunggu Persetujuan Saya", "Awaiting My Approval")} value={String(k.waitingApproval ?? 0)} sub={t("butuh keputusan Anda", "needs your decision")} icon={CheckCircle2} />
        )}
        <EssKpi label={t("Hadir Bulan Ini", "Present This Month")} value={String(k.present ?? 0)} sub={t("{n} telat · {m} absen", "{n} late · {m} absent", { n: k.late ?? 0, m: k.absent ?? 0 })} icon={TrendingUp} />
      </div>

      {/* ===== widget clock + aksi cepat ===== */}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* CLOCK IN/OUT — menonjol, amber */}
        <Card className="relative overflow-hidden rounded-2xl border-amber-500/30 bg-gradient-to-br from-amber-500 via-amber-600 to-amber-800 text-white shadow-lg shadow-amber-500/25 lg:col-span-2 dark:border-amber-500/25">
          <CardContent className="relative p-5 sm:p-6">
            <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur">
                    <Fingerprint className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[13px] font-extrabold uppercase tracking-[0.12em] text-white/90">{t("Presensi Hari Ini", "Attendance Today")}</p>
                    <p className="text-[11px] text-white/70">{fmtDateLong(new Date())}</p>
                  </div>
                </div>
                <span className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-bold ring-1",
                  doneForToday ? "bg-brand/55/20 text-brand/75 ring-brand/40/30"
                  : clocked ? "bg-white/15 text-white ring-white/25"
                  : "bg-white/15 text-white/90 ring-white/25",
                )}>
                  {doneForToday
                    ? t("Hari ini selesai", "Done for today")
                    : clocked
                      ? t("Sudah clock in", "Clocked in")
                      : t("Belum ada clock", "No clock yet")}
                </span>
              </div>

              {/* jam in/out */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 ring-1 ring-white/15">
                  <LogIn className="h-4 w-4 text-white/70" aria-hidden />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">IN</span>
                  <span className="text-lg font-extrabold tabular-nums">{clock?.in ? fmtClockTime(clock.in, locale) : "—:—"}</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 ring-1 ring-white/15">
                  <LogOut className="h-4 w-4 text-white/70" aria-hidden />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">OUT</span>
                  <span className="text-lg font-extrabold tabular-nums">{clock?.out ? fmtClockTime(clock.out, locale) : "—:—"}</span>
                </div>
              </div>

              {/* tombol besar + catatan */}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <Button
                  disabled={clockBusy != null || clocked || doneForToday}
                  onClick={() => void doClock("IN")}
                  className="h-12 flex-1 gap-2 rounded-2xl bg-white text-base font-extrabold text-amber-700 shadow-lg hover:bg-amber-50 disabled:opacity-60"
                >
                  {clockBusy === "IN" ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                  {t("Clock In")}
                </Button>
                <Button
                  disabled={clockBusy != null || !clocked || doneForToday}
                  onClick={() => void doClock("OUT")}
                  className="h-12 flex-1 gap-2 rounded-2xl bg-white text-base font-extrabold text-amber-700 shadow-lg hover:bg-amber-50 disabled:opacity-60"
                >
                  {clockBusy === "OUT" ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
                  {t("Clock Out")}
                </Button>
                <div className="sm:w-56">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/60" htmlFor="ess-clock-note">
                    {t("Catatan (opsional)", "Note (optional)")}
                  </label>
                  <Input
                    id="ess-clock-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={120}
                    placeholder={t("mis. WFH, kunjungan klien…", "e.g. WFH, client visit…")}
                    className="h-10 rounded-xl border-white/30 bg-white/10 text-white placeholder:text-white/60 focus-visible:ring-white/40"
                  />
                </div>
              </div>

              {/* status geolokasi */}
              <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-white/70">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {geoState === "ok"
                  ? t("Koordinat lokasi dilampirkan pada catatan presensi.", "Location coordinates attached to the attendance record.")
                  : geoState === "off"
                    ? t("Lokasi tidak tersedia — presensi tetap tercatat tanpa koordinat (ditolak bila geofencing ketat).", "Location unavailable — attendance is still recorded without coordinates (rejected when strict geofencing is on).")
                    : t("Lokasi akan dilampirkan otomatis bila perangkat mengizinkan.", "Location will be attached automatically if the device allows it.")}
              </p>

              {/* 27-a: banner error presensi (geofence ketat / validasi) — menetap */}
              {clockError && (
                <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-rose-950/50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-100 ring-1 ring-rose-400/40">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{clockError}</span>
                  <button
                    type="button"
                    onClick={() => setClockError(null)}
                    className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-200/70 hover:text-white"
                    aria-label={t("Tutup pesan error", "Dismiss error")}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* aksi cepat */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">{t("Aksi Cepat", "Quick Actions")}</CardTitle>
            <p className="mt-0.5 text-[11px] text-slate-400">{t("Pengajuan paling sering dipakai", "Most-used requests")}</p>
          </CardHeader>
          <CardContent className="space-y-2 pt-2">
            {quickActions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  onClick={a.onClick}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3 text-left transition hover:border-amber-300 hover:bg-amber-50/60 dark:border-slate-700 dark:hover:border-amber-500/40 dark:hover:bg-amber-500/10"
                >
                  <Icon className={cn("h-5 w-5 shrink-0", a.cls)} aria-hidden />
                  <span className="flex-1 text-[13px] font-bold text-slate-700 dark:text-slate-200">{a.label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />
                </button>
              );
            })}
            <p className="pt-1 text-[11px] leading-relaxed text-slate-400">
              {t("Lembur bulan ini: {n} jam", "Overtime this month: {n} h", { n: k.overtimeHoursMonth ?? 0 })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ===== pengajuan terbaru + saldo cuti ===== */}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold">{t("Pengajuan Terbaru", "Recent Requests")}</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => go("leave")} className="h-7 gap-1 px-2 text-[11px] font-bold text-amber-700 hover:text-amber-800 dark:text-amber-400">
              {t("Cuti Saya", "My Leave")} <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="pt-2">
            {d.recentRequests.length === 0 ? (
              <EmptyState
                title={t("Belum ada pengajuan", "No requests yet")}
                description={t("Pengajuan cuti, izin, dan lembur akan tampil di sini.", "Leave, permit, and overtime requests will appear here.")}
                icon={ClipboardList}
              />
            ) : (
              <ul className="space-y-1">
                {d.recentRequests.slice(0, 6).map((r) => (
                  <li key={r.docNo + r.docType} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">
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

        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold">{t("Ringkas Saldo Cuti", "Leave Balance Summary")}</CardTitle>
            <StatusPill status="Active" />
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            {d.leaveBalances.length === 0 ? (
              <EmptyState title={t("Saldo cuti belum tersedia", "Leave balance unavailable")} description={t("Saldo akan muncul setelah kebijakan cuti ditetapkan.", "Balances appear once leave policy is configured.")} icon={Palmtree} />
            ) : (
              d.leaveBalances.slice(0, 5).map((b) => (
                <div key={b.code ?? b.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <p className="truncate text-[12px] font-bold text-slate-700 dark:text-slate-200">{b.name}</p>
                    <p className="shrink-0 text-[12px] font-extrabold tabular-nums text-amber-700 dark:text-amber-400">
                      {t("{n} hari", "{n} days", { n: b.available ?? 0 })}
                    </p>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600"
                      style={{ width: `${Math.min(100, Math.max(3, ((b.available ?? 0) / maxBalance) * 100))}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== slip gaji terakhir + feed notifikasi ===== */}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">{t("Slip Gaji Terakhir", "Latest Payslip")}</CardTitle>
            <p className="mt-0.5 text-[11px] text-slate-400">{t("Periode berjalan terakhir yang tersedia", "Latest available period")}</p>
          </CardHeader>
          <CardContent className="pt-2">
            {d.latestPayslip ? (
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                  <ReceiptText className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold text-slate-800 dark:text-slate-100">{loc(d.latestPayslip.periodName)}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                    <StatusPill status={d.latestPayslip.status} />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Diterima", "Net Pay")}</p>
                  <p className="text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-50">{fmtIDR(d.latestPayslip.netAmount)}</p>
                </div>
                <Button onClick={() => go("payslips", `line:${d.latestPayslip!.lineId}`)} size="sm" className="gap-1.5 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
                  {t("Lihat")} <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <EmptyState
                title={t("Belum ada slip gaji", "No payslip yet")}
                description={t("Slip gaji akan tampil setelah periode pertama diproses.", "Payslips appear after your first payroll period is processed.")}
                icon={ReceiptText}
              />
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">{t("Notifikasi Terbaru", "Recent Notifications")}</CardTitle>
            <p className="mt-0.5 text-[11px] text-slate-400">{t("Dari bell di kanan atas untuk feed lengkap", "Use the bell above for the full feed")}</p>
          </CardHeader>
          <CardContent className="pt-2">
            {d.notifications.length === 0 ? (
              <EmptyState title={t("Tidak ada notifikasi", "No notifications")} description={t("Pemberitahuan pengajuan & payroll tampil di sini.", "Request & payroll updates will appear here.")} icon={Bell} />
            ) : (
              <ul className="space-y-1.5">
                {d.notifications.slice(0, 5).map((n) => {
                  const unread = !n.readAt;
                  return (
                    <li key={n.id} className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", unread ? "bg-amber-500" : "bg-slate-200 dark:bg-slate-700")} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-[12.5px]", unread ? "font-bold text-slate-800 dark:text-slate-100" : "font-medium text-slate-600 dark:text-slate-400")}>{locActivity(n.title)}</p>
                        {n.body && <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{locActivity(n.body)}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
