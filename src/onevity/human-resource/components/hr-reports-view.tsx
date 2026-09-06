"use client";
// OneVity HR — Laporan HR (T12-REPORTS): Turnover & Tenure + Demografi.
// Komponen standalone — koordinator mem-wire ke menu/routing modul HR
// (menu item + page routing ditambah di luar file ini; export default
// HrReportsView siap dipakai).
//
// Data: GET /api/onevity/hr/reports (agregat Employee + Assignment aktif).
// Export per tab: GET /api/onevity/hr/reports?export=turnover|demografi
// (XLSX multi-sheet via exceljs — lihat src/onevity/shared/lib/export.ts).
import { useMemo } from "react";
import { useApi } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from "recharts";
import { motion } from "framer-motion";
import {
  Users, UserPlus, UserMinus, TrendingUp, Hourglass, Download, RefreshCw, BarChart3, PieChart as PieIcon, Cake, BriefcaseBusiness, Heart, Landmark,
} from "lucide-react";
import { useI18n, loc } from "@/onevity/shared/lib/i18n";
import { cn } from "@/lib/utils";

interface CountRow { label: string; count: number }
interface BucketRow { key: string; label: string; count: number }

interface ReportsData {
  generatedAt: string;
  year: number;
  scope: "all" | "scoped";
  turnover: {
    kpi: {
      headcount: number; headcountTotal: number; startHeadcount: number; avgHeadcount: number;
      hiresYtd: number; exitsYtd: number; turnoverRate: number; avgTenureYears: number;
    };
    byDivision: { division: string; headcount: number; exits: number; turnoverRate: number }[];
    tenureBuckets: BucketRow[];
    trend: { month: string; hires: number; exits: number }[];
  };
  demografi: {
    gender: CountRow[];
    ageBuckets: BucketRow[];
    employmentStatus: CountRow[];
    marital: CountRow[];
    religion: CountRow[];
  };
}

const CHART_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];
const TOOLTIP_STYLE = { borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-popover)", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" };

/** Buka unduhan export XLSX dari API (Content-Disposition attachment). */
function downloadExport(kind: "turnover" | "demografi") {
  window.location.href = `/api/onevity/hr/reports?export=${kind}`;
}

export default HrReportsView;

/** View laporan HR — standalone (PageHeader + tabs Turnover/Tenure & Demografi).
 *  Dipanggil koordinator: `import HrReportsView from "@/onevity/human-resource/components/hr-reports-view"`
 *  (menu item + routing modul HR di-wire di luar file ini). */
