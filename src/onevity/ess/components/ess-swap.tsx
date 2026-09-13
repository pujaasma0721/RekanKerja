"use client";
// OneVity ESS — Tukar Shift (Task 27-g) =======================================
// =====================================================================
// Self-service tukar shift: karyawan mengajukan → ADMIN menyetujui
// (menu Kehadiran → Tukar Shift) → override jadwal 1-hari dibuat sehingga
// jadwal KEDUA pihak benar-benar tertukar pada tanggal tsb.
//   · "Ajukan Tukar Shift": pilih tanggal (min hari ini) → jadwal saya
//     hari itu + daftar rekan kandidat (punya jadwal & shift-nya BEDA) →
//     pilih rekan → alasan → kirim (TSK-xxxx, toast sukses);
//   · "Permintaan Saya": riwayat + status + catatan keputusan + batalkan
//     saat masih Pending;
//   · "Permintaan ke Saya": rekan mengajukan tukar shift dengan saya —
//     informasional, keputusan ada di admin (hint "menunggu persetujuan
//     admin").
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight, Loader2, Send, Search, History, Clock3, CheckCircle2, XCircle,
  Ban, CalendarRange, Inbox, AlertTriangle, UserCheck,
} from "lucide-react";
import { useApi, apiSend, fmtDate, fmtDateTime, initials, avatarColor } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ESS_BASE } from "./ess-api";
import { cn } from "@/lib/utils";

// ============ tipe payload (defensif — bentuk kontrak API swap.ts) ============

interface EssSwapDayType {
  id: string; code: string; name: string; color: string; category: string;
  timeIn: string | null; timeOut: string | null;
}

interface SwapCandidate {
  employeeId: string; employeeNo: string; fullName: string;
  photoUrl: string | null; unitName: string | null;
  dayType: { name: string; timeIn: string | null; timeOut: string | null; category: string; color: string };
  timeLabel: string;
}

interface ProposeData {
  date: string;
  myShift: {
    dayType: EssSwapDayType | null;
    scheduleName: string | null;
    hasAssignment: boolean;
    clockingRequired: boolean;
    holiday: { date: string; name: string; kind: string } | null;
  };
  candidates: SwapCandidate[];
  pendingMine: { id: string; code: string; status: string; targetName: string }[];
}

interface SwapHistoryRow {
  id: string; code: string; swapDate: string; reason: string | null; status: string;
  decisionNote: string | null; decidedAt: string | null; createdAt: string;
  requester: { employeeNo: string; fullName: string; photoUrl: string | null };
  target: { employeeNo: string; fullName: string; photoUrl: string | null };
  requesterScheduleName: string; targetScheduleName: string; applied: boolean;
}

interface ListData { mine: SwapHistoryRow[]; toMe: SwapHistoryRow[] }

const todayIso = () => new Date().toISOString().slice(0, 10);
const SCROLL_CLS = "max-h-96 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700";

const timeLabel = (timeIn: string | null, timeOut: string | null) =>
  !timeIn && !timeOut ? "—" : `${timeIn ?? "?"}–${timeOut ?? "?"}`;

