"use client";
// OneVity Dashboard — live KPIs, charts, approval feed
import { useApi, fmtIDRShort, fmtIDR, fmtDateTime, initials, avatarColor, paTypeLabelSafe } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { useSession } from "@/onevity/shared/lib/session-store";
import { LoadingCards, LoadingRows, StatusPill } from "@/onevity/shared/components/ui-kit";
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
  const session = useSession();
  const sessionUser = session.info?.user;
  const { data, loading } = useApi<DashData>("/api/onevity/dashboard");

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
    { label: "Total Karyawan Aktif", value: data.activeEmployees.toLocaleString("id-ID"), sub: `${data.totalEmployees - data.activeEmployees} tidak aktif`, icon: Users, accent: "from-emerald-500 to-teal-600", trend: `+${data.newHiresThisYear} hiring YTD` },
    { label: "Approval Menunggu", value: data.pendingActions.toLocaleString("id-ID"), sub: "Pengajuan karyawan", icon: Clock, accent: "from-amber-400 to-orange-500", trend: "Butuh keputusan" },
    { label: "Unit Organisasi", value: String(data.orgUnits), sub: `${data.positions} posisi terdefinisi`, icon: Network, accent: "from-teal-400 to-emerald-600", trend: "Struktur hidup" },
    { label: "Rata-rata Gaji Pokok", value: fmtIDRShort(data.avgSalary), sub: "Karyawan aktif", icon: Wallet, accent: "from-stone-500 to-stone-700", trend: "Grade G1–G8" },
  ];

  const genderData = data.genderSplit.map((g) => ({ name: g.gender === "F" ? "Perempuan" : "Laki-laki", value: g.count }));

  return (
    <div className="space-y-6">
      {/* hero */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-900 p-6 text-white shadow-xl shadow-emerald-900/20 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 right-24 h-48 w-48 rounded-full bg-teal-300/10 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200 ring-1 ring-white/15 backdrop-blur">
                <Sparkles className="h-3 w-3" /> Human Resource Base
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Selamat pagi, {sessionUser ? sessionUser.name.split(" ")[0] : "Anda"} 👋</h1>
              <p className="mt-1.5 max-w-xl text-sm text-emerald-100/85">
                {data.pendingActions > 0
                  ? `Ada ${data.pendingActions} pengajuan karyawan menunggu persetujuan Anda. ${growth >= 0 ? `Headcount tumbuh ${growth >= 0 ? "+" : ""}${growth} YTD.` : ""}`
                  : "Semua pengajuan sudah selesai. Workspace Anda bersih hari ini."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button onClick={() => navigate("actions", "inbox")} className="gap-2 bg-white font-bold text-emerald-800 hover:bg-emerald-50 shadow-lg">
                <CheckCircle2 className="h-4 w-4" /> Lihat Pengajuan
                {data.pendingActions > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 text-[10px] font-extrabold text-stone-900">{data.pendingActions}</span>}
              </Button>
              <Button onClick={() => navigate("employee", "wizard")} variant="outline" className="gap-2 border-white/25 bg-white/10 font-bold text-white hover:bg-white/20 hover:text-white backdrop-blur">
                <UserCheck className="h-4 w-4" /> Onboarding
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
              <Card className="relative overflow-hidden rounded-2xl border-stone-200/80 shadow-sm transition-all hover:shadow-md hover:shadow-stone-200/60 dark:border-stone-800 dark:hover:shadow-stone-900/60">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-stone-400">{k.label}</p>
                      <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-stone-900 dark:text-stone-50">{k.value}</p>
                      <p className="mt-1 text-[11px] text-stone-400">{k.sub}</p>
                    </div>
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${k.accent} text-white shadow-md`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-3.5 flex items-center gap-1.5 border-t border-dashed border-stone-100 pt-3 text-[11px] font-bold text-emerald-600 dark:border-stone-800 dark:text-emerald-400">
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
        <Card className="rounded-2xl border-stone-200/80 shadow-sm lg:col-span-2 dark:border-stone-800">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-bold">Tren Rekrutmen — 12 Bulan</CardTitle>
              <p className="mt-0.5 text-[11px] text-stone-400">Jumlah karyawan baru per bulan</p>
            </div>
            <Badge2 label="Live" />
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.hireTrend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
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
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Komposisi Karyawan</CardTitle>
            <p className="mt-0.5 text-[11px] text-stone-400">Gender & status kepegawaian</p>
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
                    <span className="font-semibold text-stone-700 dark:text-stone-300">{g.name}</span>
                    <span className="ml-auto font-bold text-stone-900 dark:text-stone-100">{g.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1.5 border-t border-dashed border-stone-100 pt-3 dark:border-stone-800">
              {data.employmentStatusSplit.map((s) => (
                <div key={s.status} className="rounded-lg bg-stone-50 py-1.5 text-center dark:bg-stone-900">
                  <p className="text-sm font-extrabold text-stone-900 dark:text-stone-100">{s.count}</p>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-stone-400">{s.status}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* headcount per division + grade */}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Headcount per Divisi</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.headcountByDivision.slice(0, 7)} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 9.5, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-popover)", fontSize: 12 }} cursor={{ fill: "var(--color-muted)" }} />
                  <Bar dataKey="count" name="Karyawan" fill="var(--color-chart-1)" radius={[0, 6, 6, 0]} barSize={13} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Distribusi Grade</CardTitle>
            <p className="mt-0.5 text-[11px] text-stone-400">Struktur level G1–G8</p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2 pt-1">
              {data.gradeDistribution.map((g) => {
                const max = Math.max(...data.gradeDistribution.map((x) => x.count), 1);
                return (
                  <div key={g.code} className="flex items-center gap-2.5">
                    <span className="w-6 text-[10px] font-extrabold text-stone-400">{g.code}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-stone-100 dark:bg-stone-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(g.count / max) * 100}%` }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                        className="flex h-full items-center rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-2"
                      >
                        <span className="text-[10px] font-extrabold text-white">{g.count}</span>
                      </motion.div>
                    </div>
                    <span className="w-24 truncate text-[10px] text-stone-400">{g.name}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* recent PA */}
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold">Pengajuan Terbaru</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] font-bold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400" onClick={() => navigate("actions", "all")}>
              Lihat semua <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {data.recentActions.map((a) => (
              <button key={a.id} onClick={() => navigate("actions", "all", { id: a.id })} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-stone-50 dark:hover:bg-stone-900">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold ${avatarColor(a.employee.fullName)}`}>
                  {initials(a.employee.fullName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-stone-800 dark:text-stone-200">{a.docNo} · {paTypeLabelSafe(a.type)}</p>
                  <p className="truncate text-[11px] text-stone-400">{a.employee.fullName}</p>
                </div>
                <StatusPill status={a.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* activity feed */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold"><TrendingUp className="h-4 w-4 text-emerald-600" /> Aktivitas Terakhir</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ol className="relative ml-2 space-y-4 border-l border-stone-200 pl-6 dark:border-stone-800">
            {data.activities.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 ring-4 ring-white dark:bg-emerald-500/20 dark:ring-stone-950">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-xs font-bold text-stone-800 dark:text-stone-200">{a.appUser?.fullName ?? "System"} <span className="font-medium text-stone-400">· {a.action}</span> <span className="font-semibold text-emerald-700 dark:text-emerald-400">{a.entity}</span></p>
                  <time className="text-[10px] text-stone-400">{fmtDateTime(a.createdAt)}</time>
                </div>
                <p className="mt-0.5 text-[11px] text-stone-500">{a.detail}</p>
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
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25">
      <span className="relative flex h-1.5 w-1.5"><span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>
      {label}
    </span>
  );
}
