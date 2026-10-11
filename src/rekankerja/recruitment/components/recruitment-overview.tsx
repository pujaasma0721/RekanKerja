"use client";
// RekanKerja Recruitment — Ringkasan modul (F0): status fondasi + jumlah
// master + rantai tahap seleksi default + peta fase pengembangan.
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { MASTER_DEFS } from "./recruitment-types";
import type { MasterType } from "@/rekankerja/recruitment/services/recruitment-master-service";
import {
  UserRoundSearch, Boxes, ListChecks, CheckCircle2, Circle, ArrowRight, Megaphone, BadgeCheck,
  Wallet, Sparkles, FileCheck2, Layers, CalendarClock, ClipboardList, UsersRound, Inbox, Layers3,
  UserRoundCheck, FileText, Handshake, UserRoundPlus, Clock,
} from "lucide-react";

const TYPE_ICON: Record<string, React.ElementType> = {
  method: Megaphone,
  "ad-media": BadgeCheck,
  agency: Handshake,
  "cost-item": Wallet,
  skill: Sparkles,
  "required-document": FileCheck2,
  "eval-category": Layers,
  "eval-scale": Layers,
  "sla-group": CalendarClock,
  "selection-process": ListChecks,
};

interface SelectionRow {
  id: string; code: string; name: string; description?: string | null;
  resultType?: string | null; processOrder?: number | null; slaDays?: number | null;
  needAcknowledgement?: boolean | null; mandatory?: boolean | null; active: boolean;
}

