"use client";
// P3.3-BM (D-BM25) — Tim Saya: workspace atasan ESS.
// Satu GET /ess/my-team untuk seluruh halaman (agregasi server-side):
// KPI (headcount · hadir hari ini · cuti hari ini · menunggu approval) →
// kartu "Menunggu Persetujuan" (tombol approve/reject ME-REUSE service
// modul via POST my-team) → tabel anggota (desktop) / kartu (mobile) dengan
// strip kehadiran 7 hari + baris detail expandable → "Tanggal Penting
// Mendatang" (anniversary & akhir kontrak ≤60 hari). Mobile 375 tanpa
// h-scroll: semua kolom flex-wrap + min-w-0 + truncate.
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Users, ClipboardCheck, UserCheck, Palmtree, Inbox, CheckCircle2, XCircle,
  ChevronDown, Loader2, Cake, CalendarClock, AlertTriangle, Clock3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, apiSend, fmtDate, fmtIDR, initials } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingCards } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ESS_BASE } from "./ess-api";

// ============ kontrak GET /ess/my-team ============

interface TeamMember {
  employeeId: string;
  fullName: string;
  employeeNo: string;
  positionTitle: string | null;
  orgUnitName: string | null;
  photoUrl: string | null;
  joinDate: string | null;
  tenureYears: number;
  contractEndDate: string | null;
  employmentStatus: string;
  present7d: { date: string; status: string | null }[];
  onLeaveToday: boolean;
  onLeaveTodayType: string | null;
  onLeaveUpcoming: boolean;
  onLeaveUpcomingType: string | null;
  onLeaveUpcomingFrom: string | null;
  pendingMyApprovalCount: number;
}

interface PendingApproval {
  kind: "leave" | "workoff" | "overtime" | "travel";
  id: string;
  refNo: string;
  dateFrom: string;
  dateTo: string | null;
  requesterName: string;
  requesterNo: string;
  summary: string;
  amount: number | null;
  approval: { level: number; total: number } | null;
  detail: Record<string, unknown>;
}

interface UpcomingDate {
  employeeId: string;
  type: "anniversary" | "end";
  date: string;
  years: number | null;
}

interface TeamData {
  headcount: number;
  members: TeamMember[];
  pendingApprovals: PendingApproval[];
  upcoming: UpcomingDate[];
  todayStats: { present: number; late: number; absent: number; onLeave: number };
}

// ============ label & peta warna (konsisten dgn ess-attendance) ============

const KIND_LABEL: Record<string, { id: string; en: string }> = {
  leave: { id: "Cuti", en: "Leave" },
  workoff: { id: "Izin Tidak Masuk", en: "Work Off" },
  overtime: { id: "Lembur", en: "Overtime" },
  travel: { id: "Dinas", en: "Travel" },
};

const STATUS_DOT: Record<string, { id: string; en: string; dot: string }> = {
  Present: { id: "Hadir", en: "Present", dot: "bg-brand" },
  Late: { id: "Telat", en: "Late", dot: "bg-amber-500" },
  Absent: { id: "Absen", en: "Absent", dot: "bg-rose-500" },
  OnLeave: { id: "Cuti", en: "Leave", dot: "bg-violet-500" },
  WorkOff: { id: "Izin", en: "Permit", dot: "bg-sky-500" },
  Off: { id: "Libur", en: "Off", dot: "bg-slate-300" },
  Holiday: { id: "Hari Libur", en: "Holiday", dot: "bg-slate-300" },
};

function statusMeta(status: string | null) {
  return STATUS_DOT[status ?? ""] ?? { id: status ?? "—", en: status ?? "—", dot: "bg-slate-300" };
}

const EMPLOYMENT_STATUS_ID: Record<string, string> = {
  Permanent: "Tetap",
  Contract: "Kontrak",
  Probation: "Percobaan",
  Outsourcing: "Outsourcing",
};

