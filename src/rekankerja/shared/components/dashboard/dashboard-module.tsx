"use client";
// RekanKerja Dashboard — live KPIs, charts, approval feed
import { useApi, fmtIDRShort, fmtIDR, fmtDateTime, initials, avatarColor, paTypeLabelSafe } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { LoadingCards, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, RadialBarChart, RadialBar, Legend,
} from "recharts";
import {
  Users, UserCheck, Network, BriefcaseBusiness, TrendingUp, Wallet, ArrowUpRight, ArrowRight,
  CheckCircle2, Clock, FileText, Sparkles, Award,
} from "lucide-react";
import { motion } from "framer-motion";
import { useI18n, loc, locActivity } from "@/rekankerja/shared/lib/i18n";

interface DashData {
  totalEmployees: number; activeEmployees: number; pendingActions: number;
  orgUnits: number; positions: number; newHiresThisYear: number; exitsYTD: number;
  avgSalary: number;
  recentActions: { id: string; docNo: string; type: string; status: string; effectiveDate: string; employee: { fullName: string; employeeNo: string } }[];
  activities: { id: string; action: string; entity: string; detail: string | null; createdAt: string; appUser: { fullName: string; role: string } | null; employee: { fullName: string } | null }[];
  genderSplit: { gender: string; count: number }[];
  employmentStatusSplit: { status: string; count: number }[];
  headcountByDivision: { name: string; count: number }[];
  hireTrend: { month: string; hires: number }[];
  gradeDistribution: { code: string; name: string; count: number }[];
}

const CHART_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

