"use client";
// RekanKerja Attendance — Tukar Shift (Task 27-g): approval permintaan tukar shift
// antar karyawan (diajukan dari ESS). Approve membuat override ScheduleAssignment
// 1-hari per pasangan (engine assignmentFor memilih validFrom terbaru) + rekap
// absensi kedua karyawan dihitung ulang — jadwal KEDUA pihak benar-benar tertukar.
// Konvensi approval-list mengikuti workoff/overtime: filter chips status,
// badge StatusPill, aksi digerbang useMenuPerms op:approve, tabel desktop +
// kartu mobile, dialog tolak (catatan opsional) + AlertDialog konfirmasi setujui.
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtDate, fmtDateTime, initials, avatarColor } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { ArrowLeftRight, CheckCircle2, XCircle, Search, Eye, Clock3, CalendarRange, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SwapPerson {
  id: string;
  employeeNo: string;
  fullName: string;
  photoUrl: string | null;
}

interface SwapRow {
  id: string;
  code: string;
  swapDate: string;
  reason: string | null;
  status: string;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  createdAt: string;
  requester: SwapPerson;
  target: SwapPerson;
  requesterScheduleName: string;
  targetScheduleName: string;
  appliedAssignment1: string | null;
  appliedAssignment2: string | null;
  applied: boolean;
}

interface SwapData {
  requests: SwapRow[];
  stats: { total: number; pending: number; approved: number; rejected: number; cancelled: number };
}

const STATUS_FILTERS = [
  { key: "Pending", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Rejected", label: "Ditolak" },
  { key: "Cancelled", label: "Dibatalkan" },
  { key: "all", label: "Semua" },
];

const STATUS_FILTERS_EN: Record<string, string> = {
  Pending: "Pending", Approved: "Approved", Rejected: "Rejected", Cancelled: "Cancelled", all: "All",
};

const SCROLL_CLS = "max-h-96 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700";

function PersonCell({ p, t, size = "sm" }: { p: SwapPerson; t: (a: string, b: string, v?: Record<string, string | number>) => string; size?: "sm" | "md" }) {
  const dim = size === "md" ? "h-10 w-10 rounded-xl" : "h-8 w-8 rounded-lg";
  return (
    <div className="flex items-center gap-2">
      <Avatar className={cn(dim, "shrink-0")}>
        {p.photoUrl && <AvatarImage src={p.photoUrl} alt={t("Foto {name}", "Photo of {name}", { name: p.fullName })} />}
        <AvatarFallback className={cn(dim, "text-[10px] font-extrabold", avatarColor(p.fullName))}>{initials(p.fullName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-200">{p.fullName}</p>
        <p className="truncate font-mono text-[10px] text-slate-400">{p.employeeNo}</p>
      </div>
    </div>
  );
}

export function AttendanceShiftSwapPage() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<SwapRow | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<SwapRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  const [detail, setDetail] = useState<SwapRow | null>(null);

  const api = useApi<SwapData>(`/api/rekankerja/attendance/shift-swap?status=${statusFilter}`);

  const rows = useMemo(() => (api.data?.requests ?? []).filter((r) => {
    const q = query.toLowerCase();
    const matchQ = !q
      || r.code.toLowerCase().includes(q)
      || r.requester.fullName.toLowerCase().includes(q)
      || r.target.fullName.toLowerCase().includes(q)
      || r.requester.employeeNo.toLowerCase().includes(q)
      || r.target.employeeNo.toLowerCase().includes(q)
      || (r.reason ?? "").toLowerCase().includes(q);
    const matchD = !dateFilter || r.swapDate === dateFilter;
    return matchQ && matchD;
  }), [api.data, query, dateFilter]);

  const canApprove = perms.canOp("attendance", "shift-swap", "approve");
  const stats = api.data?.stats;

  const decide = async (r: SwapRow, action: "approve" | "reject", note?: string) => {
    setBusyId(r.id);
    try {
      const res = await apiSend<{ note: string }>("/api/rekankerja/attendance/shift-swap", "PATCH", { id: r.id, action, note });
      toast.success(res.note);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memutuskan permintaan", "Failed to decide request"));
    } finally {
      setBusyId(null);
    }
  };

  const runApprove = async () => {
    if (!approveTarget) return;
    setApproveBusy(true);
    try {
      await decide(approveTarget, "approve");
    } finally {
      setApproveBusy(false);
      setApproveTarget(null);
    }
  };

  const runReject = async () => {
    if (!rejectTarget) return;
    setRejectBusy(true);
    try {
      await decide(rejectTarget, "reject", rejectNote.trim() || undefined);
      setRejectTarget(null);
    } finally {
      setRejectBusy(false);
    }
  };

  const statChips = [
    { key: "pending", label: t("Menunggu Keputusan", "Awaiting Decision"), value: stats?.pending ?? 0, cls: "text-amber-600 dark:text-amber-400", icon: Clock3 },
    { key: "approved", label: t("Disetujui", "Approved"), value: stats?.approved ?? 0, cls: "text-brand dark:text-brand/85", icon: CheckCircle2 },
    { key: "rejected", label: t("Ditolak", "Rejected"), value: stats?.rejected ?? 0, cls: "text-rose-600 dark:text-rose-400", icon: XCircle },
    { key: "total", label: t("Total Permintaan", "Total Requests"), value: stats?.total ?? 0, cls: "text-slate-500", icon: ArrowLeftRight },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Tukar Shift", "Shift Swap")}
        description={t(
          "Persetujuan permintaan tukar shift antar karyawan (diajukan dari ESS) — setujui untuk menukar jadwal kedua pihak pada tanggal terkait.",
          "Approval of employee shift swap requests (submitted from ESS) — approving swaps both parties' schedules on the given date.",
        )}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statChips.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.key} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-slate-400" aria-hidden /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{c.label}</p></div>
              <p className={cn("text-lg font-extrabold", c.cls)}>{c.value}</p>
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
                  statusFilter === f.key ? "ov-fill shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800",
                )}>
                  {t(f.label, STATUS_FILTERS_EN[f.key] ?? f.label)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
                aria-label={t("Filter tanggal tukar", "Filter swap date")}
                className="h-8 w-40 text-xs"
              />
              {dateFilter && (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-[11px] font-bold" onClick={() => setDateFilter("")}>{t("Hapus", "Clear")}</Button>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari kode / nama…", "Search code / name…")} className="h-8 w-52 pl-8 text-xs" />
              </div>
            </div>
          </div>

          {api.loading && !api.data ? (
            <div className="p-5"><LoadingRows rows={6} /></div>
          ) : api.error ? (
            <div className="p-5"><EmptyState title={t("Gagal memuat", "Failed to load")} description={api.error} icon={<XCircle className="h-6 w-6" />} /></div>
          ) : rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={t("Tidak ada permintaan tukar shift", "No shift swap requests")}
                description={t(
                  "Permintaan tukar shift karyawan (dari portal ESS) tampil di sini untuk disetujui atau ditolak.",
                  "Employee shift swap requests (from the ESS portal) appear here to approve or reject.",
                )}
                icon={<ArrowLeftRight className="h-6 w-6" />}
              />
            </div>
          ) : (
            <>
              {/* ===== tabel (≥ md) ===== */}
              <div className={cn("hidden overflow-x-auto md:block", SCROLL_CLS)}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableHead className="text-[11px] font-bold">{t("Kode", "Code")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Tanggal Tukar", "Swap Date")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Pemohon", "Requester")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Ditukar Dengan", "Swapped With")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Jadwal (Pemohon → Target)", "Schedule (Requester → Target)")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Alasan", "Reason")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Status", "Status")}</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <TableCell>
                          <p className="font-mono text-[11px] font-bold text-slate-500">{r.code}</p>
                          <p className="text-[9px] text-slate-400">{fmtDateTime(r.createdAt)}</p>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-300">
                            <CalendarRange className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {fmtDate(r.swapDate)}
                          </span>
                        </TableCell>
                        <TableCell><PersonCell p={r.requester} t={t} /></TableCell>
                        <TableCell><PersonCell p={r.target} t={t} /></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="max-w-36 truncate text-[10px] font-bold">{r.requesterScheduleName}</Badge>
                            <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                            <Badge variant="outline" className="max-w-36 truncate border-brand/25 bg-brand/10 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">{r.targetScheduleName}</Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.reason
                            ? <p className="max-w-44 truncate text-[11px] italic text-slate-500 dark:text-slate-400" title={r.reason}>“{r.reason}”</p>
                            : <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={r.status} />
                          {r.decidedAt && (
                            <p className="mt-1 text-[9px] text-slate-400" title={`${r.decidedByName ?? "-"} · ${r.decisionNote ?? ""}`}>
                              {fmtDateTime(r.decidedAt)}{r.decidedByName ? ` · ${r.decidedByName}` : ""}
                            </p>
                          )}
                          {r.decisionNote && <p className="max-w-36 truncate text-[9px] italic text-slate-400" title={r.decisionNote}>{r.decisionNote}</p>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Detail", "Detail")} onClick={() => setDetail(r)} aria-label={t("Lihat detail {code}", "View detail {code}", { code: r.code })}>
                              <Eye className="h-4 w-4 text-slate-400" />
                            </Button>
                            {r.status === "Pending" && canApprove && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Setujui", "Approve")} disabled={busyId === r.id} onClick={() => setApproveTarget(r)} aria-label={t("Setujui tukar shift", "Approve swap")}>
                                  {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-brand" />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Tolak", "Reject")} disabled={busyId === r.id} onClick={() => { setRejectTarget(r); setRejectNote(""); }} aria-label={t("Tolak tukar shift", "Reject swap")}>
                                  <XCircle className="h-4 w-4 text-rose-500" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ===== kartu (< md) ===== */}
              <div className={cn("space-y-3 p-4 md:hidden", SCROLL_CLS)}>
                {rows.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-[11px] font-bold text-slate-500">{r.code}</p>
                        <p className="text-[13px] font-extrabold text-slate-800 dark:text-slate-200">{fmtDate(r.swapDate)}</p>
                      </div>
                      <StatusPill status={r.status} />
                    </div>
                    <div className="mt-2.5 flex items-center gap-2">
                      <PersonCell p={r.requester} t={t} />
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />
                      <PersonCell p={r.target} t={t} />
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Badge variant="outline" className="max-w-[38%] truncate text-[10px] font-bold">{r.requesterScheduleName}</Badge>
                      <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                      <Badge variant="outline" className="max-w-[38%] truncate border-brand/25 bg-brand/10 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">{r.targetScheduleName}</Badge>
                    </div>
                    {r.reason && <p className="mt-2 line-clamp-2 text-[11px] italic text-slate-500 dark:text-slate-400">“{r.reason}”</p>}
                    {r.decisionNote && (
                      <p className="mt-1.5 rounded-lg bg-slate-100/70 px-2.5 py-1 text-[10px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                        {t("Keputusan", "Decision")}: {r.decisionNote}
                      </p>
                    )}
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <Button variant="outline" size="sm" className="h-8 flex-1 gap-1.5 rounded-lg text-[11px] font-bold" onClick={() => setDetail(r)}>
                        <Eye className="h-3.5 w-3.5" /> {t("Detail", "Detail")}
                      </Button>
                      {r.status === "Pending" && canApprove && (
                        <>
                          <Button size="sm" className="h-8 flex-1 gap-1.5 rounded-lg bg-brand text-[11px] font-bold hover:bg-brand/70" disabled={busyId === r.id} onClick={() => setApproveTarget(r)}>
                            {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {t("Setujui", "Approve")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5 rounded-lg border-rose-200 text-[11px] font-bold text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400" disabled={busyId === r.id} onClick={() => { setRejectTarget(r); setRejectNote(""); }}>
                            <XCircle className="h-3.5 w-3.5" /> {t("Tolak", "Reject")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog detail ===== */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-brand dark:text-brand/85" aria-hidden />
              {t("Detail Tukar Shift {code}", "Shift Swap Detail {code}", { code: detail?.code ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {t("Diajukan {when} dari portal karyawan.", "Submitted {when} from the employee portal.", { when: detail ? fmtDateTime(detail.createdAt) : "" })}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Tanggal Tukar", "Swap Date")}</p>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200">{fmtDate(detail.swapDate)}</p>
                </div>
                <StatusPill status={detail.status} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {([["requester", detail.requester, detail.requesterScheduleName], ["target", detail.target, detail.targetScheduleName]] as const).map(([side, p, sched]) => (
                  <div key={side} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      {side === "requester" ? t("Pemohon", "Requester") : t("Ditukar Dengan", "Swapped With")}
                    </p>
                    <PersonCell p={p} t={t} size="md" />
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                      {t("Jadwal saat mengajukan", "Schedule when submitted")}: <b>{sched}</b>
                    </p>
                  </div>
                ))}
              </div>

              {detail.reason && (
                <div className="rounded-xl bg-slate-100/70 px-3.5 py-2.5 dark:bg-slate-800/60">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Alasan", "Reason")}</p>
                  <p className="mt-0.5 text-[12px] italic leading-relaxed text-slate-600 dark:text-slate-300">“{detail.reason}”</p>
                </div>
              )}

              {detail.decidedAt && (
                <div className="rounded-xl border border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Keputusan", "Decision")}</p>
                  <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-300">
                    {fmtDateTime(detail.decidedAt)}{detail.decidedByName ? ` · ${detail.decidedByName}` : ""}
                  </p>
                  {detail.decisionNote && <p className="mt-1 text-[11px] italic text-slate-500 dark:text-slate-400">“{detail.decisionNote}”</p>}
                </div>
              )}

              {detail.applied && (
                <p className="rounded-lg bg-brand/10 px-3 py-2 text-[11px] leading-relaxed text-brand-deep dark:bg-brand/10 dark:text-brand/85">
                  {t(
                    "Override jadwal 1-hari telah dibuat untuk kedua karyawan (assignment 1: {a1}, assignment 2: {a2}) — rekap absensi tanggal tsb dihitung ulang.",
                    "One-day schedule overrides created for both employees (assignment 1: {a1}, assignment 2: {a2}) — that date's attendance recap recalculated.",
                    { a1: detail.appliedAssignment1?.slice(-6) ?? "-", a2: detail.appliedAssignment2?.slice(-6) ?? "-" },
                  )}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>{t("Tutup", "Close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== AlertDialog setujui ===== */}
      <AlertDialog open={!!approveTarget} onOpenChange={(v) => { if (!v && !approveBusy) setApproveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Setujui Tukar Shift {code}?", "Approve Shift Swap {code}?", { code: approveTarget?.code ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Jadwal kedua karyawan pada tanggal ini akan BENAR-BENAR tertukar (override 1-hari), lalu rekap absensi keduanya dihitung ulang.",
                "Both employees' schedules on this date will ACTUALLY swap (1-day override), then both attendance recaps are recalculated.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {approveTarget && (
            <div className="rounded-xl border border-slate-200 px-3.5 py-3 text-[12px] dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-800 dark:text-slate-200">{approveTarget.requester.fullName}</p>
                  <p className="truncate text-[11px] text-slate-400">{approveTarget.requesterScheduleName}</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                <div className="min-w-0 text-right">
                  <p className="truncate font-bold text-slate-800 dark:text-slate-200">{approveTarget.targetScheduleName}</p>
                  <p className="truncate text-[11px] text-slate-400">{approveTarget.target.fullName}</p>
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] font-bold text-slate-500">
                {fmtDate(approveTarget.swapDate)}
              </p>
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
              {t("Setujui & Tukar Jadwal", "Approve & Swap Schedules")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== dialog tolak ===== */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => { if (!rejectBusy) setRejectTarget(v ? rejectTarget : null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Tolak Tukar Shift {no}", "Reject Shift Swap {no}", { no: rejectTarget?.code ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("Kedua karyawan akan menerima notifikasi penolakan (beserta catatan bila diisi).", "Both employees will receive a rejection notification (including the note if provided).")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan penolakan (opsional)", "Rejection note (optional)")}</Label>
              <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder={t("mis. kebutuhan operator shift malam tidak dapat diganggu", "e.g. night-shift operator coverage cannot be disturbed")} className="min-h-20 text-sm" maxLength={300} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={rejectBusy} onClick={() => setRejectTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={() => void runReject()} disabled={rejectBusy} className="gap-1.5 bg-rose-600 font-bold hover:bg-rose-700">
              {rejectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              {t("Tolak Permintaan", "Reject Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