/** akhir kontrak ≤60 hari? (peringatan di detail anggota) */
function within60d(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return false;
  const diff = d.getTime() - Date.now();
  return diff >= 0 && diff <= 60 * 86_400_000;
}

/** Baris ringkasan bilingual per jenis pengajuan (dari field detail API). */
function approvalDetailLine(row: PendingApproval, t: (id: string, en?: string, vars?: Record<string, string | number>) => string): string {
  const d = row.detail ?? {};
  if (row.kind === "leave") {
    const type = typeof d.typeName === "string" ? d.typeName : null;
    const days = typeof d.days === "number" ? d.days : null;
    if (type != null && days != null) {
      return t("{type} — {n} hari kerja", "{type} — {n} working days", { type, n: days });
    }
    return type ?? row.summary;
  }
  if (row.kind === "workoff") {
    const reason = typeof d.reason === "string" && d.reason.trim() ? d.reason : null;
    const paid = d.paid === true;
    return [
      reason,
      paid ? t("dibayar", "paid") : t("tidak dibayar", "unpaid"),
    ].filter(Boolean).join(" · ");
  }
  if (row.kind === "overtime") {
    const pm = typeof d.planMinutes === "number" ? d.planMinutes : 0;
    return t("rencana {n} menit", "planned {n} minutes", { n: pm });
  }
  const purpose = typeof d.purpose === "string" && d.purpose.trim() ? d.purpose : null;
  return purpose ?? t("Perjalanan dinas", "Business travel");
}

// ============ komponen kecil ============