export function DashboardModule() {
  const { navigate } = useNav();
  const { t, locale } = useI18n();
  const session = useSession();
  const sessionUser = session.info?.user;
  const { data, loading } = useApi<DashData>("/api/rekankerja/dashboard");

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <LoadingCards cards={4} />
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-80 lg:col-span-2" /><Skeleton className="h-80" /></div>
      </div>
    );
  }
  if (!data) return <LoadingCards />;

  const growth = data.newHiresThisYear - data.exitsYTD;

  const kpis = [
    { label: t("Total Karyawan Aktif", "Total Active Employees"), value: data.activeEmployees.toLocaleString(locale), sub: t("{n} tidak aktif", "{n} inactive", { n: data.totalEmployees - data.activeEmployees }), icon: Users, hero: true, trend: t("+{n} hiring YTD", "+{n} hires YTD", { n: data.newHiresThisYear }) },
    { label: t("Approval Menunggu", "Pending Approvals"), value: data.pendingActions.toLocaleString(locale), sub: t("Pengajuan karyawan", "Employee requests"), icon: Clock, trend: t("Butuh keputusan", "Needs a decision") },
    { label: t("Unit Organisasi"), value: String(data.orgUnits), sub: t("{n} posisi terdefinisi", "{n} positions defined", { n: data.positions }), icon: Network, trend: t("Struktur hidup", "Active structure") },
    { label: t("Rata-rata Gaji Pokok", "Average Base Salary"), value: fmtIDRShort(data.avgSalary), sub: t("Karyawan aktif", "Active employees"), icon: Wallet, trend: "Grade G1–G8" },
  ];

  const genderData = data.genderSplit.map((g) => ({ name: g.gender === "F" ? t("Perempuan", "Female") : t("Laki-laki", "Male"), value: g.count }));

  return (
    <div className="space-y-6">
      {/* hero */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="relative overflow-hidden rounded-3xl ov-hero p-6 text-white ov-glow sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 right-24 h-48 w-48 rounded-full bg-white/5 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white ring-1 ring-white/15 backdrop-blur">
                <Sparkles className="h-3 w-3" /> Human Resource Base
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t("Selamat pagi, {nama} 👋", "Good morning, {nama} 👋", { nama: sessionUser ? sessionUser.name.split(" ")[0] : t("Anda", "there") })}</h1>
              <p className="mt-1.5 max-w-xl text-sm text-white/80">
                {data.pendingActions > 0
                  ? t("Ada {n} pengajuan karyawan menunggu persetujuan Anda. {growth}", "You have {n} employee requests awaiting your approval. {growth}", {
                      n: data.pendingActions,
                      growth: growth >= 0 ? t("Headcount tumbuh {g} YTD.", "Headcount {g} YTD.", { g: `${growth >= 0 ? "+" : ""}${growth}` }) : "",
                    })
                  : t("Semua pengajuan sudah selesai. Workspace Anda bersih hari ini.", "All requests are settled. Your workspace is clear today.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button onClick={() => navigate("actions", "inbox")} className="gap-2 bg-white font-bold text-slate-900 hover:bg-slate-100 shadow-lg">
                <CheckCircle2 className="h-4 w-4" /> {t("Lihat Pengajuan", "View Requests")}
                {data.pendingActions > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-[10px] font-extrabold text-slate-900">{data.pendingActions}</span>}
              </Button>
              <Button onClick={() => navigate("employee", "wizard")} variant="outline" className="gap-2 border-white/25 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white backdrop-blur">
                <UserCheck className="h-4 w-4" /> {t("Onboarding")}
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <motion.div key={k.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.3 }}>
              <Card className="relative overflow-hidden rounded-2xl border-slate-200/80 shadow-sm transition-all hover:shadow-md hover:shadow-slate-200/60 dark:border-slate-800 dark:hover:shadow-slate-900/60">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{k.label}</p>
                      <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">{k.value}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{k.sub}</p>
                    </div>
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${k.hero ? "ov-fill" : "ov-tile"}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-3.5 flex items-center gap-1.5 border-t border-dashed border-slate-100 pt-3 text-[11px] font-bold ov-text-accent dark:border-slate-800">
                    <ArrowUpRight className="h-3.5 w-3.5" /> {k.trend}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* charts row */}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* headcount trend */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm lg:col-span-2 dark:border-slate-800">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-bold">{t("Tren Rekrutmen — 12 Bulan", "Hiring Trend — 12 Months")}</CardTitle>
              <p className="mt-0.5 text-[11px] text-slate-400">{t("Jumlah karyawan baru per bulan", "New employees per month")}</p>
            </div>
            <Badge2 label="Live" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.hireTrend.map((p) => ({ ...p, month: loc(p.month) }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hireGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-popover)", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }} labelStyle={{ fontWeight: 700 }} />
                  <Area type="monotone" dataKey="hires" name="Hire" stroke="var(--color-chart-1)" strokeWidth={2.5} fill="url(#hireGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* gender + status donuts */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">{t("Komposisi Karyawan", "Employee Composition")}</CardTitle>
            <p className="mt-0.5 text-[11px] text-slate-400">{t("Gender & status kepegawaian", "Gender & employment status")}</p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-2">
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={genderData} dataKey="value" nameKey="name" innerRadius={38} outerRadius={55} paddingAngle={3} strokeWidth={0}>
                      {genderData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-popover)", fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col justify-center gap-2.5">
                {genderData.map((g, i) => (
                  <div key={g.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{g.name}</span>
                    <span className="ml-auto font-bold text-slate-900 dark:text-slate-100">{g.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5 border-t border-dashed border-slate-100 pt-3 dark:border-slate-800">
              {data.employmentStatusSplit.map((s) => (
                <div key={s.status} className="rounded-lg bg-slate-50 py-1.5 text-center dark:bg-slate-900">
                  <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{s.count}</p>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{s.status}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* headcount per division + grade */}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">{t("Headcount per Divisi", "Headcount per Division")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.headcountByDivision.slice(0, 7)} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 9.5, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-popover)", fontSize: 12 }} cursor={{ fill: "var(--color-muted)" }} />
                  <Bar dataKey="count" name={t("Karyawan")} fill="var(--color-chart-1)" radius={[0, 6, 6, 0]} barSize={13} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">{t("Distribusi Grade", "Grade Distribution")}</CardTitle>
            <p className="mt-0.5 text-[11px] text-slate-400">{t("Struktur level G1–G8", "Level structure G1–G8")}</p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2 pt-1">
              {data.gradeDistribution.map((g) => {
                const max = Math.max(...data.gradeDistribution.map((x) => x.count), 1);
                return (
                  <div key={g.code} className="flex items-center gap-2.5">
                    <span className="w-6 text-[10px] font-extrabold text-slate-400">{g.code}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(g.count / max) * 100}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                        className="flex h-full items-center rounded-md ov-chart px-2"
                      >
                        <span className="text-[10px] font-extrabold text-white">{g.count}</span>
                      </motion.div>
                    </div>
                    <span className="w-24 truncate text-[10px] text-slate-400">{g.name}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* recent PA */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold">{t("Pengajuan Terbaru", "Recent Requests")}</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] font-bold ov-text-accent hover:ov-text-accent" onClick={() => navigate("actions", "all")}>
              {t("Lihat semua", "View all")} <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {data.recentActions.map((a) => (
              <button key={a.id} onClick={() => navigate("actions", "all", { id: a.id })} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold ${avatarColor(a.employee.fullName)}`}>
                  {initials(a.employee.fullName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">{a.docNo} · {paTypeLabelSafe(a.type)}</p>
                  <p className="truncate text-[11px] text-slate-400">{a.employee.fullName}</p>
                </div>
                <StatusPill status={a.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* activity feed */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold"><TrendingUp className="h-4 w-4 ov-text-accent" /> {t("Aktivitas Terakhir", "Recent Activity")}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ol className="relative ml-2 space-y-4 border-l border-slate-200 pl-6 dark:border-slate-800">
            {data.activities.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full ov-tile ring-4 ring-white dark:ring-slate-950">
                  <span className="h-1.5 w-1.5 rounded-full ov-bar" />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{a.appUser?.fullName ?? "System"} <span className="font-medium text-slate-400">· {a.action}</span> <span className="font-semibold ov-text-accent">{a.entity}</span></p>
                  <time className="text-[10px] text-slate-400">{fmtDateTime(a.createdAt)}</time>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{locActivity(a.detail)}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Badge2({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full ov-soft px-2.5 py-0.5 text-[10px] font-extrabold ring-1 ring-(--ov-accent)/30">
      <span className="relative flex h-1.5 w-1.5"><span className="absolute h-full w-full animate-ping rounded-full ov-bar opacity-75" /><span className="h-1.5 w-1.5 rounded-full ov-bar" /></span>
      {label}
    </span>
  );
}
