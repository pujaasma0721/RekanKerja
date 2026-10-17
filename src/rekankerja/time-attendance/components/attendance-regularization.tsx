"use client";
// RekanKerja Attendance — REGULARISASI ABSENSI (P1.3 / D-BM7): karyawan
// mengajukan koreksi absensi sendiri (lupa absen / jam salah) dari ESS; halaman
// ini inbox approval admin/HR — sebelum putus, approver melihat PERBANDINGAN
// jam rekap SAAT INI (AttendanceDaily tanggal tsb) vs jam yang diajukan + alasan
// + lampiran bukti. Approve jenjang terakhir → service auto-apply override
// (state "Revised") + regenerasi rekap hari tsb.
// Konvensi UI: tabel desktop (hidden md:block) + kartu mobile (md:hidden),
// dialog detail sm:max-w-* + max-h overflow, filter status/date, StatusPill,
// tolak wajib catatan ≥10 karakter, busy + toast + error state G10.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ClipboardPen, CheckCircle2, XCircle, Loader2, Search, CalendarClock, ArrowRight, Paperclip, Ban, Clock3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, apiSend, fmtDate } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiErrorState } from "@/rekankerja/time-attendance/components/attendance-ui";

// ===== tipe payload (kontrak service RegRow) =====
interface RegRowUI {
  id: string;
  docNo: string;
  employeeId: string;
  employeeNo: string;
  fullName: string;
  orgUnitName: string | null;
  workDate: string;
  kind: string;
  clockIn: string | null;
  clockOut: string | null;
  reason: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedByName: string | null;
  current: { checkIn: string | null; checkOut: string | null; status: string; state: string; revised: boolean } | null;
  approval: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
}

interface RegListData {
  rows: RegRowUI[];
  stats: { total: number; submitted: number; approved: number; rejected: number; cancelled: number };
  capPerMonth: number;
}

// B-14: urutan inbox approval — Submitted dulu, Semua terakhir.
const STATUS_FILTERS = [
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Rejected", label: "Ditolak" },
  { key: "Cancelled", label: "Ditarik" },
  { key: "all", label: "Semua" },
];
const STATUS_FILTERS_EN: Record<string, string> = {
  Submitted: "Waiting", Approved: "Approved", Rejected: "Rejected", Cancelled: "Withdrawn", all: "All",
};