function KpiCard({ icon: Icon, value, label, sub, tone }: {
  icon: React.ElementType; value: string; label: string; sub?: string | null; tone: "brand" | "amber" | "violet" | "rose";
}) {
  const tones: Record<string, string> = {
    brand: "bg-brand/10 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  };
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="flex items-center gap-3.5 p-4">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-extrabold leading-none tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
          <p className="mt-1 truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
          {sub ? <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">{sub}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Strip 7 titik kehadiran (title tooltip per tanggal + legenda dipakai di container). */
function WeekStrip({ member }: { member: TeamMember }) {
  return (
    <div className="flex items-center gap-1.5">
      {member.present7d.map((d) => {
        const meta = statusMeta(d.status);
        return (
          <span
            key={d.date}
            title={`${fmtDate(d.date)} — ${meta.id}`}
            className={cn("h-2.5 w-2.5 rounded-full", meta.dot, !d.status && "border border-dashed border-slate-300 bg-transparent dark:border-slate-600")}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

function WeekLegend({ t }: { t: (id: string, en?: string) => string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800/70">
      {["Present", "Late", "Absent", "OnLeave", "WorkOff", "Off"].map((s) => {
        const m = statusMeta(s);
        return (
          <span key={s} className="flex items-center gap-1.5 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
            <span className={cn("h-2 w-2 rounded-full", m.dot)} aria-hidden /> {t(m.id, m.en)}
          </span>
        );
      })}
    </div>
  );
}

function AvatarName({ member, size = "md" }: { member: TeamMember; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12 rounded-xl" : "h-9 w-9 rounded-lg";
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className={cn(dim, "border border-slate-200 dark:border-slate-700")}>
        {member.photoUrl && <AvatarImage src={member.photoUrl} alt={member.fullName} />}
        <AvatarFallback className={cn(dim, "bg-brand/10 text-[11px] font-extrabold text-brand-deep dark:bg-brand/15 dark:text-brand/85")}>
          {initials(member.fullName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold leading-tight text-slate-900 dark:text-slate-50">{member.fullName}</p>
        <p className="truncate font-mono text-[10.5px] text-slate-400">{member.employeeNo}</p>
      </div>
    </div>
  );
}

function LeaveChip({ member, t }: { member: TeamMember; t: (id: string, en?: string, vars?: Record<string, string | number>) => string }) {
  if (member.onLeaveToday) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-400">
        <Palmtree className="h-3 w-3" aria-hidden /> {t("Cuti hari ini", "On leave today")}{member.onLeaveTodayType ? ` · ${member.onLeaveTodayType}` : ""}
      </span>
    );
  }
  if (member.onLeaveUpcoming) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
        <Palmtree className="h-3 w-3" aria-hidden /> {t("Cuti mendatang", "Upcoming leave")} · {member.onLeaveUpcomingFrom}
      </span>
    );
  }
  return null;
}

// ============ halaman ============

export function EssMyTeamPage() {
  const { t } = useI18n();
  const api = useApi<TeamData>(`${ESS_BASE}/my-team`, [ESS_BASE]);
  const data = api.data;

  const [expanded, setExpanded] = useState<string | null>(null);
  const [decide, setDecide] = useState<{ row: PendingApproval; action: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const todayPresent = (data?.todayStats.present ?? 0) + (data?.todayStats.late ?? 0);
  const pending = data?.pendingApprovals ?? [];

  /** reject utk workoff/overtime: service menuntut alasan (≥ service guard). */
  const noteRequired = decide != null && decide.action === "reject" && (decide.row.kind === "workoff" || decide.row.kind === "overtime");

  const memberName = useMemo(() => new Map((data?.members ?? []).map((m) => [m.employeeId, m])), [data]);

  const submitDecide = async () => {
    if (!decide) return;
    if (noteRequired && !note.trim()) {
      toast.error(t("Alasan penolakan wajib diisi untuk jenis ini", "A rejection note is required for this kind"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ status: string | null; approval: { currentLevel: number; totalLevels: number } | null }>(
        `${ESS_BASE}/my-team`, "POST",
        { kind: decide.row.kind, id: decide.row.id, action: decide.action, note: note.trim() || undefined },
      );
      if (res.approval) {
        toast.success(t(
          `Jenjang ${res.approval.currentLevel}/${res.approval.totalLevels} disetujui — menunggu jenjang berikutnya`,
          `Tier ${res.approval.currentLevel}/${res.approval.totalLevels} approved — awaiting the next tier`,
        ));
      } else {
        toast.success(decide.action === "approve"
          ? t(`${decide.row.refNo} disetujui`, `${decide.row.refNo} approved`)
          : t(`${decide.row.refNo} ditolak`, `${decide.row.refNo} rejected`));
      }
      setDecide(null);
      setNote("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Keputusan gagal diproses", "Failed to process the decision"));
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow={t("Employee Self Service")}
        title={t("Tim Saya", "My Team")}
        description={t(
          "Ringkasan tim langsung Anda: kehadiran, cuti, dan persetujuan menunggu.",
          "Your direct team at a glance: attendance, leave, and pending approvals.",
        )}
      />

      {api.loading && !data ? (
        <LoadingCards cards={4} />
      ) : api.error ? (
        <EmptyState
          icon={AlertTriangle}
          title={t("Gagal memuat tim", "Failed to load the team")}
          description={api.error}
        />
      ) : !data ? null : (
        <>
          {/* ===== KPI row ===== */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard icon={Users} value={String(data.headcount)} label={t("Headcount", "Headcount")} sub={t("anggota tim langsung (aktif)", "direct team members (active)")} tone="brand" />
            <KpiCard icon={UserCheck} value={String(todayPresent)} label={t("Hadir hari ini", "Present today")} sub={t("termasuk {n} telat", "incl. {n} late", { n: data.todayStats.late })} tone="amber" />
            <KpiCard icon={Palmtree} value={String(data.todayStats.onLeave)} label={t("Cuti hari ini", "On leave today")} sub={t("cuti disetujui", "approved leave")} tone="violet" />
            <KpiCard icon={ClipboardCheck} value={String(pending.length)} label={t("Menunggu approval", "Awaiting approval")} sub={t("pengajuan anggota tim", "team requests")} tone="rose" />
          </div>

          {/* ===== Menunggu Persetujuan ===== */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
                  {t("Menunggu Persetujuan", "Awaiting Approval")}
                </span>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                  {t("{n} pengajuan", "{n} requests", { n: String(pending.length) })}
                </span>
              </CardTitle>
              <p className="text-[12px] text-slate-500 dark:text-slate-400">
                {t("Pengajuan anggota tim yang menunggu keputusan Anda", "Team requests awaiting your decision")}
              </p>
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title={t("Tidak ada pengajuan yang menunggu Anda", "No requests awaiting you")}
                  description={t("Semua pengajuan anggota tim sudah diputuskan.", "All team requests have been decided.")}
                />
              ) : (
                <ul className="space-y-2.5">
                  {pending.map((r) => {
                    const kl = KIND_LABEL[r.kind] ?? { id: r.kind, en: r.kind };
                    return (
                      <li key={`${r.kind}-${r.id}`} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-700 dark:bg-slate-800/40">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand-deep dark:bg-brand/15 dark:text-brand/85">
                              {t(kl.id, kl.en)}
                            </span>
                            <span className="font-mono text-xs font-semibold">{r.refNo}</span>
                            {r.approval && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                                {t("jenjang", "tier")} {r.approval.level}/{r.approval.total}
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <Button size="sm" variant="outline" className="h-7 gap-1 border-emerald-300 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400"
                              onClick={() => { setDecide({ row: r, action: "approve" }); setNote(""); }}>
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t("Setujui", "Approve")}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 gap-1 border-rose-300 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-400"
                              onClick={() => { setDecide({ row: r, action: "reject" }); setNote(""); }}>
                              <XCircle className="h-3.5 w-3.5" aria-hidden /> {t("Tolak", "Reject")}
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 text-sm">
                          <span className="font-semibold">{r.requesterName}</span>
                          <span className="text-slate-400"> ({r.requesterNo})</span>
                        </div>
                        <div className="text-[12px] text-slate-600 dark:text-slate-300">{approvalDetailLine(r, t)}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                          <CalendarClock className="h-3 w-3" aria-hidden />
                          {r.dateTo && r.dateTo !== r.dateFrom
                            ? `${fmtDate(r.dateFrom)} → ${fmtDate(r.dateTo)}`
                            : fmtDate(r.dateFrom)}
                          {r.amount != null && (
                            <span className="font-semibold text-slate-500 dark:text-slate-400">· {fmtIDR(r.amount)}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ===== Anggota Tim ===== */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-brand-deep dark:text-brand/85" aria-hidden />
                {t("Anggota Tim", "Team Members")}
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {data.headcount}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.members.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={t("Tim kosong", "Empty team")}
                  description={t("Belum ada anggota tim aktif yang melapor ke Anda.", "No active team members report to you yet.")}
                />
              ) : (
                <>
                  {/* — tabel (desktop) — */}
                  <div className="hidden md:block">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-slate-200 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-700">
                          <th className="px-2 py-2">{t("Anggota", "Member")}</th>
                          <th className="px-2 py-2">{t("Posisi · Unit", "Position · Unit")}</th>
                          <th className="px-2 py-2">{t("Tenure", "Tenure")}</th>
                          <th className="px-2 py-2">{t("Kehadiran 7 Hari", "7-Day Attendance")}</th>
                          <th className="px-2 py-2">{t("Hari Ini", "Today")}</th>
                          <th className="w-10 px-2 py-2" aria-hidden />
                        </tr>
                      </thead>
                      <tbody>
                        {data.members.map((mem) => {
                          const open = expanded === mem.employeeId;
                          return (
                            <Fragment key={mem.employeeId}>
                              <tr className="border-b border-slate-100 align-middle last:border-b-0 hover:bg-slate-50/60 dark:border-slate-800/70 dark:hover:bg-slate-800/30">
                                <td className="px-2 py-2.5">
                                  <AvatarName member={mem} />
                                </td>
                                <td className="max-w-[220px] px-2 py-2.5">
                                  <p className="truncate text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">{mem.positionTitle ?? "—"}</p>
                                  <p className="truncate text-[11px] text-slate-400">{mem.orgUnitName ?? "—"}</p>
                                </td>
                                <td className="whitespace-nowrap px-2 py-2.5 text-[12px] tabular-nums text-slate-600 dark:text-slate-300">
                                  {t("{n} thn", "{n} yr", { n: mem.tenureYears.toFixed(1) })}
                                </td>
                                <td className="px-2 py-2.5"><WeekStrip member={mem} /></td>
                                <td className="px-2 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    <LeaveChip member={mem} t={t} />
                                    {mem.pendingMyApprovalCount > 0 && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                                        <ClipboardCheck className="h-3 w-3" aria-hidden /> {mem.pendingMyApprovalCount}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2 py-2.5 text-right">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setExpanded(open ? null : mem.employeeId)} aria-label={t("Detail", "Details")}>
                                    <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
                                  </Button>
                                </td>
                              </tr>
                              {open && (
                                <tr className="bg-slate-50/70 dark:bg-slate-800/30">
                                  <td colSpan={6} className="px-3 py-3">
                                    <MemberDetail member={mem} t={t} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    <WeekLegend t={t} />
                  </div>

                  {/* — kartu (mobile) — */}
                  <div className="space-y-2.5 md:hidden">
                    {data.members.map((mem) => {
                      const open = expanded === mem.employeeId;
                      return (
                        <div key={mem.employeeId} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                          <div className="flex items-start justify-between gap-2">
                            <AvatarName member={mem} size="lg" />
                            <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" onClick={() => setExpanded(open ? null : mem.employeeId)} aria-label={t("Detail", "Details")}>
                              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
                            </Button>
                          </div>
                          <p className="mt-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200">{mem.positionTitle ?? "—"}</p>
                          <p className="text-[11px] text-slate-400">{mem.orgUnitName ?? "—"}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <span className="text-[11px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                              {t("{n} thn", "{n} yr", { n: mem.tenureYears.toFixed(1) })}
                            </span>
                            <WeekStrip member={mem} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <LeaveChip member={mem} t={t} />
                            {mem.pendingMyApprovalCount > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                                <ClipboardCheck className="h-3 w-3" aria-hidden /> {t("{n} menunggu", "{n} pending", { n: mem.pendingMyApprovalCount })}
                              </span>
                            )}
                          </div>
                          {open && <div className="mt-3"><MemberDetail member={mem} t={t} /></div>}
                        </div>
                      );
                    })}
                    <WeekLegend t={t} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ===== Tanggal Penting Mendatang ===== */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cake className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
                {t("Tanggal Penting Mendatang", "Upcoming Key Dates")}
              </CardTitle>
              <p className="text-[12px] text-slate-500 dark:text-slate-400">
                {t("Anniversary & akhir kontrak ≤ 60 hari", "Anniversaries & contract ends within 60 days")}
              </p>
            </CardHeader>
            <CardContent>
              {data.upcoming.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title={t("Belum ada tanggal penting mendatang", "No upcoming key dates")}
                  description={t("Anniversary & akhir kontrak 60 hari ke depan akan tampil di sini.", "Anniversaries & contract ends in the next 60 days will appear here.")}
                />
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {data.upcoming.map((u, i) => {
                    const name = memberName.get(u.employeeId)?.fullName ?? "—";
                    const isEnd = u.type === "end";
                    return (
                      <li key={`${u.employeeId}-${u.type}-${i}`} className={cn(
                        "flex items-center gap-3 rounded-xl border p-3",
                        isEnd
                          ? "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10"
                          : "border-violet-200 bg-violet-50/70 dark:border-violet-500/30 dark:bg-violet-500/10",
                      )}>
                        <span className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base",
                          isEnd
                            ? "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400"
                            : "bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400",
                        )} aria-hidden>
                          {isEnd ? <AlertTriangle className="h-4 w-4" /> : "🎉"}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-bold text-slate-900 dark:text-slate-50">{name}</p>
                          <p className="text-[11.5px] text-slate-600 dark:text-slate-300">
                            {isEnd
                              ? t("Akhir kontrak — {d}", "Contract end — {d}", { d: fmtDate(u.date) })
                              : t("{n} tahun — {d}", "{n} years — {d}", { n: String(u.years ?? 0), d: fmtDate(u.date) })}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ===== dialog keputusan (approve / reject) ===== */}
      <Dialog open={decide != null} onOpenChange={(o) => { if (!o) setDecide(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={cn("flex items-center gap-2", decide?.action === "reject" && "text-rose-600 dark:text-rose-400")}>
              {decide?.action === "approve"
                ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
                : <XCircle className="h-5 w-5 text-rose-500" aria-hidden />}
              {decide?.action === "approve"
                ? t("Setujui pengajuan ini?", "Approve this request?")
                : t("Tolak pengajuan ini?", "Reject this request?")}
            </DialogTitle>
          </DialogHeader>
          {decide && (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <div className="text-sm font-semibold">{decide.row.requesterName}</div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400">{approvalDetailLine(decide.row, t)}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span className="font-mono">{decide.row.refNo}</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3 w-3" aria-hidden />
                    {decide.row.dateTo && decide.row.dateTo !== decide.row.dateFrom
                      ? `${fmtDate(decide.row.dateFrom)} → ${fmtDate(decide.row.dateTo)}`
                      : fmtDate(decide.row.dateFrom)}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>
                  {noteRequired
                    ? t("Alasan penolakan *", "Rejection reason *")
                    : t("Catatan (opsional)", "Note (optional)")}
                </Label>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecide(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitDecide} disabled={busy}
              className={decide?.action === "reject" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy
                ? t("Memproses…", "Processing…")
                : decide?.action === "approve" ? t("Setujui", "Approve") : t("Tolak", "Reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Panel detail expandable per anggota: daftar status 7 hari + peringatan kontrak. */
function MemberDetail({ member, t }: {
  member: TeamMember;
  t: (id: string, en?: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
        {t("Detail kehadiran 7 hari terakhir", "7-day attendance detail")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {member.present7d.map((d) => {
          const meta = statusMeta(d.status);
          return (
            <span key={d.date} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10.5px] dark:border-slate-700 dark:bg-slate-900">
              <span className={cn("h-2 w-2 rounded-full", meta.dot, !d.status && "border border-dashed border-slate-300 bg-transparent dark:border-slate-600")} aria-hidden />
              <span className="text-slate-500 dark:text-slate-400">{fmtDate(d.date)}</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">{t(meta.id, meta.en)}</span>
            </span>
          );
        })}
        {member.present7d.every((d) => !d.status) && (
          <p className="text-[11px] italic text-slate-400">
            {t("Belum ada baris kehadiran 7 hari terakhir", "No attendance rows in the last 7 days")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10.5px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {t(EMPLOYMENT_STATUS_ID[member.employmentStatus] ?? member.employmentStatus, member.employmentStatus)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10.5px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {t("bergabung {d}", "joined {d}", { d: member.joinDate ? fmtDate(member.joinDate) : "—" })}
        </span>
        {member.onLeaveUpcoming && member.onLeaveUpcomingFrom && (
          <span className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10.5px] font-bold text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400">
            {t("Cuti mendatang", "Upcoming leave")} · {member.onLeaveUpcomingFrom}
            {member.onLeaveUpcomingType ? ` (${member.onLeaveUpcomingType})` : ""}
          </span>
        )}
        {within60d(member.contractEndDate) && (
          <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10.5px] font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {t("Kontrak berakhir {d}", "Contract ends {d}", { d: fmtDate(member.contractEndDate) })}
          </span>
        )}
      </div>
    </div>
  );
}
