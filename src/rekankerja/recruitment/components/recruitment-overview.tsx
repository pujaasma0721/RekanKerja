"use client";
// RekanKerja Recruitment — Ringkasan: dashboard informatif modul (pola leave/
// travel): KPI pipeline → funnel & kesehatan PR & SLA & rencana/anggaran →
// alur kerja end-to-end + rantai Standard Selection Process.
// Satu endpoint /api/rekankerja/recruitment/overview (menggantikan 10+
// pemanggilan API terpisah + peta fase dev pada overview lama).
import { useApi, fmtIDRShort } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, LoadingCards } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ClipboardList, Inbox, UserRoundCheck, UserRoundPlus, Megaphone, Handshake,
  BarChart3, ClipboardCheck, AlertTriangle, ListChecks, TrendingUp, ArrowRight,
  Calculator, Award, Gauge,
} from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

// ============ tipe (cermin overview-service) ============

interface OverviewData {
  pr: {
    stats: { total: number; draft: number; submitted: number; approved: number; rejected: number; onHold: number; fulfilled: number; closed: number; cancelled: number };
    health: {
      open: number;
      avgAgeDays: number | null;
      oldest: { prNo: string; days: number } | null;
      atRisk: number;
      oldestRisk: { prNo: string; positionTitle: string | null; ageDays: number; targetDays: number } | null;
    };
  };
  openings: { posted: number; openSlots: number; applications: number };
  applicants: { active: number; pendingStaging: number; blacklisted: number };
  selection: {
    prsWithCandidates: number; activeCandidates: number; overdue: number; invitations: number;
    topPrs: { prNo: string; candidates: number; overdue: number }[];
  };
  offers: {
    sent: number; awaiting: number; accepted: number; declined: number; expired: number;
    hired: number; acceptanceRate: number | null;
    funnel: { key: string; label: string; labelEn: string; count: number }[];
  };
  plan: { applied: number; sumH: number; sumFulfilled: number; outsideCount: number };
  budget: { period: string; total: number | null; used: number };
  silver: number;
  chain: { name: string; processOrder: number | null; slaDays: number | null; resultType: string | null }[];
}