// jenis regularisasi — badge dwibahasa (peta paralel + t() saat render).
const KIND_META: Record<string, { id: string; en: string; cls: string }> = {
  MissingClockIn: { id: "Lupa Clock In", en: "Missing Clock In", cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400" },
  MissingClockOut: { id: "Lupa Clock Out", en: "Missing Clock Out", cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400" },
  WrongTime: { id: "Jam Salah", en: "Wrong Time", cls: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-400" },
  MissingBoth: { id: "Lupa Keduanya", en: "Missing Both", cls: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400" },
};
function kindMeta(kind: string) {
  return KIND_META[kind] ?? { id: kind, en: kind, cls: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" };
}

const fmtSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

export function AttendanceRegularizationPage() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("Submitted");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const qs = new URLSearchParams({ status: statusFilter });
  if (dateFrom) qs.set("dateFrom", dateFrom);
  if (dateTo) qs.set("dateTo", dateTo);
  const api = useApi<RegListData>(`/api/rekankerja/attendance/regularization?${qs.toString()}`, [statusFilter, dateFrom, dateTo]);

  const [detail, setDetail] = useState<RegRowUI | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RegRowUI | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [decideBusy, setDecideBusy] = useState(false);
  const [rejectBusy, setRejectBusy] = useState(false);

  const rows = useMemo(() => (api.data?.rows ?? []).filter((r) =>
    !query ||
    r.fullName.toLowerCase().includes(query.toLowerCase()) ||
    r.employeeNo.toLowerCase().includes(query.toLowerCase()) ||
    r.docNo.toLowerCase().includes(query.toLowerCase()),
  ), [api.data, query]);
  const stats = api.data?.stats;
  const canDecide = perms.canOp("attendance", "regularization", "approve");

  const decide = async (row: RegRowUI, action: "approve" | "reject", note?: string): Promise<boolean> => {
    setDecideBusy(true);
    try {
      const res = await apiSend<{ docNo: string; status: string; approval: { currentLevel: number; totalLevels: number; currentApprover: string | null } | null }>(
        "/api/rekankerja/attendance/regularization",
        "PATCH",
        { id: row.id, action, note },
      );
      if (res.approval) {
        toast.success(t("Jenjang {l}/{n} disetujui — menunggu {a}", "Tier {l}/{n} approved — awaiting {a}", {
          l: res.approval.currentLevel - 1,
          n: res.approval.totalLevels,
          a: res.approval.currentApprover ?? t("jenjang berikutnya", "the next tier"),
        }));
      } else if (action === "approve") {
        toast.success(t("{d} disetujui — rekap {date} dikoreksi & di-regen (Revised)", "{d} approved — {date} recap corrected & regenerated (Revised)", { d: res.docNo, date: row.workDate }));
      } else {
        toast.success(t("{d} ditolak", "{d} rejected", { d: res.docNo }));
      }
      api.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memproses keputusan", "Failed to process decision"));
      return false;
    } finally {
      setDecideBusy(false);
    }
  };

  const runReject = async () => {
    if (!rejectTarget) return;
    setRejectBusy(true);
    try {
      const ok = await decide(rejectTarget, "reject", rejectNote.trim());
      if (ok) { setRejectTarget(null); setRejectNote(""); setDetail(null); }
    } finally {
      setRejectBusy(false);
    }
  };

  const openDetail = (r: RegRowUI) => setDetail(r);

  // ===== perbandingan before → after (utk tabel + dialog) =====
  const DiffTimes = ({ r, size = "sm" }: { r: RegRowUI; size?: "sm" | "lg" }) => (
    <span className={cn("inline-flex flex-wrap items-center gap-1 font-mono tabular-nums", size === "lg" ? "text-[13px]" : "text-[11.5px]")}>
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{r.current?.checkIn ?? "—"}</span>
      <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden />
      <span className="rounded bg-brand/10 px-1.5 py-0.5 font-bold text-brand-deep dark:bg-brand/10 dark:text-brand/90">{r.clockIn ?? "—"}</span>
      <span className="text-slate-300 dark:text-slate-600">/</span>
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{r.current?.checkOut ?? "—"}</span>
      <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden />
      <span className="rounded bg-brand/10 px-1.5 py-0.5 font-bold text-brand-deep dark:bg-brand/10 dark:text-brand/90">{r.clockOut ?? "—"}</span>
    </span>
  );

  const KindBadge = ({ r }: { r: RegRowUI }) => {
    const k = kindMeta(r.kind);
    return <Badge variant="outline" className={cn("text-[10px] font-bold", k.cls)}>{t(k.id, k.en)}</Badge>;
  };

  const StatCards = () => (
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        { label: t("Menunggu Keputusan", "Awaiting Decision"), value: stats?.submitted ?? 0, cls: "text-amber-600 dark:text-amber-400", icon: <ClipboardPen className="h-4 w-4" /> },
        { label: t("Disetujui", "Approved"), value: stats?.approved ?? 0, cls: "text-brand dark:text-brand/85", icon: <CheckCircle2 className="h-4 w-4" /> },
        { label: t("Ditolak", "Rejected"), value: stats?.rejected ?? 0, cls: "text-rose-600 dark:text-rose-400", icon: <XCircle className="h-4 w-4" /> },
        { label: t("Total Pengajuan", "Total Requests"), value: stats?.total ?? 0, cls: "text-slate-500", icon: <CalendarClock className="h-4 w-4" /> },
      ].map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
          className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-2">{s.icon}<p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{s.label}</p></div>
          <p className={cn("text-lg font-extrabold tabular-nums", s.cls)}>{s.value}</p>
          <p className="text-[11px] text-slate-400">{t("cap {n}/bulan aktif per karyawan", "cap {n}/month active per employee", { n: api.data?.capPerMonth ?? 4 })}</p>
        </motion.div>
      ))}
    </div>
  );

  const Actions = ({ r }: { r: RegRowUI }) => (
    <div className="flex items-center gap-1">
      {r.status === "Submitted" && canDecide && (
        <>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Setujui", "Approve")} disabled={decideBusy} onClick={() => decide(r, "approve")} aria-label={t("Setujui regularisasi", "Approve regularization")}>
            <CheckCircle2 className="h-4 w-4 text-brand" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Tolak", "Reject")} disabled={decideBusy} onClick={() => { setRejectTarget(r); setRejectNote(""); }} aria-label={t("Tolak regularisasi", "Reject regularization")}>
            <XCircle className="h-4 w-4 text-rose-500" />
          </Button>
        </>
      )}
      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] font-bold" onClick={() => openDetail(r)}>
        {t("Detail", "Detail")}
      </Button>
    </div>
  );

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Regularisasi Absensi", "Attendance Regularization")}
        description={t("Pengajuan koreksi absensi mandiri (lupa absen / jam salah) — approval berjenjang; persetujuan akhir otomatis mengoreksi & regenerasi rekap hari tsb.", "Employee self-service attendance corrections (missed clock / wrong time) — multi-tier approval; final approval auto-corrects & regenerates that day's recap.")}
      />

      <StatCards />

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {/* ===== filter bar ===== */}
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
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label={t("Tanggal kerja dari", "Work date from")} className="h-8 w-[9.5rem] text-xs" />
              <span className="text-[11px] text-slate-400">→</span>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label={t("Tanggal kerja sampai", "Work date to")} className="h-8 w-[9.5rem] text-xs" />
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan / no. dokumen…", "Search employee / document no.…")} className="h-8 w-52 pl-8 text-xs" />
              </div>
            </div>
          </div>

          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : api.error ? (
            <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />
          ) : rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={t("Tidak ada pengajuan regularisasi", "No regularization requests")}
                description={t("Karyawan mengajukan koreksi absensi (lupa absen / jam salah) dari portal ESS — persetujuan akhir otomatis mengoreksi rekap hari tsb.", "Employees submit attendance corrections (missed clock / wrong time) from the ESS portal — final approval auto-corrects that day's recap.")}
                icon={<ClipboardPen className="h-6 w-6" />}
              />
            </div>
          ) : (
            <>
              {/* ===== tabel desktop ===== */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableHead className="text-[11px] font-bold">{t("Dokumen", "Document")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Karyawan", "Employee")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Tanggal Kerja", "Work Date")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Jenis", "Kind")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Jam: Rekap Saat Ini → Diajukan", "Times: Current Recap → Proposed")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Alasan", "Reason")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                      <TableHead className="w-36" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60" onClick={() => openDetail(r)}>
                        <TableCell>
                          <p className="font-mono text-[11px] font-bold text-slate-500">{r.docNo}</p>
                          <p className="text-[10px] text-slate-400">{fmtDate(r.createdAt)}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{r.fullName}</p>
                          <p className="font-mono text-[10px] text-slate-400">{r.employeeNo} · {r.orgUnitName ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-slate-600 dark:text-slate-300">{fmtDate(r.workDate)}</TableCell>
                        <TableCell><KindBadge r={r} /></TableCell>
                        <TableCell><DiffTimes r={r} /></TableCell>
                        <TableCell className="max-w-56">
                          <p className="truncate text-[11px] italic text-slate-500 dark:text-slate-400" title={r.reason}>{r.reason}</p>
                        </TableCell>
                        <TableCell>
                          <StatusPill status={r.status} />
                          {r.approval && r.approval.status === "InProgress" && (
                            <p className="mt-0.5 max-w-32 truncate text-[10px] text-slate-400" title={r.approval.currentApprover ?? undefined}>
                              {t("menunggu", "awaiting")} {r.approval.currentApprover ?? t("jenjang {l}", "tier {l}", { l: r.approval.currentLevel })}
                            </p>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Actions r={r} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ===== kartu mobile (md:hidden — 375px ramah) ===== */}
              <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800/70">
                {rows.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <button onClick={() => openDetail(r)} className="w-full space-y-1.5 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-[11px] font-bold text-slate-500">{r.docNo}</p>
                        <StatusPill status={r.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{r.fullName}</p>
                        <p className="font-mono text-[10px] text-slate-400">{r.employeeNo}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <KindBadge r={r} />
                        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{fmtDate(r.workDate)}</span>
                      </div>
                      <DiffTimes r={r} />
                      {r.reason && <p className="line-clamp-2 text-[11px] italic text-slate-400">{r.reason}</p>}
                    </button>
                    <div className="mt-2">
                      <Actions r={r} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog detail: before → after + alasan + lampiran ===== */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <ClipboardPen className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
              {t("Regularisasi {d}", "Regularization {d}", { d: detail?.docNo ?? "—" })}
            </DialogTitle>
            <DialogDescription>
              {t("Persetujuan akhir mengoreksi rekap & memicu regenerasi hari tsb (baris ditandai Revised).", "Final approval corrects the recap & triggers regeneration for that day (row marked Revised).")}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              {/* identitas */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Karyawan", "Employee")}</p>
                  <p className="mt-0.5 text-[13px] font-extrabold text-slate-800 dark:text-slate-100">{detail.fullName}</p>
                  <p className="font-mono text-[10px] text-slate-400">{detail.employeeNo} · {detail.orgUnitName ?? "—"}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Tanggal Kerja", "Work Date")}</p>
                  <p className="mt-0.5 text-[13px] font-extrabold text-slate-800 dark:text-slate-100">{fmtDate(detail.workDate)}</p>
                  <p className="mt-0.5"><KindBadge r={detail} /></p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Diajukan", "Submitted")}</p>
                  <p className="mt-0.5 text-[13px] font-extrabold text-slate-800 dark:text-slate-100">{fmtDate(detail.createdAt)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Status")}</p>
                  <div className="mt-1"><StatusPill status={detail.status} /></div>
                  {detail.approval && detail.approval.status === "InProgress" && (
                    <p className="mt-1 text-[10px] text-slate-400">{t("menunggu {a}", "awaiting {a}", { a: detail.approval.currentApprover ?? detail.approval.currentLevel })}</p>
                  )}
                </div>
              </div>

              {/* perbandingan before → after */}
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden /> {t("Jam Absen — Rekap Saat Ini → Diajukan", "Clock Times — Current Recap → Proposed")}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Clock In", "Clock In")}</p>
                    <p className="mt-1 flex items-center gap-2 font-mono text-[15px] font-extrabold tabular-nums">
                      <span className="text-slate-500 dark:text-slate-400">{detail.current?.checkIn ?? "—"}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      <span className="text-brand-deep dark:text-brand/90">{detail.clockIn ?? "—"}</span>
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Clock Out", "Clock Out")}</p>
                    <p className="mt-1 flex items-center gap-2 font-mono text-[15px] font-extrabold tabular-nums">
                      <span className="text-slate-500 dark:text-slate-400">{detail.current?.checkOut ?? "—"}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      <span className="text-brand-deep dark:text-brand/90">{detail.clockOut ?? "—"}</span>
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  {t("Rekap saat ini: status {s} · state {st}{rev}", "Current recap: status {s} · state {st}{rev}", {
                    s: detail.current?.status ?? "—",
                    st: detail.current?.state ?? "—",
                    rev: detail.current?.revised ? ` · ${t("sudah pernah dikoreksi", "previously corrected")}` : "",
                  })}
                </p>
              </div>

              {/* alasan */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Alasan Pengajuan", "Reason")}</p>
                <p className="mt-1 whitespace-pre-wrap rounded-xl bg-amber-50/70 p-3 text-[13px] leading-relaxed text-slate-700 dark:bg-amber-500/5 dark:text-slate-200">{detail.reason}</p>
              </div>

              {/* lampiran */}
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden /> {t("Lampiran Bukti ({n})", "Attachments ({n})", { n: detail.attachments.length })}
                </p>
                {detail.attachments.length === 0 ? (
                  <p className="mt-1 text-[11px] italic text-slate-400">{t("Tidak ada lampiran (opsional).", "No attachments (optional).")}</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {detail.attachments.map((a) => (
                      <li key={a.id}>
                        <a
                          href={`/api/rekankerja/attachments/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 transition hover:border-brand/40 hover:text-brand-deep dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:text-brand/90"
                        >
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                          <span className="truncate">{a.fileName}</span>
                          <span className="shrink-0 font-mono text-[10px] text-slate-400">{fmtSize(a.sizeBytes)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* keputusan sebelumnya */}
              {detail.status !== "Submitted" && (detail.decisionNote || detail.decidedByName) && (
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Keputusan", "Decision")}</p>
                  <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-300">
                    {detail.decidedByName ? `${detail.decidedByName} · ` : ""}{detail.decidedAt ? fmtDate(detail.decidedAt) : ""}
                  </p>
                  {detail.decisionNote && <p className="mt-1 whitespace-pre-wrap text-[12px] italic text-slate-500 dark:text-slate-400">{detail.decisionNote}</p>}
                </div>
              )}

              {/* aksi */}
              {detail.status === "Submitted" && canDecide && (
                <DialogFooter className="gap-2">
                  <Button variant="outline" className="gap-1.5 font-bold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10" disabled={decideBusy} onClick={() => { setRejectTarget(detail); setRejectNote(""); }}>
                    <XCircle className="h-4 w-4" /> {t("Tolak…", "Reject…")}
                  </Button>
                  <Button className="gap-1.5 font-bold" disabled={decideBusy} onClick={() => decide(detail, "approve")}>
                    {decideBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {t("Setujui & Terapkan", "Approve & Apply")}
                  </Button>
                </DialogFooter>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== dialog tolak (catatan wajib ≥10 karakter) ===== */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Tolak Regularisasi {d}", "Reject Regularization {d}", { d: rejectTarget?.docNo ?? "—" })}</DialogTitle>
            <DialogDescription>
              {t("Catatan wajib minimal 10 karakter — ditampilkan ke karyawan.", "Note of at least 10 characters required — shown to the employee.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reg-reject-note" className="text-xs font-bold">{t("Catatan Penolakan *", "Rejection Note *")}</Label>
            <Textarea
              id="reg-reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder={t("Contoh: Bukti clock tidak mendukung jam yang diajukan…", "E.g. clock evidence does not support the proposed time…")}
              className="text-[13px]"
            />
            <p className={cn("text-right text-[10px] font-bold", rejectNote.trim().length >= 10 ? "text-slate-400" : "text-amber-600 dark:text-amber-400")}>
              {rejectNote.trim().length}/300 · {t("min 10 karakter", "min 10 characters")}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="font-bold" disabled={rejectBusy} onClick={() => setRejectTarget(null)}>
              <Ban className="h-4 w-4" /> {t("Batal", "Cancel")}
            </Button>
            <Button variant="destructive" className="gap-1.5 font-bold" disabled={rejectBusy || rejectNote.trim().length < 10} onClick={runReject}>
              {rejectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              {t("Tolak Pengajuan", "Reject Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