// ===== kartu riwayat (dipakai "Permintaan Saya" + "Permintaan ke Saya") =====
function SwapHistoryCard({
  r, role, t, onCancel, busy,
}: {
  r: SwapHistoryRow;
  role: "mine" | "toMe";
  t: (a: string, b: string, v?: Record<string, string | number>) => string;
  onCancel?: (r: SwapHistoryRow) => void;
  busy: boolean;
}) {
  const partner = role === "mine" ? r.target : r.requester;
  return (
    <div className="rounded-xl border border-stone-200 p-3.5 dark:border-stone-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-stone-500">{r.code}</span>
        <StatusPill status={r.status} />
        <span className="inline-flex items-center gap-1 text-[12px] font-bold text-stone-700 dark:text-stone-300">
          <CalendarRange className="h-3.5 w-3.5 text-stone-400" aria-hidden /> {fmtDate(r.swapDate)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Avatar className="h-9 w-9 shrink-0 rounded-xl">
          {partner.photoUrl && <AvatarImage src={partner.photoUrl} alt={t("Foto {name}", "Photo of {name}", { name: partner.fullName })} />}
          <AvatarFallback className={cn("rounded-xl text-[11px] font-extrabold", avatarColor(partner.fullName))}>{initials(partner.fullName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-stone-800 dark:text-stone-200">
            {role === "mine" ? t("dengan", "with") : t("dari", "from")} {partner.fullName}
          </p>
          <p className="truncate font-mono text-[10px] text-stone-400">{partner.employeeNo}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="max-w-[45%] truncate text-[10px] font-bold">
          {r.requesterScheduleName}
        </Badge>
        <ArrowLeftRight className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />
        <Badge variant="outline" className="max-w-[45%] truncate border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
          {r.targetScheduleName}
        </Badge>
      </div>

      {r.reason && (
        <p className="mt-1.5 rounded-lg bg-stone-100/70 px-2.5 py-1.5 text-[11px] italic leading-relaxed text-stone-500 dark:bg-stone-800/60 dark:text-stone-400">
          “{r.reason}”
        </p>
      )}

      {r.status === "Pending" && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          <Clock3 className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden />
          {t("Menunggu persetujuan admin", "Awaiting admin approval")}
        </p>
      )}
      {r.status === "Approved" && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-brand-deep dark:text-brand/85">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("Jadwal Anda telah tertukar pada tanggal tsb", "Your schedule has been swapped on that date")}
        </p>
      )}
      {r.status === "Rejected" && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t("Ditolak", "Rejected")}{r.decisionNote ? ` — ${r.decisionNote}` : ""}</span>
        </p>
      )}
      {r.status === "Cancelled" && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-stone-400">
          <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("Dibatalkan", "Cancelled")}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-stone-400">
          {t("diajukan", "submitted")} {fmtDateTime(r.createdAt)}
          {r.decidedAt ? ` · ${t("diputuskan", "decided")} ${fmtDateTime(r.decidedAt)}` : ""}
        </p>
        {role === "mine" && r.status === "Pending" && onCancel && (
          <Button
            variant="outline" size="sm" disabled={busy}
            className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold text-stone-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
            onClick={() => onCancel(r)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} {t("Batalkan", "Cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function EssSwap() {
  const { t } = useI18n();
  const [date, setDate] = useState(todayIso());
  const [targetId, setTargetId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);

  const propose = useApi<ProposeData>(`${ESS_BASE}/swap?date=${date}`);
  const list = useApi<ListData>(`${ESS_BASE}/swap?list=mine`);
  const mineRows = list.data?.mine ?? [];
  const toMeRows = list.data?.toMe ?? [];

  const myShift = propose.data?.myShift ?? null;
  const candidates = useMemo(() => {
    const q = query.toLowerCase();
    return (propose.data?.candidates ?? []).filter((c) =>
      !q || c.fullName.toLowerCase().includes(q) || c.employeeNo.toLowerCase().includes(q));
  }, [propose.data, query]);
  const pendingMine = propose.data?.pendingMine ?? [];
  const blocked = pendingMine.length > 0 || !myShift?.hasAssignment || !myShift?.dayType;
  const selected = candidates.find((c) => c.employeeId === targetId) ?? null;

  // ganti tanggal → reset pilihan rekan (kandidat berubah per tanggal)
  const onDateChange = (v: string) => {
    setDate(v);
    setTargetId(null);
  };

  const submit = async () => {
    if (busy || !targetId || !reason.trim()) return;
    setBusy(true);
    try {
      const res = await apiSend<{ code: string; status: string }>(`${ESS_BASE}/swap`, "POST", {
        targetId, date, reason: reason.trim(),
      });
      toast.success(t(
        "Permintaan tukar shift {code} diajukan — menunggu persetujuan admin",
        "Shift swap request {code} submitted — awaiting admin approval",
        { code: res.code },
      ));
      setReason("");
      setTargetId(null);
      propose.refresh();
      list.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan tukar shift", "Failed to submit shift swap"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (r: SwapHistoryRow) => {
    setCancelBusyId(r.id);
    try {
      const res = await apiSend<{ note: string }>(`${ESS_BASE}/swap`, "PATCH", { id: r.id, action: "cancel" });
      toast.success(res.note);
      propose.refresh();
      list.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membatalkan", "Failed to cancel"));
    } finally {
      setCancelBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Tukar Shift", "Shift Swap")}
        description={t(
          "Ajukan pertukaran jadwal dengan rekan sekerja — admin menyetujui, lalu jadwal kedua pihak benar-benar tertukar pada tanggal tsb.",
          "Request a schedule swap with a colleague — once admin approves, both parties' schedules actually swap on that date.",
        )}
      />

      {/* ===== seksi 1: ajukan tukar shift ===== */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
            </span>
            {t("Ajukan Tukar Shift", "Submit Shift Swap")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3.5 pt-1">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ess-swap-date" className="text-xs font-bold">{t("Tanggal Tukar *", "Swap Date *")}</Label>
              <Input
                id="ess-swap-date" type="date" value={date} min={todayIso()}
                onChange={(e) => onDateChange(e.target.value)} className="text-sm"
              />
              <p className="text-[10px] text-stone-400">{t("Hari ini atau masa depan — hari lampau tidak bisa diajukan.", "Today or later — past dates cannot be requested.")}</p>
            </div>

            {/* jadwal saya tanggal tsb */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Jadwal Saya", "My Schedule")}</Label>
              {propose.loading && !propose.data ? (
                <div className="h-9 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800" />
              ) : myShift?.holiday ? (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-500/25 dark:bg-rose-500/10">
                  <CalendarRange className="h-4 w-4 text-rose-500" aria-hidden />
                  <p className="text-[12px] font-bold text-rose-700 dark:text-rose-400">
                    {t("Libur", "Holiday")} — {myShift.holiday.name}
                  </p>
                </div>
              ) : myShift?.dayType ? (
                <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-800/60">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border" style={{ borderColor: myShift.dayType.color ?? "#d6d3d1", background: myShift.dayType.color ?? "#d6d3d1" }} aria-hidden />
                  <p className="min-w-0 flex-1 truncate text-[12px] font-bold text-stone-700 dark:text-stone-200">
                    {myShift.dayType.name}
                    <span className="ml-1.5 font-mono text-[11px] font-semibold text-stone-400">{timeLabel(myShift.dayType.timeIn, myShift.dayType.timeOut)}</span>
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/25 dark:bg-amber-500/10">
                  <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
                  <p className="text-[12px] font-bold text-amber-700 dark:text-amber-400">
                    {t("Anda tidak berjadwal pada tanggal ini", "You have no schedule on this date")}
                  </p>
                </div>
              )}
              {myShift?.scheduleName && (
                <p className="text-[10px] text-stone-400">{myShift.scheduleName}{!myShift.clockingRequired ? " · non-clocking" : ""}</p>
              )}
            </div>
          </div>

          {/* banner: sudah ada permintaan pending tanggal ini */}
          {pendingMine.length > 0 && (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              <p className="text-[12px] font-semibold leading-relaxed text-amber-800 dark:text-amber-300">
                {t(
                  "Anda masih punya permintaan menunggu keputusan untuk tanggal ini ({code} dengan {name}) — permintaan baru untuk tanggal yang sama akan ditolak.",
                  "You still have a pending request for this date ({code} with {name}) — a new request for the same date will be rejected.",
                  { code: pendingMine[0]!.code, name: pendingMine[0]!.targetName },
                )}
              </p>
            </div>
          )}

          {/* daftar rekan kandidat */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs font-bold">
                {t("Rekan Tukar *", "Swap Partner *")}
                <span className="ml-1.5 font-mono text-[10px] font-semibold text-stone-400">
                  {t("{n} rekan berbeda shift", "{n} colleagues on a different shift", { n: candidates.length })}
                </span>
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" aria-hidden />
                <Input
                  value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("Cari nama / NIK…", "Search name / ID…")}
                  aria-label={t("Cari rekan tukar", "Search swap partner")}
                  className="h-8 w-48 pl-8 text-xs"
                />
              </div>
            </div>

            {propose.loading && !propose.data ? (
              <LoadingRows rows={3} />
            ) : !myShift?.dayType ? (
              <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50/50 px-4 py-5 text-center text-xs text-stone-400 dark:border-stone-700 dark:bg-stone-900/30">
                {t("Pilih tanggal ketika Anda berjadwal untuk melihat rekan yang bisa diajak tukar.", "Pick a date on which you have a schedule to see swap candidates.")}
              </p>
            ) : candidates.length === 0 ? (
              <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50/50 px-4 py-5 text-center text-xs text-stone-400 dark:border-stone-700 dark:bg-stone-900/30">
                {t(
                  "Tidak ada rekan dengan shift berbeda pada tanggal ini.",
                  "No colleague has a different shift on this date.",
                )}
              </p>
            ) : (
              <div className={cn("space-y-2", SCROLL_CLS)} role="listbox" aria-label={t("Daftar rekan kandidat tukar shift", "Shift swap candidate list")}>
                {candidates.map((c) => {
                  const isSel = c.employeeId === targetId;
                  return (
                    <button
                      key={c.employeeId} type="button" role="option" aria-selected={isSel}
                      onClick={() => setTargetId(isSel ? null : c.employeeId)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition hover:border-amber-300 hover:bg-amber-50/50 dark:hover:border-amber-500/40 dark:hover:bg-amber-500/5",
                        isSel
                          ? "border-amber-400 bg-amber-50 ring-1 ring-amber-400 dark:border-amber-500/50 dark:bg-amber-500/10"
                          : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900",
                      )}
                    >
                      <Avatar className="h-9 w-9 shrink-0 rounded-xl">
                        {c.photoUrl && <AvatarImage src={c.photoUrl} alt={t("Foto {name}", "Photo of {name}", { name: c.fullName })} />}
                        <AvatarFallback className={cn("rounded-xl text-[11px] font-extrabold", avatarColor(c.fullName))}>{initials(c.fullName)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold text-stone-800 dark:text-stone-200">{c.fullName}</p>
                        <p className="truncate font-mono text-[10px] text-stone-400">
                          {c.employeeNo}{c.unitName ? ` · ${c.unitName}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge variant="outline" className="max-w-40 truncate border-stone-200 text-[10px] font-bold dark:border-stone-700">
                          {c.dayType.name}
                        </Badge>
                        <p className="mt-0.5 font-mono text-[10px] font-semibold text-stone-400">{c.timeLabel}</p>
                      </div>
                      {isSel && <UserCheck className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* alasan */}
          <div className="space-y-1.5">
            <Label htmlFor="ess-swap-reason" className="text-xs font-bold">{t("Alasan Tukar *", "Reason *")}</Label>
            <Textarea
              id="ess-swap-reason" rows={3} maxLength={300} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("mis. keperluan keluarga pagi — bersedia ganti shift malam", "e.g. family matter in the morning — willing to take the night shift")}
              className="min-h-16 text-sm"
            />
          </div>

          <p className="rounded-lg bg-stone-50 px-3 py-2 text-[10px] leading-relaxed text-stone-500 dark:bg-stone-900/60">
            {t(
              "Permintaan masuk ke admin (menu Kehadiran → Tukar Shift). Setelah disetujui, jadwal Anda dan rekan tertukar pada tanggal tsb — rekap absensi & jam kerja dihitung mengikuti shift baru.",
              "The request goes to admin (Attendance → Shift Swap). Once approved, your and your colleague's schedules swap on that date — attendance recap and working hours follow the new shift.",
            )}
          </p>

          <div className="flex justify-end">
            <Button
              onClick={() => void submit()}
              disabled={busy || blocked || !targetId || !reason.trim()}
              className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? t("Mengirim…") : t("Ajukan Tukar Shift", "Submit Swap")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== seksi 2: permintaan saya ===== */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Permintaan Saya", "My Requests")}
            {mineRows.length > 0 && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-extrabold text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                {mineRows.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-1">
          {list.loading && !list.data ? (
            <LoadingRows rows={3} />
          ) : mineRows.length === 0 ? (
            <EmptyState
              title={t("Belum ada permintaan tukar shift", "No shift swap requests yet")}
              description={t("Ajukan lewat formulir di atas — status persetujuannya tampil di sini.", "Submit using the form above — approval status appears here.")}
              icon={History}
            />
          ) : (
            <div className={cn("space-y-3", SCROLL_CLS)}>
              {mineRows.map((r) => (
                <SwapHistoryCard key={r.id} r={r} role="mine" t={t} onCancel={cancel} busy={cancelBusyId === r.id} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== seksi 3: permintaan ke saya ===== */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Inbox className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Permintaan ke Saya", "Requests to Me")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-1">
          <p className="mb-2.5 text-[11px] leading-relaxed text-stone-400">
            {t(
              "Rekan yang mengajukan tukar shift dengan Anda. Keputusan diambil admin — Anda akan menerima notifikasi saat disetujui/ditolak.",
              "Colleagues requesting a swap with you. Admin decides — you get a notification once approved/rejected.",
            )}
          </p>
          {list.loading && !list.data ? (
            <LoadingRows rows={2} />
          ) : toMeRows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50/50 px-4 py-5 text-center text-xs text-stone-400 dark:border-stone-700 dark:bg-stone-900/30">
              {t("Belum ada rekan yang mengajukan tukar shift dengan Anda.", "No colleague has requested a swap with you yet.")}
            </p>
          ) : (
            <div className={cn("space-y-3", SCROLL_CLS)}>
              {toMeRows.map((r) => (
                <SwapHistoryCard key={r.id} r={r} role="toMe" t={t} busy={false} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