export function RecruitmentOverview() {
  const { t } = useI18n();
  const { navigate } = useNav();
  const { data, loading } = useApi<OverviewData>("/api/rekankerja/recruitment/overview");
  const d = data;

  // ============ KPI pipeline (4 kartu klik → menu terkait) ============
  const kpi = [
    {
      label: t("PR Menunggu Approval", "PRs Pending Approval"),
      value: d ? String(d.pr.stats.submitted) : "—",
      sub: d
        ? t(
          "{n} disetujui sedang direkrut · umur rata-rata {m} hari",
          "{n} approved & recruiting · average age {m} days",
          { n: d.pr.stats.approved, m: d.pr.health.avgAgeDays ?? 0 },
        )
        : undefined,
      icon: ClipboardCheck, hero: true,
      onClick: () => navigate("recruitment", "pr-approval"),
    },
    {
      label: t("Lamaran Menunggu Verifikasi", "Applications Pending Verification"),
      value: d ? String(d.applicants.pendingStaging) : "—",
      sub: d
        ? t("{n} pelamar aktif · {m} lowongan terposting", "{n} active applicants · {m} posted openings", { n: d.applicants.active, m: d.openings.posted })
        : undefined,
      icon: Inbox,
      onClick: () => navigate("recruitment", "public-staging"),
    },
    {
      label: t("Kandidat Aktif Seleksi", "Candidates in Selection"),
      value: d ? String(d.selection.activeCandidates) : "—",
      sub: d
        ? t("{n} tahap SLA terlambat · {m} undangan terbit", "{n} overdue SLA stages · {m} invitations issued", { n: d.selection.overdue, m: d.selection.invitations })
        : undefined,
      icon: UserRoundCheck,
      warn: d ? d.selection.overdue > 0 : false,
      onClick: () => navigate("recruitment", "selection"),
    },
    {
      label: t("Kandidat Diangkat", "Candidates Hired"),
      value: d ? String(d.offers.hired) : "—",
      sub: d
        ? t(
          "penerimaan offer {r}% · {n} menunggu respons",
          "offer acceptance {r}% · {n} awaiting response",
          { r: d.offers.acceptanceRate ?? 0, n: d.offers.awaiting },
        )
        : undefined,
      icon: UserRoundPlus,
      onClick: () => navigate("recruitment", "offers"),
    },
  ];

  // ============ alur kerja end-to-end (4 langkah klik) ============
  const steps = [
    {
      n: 1, title: t("Permintaan Karyawan (PR)", "Personnel Requisition (PR)"), icon: ClipboardList, view: "pr",
      desc: t(
        "Kebutuhan SDM diajukan dengan approval berjenjang — PR disetujui otomatis menyiapkan lowongan dan slot per kantor",
        "Headcount needs are submitted with tiered approval — an approved PR automatically prepares job openings and slots per office",
      ),
    },
    {
      n: 2, title: t("Lowongan & Talent Pool", "Openings & Talent Pool"), icon: Megaphone, view: "openings",
      desc: t(
        "Iklan lowongan per kanal dengan biaya, pelamar masuk talent pool, dan verifikasi lamaran publik dengan pertanyaan knockout",
        "Job ads per channel with costs, applicants enter the talent pool, and public applications are verified with knockout questions",
      ),
    },
    {
      n: 3, title: t("Seleksi Kandidat", "Candidate Selection"), icon: UserRoundCheck, view: "selection",
      desc: t(
        "Board kanban per PR, scorecard terstruktur, surat undangan, kalender seleksi, SLA & reminder per tahap",
        "Kanban board per PR, structured scorecards, invitation letters, selection calendar, and per-stage SLA & reminders",
      ),
    },
    {
      n: 4, title: t("Offer & Pengangkatan", "Offer & Appointment"), icon: Handshake, view: "offers",
      desc: t(
        "Penawaran dengan approval & e-sign kandidat — diterima menjadi surat pengangkatan dan lanjut ke onboarding karyawan baru",
        "Offers with approval & candidate e-sign — accepted offers become appointment letters and continue into new-employee onboarding",
      ),
    },
  ];

  const maxFunnel = d ? Math.max(1, ...d.offers.funnel.map((s) => s.count)) : 1;
  const mppPct = d && d.plan.sumH > 0 ? Math.min(100, Math.round((d.plan.sumFulfilled / d.plan.sumH) * 100)) : 0;
  const budgetPct = d && d.budget.total != null && d.budget.total > 0
    ? Math.min(100, Math.round((d.budget.used / d.budget.total) * 100))
    : 0;
  const overBudget = d && d.budget.total != null && d.budget.used > d.budget.total && d.budget.total > 0;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL RECRUITMENT", "RECRUITMENT MODULE")}
        title={t("Ringkasan Rekrutmen", "Recruitment Overview")}
        description={t(
          "Pipeline rekrutmen end-to-end: permintaan karyawan, lowongan & talent pool, seleksi terstruktur, sampai pengangkatan yang tersambung ke onboarding — lengkap dengan rencana, anggaran, dan analitik.",
          "The end-to-end recruiting pipeline: personnel requisitions, openings & talent pool, structured selection, through appointments connected to onboarding — complete with planning, budget, and analytics.",
        )}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("recruitment", "reports")} className="gap-2 font-bold">
              <BarChart3 className="h-4 w-4" /> {t("Lihat Laporan", "View Reports")}
            </Button>
            <Button onClick={() => navigate("recruitment", "pr")} className="gap-2 font-bold">
              <ClipboardList className="h-4 w-4" /> {t("Ajukan Permintaan Karyawan", "New Personnel Requisition")}
            </Button>
          </div>
        }
      />

      {loading && !d ? (
        <LoadingCards cards={4} />
      ) : !d ? (
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-6 text-sm text-slate-500">
            {t("Data ringkasan belum termuat — coba muat ulang halaman.", "Overview data could not be loaded — try reloading the page.")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* ---- KPI pipeline ---- */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpi.map((k) => (
              <Card
                key={k.label}
                className="cursor-pointer border-slate-200 bg-white/80 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80"
                onClick={k.onClick}
              >
                <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{k.label}</p>
                    <p className={cn(
                      "mt-1 truncate text-2xl font-black tabular-nums",
                      k.warn ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100",
                    )}>{k.value}</p>
                    {k.sub && <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{k.sub}</p>}
                  </div>
                  <div className={cn("rounded-xl p-2.5", k.hero ? "ov-fill" : "ov-tile")}>
                    <k.icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ---- analitik: funnel · kesehatan PR · SLA · rencana & anggaran ---- */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {/* funnel */}
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <TrendingUp className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Funnel Rekrutmen", "Recruitment Funnel")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {d.offers.funnel.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => navigate("recruitment", "offers")}
                    className="block w-full text-left"
                    title={t("Buka Offer & Pengangkatan", "Open Offers & Appointment")}
                  >
                    <span className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">{t(s.label, s.labelEn)}</span>
                      <span className="font-bold tabular-nums text-slate-800 dark:text-slate-100">{s.count}</span>
                    </span>
                    <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <span className="block h-full rounded-full ov-bar" style={{ width: `${Math.max(2, (s.count / maxFunnel) * 100)}%` }} />
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* kesehatan PR */}
            <Card
              className="cursor-pointer border-slate-200 bg-white/80 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80"
              onClick={() => navigate("recruitment", "pr")}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <Gauge className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Kesehatan PR", "PR Health")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-black text-slate-900 dark:text-slate-100">{d.pr.health.open}</p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {t("PR terbuka (menunggu + direkrut)", "open requisitions (pending + recruiting)")}
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {t(
                    "umur rata-rata {n} hari · tertua {pr} ({m} hari)",
                    "average age {n} days · oldest {pr} ({m} days)",
                    { n: d.pr.health.avgAgeDays ?? "—", pr: d.pr.health.oldest?.prNo ?? "—", m: d.pr.health.oldest?.days ?? "—" },
                  )}
                </p>
                {d.pr.health.atRisk > 0 ? (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t(
                      "{n} PR lewat target SLA — tertua {pr} ({d} hari vs target {t} hari)",
                      "{n} requisitions over SLA target — oldest {pr} ({d} days vs {t}-day target)",
                      { n: d.pr.health.atRisk, pr: d.pr.health.oldestRisk?.prNo ?? "—", d: d.pr.health.oldestRisk?.ageDays ?? 0, t: d.pr.health.oldestRisk?.targetDays ?? 0 },
                    )}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    {t("Semua PR dalam target SLA", "All requisitions within SLA target")}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* tahap SLA terlambat */}
            <Card
              className="cursor-pointer border-slate-200 bg-white/80 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80"
              onClick={() => navigate("recruitment", "selection")}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <AlertTriangle className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Tahap Terlambat (SLA)", "Overdue Stages (SLA)")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {d.selection.topPrs.length === 0 ? (
                  <p className="text-[12px] text-slate-400">
                    {t("Tidak ada tahap mengganjal — SLA sehat", "No stuck stages — SLA healthy")}
                  </p>
                ) : (
                  d.selection.topPrs.map((p) => (
                    <div key={p.prNo} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{p.prNo}</span>
                      <span className="truncate text-slate-500 dark:text-slate-400">
                        {t("{n} kandidat", "{n} candidates", { n: p.candidates })}
                      </span>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        {p.overdue} {t("terlambat", "overdue")}
                      </span>
                    </div>
                  ))
                )}
                <p className="border-t border-dashed border-slate-200 pt-1.5 text-[10px] leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {t(
                    "{n} PR dengan kandidat · {m} undangan terbit",
                    "{n} requisitions with candidates · {m} invitations issued",
                    { n: d.selection.prsWithCandidates, m: d.selection.invitations },
                  )}
                </p>
              </CardContent>
            </Card>

            {/* rencana & anggaran */}
            <Card
              className="cursor-pointer border-slate-200 bg-white/80 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80"
              onClick={() => navigate("recruitment", "plan")}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <Calculator className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Rencana & Anggaran", "Plan & Budget")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {t("Capaian MPP {y}", "MPP Achievement {y}", { y: d.budget.period })}
                    </span>
                    <span className="text-sm font-black tabular-nums text-slate-900 dark:text-slate-100">
                      {d.plan.sumFulfilled}/{d.plan.sumH}
                    </span>
                  </div>
                  <Progress value={mppPct} className="mt-1 h-2 [&>div]:ov-bar" />
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {t("Realisasi Anggaran", "Budget Actuals")}
                    </span>
                    <span className="text-sm font-black tabular-nums text-slate-900 dark:text-slate-100">
                      {fmtIDRShort(d.budget.used)}
                    </span>
                  </div>
                  {d.budget.total != null ? (
                    <>
                      <Progress value={budgetPct} className="mt-1 h-2 [&>div]:ov-bar" />
                      <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                        {t("dari {total} · {p}% terpakai", "of {total} · {p}% used", { total: fmtIDRShort(d.budget.total), p: budgetPct })}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                      {t("total anggaran belum diatur / disamarkan", "total budget not set / masked")}
                    </p>
                  )}
                </div>
                {overBudget && (
                  <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t("Terpakai melebihi anggaran — lowongan tetap diproses", "Usage exceeds budget — openings still processed")}
                  </p>
                )}
                <p className="border-t border-dashed border-slate-200 pt-1.5 text-[10px] leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {d.plan.outsideCount > 0
                    ? t("{n} PR aktif di luar rencana", "{n} active requisitions outside plan", { n: d.plan.outsideCount })
                    : t("semua PR aktif melayani rencana", "all active requisitions serve a plan")}
                  {" · "}
                  {t("{n} rencana applied", "{n} applied plans", { n: d.plan.applied })}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ---- alur kerja + rantai selection process ---- */}
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <TrendingUp className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Alur Rekrutmen End-to-End", "End-to-End Recruiting Flow")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {steps.map((st) => (
                  <button
                    key={st.n}
                    onClick={() => navigate("recruitment", st.view)}
                    className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ov-fill text-sm font-black">
                      {st.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                        {st.title} <st.icon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{st.desc}</span>
                    </span>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />
                  </button>
                ))}
              </CardContent>
            </Card>

            <div className="rounded-2xl border border-slate-200/80 ov-hero p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4" aria-hidden />
                <h3 className="text-sm font-bold">{t("Standard Selection Process", "Standard Selection Process")}</h3>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/90">
                {t(
                  "Rantai tahap seleksi standar per-tenant: urutan, jenis hasil, dan SLA per tahap diatur di Master Rekrutmen — setiap kandidat mengikutinya di board Kandidat & Seleksi.",
                  "The per-tenant standard selection chain: order, result type, and per-stage SLA are configured in Recruitment Masters — every candidate follows it on the Candidates & Selection board.",
                )}
              </p>
              {d.chain.length === 0 ? (
                <p className="mt-3 text-[11px] text-white/80">
                  {t("Belum ada tahap aktif — atur di Master Rekrutmen.", "No active stages yet — configure in Recruitment Masters.")}
                </p>
              ) : (
                <ol className="mt-3 flex flex-wrap gap-1.5">
                  {d.chain.map((c, i) => (
                    <li key={`${c.name}-${i}`} className="rounded-lg bg-white/15 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">
                      <span className="mr-1 font-mono opacity-80">{c.processOrder ?? i + 1}</span>
                      {c.name}
                      {c.slaDays != null && <span className="ml-1 font-normal opacity-80">· SLA {c.slaDays}{t("hr", "d")}</span>}
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/20 pt-3">
                <Award className="h-3.5 w-3.5 text-white/90" aria-hidden />
                <p className="flex-1 text-[10px] leading-relaxed text-white/90">
                  {t(
                    "{n} silver medalist siap diajak ulang saat slot serupa buka",
                    "{n} silver medalists ready to re-engage when similar slots open",
                    { n: d.silver },
                  )}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1.5 bg-white/90 px-2.5 text-[11px] font-bold text-primary hover:bg-white"
                  onClick={() => navigate("recruitment", "demographics")}
                >
                  {t("Lihat Demografi", "View Demographics")}
                </Button>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3 w-full gap-1.5 bg-white/90 font-bold text-primary hover:bg-white"
                onClick={() => navigate("recruitment", "masters")}
              >
                {t("Kelola Master Rekrutmen", "Manage Recruitment Masters")} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