export function RecruitmentOverview() {
  const { t } = useI18n();
  const counts = useApi<{ counts: Record<string, number> }>("/api/rekankerja/recruitment/masters");
  const chain = useApi<{ rows: SelectionRow[] }>("/api/rekankerja/recruitment/masters?type=selection-process");

  const c = counts.data?.counts;
  const steps = (chain.data?.rows ?? []).slice().sort((a, b) => (a.processOrder ?? 99) - (b.processOrder ?? 99));

  const phases: { key: string; label: string; labelEn: string; done: boolean }[] = [
    { key: "F0", label: "Fondasi Modul & Master", labelEn: "Module & Master Foundation", done: true },
    { key: "F1", label: "Permintaan Karyawan (PR) + Approval", labelEn: "Personnel Requisition + Approval", done: true },
    { key: "F2", label: "Lowongan & Pelamar (talent pool)", labelEn: "Openings & Applicants (talent pool)", done: true },
    { key: "F3", label: "Kandidat & Proses Seleksi", labelEn: "Candidates & Selection Process", done: true },
    { key: "F4", label: "Offer & Appointment + Onboarding", labelEn: "Offer & Appointment + Onboarding", done: true },
    { key: "F5", label: "ESS, Rencana & Anggaran", labelEn: "ESS, Plan & Budget", done: false },
  ];
  const prApi = useApi<{ stats: Record<string, number> }>("/api/rekankerja/recruitment/pr?limit=1");
  const ps = prApi.data?.stats;

  // F3: ringkasan kandidat & seleksi per PR (summaries — 403 → null "—")
  const selApi = useApi<{ summaries: { prId: string; prNo: string; candidates: number; active: number; overdue: number; invitations: number }[] }>(
    "/api/rekankerja/recruitment/selection?summaries=1",
  );
  const selSum = selApi.data?.summaries ?? [];
  const selTotals = {
    prs: selApi.data ? selSum.length : null,
    candidates: selApi.data ? selSum.reduce((a, s) => a + s.candidates, 0) : null,
    active: selApi.data ? selSum.reduce((a, s) => a + s.active, 0) : null,
    overdue: selApi.data ? selSum.reduce((a, s) => a + s.overdue, 0) : null,
    invitations: selApi.data ? selSum.reduce((a, s) => a + s.invitations, 0) : null,
  };

  // F2: statistik lowongan / talent pool / staging — 403 (tanpa menu terkait)
  // dirender "—" tanpa error console (useApi menangkap error sebagai string).
  const joApi = useApi<{ stats: Record<string, number> }>("/api/rekankerja/recruitment/openings?limit=1");
  const joSt = joApi.data?.stats;
  const apApi = useApi<{ stats: Record<string, number> }>("/api/rekankerja/recruitment/applicants?limit=1");
  const apSt = apApi.data?.stats;
  const paApi = useApi<{ stats: Record<string, number> }>("/api/rekankerja/recruitment/public-applications?limit=1");
  const paSt = paApi.data?.stats;

  // F4: statistik offer & pengangkatan
  const offApi = useApi<{ stats: Record<string, number> }>("/api/rekankerja/recruitment/offers?list=1");
  const offSt = offApi.data?.stats;
  const funnelApi = useApi<{ funnel: { stages: { key: string; label: string; labelEn: string; count: number }[]; offerAcceptanceRate: number | null } }>(
    "/api/rekankerja/recruitment/offers?funnel=1",
  );
  const funnelStages = funnelApi.data?.funnel.stages ?? [];
  const hiredCount = funnelStages.find((s) => s.key === "hired")?.count ?? null;

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · Ringkasan")}
        title={t("Rekrutmen", "Recruitment")}
        description={t(
          "Modul rekrutmen end-to-end RekanKerja — dari permintaan karyawan, lowongan, talent pool, seleksi terstruktur, sampai pengangkatan yang tersambung ke onboarding karyawan. Fase aktif: F4 (offer & pengangkatan — surat penawaran, expiry timer, penolakan batch, onboarding).",
          "RekanKerja end-to-end recruitment module — from personnel requisition, job openings, talent pool, structured selection, to appointment connected to employee onboarding. Active phase: F4 (offers & appointment — offer letters, expiry timer, batch rejection, onboarding).",
        )}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* rantai tahap seleksi default */}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Rantai Tahap Seleksi Standar", "Standard Selection Chain")}
              <Badge variant="secondary" className="font-normal">{t("dapat diedit di Master", "editable in Masters")}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                "Padanan Standard Selection Process oranHR — katalog per-tenant, berurutan, dengan SLA per tahap. Dipakai proses seleksi kandidat (F3).",
                "oranHR Standard Selection Process equivalent — per-tenant catalog, ordered, with per-stage SLA. Used by candidate selection (F3).",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chain.loading && !chain.data ? (
              <LoadingRows rows={3} />
            ) : steps.length === 0 ? (
              <EmptyState title={t("Belum ada tahap seleksi", "No selection stages yet")} icon={ListChecks} />
            ) : (
              <ol className="flex flex-wrap items-stretch gap-2">
                {steps.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <div className={cn(
                      "flex min-w-[9rem] flex-col gap-1 rounded-xl border px-3 py-2.5",
                      s.active
                        ? "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60"
                        : "border-dashed border-slate-300 opacity-60 dark:border-slate-700",
                    )}>
                      <div className="flex items-center gap-1.5">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-900 text-[10px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">
                          {s.processOrder ?? i + 1}
                        </span>
                        <span className="text-sm font-semibold leading-tight">{s.name}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                        <span>{s.resultType === "Quantitative" ? t("Kuantitatif", "Quantitative") : t("Kualitatif", "Qualitative")}</span>
                        {s.slaDays != null && <span>· SLA {s.slaDays} {t("hr", "d")}</span>}
                        {s.needAcknowledgement && <span>· {t("konfirmasi", "ack")}</span>}
                      </div>
                    </div>
                    {i < steps.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* peta fase */}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRoundSearch className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Peta Fase (Gelombang 1)", "Phase Map (Wave 1)")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t("DEVELOPMENT-PLAN-RECRUITMENT.md — Gelombang Core", "DEVELOPMENT-PLAN-RECRUITMENT.md — Core wave")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {phases.map((p) => (
                <li key={p.key} className="flex items-start gap-2 text-sm">
                  {p.done
                    ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />}
                  <span className={cn("leading-tight", p.done && "font-semibold")}>
                    <span className="mr-1.5 font-mono text-[11px] text-slate-400">{p.key}</span>
                    {t(p.label, p.labelEn)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* ringkasan PR (F1) */}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Permintaan Karyawan (PR)", "Personnel Requisitions (PR)")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                "F1 — pengajuan kebutuhan karyawan dengan state machine & approval berjenjang. Kelola di menu Permintaan Karyawan.",
                "F1 — headcount requests with an explicit state machine & tiered approval. Manage in the Personnel Requisition menu.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {prApi.loading && !prApi.data ? (
              <LoadingRows rows={2} />
            ) : !ps ? (
              <EmptyState title={t("Anda belum memiliki akses lihat PR", "You do not have PR view access")} icon={ClipboardList} />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {([
                  ["total", t("Total", "Total")],
                  ["draft", t("Draft", "Draft")],
                  ["submitted", t("Menunggu", "Pending")],
                  ["approved", t("Disetujui", "Approved")],
                  ["rejected", t("Ditolak", "Rejected")],
                  ["onHold", t("Ditahan", "On Hold")],
                  ["closed", t("Ditutup", "Closed")],
                  ["cancelled", t("Dibatalkan", "Cancelled")],
                ] as [string, string][]).map(([k, label]) => (
                  <div key={k} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="text-[11px] font-medium text-slate-500">{label}</p>
                    <p className="text-lg font-semibold tabular-nums">{ps[k] ?? 0}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ringkasan F3 — kandidat & seleksi */}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRoundCheck className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Kandidat & Seleksi (F3)", "Candidates & Selection (F3)")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                "Kandidat aktif per PR beserta tahap seleksi berjalan (board kanban, scorecard, surat undangan, SLA). Kelola di menu Kandidat & Seleksi.",
                "Active candidates per PR with running selection stages (kanban board, scorecards, invitation letters, SLA). Manage in the Candidates & Selection menu.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                { icon: Layers3, label: t("PR dengan Kandidat", "PRs w/ Candidates"), value: selTotals.prs },
                { icon: UsersRound, label: t("Kandidat Aktif", "Active Candidates"), value: selTotals.active },
                { icon: UserRoundCheck, label: t("Tahap SLA Terlambat", "Overdue Stages"), value: selTotals.overdue },
                { icon: FileText, label: t("Undangan Terbit", "Invitations Issued"), value: selTotals.invitations },
              ] as { icon: React.ElementType; label: string; value: number | null }[]).map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={i} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40"
                    title={s.value == null ? t("Anda tidak memiliki akses lihat data ini", "You do not have access to view this data") : s.label}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm dark:bg-slate-900">
                      <Icon className="h-4 w-4 text-slate-600 dark:text-slate-300" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold leading-tight">{s.label}</p>
                      <p className="text-lg font-semibold tabular-nums">{s.value ?? "—"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {selApi.data && selSum.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selSum.map((s) => (
                  <span key={s.prId} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    {s.prNo}: {s.candidates} {t("kandidat", "candidates")}
                    {s.overdue > 0 && <span className="ml-1 font-bold text-amber-600 dark:text-amber-400">· {s.overdue} {t("terlambat", "overdue")}</span>}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ringkasan F4 — offer & pengangkatan */}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Handshake className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Offer & Pengangkatan (F4)", "Offers & Appointment (F4)")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                "Penawaran terkirim/menunggu respons, offer diterima, dan kandidat yang resmi menjadi karyawan via onboarding. Kelola di menu Offer & Pengangkatan.",
                "Offers sent / awaiting response, accepted offers, and candidates who officially became employees via onboarding. Manage in the Offers & Appointment menu.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                { icon: Handshake, label: t("Offer Terkirim", "Offers Sent"), value: offApi.data ? (offSt?.Sent ?? 0) + (offSt?.Viewed ?? 0) + (offSt?.Accepted ?? 0) + (offSt?.Declined ?? 0) + (offSt?.Expired ?? 0) : null },
                { icon: Clock, label: t("Menunggu Respons", "Awaiting Response"), value: offApi.data ? (offSt?.Sent ?? 0) + (offSt?.Viewed ?? 0) + (offSt?.PendingApproval ?? 0) : null },
                { icon: BadgeCheck, label: t("Diterima", "Accepted"), value: offApi.data ? (offSt?.Accepted ?? 0) : null },
                { icon: UserRoundPlus, label: t("Jadi Karyawan", "Hired"), value: offApi.data ? hiredCount : null },
              ] as { icon: React.ElementType; label: string; value: number | null }[]).map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={i} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40"
                    title={s.value == null ? t("Anda tidak memiliki akses lihat data ini", "You do not have access to view this data") : s.label}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm dark:bg-slate-900">
                      <Icon className="h-4 w-4 text-slate-600 dark:text-slate-300" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold leading-tight">{s.label}</p>
                      <p className="text-lg font-semibold tabular-nums">{s.value ?? "—"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {funnelStages.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500">{t("Funnel:", "Funnel:")}</span>
                {funnelStages.map((s, i) => (
                  <span key={s.key} className="flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden />}
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {t(s.label, s.labelEn)}: <span className="font-bold tabular-nums">{s.count}</span>
                    </span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ringkasan F2 — lowongan, talent pool & staging */}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Lowongan & Talent Pool (F2)", "Openings & Talent Pool (F2)")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                "Iklan lowongan per PR disetujui, talent pool pelamar, dan lamaran publik yang menunggu verifikasi. Kelola di menu Lowongan, Talent Pool, dan Lamaran Publik.",
                "Job ads per approved PR, the applicant talent pool, and public applications awaiting verification. Manage in the Openings, Talent Pool, and Public Applications menus.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                { icon: Megaphone, label: t("JO Terposting", "Posted JOs"), value: joApi.data ? (joSt?.posted ?? 0) : null },
                { icon: Layers3, label: t("Slot Terbuka", "Open Slots"), value: joApi.data ? (joSt?.openSlots ?? 0) : null },
                { icon: UsersRound, label: t("Pelamar Aktif", "Active Applicants"), value: apApi.data ? (apSt?.active ?? 0) : null },
                { icon: Inbox, label: t("Staging Menunggu", "Pending Staging"), value: paApi.data ? (paSt?.pending ?? 0) : null },
              ] as { icon: React.ElementType; label: string; value: number | null }[]).map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={i} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40"
                    title={s.value == null ? t("Anda tidak memiliki akses lihat data ini", "You do not have access to view this data") : s.label}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm dark:bg-slate-900">
                      <Icon className="h-4 w-4 text-slate-600 dark:text-slate-300" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold leading-tight">{s.label}</p>
                      <p className="text-lg font-semibold tabular-nums">{s.value ?? "—"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* kartu jumlah master */}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Master Rekrutmen Terpasang", "Recruitment Masters Provisioned")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t(
                "10 master (padanan General Setting oranHR). Kelola di menu Master Rekrutmen.",
                "10 masters (oranHR General Setting equivalent). Manage in the Recruitment Masters menu.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {counts.loading && !counts.data ? (
              <LoadingRows rows={2} />
            ) : !c ? (
              <EmptyState title={t("Jumlah master belum termuat", "Master counts not loaded")} icon={Boxes} />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {MASTER_DEFS.map((m) => {
                  const Icon = TYPE_ICON[m.type] ?? Boxes;
                  const n = c[m.type] ?? 0;
                  return (
                    <div key={m.type} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40" title={t(m.desc, m.descEn)}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm dark:bg-slate-900">
                        <Icon className="h-4 w-4 text-slate-600 dark:text-slate-300" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold leading-tight">{t(m.label, m.labelEn)}</p>
                        <p className="text-[11px] text-slate-500">
                          {t("{n} entri", "{n} entries", { n })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