export function HrReportsView() {
  const { t, locale } = useI18n();
  const api = useApi<ReportsData>("/api/onevity/hr/reports");
  const data = api.data;

  const trend = useMemo(
    () => (data?.turnover.trend ?? []).map((p) => ({ ...p, month: loc(p.month) })),
    [data],
  );
  const maxTenure = Math.max(1, ...(data?.turnover.tenureBuckets ?? []).map((b) => b.count));

  const fmtNum = (n: number | null | undefined) => (n ?? 0).toLocaleString(locale);

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL HUMAN RESOURCE")}
        title={t("Laporan HR")}
        description={t(
          "Turnover & tenure + komposisi demografi karyawan — agregat dari data karyawan & penempatan aktif (export XLSX per laporan).",
          "Turnover & tenure + employee demographic composition — aggregated from employee & active assignment data (per-report XLSX export).",
        )}
        actions={
          <>
            <Button variant="outline" onClick={() => api.refresh()} className="gap-2 font-bold">
              <RefreshCw className="h-4 w-4" /> {t("Segarkan")}
            </Button>
            <Button onClick={() => downloadExport("turnover")} className="gap-2 font-bold">
              <Download className="h-4 w-4" /> {t("Export Turnover (XLSX)")}
            </Button>
            <Button variant="outline" onClick={() => downloadExport("demografi")} className="gap-2 font-bold">
              <Download className="h-4 w-4" /> {t("Export Demografi (XLSX)")}
            </Button>
          </>
        }
      />

      {api.loading && !data ? (
        <LoadingRows rows={8} />
      ) : !data ? (
        <Card className="rounded-2xl"><CardContent className="p-5">
          <EmptyState title={t("Laporan belum tersedia")} description={api.error ?? undefined} icon={<BarChart3 className="h-6 w-6" />} />
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="turnover">
          <TabsList className="mb-4">
            <TabsTrigger value="turnover" className="gap-1.5 text-xs font-bold"><TrendingUp className="h-3.5 w-3.5" /> {t("Turnover & Tenure")}</TabsTrigger>
            <TabsTrigger value="demografi" className="gap-1.5 text-xs font-bold"><PieIcon className="h-3.5 w-3.5" /> {t("Demografi")}</TabsTrigger>
          </TabsList>

          {/* ================= TAB TURNOVER & TENURE ================= */}
          <TabsContent value="turnover" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                { label: t("Headcount Aktif", "Active Headcount"), value: fmtNum(data.turnover.kpi.headcount), sub: t("{n} total dalam scope", "{n} total in scope", { n: data.turnover.kpi.headcountTotal }), icon: Users, hero: true, trend: t("awal tahun {n}", "start of year {n}", { n: data.turnover.kpi.startHeadcount }) },
                { label: t("Hires YTD"), value: fmtNum(data.turnover.kpi.hiresYtd), sub: t(`sejak 1 Jan ${data.year}`), icon: UserPlus, trend: t("bergabung tahun ini", "joined this year") },
                { label: t("Exits YTD"), value: fmtNum(data.turnover.kpi.exitsYtd), sub: t("Resign + Terminated", "Resigned + Terminated"), icon: UserMinus, trend: t("keluar tahun ini", "left this year") },
                { label: t("Turnover Rate"), value: `${data.turnover.kpi.turnoverRate.toLocaleString(locale)}%`, sub: t("exits / rata-rata headcount", "exits / average headcount"), icon: TrendingUp, trend: t("avg HC {n}", "avg HC {n}", { n: data.turnover.kpi.avgHeadcount.toLocaleString(locale) }) },
                { label: t("Avg Tenure"), value: `${data.turnover.kpi.avgTenureYears.toLocaleString(locale)} ${t("thn", "yr")}`, sub: t("karyawan aktif", "active employees"), icon: Hourglass, trend: t("sejak join date", "since join date") },
              ].map((k, i) => {
                const Icon = k.icon;
                return (
                  <motion.div key={k.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i, duration: 0.3 }}>
                    <Card className="h-full overflow-hidden rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">{k.label}</p>
                            <p className="mt-1 text-xl font-extrabold tracking-tight text-stone-900 dark:text-stone-50">{k.value}</p>
                            <p className="mt-0.5 text-[10px] text-stone-400">{k.sub}</p>
                          </div>
                          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", k.hero ? "ov-fill" : "ov-tile")}>
                            <Icon className="h-4 w-4" />
                          </div>
                        </div>
                        <p className="mt-2.5 border-t border-dashed border-stone-100 pt-2 text-[10px] font-bold ov-text-accent dark:border-stone-800">{k.trend}</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
              {/* tren hires vs exits 12 bulan */}
              <Card className="rounded-2xl border-stone-200/80 shadow-sm lg:col-span-2 dark:border-stone-800">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-sm font-bold">{t("Tren Hires vs Exits — 12 Bulan", "Hires vs Exits Trend — 12 Months")}</CardTitle>
                    <p className="mt-0.5 text-[11px] text-stone-400">{t("Karyawan bergabung & keluar per bulan", "Employees joining & leaving per month")}</p>
                  </div>
                  <Badge className="bg-stone-100 text-[9px] font-bold text-stone-500 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-400">{t("12 bln", "12 mo")}</Badge>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 700 }} cursor={{ fill: "var(--color-muted)" }} />
                        <Bar dataKey="hires" name={t("Hires")} stackId="a" fill="var(--color-chart-1)" radius={[0, 0, 0, 0]} maxBarSize={18} />
                        <Bar dataKey="exits" name={t("Exits")} stackId="b" fill="var(--color-chart-3)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* distribusi tenure */}
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold">{t("Distribusi Tenure")}</CardTitle>
                  <p className="mt-0.5 text-[11px] text-stone-400">{t("Masa kerja karyawan aktif", "Tenure of active employees")}</p>
                </CardHeader>
                <CardContent className="space-y-2.5 pt-0">
                  {data.turnover.tenureBuckets.map((b, i) => (
                    <div key={b.key}>
                      <div className="flex items-baseline justify-between">
                        <p className="text-[11px] font-bold text-stone-700 dark:text-stone-200">{loc(b.label)}</p>
                        <p className="text-[11px] font-bold tabular-nums text-stone-500">{b.count} {t("kry", "emp")}</p>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(3, (b.count / maxTenure) * 100)}%` }}
                          transition={{ duration: 0.5, delay: 0.05 * i, ease: "easeOut" }}
                          className="h-full rounded-full ov-chart"
                        />
                      </div>
                    </div>
                  ))}
                  <div className="mt-2 flex items-center justify-between border-t border-dashed border-stone-100 pt-3 text-[11px] dark:border-stone-800">
                    <span className="text-stone-400">{t("Rata-rata")}</span>
                    <span className="font-extrabold text-stone-900 dark:text-stone-100">{data.turnover.kpi.avgTenureYears.toLocaleString(locale)} {t("tahun", "years")}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* tabel per divisi */}
            <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
              <CardContent className="p-0">
                <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
                  <p className="flex items-center gap-2 text-xs font-bold text-stone-600 dark:text-stone-300">
                    <BarChart3 className="h-4 w-4 ov-text-accent" /> {t("Headcount & Turnover per Divisi", "Headcount & Turnover per Division")} {data.year}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => downloadExport("turnover")} className="h-7 gap-1.5 px-2.5 text-[11px] font-bold">
                    <Download className="h-3.5 w-3.5" /> {t("Export XLSX")}
                  </Button>
                </div>
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                        <TableHead className="text-[11px] font-bold">{t("Divisi")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Headcount")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Exits YTD")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Turnover %")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.turnover.byDivision.map((d) => (
                        <TableRow key={d.division} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                          <TableCell className="text-xs font-bold text-stone-800 dark:text-stone-100">{d.division}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-stone-700 dark:text-stone-200">{fmtNum(d.headcount)}</TableCell>
                          <TableCell className={cn("text-right text-xs font-semibold tabular-nums", d.exits > 0 ? "text-rose-600 dark:text-rose-400" : "text-stone-400")}>{fmtNum(d.exits)}</TableCell>
                          <TableCell className="text-right text-xs font-bold tabular-nums text-stone-700 dark:text-stone-200">{d.turnoverRate.toLocaleString(locale)}%</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-stone-50/60 dark:bg-stone-900/60">
                        <TableCell className="text-xs font-extrabold text-stone-900 dark:text-stone-50">{t("TOTAL")}</TableCell>
                        <TableCell className="text-right text-xs font-extrabold tabular-nums text-stone-900 dark:text-stone-50">{fmtNum(data.turnover.kpi.headcount)}</TableCell>
                        <TableCell className="text-right text-xs font-extrabold tabular-nums text-stone-900 dark:text-stone-50">{fmtNum(data.turnover.kpi.exitsYtd)}</TableCell>
                        <TableCell className="text-right text-xs font-extrabold tabular-nums text-stone-900 dark:text-stone-50">{data.turnover.kpi.turnoverRate.toLocaleString(locale)}%</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= TAB DEMOGRAFI ================= */}
          <TabsContent value="demografi" className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => downloadExport("demografi")} className="h-7 gap-1.5 px-2.5 text-[11px] font-bold">
                <Download className="h-3.5 w-3.5" /> {t("Export Demografi (XLSX)")}
              </Button>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              {/* gender donut */}
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4 ov-text-accent" /> {t("Komposisi Gender")}</CardTitle>
                  <p className="mt-0.5 text-[11px] text-stone-400">{t("Karyawan aktif", "Active employees")}</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={data.demografi.gender.map((g) => ({ name: loc(g.label), value: g.count }))} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={3} strokeWidth={0}>
                            {data.demografi.gender.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col justify-center gap-2.5">
                      {data.demografi.gender.map((g, i) => (
                        <div key={g.label} className="flex items-center gap-2 text-xs">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="font-semibold text-stone-700 dark:text-stone-300">{loc(g.label)}</span>
                          <span className="ml-auto font-bold text-stone-900 dark:text-stone-100">{g.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* bucket usia */}
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold"><Cake className="h-4 w-4 ov-text-accent" /> {t("Distribusi Usia")}</CardTitle>
                  <p className="mt-0.5 text-[11px] text-stone-400">{t("Bucket usia karyawan aktif", "Age buckets of active employees")}</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.demografi.ageBuckets.map((b) => ({ bucket: loc(b.label), count: b.count }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 700 }} cursor={{ fill: "var(--color-muted)" }} />
                        <Bar dataKey="count" name={t("Karyawan")} fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} maxBarSize={42} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
              <DistCard title={t("Status Kepegawaian", "Employment Status")} icon={BriefcaseBusiness} rows={data.demografi.employmentStatus} />
              <DistCard title={t("Status Pernikahan", "Marital Status")} icon={Heart} rows={data.demografi.marital} />
              <DistCard title={t("Agama", "Religion")} icon={Landmark} rows={data.demografi.religion} />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/** Kartu distribusi sederhana (label + jumlah + bar proporsional). */
function DistCard({ title, icon: Icon, rows }: { title: string; icon: React.ElementType; rows: CountRow[] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold"><Icon className="h-4 w-4 ov-text-accent" /> {title}</CardTitle>
        <p className="mt-0.5 text-[11px] text-stone-400">{t("{n} karyawan aktif", "{n} active employees", { n: total })}</p>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {rows.map((r, i) => (
          <div key={r.label} className="flex items-center gap-2.5">
            <span className="w-28 shrink-0 truncate text-[11px] font-bold text-stone-700 dark:text-stone-200" title={r.label}>{r.label}</span>
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-stone-100 dark:bg-stone-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(4, (r.count / max) * 100)}%` }}
                transition={{ duration: 0.5, delay: 0.04 * i, ease: "easeOut" }}
                className="h-full rounded-md ov-chart"
              />
            </div>
            <span className="w-8 shrink-0 text-right text-[11px] font-extrabold tabular-nums text-stone-900 dark:text-stone-100">{r.count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
