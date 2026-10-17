"use client";
// RekanKerja Recruitment F8 — view "Laporan" (recruitment:reports):
//   · Dashboard — kesehatan & aging PR, beban recruiter, kepatuhan SLA,
//     ROI sumber & cost per hire, funnel ringkas (gaya offers.tsx F4).
//   · Katalog Metrik — 6 metrik standar + breakdown efektivitas sumber.
//   · Adverse Impact — pass-through demografis per tahap + flag 4/5ths
//     (EEOC) per dimensi gender/umur/pendidikan + disclaimer fairness.
//   · Proyeksi — prediktif heuristik (BUKAN ML): estimasi fill per posisi
//     + PR berisiko (umur > proyeksi × faktor).
//   · Dokumen Laporan — katalog 12 laporan distribusi siap cetak (SB-RC-RD
//     — mirror T110–T113 HR/Leave/Attendance/Travel/Medical/Performance):
//     form parameter → ReportSheet A4 → Cetak/PDF + XLSX.
//   · Tampilan Tersimpan — saved views MILIK AKTOR + jadwal digest mingguan.
// Kontrak API: src/rekankerja/recruitment/api/reports.ts (F8-BACKEND) —
// GET ?section=…|?views=1|?export=… + POST view-save|view-delete|view-schedule.
// Tipe mirror serializer — komponen client TIDAK meng-import file service.
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { RecruitmentReportDocumentsTab } from "./report-documents/report-documents-tab";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  AlertTriangle, BarChart3, CalendarClock, CheckCircle2, ChevronDown, Clock, Coins, Download, FileSpreadsheet, FileText, Filter, FolderOpen, Gauge,
  Info, Save, Scale, Target, Trash2, TrendingUp, UsersRound,
} from "lucide-react";

export const REPORTS_API = "/api/rekankerja/recruitment/reports";

// ============ tipe (mirror JSON API F8) ============

interface FunnelStageUI { key: string; label: string; labelEn: string; count: number }

interface DashboardUI {
  prHealth: {
    open: number;
    avgAgeDays: number | null;
    oldest: { prNo: string; days: number } | null;
    atRisk: { prNo: string; positionTitle: string | null; ageDays: number; targetDays: number }[];
    closedThisPeriod: number;
  };
  recruiterLoad: { officerId: string | null; name: string; activeCandidates: number; activePrs: number }[];
  slaCompliance: { onTime: number; late: number; rate: number | null; latestStage: { name: string; late: number } | null };
  sourceRoi: { source: string; spend: number | null; hires: number; costPerHire: number | null }[];
  funnel: { prId: string | null; stages: FunnelStageUI[]; offerAcceptanceRate: number | null };
}

interface MetricItemUI {
  key: string;
  labelId: string;
  labelEn: string;
  value: number | null;
  unit: string;
  /** padanan EN satuan ("hari"→"days") — BL-REC-CORE. */
  unitEn?: string;
  hint: string;
  /** padanan EN hint kartu metrik — BL-REC-CORE. */
  hintEn?: string;
  breakdown?: { source: string; applicants: number; hires: number; rate: number | null }[];
}

interface AdverseGroupUI {
  label: string;
  entered: number;
  passed: number;
  rate: number | null;
  flag: boolean;
  small: boolean;
}

interface AdverseDimUI {
  dim: string;
  groups: AdverseGroupUI[];
  impactRatio: number | null;
  flagged: boolean;
}

interface AdverseImpactUI {
  stages: { stage: string; processOrder: number | null; dims: AdverseDimUI[] }[];
  rule: { threshold: number; noteId: string; noteEn: string };
}

interface ProjectionsUI {
  positions: { position: string; avgFillDays: number | null; sampleSize: number }[];
  atRisk: { prNo: string; positionTitle: string | null; ageDays: number; projection: number; overdueFactor: number }[];
  globalAvgDays: number | null;
  method: string;
}

interface SavedViewUI {
  id: string;
  name: string;
  view: string;
  filters: Record<string, unknown>;
  schedule: string;
  createdAt: string;
  updatedAt: string;
}

// ============ label dwibahasa ============

/** Tab laporan yang bisa disimpan/diterapkan ke filter SavedReportView. */
const TAB_KEYS = ["dashboard", "metrics", "adverse-impact", "projections", "documents", "views"] as const;

/** View rekrutmen yang dikenal router (utk aksi "Terapkan" lintas view). */
const RECRUITMENT_VIEWS = new Set([
  "overview", "masters", "pr", "pr-approval", "openings", "applicants", "public-staging",
  "selection", "offers", "plan", "demographics", "settings", "reports",
]);

/** Sumber pelamar — server mengirim kunci EN (ROI) atau label ID (breakdown). */
const SOURCE_PAIRS: { id: string; en: string }[] = [
  { id: "Iklan", en: "Advertisement" },
  { id: "Agency", en: "Agency" },
  { id: "Referral karyawan", en: "Employee referral" },
  { id: "Web", en: "Web" },
  { id: "Internal", en: "Internal" },
  { id: "Lainnya", en: "Other" },
];

function sourceLabel(src: string, lang: string): string {
  const p = SOURCE_PAIRS.find((x) => x.en === src || x.id === src);
  return p ? (lang === "en" ? p.en : p.id) : src;
}

/** Label grup demografis dari server (ID) → EN utk label umum. */
function groupLabel(label: string, lang: string): string {
  if (lang !== "en") return label;
  const map: Record<string, string> = { "Laki-laki": "Male", Perempuan: "Female", "Tak diisi": "Not set" };
  return map[label] ?? label;
}

function dimLabel(dim: string, t: (a: string, b?: string) => string): string {
  if (dim === "gender") return t("Jenis Kelamin", "Gender");
  if (dim === "age") return t("Umur", "Age");
  if (dim === "education") return t("Pendidikan", "Education");
  return dim;
}

/** Ringkasan filter tersimpan utk ditampilkan (pretty, bukan JSON mentah). */
function prettyFilters(f: Record<string, unknown>): string {
  const keys = Object.keys(f ?? {});
  if (keys.length === 0) return "—";
  return keys.map((k) => `${k}: ${typeof f[k] === "string" ? String(f[k]) : JSON.stringify(f[k])}`).join(" · ");
}

// ============ pill/badge kecil ============

function SchedulePill({ schedule, t }: { schedule: string; t: (a: string, b?: string) => string }) {
  const weekly = schedule === "weekly";
  return (
    <span className={cn(
      "inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold",
      weekly
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
        : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
    )}>
      {weekly ? t("mingguan", "weekly") : t("tanpa jadwal", "no schedule")}
    </span>
  );
}

/** Bar rate % mini (track zinc + isi emerald) — dipakai tabel adverse impact. */
function RateBar({ rate }: { rate: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
        <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Math.max(rate ?? 0, rate ? 3 : 0)}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">
        {rate != null ? `${rate}%` : "—"}
      </span>
    </div>
  );
}

// ============ tombol unduh (anchor biasa — cookie sesi ikut) ============

/** Menu unduh multi-format (F8 spec: CSV/XLSX/PDF) — dropdown ringkas. */
function ExportMenu({ section, lang, title }: { section: "dashboard" | "metrics" | "adverse-impact"; lang: string; title: string }) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={title}
          title={title}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-slate-900 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          <Download className="h-4 w-4" aria-hidden /> {t("Unduh", "Download")}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <a href={`${REPORTS_API}?export=${section}&format=csv&lang=${lang}`} className="cursor-pointer">
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> {t("CSV (Excel ID \";\")", "CSV")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${REPORTS_API}?export=${section}&format=xlsx&lang=${lang}`} className="cursor-pointer">
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> {t("Excel (.xlsx)", "Excel (.xlsx)")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`${REPORTS_API}?export=${section}&format=pdf&lang=${lang}`} className="cursor-pointer">
            <FileText className="h-4 w-4" aria-hidden /> {t("PDF", "PDF")}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============ halaman ============

export function ReportsPage() {
  const { t, lang } = useI18n();
  const perms = useMenuPerms();
  const nav = useNav();

  const [tab, setTab] = useState<string>("dashboard");
  // Form simpan view hidup di tab "views" — tab tersimpan = tab konten
  // terakhir yang dilihat user (bukan tab "views" itu sendiri).
  const [savedTab, setSavedTab] = useState<string>("dashboard");
  const onTabChange = (next: string) => {
    if (next !== "views") setSavedTab(next);
    setTab(next);
  };

  // ---------- gating (mirror guard server: op export/views) ----------
  const canExport = perms.canOp("recruitment", "reports", "export");
  const canViews = perms.canOp("recruitment", "reports", "views");
  // ---------- data (semua seksi dimuat sekali — data demo kecil) ----------
  const dashApi = useApi<{ dashboard: DashboardUI }>(`${REPORTS_API}?section=dashboard`);
  const metricsApi = useApi<{ metrics: MetricItemUI[] }>(`${REPORTS_API}?section=metrics`);
  const adverseApi = useApi<{ adverseImpact: AdverseImpactUI }>(`${REPORTS_API}?section=adverse-impact`);
  const projApi = useApi<{ projections: ProjectionsUI }>(`${REPORTS_API}?section=projections`);
  const viewsApi = useApi<{ views: SavedViewUI[] }>(`${REPORTS_API}?views=1`);

  const dash = dashApi.data?.dashboard ?? null;
  const metrics = metricsApi.data?.metrics ?? null;
  const adverse = adverseApi.data?.adverseImpact ?? null;
  const proj = projApi.data?.projections ?? null;
  const views = viewsApi.data?.views ?? null;

  // ---------- form simpan tampilan ----------
  const [viewName, setViewName] = useState("");
  const [busySave, setBusySave] = useState(false);
  const [busySchedule, setBusySchedule] = useState<string | null>(null);

  const tabLabel = (key: string): string => {
    const m: Record<string, { id: string; en: string }> = {
      dashboard: { id: "Dashboard", en: "Dashboard" },
      metrics: { id: "Katalog Metrik", en: "Metrics Catalog" },
      "adverse-impact": { id: "Adverse Impact", en: "Adverse Impact" },
      projections: { id: "Proyeksi", en: "Projections" },
      documents: { id: "Dokumen Laporan", en: "Report Documents" },
      views: { id: "Tampilan Tersimpan", en: "Saved Views" },
    };
    const e = m[key] ?? { id: key, en: key };
    return t(e.id, e.en);
  };

  const saveView = async () => {
    const name = viewName.trim();
    if (!name) {
      toast.error(t("Beri nama tampilan dulu (1–80 karakter).", "Name the view first (1–80 characters)."));
      return;
    }
    setBusySave(true);
    try {
      await apiSend(REPORTS_API, "POST", {
        action: "view-save",
        name,
        view: "reports",
        filters: { section: "reports", tab: savedTab },
      });
      toast.success(t(`Tampilan "${name}" disimpan (${tabLabel(savedTab)}).`, `View "${name}" saved (${tabLabel(savedTab)}).`));
      setViewName("");
      viewsApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan tampilan", "Failed to save the view"));
    } finally {
      setBusySave(false);
    }
  };

  const applyView = (v: SavedViewUI) => {
    const f = v.filters ?? {};
    const target = typeof f.tab === "string" ? f.tab : typeof f.section === "string" ? f.section : null;
    if (v.view === "reports") {
      const next = (TAB_KEYS as readonly string[]).includes(target ?? "") ? (target as string) : "dashboard";
      setTab(next);
      toast.success(t(`Tampilan "${v.name}" diterapkan — ${tabLabel(next)}.`, `View "${v.name}" applied — ${tabLabel(next)}.`));
      return;
    }
    if (RECRUITMENT_VIEWS.has(v.view)) {
      nav.navigate("recruitment", v.view);
      toast.info(t(`Membuka view terkait untuk tampilan "${v.name}".`, `Opening the related view for "${v.name}".`));
      return;
    }
    toast.info(t(
      "Tampilan ini milik modul lain — filter belum didukung lintas modul dari sini.",
      "This view belongs to another module — cross-module filters are not supported from here.",
    ));
  };

  const toggleSchedule = async (v: SavedViewUI) => {
    const next = v.schedule === "weekly" ? "none" : "weekly";
    setBusySchedule(v.id);
    try {
      await apiSend(REPORTS_API, "POST", { action: "view-schedule", id: v.id, schedule: next });
      toast.success(next === "weekly"
        ? t(`Ringkasan mingguan "${v.name}" diaktifkan — dikirim setiap Senin.`, `Weekly digest "${v.name}" enabled — sent every Monday.`)
        : t(`Ringkasan mingguan "${v.name}" dimatikan.`, `Weekly digest "${v.name}" disabled.`));
      viewsApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengubah jadwal", "Failed to change the schedule"));
    } finally {
      setBusySchedule(null);
    }
  };

  const deleteView = async (v: SavedViewUI) => {
    if (!window.confirm(t(`Hapus tampilan "${v.name}"?`, `Delete view "${v.name}"?`))) return;
    setBusySchedule(v.id);
    try {
      await apiSend(REPORTS_API, "POST", { action: "view-delete", id: v.id });
      toast.success(t(`Tampilan "${v.name}" dihapus.`, `View "${v.name}" deleted.`));
      viewsApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus tampilan", "Failed to delete the view"));
    } finally {
      setBusySchedule(null);
    }
  };

  // ---------- render ----------

  const errBox = (title: string, error: string | null) => (
    <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="pt-6">
        <EmptyState title={title} description={error ?? undefined} />
      </CardContent>
    </Card>
  );

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · F8")}
        title={t("Laporan", "Reports")}
        description={t(
          "Analitik & prediktif rekrutmen — dashboard kesehatan PR, katalog metrik standar, adverse impact 4/5ths, proyeksi heuristik, dokumen laporan siap cetak, dan tampilan tersimpan pribadi.",
          "Recruitment analytics & predictions — PR health dashboard, standard metrics catalog, 4/5ths adverse impact, heuristic projections, print-ready report documents, and personal saved views.",
        )}
      />

      <Tabs value={tab} onValueChange={onTabChange} className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
          <TabsTrigger value="dashboard" className="gap-1.5 text-xs font-bold"><TrendingUp className="h-3.5 w-3.5" /> {t("Dashboard", "Dashboard")}</TabsTrigger>
          <TabsTrigger value="metrics" className="gap-1.5 text-xs font-bold"><Gauge className="h-3.5 w-3.5" /> {t("Katalog Metrik", "Metrics Catalog")}</TabsTrigger>
          <TabsTrigger value="adverse-impact" className="gap-1.5 text-xs font-bold"><Scale className="h-3.5 w-3.5" /> {t("Adverse Impact", "Adverse Impact")}</TabsTrigger>
          <TabsTrigger value="projections" className="gap-1.5 text-xs font-bold"><CalendarClock className="h-3.5 w-3.5" /> {t("Proyeksi", "Projections")}</TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5 text-xs font-bold"><FolderOpen className="h-3.5 w-3.5" /> {t("Dokumen Laporan", "Report Documents")}</TabsTrigger>
          <TabsTrigger value="views" className="gap-1.5 text-xs font-bold"><Save className="h-3.5 w-3.5" /> {t("Tampilan Tersimpan", "Saved Views")}</TabsTrigger>
        </TabsList>

        {/* ==================== TAB: DASHBOARD ==================== */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          {dashApi.loading && !dash ? (
            <LoadingRows rows={5} />
          ) : dashApi.error ? (
            errBox(t("Dashboard gagal dimuat", "Failed to load the dashboard"), dashApi.error)
          ) : !dash ? null : (
            <>
              {/* kartu ringkas */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardContent className="p-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <BarChart3 className="h-3.5 w-3.5" aria-hidden /> {t("PR Terbuka", "Open Requisitions")}
                    </p>
                    <p className="mt-1 text-3xl font-black text-slate-900 dark:text-slate-100">{dash.prHealth.open}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {t(
                        `Rata-rata {n} hari sejak request`, `Avg {n} days since request`,
                        { n: String(dash.prHealth.avgAgeDays ?? "—") },
                      )}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className={cn(
                        "inline-block rounded-full border px-2 py-0.5 font-bold",
                        dash.prHealth.atRisk.length > 0
                          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
                      )}>
                        {t("{n} at-risk (lebih dari SLA target)", "{n} at-risk (beyond SLA target)", { n: String(dash.prHealth.atRisk.length) })}
                      </span>
                      {dash.prHealth.oldest && (
                        <span className="text-slate-400">
                          {t("tertua: {pr} ({d} hari)", "oldest: {pr} ({d} days)", { pr: dash.prHealth.oldest.prNo, d: String(dash.prHealth.oldest.days) })}
                        </span>
                      )}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardContent className="p-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <Clock className="h-3.5 w-3.5" aria-hidden /> {t("Kepatuhan SLA Tahap", "Stage SLA Compliance")}
                    </p>
                    <p className="mt-1 text-3xl font-black text-slate-900 dark:text-slate-100">
                      {dash.slaCompliance.rate != null ? `${dash.slaCompliance.rate}%` : "—"}
                    </p>
                    {/* bar on-time vs late */}
                    <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
                      <div
                        className="h-2.5 bg-emerald-400"
                        style={{ width: `${dash.slaCompliance.onTime + dash.slaCompliance.late > 0 ? Math.round((dash.slaCompliance.onTime / (dash.slaCompliance.onTime + dash.slaCompliance.late)) * 100) : 0}%` }}
                      />
                      <div
                        className="h-2.5 bg-rose-400"
                        style={{ width: `${dash.slaCompliance.onTime + dash.slaCompliance.late > 0 ? Math.round((dash.slaCompliance.late / (dash.slaCompliance.onTime + dash.slaCompliance.late)) * 100) : 0}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">{t("tepat waktu {n}", "on time {n}", { n: String(dash.slaCompliance.onTime) })}</span>
                      {" · "}
                      <span className="font-bold text-rose-600 dark:text-rose-400">{t("terlambat {n}", "late {n}", { n: String(dash.slaCompliance.late) })}</span>
                      {dash.slaCompliance.latestStage && (
                        <>{" · "}
                          {t("terbanyak terlambat: {s} ({n})", "most late: {s} ({n})", { s: dash.slaCompliance.latestStage.name, n: String(dash.slaCompliance.latestStage.late) })}
                        </>
                      )}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardContent className="p-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t("Ditutup Bulan Ini", "Closed This Month")}
                    </p>
                    <p className="mt-1 text-3xl font-black text-slate-900 dark:text-slate-100">{dash.prHealth.closedThisPeriod}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {t("PR Fulfilled / Closed / Cancelled sejak awal bulan berjalan.", "Requisitions Fulfilled / Closed / Cancelled since the start of the current month.")}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardContent className="p-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <TrendingUp className="h-3.5 w-3.5" aria-hidden /> {t("Penerimaan Offer", "Offer Acceptance")}
                    </p>
                    <p className="mt-1 text-3xl font-black text-slate-900 dark:text-slate-100">
                      {dash.funnel.offerAcceptanceRate != null ? `${dash.funnel.offerAcceptanceRate}%` : "—"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {t("Offer diterima / (diterima + ditolak).", "Offers accepted / (accepted + declined).")}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* beban recruiter + ROI sumber (min-w-0 — cegah grid blowout tabel di mobile) */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="min-w-0 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <UsersRound className="h-4 w-4 ov-text-accent" aria-hidden />
                      {t("Beban Recruiter", "Recruiter Workload")}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t(
                        "Kandidat aktif (Nominated/InProcess) dan PR aktif per penanggung jawab.",
                        "Active candidates (Nominated/InProcess) and active requisitions per owner.",
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {dash.recruiterLoad.length === 0 ? (
                      <EmptyState
                        icon={UsersRound}
                        title={t("Belum ada beban recruiter", "No recruiter workload yet")}
                        description={t("Belum ada kandidat aktif di pipeline.", "No active candidates in the pipeline yet.")}
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table className="min-w-[420px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("Recruiter", "Recruiter")}</TableHead>
                              <TableHead className="text-right">{t("Kandidat Aktif", "Active Candidates")}</TableHead>
                              <TableHead className="text-right">{t("PR Aktif", "Active Requisitions")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {dash.recruiterLoad.map((r, i) => (
                              <TableRow key={`${r.officerId ?? "none"}-${i}`}>
                                <TableCell className="font-medium text-slate-800 dark:text-slate-200">{r.name}</TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">{r.activeCandidates}</TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">{r.activePrs}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="min-w-0 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <Coins className="h-4 w-4 ov-text-accent" aria-hidden />
                      {t("ROI Sumber & Cost per Hire", "Source ROI & Cost per Hire")}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t(
                        "Belanja kanal (Job Opening Method) vs jumlah hire per kelompok sumber pelamar.",
                        "Channel spend (Job Opening Method) vs hires per applicant source group.",
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {dash.sourceRoi.length === 0 ? (
                      <EmptyState
                        icon={Coins}
                        title={t("Belum ada data sumber", "No source data yet")}
                        description={t("Belum ada pelamar maupun belanja kanal rekrutmen.", "No applicants or recruitment channel spend yet.")}
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table className="min-w-[460px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("Sumber", "Source")}</TableHead>
                              <TableHead className="text-right">{t("Belanja", "Spend")}</TableHead>
                              <TableHead className="text-right">{t("Hire", "Hires")}</TableHead>
                              <TableHead className="text-right">{t("Cost / Hire", "Cost / Hire")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {dash.sourceRoi.map((r) => (
                              <TableRow key={r.source}>
                                <TableCell className="font-medium text-slate-800 dark:text-slate-200">{sourceLabel(r.source, lang)}</TableCell>
                                <TableCell className="text-right tabular-nums">{fmtIDR(r.spend)}</TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">{r.hires}</TableCell>
                                <TableCell className="text-right tabular-nums">{r.costPerHire != null ? fmtIDR(r.costPerHire) : "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* funnel ringkas (gaya offers.tsx F4) */}
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Filter className="h-4 w-4 ov-text-accent" aria-hidden />
                    {t("Funnel Rekrutmen", "Recruitment Funnel")}
                    {canExport && (
                      <div className="ml-auto">
                        <ExportMenu
                          section="dashboard"
                          lang={lang}
                          title={t("Unduh dashboard rekrutmen (CSV/Excel/PDF)", "Download the recruitment dashboard (CSV/Excel/PDF)")}
                        />
                      </div>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {t(
                      "Corong keseluruhan rekrutmen (semua PR) — dari talent pool hingga kandidat diangkat.",
                      "Overall recruitment funnel (all PRs) — from the talent pool to hired candidates.",
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {dash.funnel.stages.length === 0 ? (
                    <EmptyState title={t("Funnel kosong", "Funnel is empty")} description={t("Belum ada aktivitas rekrutmen.", "No recruitment activity yet.")} />
                  ) : (() => {
                    const funnelMax = Math.max(...dash.funnel.stages.map((s) => s.count), 1);
                    return (
                      <div className="space-y-2.5">
                        {dash.funnel.stages.map((s, i) => (
                          <div key={s.key}>
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-600 dark:text-slate-300">{t(s.label, s.labelEn)}</span>
                              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{s.count}</span>
                            </div>
                            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
                              <div
                                className={cn("h-2.5 rounded-full",
                                  i === dash.funnel.stages.length - 1
                                    ? "bg-gradient-to-r from-emerald-400 to-emerald-600 dark:from-emerald-500 dark:to-emerald-400"
                                    : "bg-gradient-to-r from-amber-300 to-amber-500 dark:from-amber-600 dark:to-amber-400")}
                                style={{ width: `${Math.max(2, Math.round((s.count / funnelMax) * 100))}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ==================== TAB: KATALOG METRIK ==================== */}
        <TabsContent value="metrics" className="mt-4 space-y-4">
          {metricsApi.loading && !metrics ? (
            <LoadingRows rows={5} />
          ) : metricsApi.error ? (
            errBox(t("Katalog metrik gagal dimuat", "Failed to load the metrics catalog"), metricsApi.error)
          ) : !metrics || metrics.length === 0 ? (
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="pt-6">
                <EmptyState icon={Gauge} title={t("Belum ada metrik", "No metrics yet")} description={t("Metrik akan muncul setelah ada aktivitas rekrutmen.", "Metrics will appear once there is recruitment activity.")} />
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t(
                    "Nilai dihitung langsung dari data operasional — bukan snapshot periodik.",
                    "Values are computed live from operational data — not periodic snapshots.",
                  )}
                </p>
                {canExport && (
                  <ExportMenu
                    section="metrics"
                    lang={lang}
                    title={t("Unduh katalog metrik (CSV/Excel/PDF)", "Download the metrics catalog (CSV/Excel/PDF)")}
                  />
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {metrics.map((m) => (
                  <Card key={m.key} className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                        <Gauge className="h-4 w-4 ov-text-accent" aria-hidden />
                        {lang === "en" ? m.labelEn : m.labelId}
                        <Badge variant="secondary" className="font-mono text-[9px]">{m.key}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black text-slate-900 dark:text-slate-100">
                          {m.value != null ? m.value : "—"}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">{lang === "en" ? (m.unitEn ?? m.unit) : m.unit}</span>
                      </p>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{lang === "en" ? (m.hintEn ?? m.hint) : m.hint}</p>

                      {/* breakdown efektivitas sumber */}
                      {m.key === "source_effectiveness" && (m.breakdown?.length ?? 0) > 0 && (
                        <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            {t("Per Sumber", "Per Source")}
                          </p>
                          <div className="space-y-1.5">
                            {m.breakdown!.map((b) => (
                              <div key={b.source} className="flex items-center gap-2 text-[11px]">
                                <span className="w-24 shrink-0 truncate font-medium text-slate-600 dark:text-slate-300" title={sourceLabel(b.source, lang)}>
                                  {sourceLabel(b.source, lang)}
                                </span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
                                  <div className="h-1.5 rounded-full bg-teal-400" style={{ width: `${Math.max(b.rate ?? 0, b.rate ? 4 : 0)}%` }} />
                                </div>
                                <span className="w-20 shrink-0 text-right font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                                  {b.rate != null ? `${b.rate}%` : "—"}
                                </span>
                                <span className="w-16 shrink-0 text-right tabular-nums text-slate-400">
                                  {t("{h}/{a}", "{h}/{a}", { h: String(b.hires), a: String(b.applicants) })}
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="mt-2 text-[10px] text-slate-400">
                            {t("hire / pelamar per sumber", "hires / applicants per source")}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ==================== TAB: ADVERSE IMPACT ==================== */}
        <TabsContent value="adverse-impact" className="mt-4 space-y-4">
          {adverseApi.loading && !adverse ? (
            <LoadingRows rows={5} />
          ) : adverseApi.error ? (
            errBox(t("Adverse impact gagal dimuat", "Failed to load adverse impact"), adverseApi.error)
          ) : !adverse ? null : (
            <>
              {/* penjelasan aturan + disclaimer fairness */}
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Scale className="h-4 w-4 ov-text-accent" aria-hidden />
                    {t("Aturan 4/5ths (EEOC)", "4/5ths Rule (EEOC)")}
                    {canExport && (
                      <div className="ml-auto">
                        <ExportMenu
                          section="adverse-impact"
                          lang={lang}
                          title={t("Unduh adverse impact (CSV/Excel/PDF)", "Download adverse impact (CSV/Excel/PDF)")}
                        />
                      </div>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {lang === "en" ? adverse.rule.noteEn : adverse.rule.noteId}
                  </p>
                  <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {t(
                      "Disclaimer fairness: adverse impact adalah indikator statistik — bukan bukti diskriminasi. Temuan wajib ditindaklanjuti dengan investigasi manual (konteks tahap, rubrik, evaluator) sebelum mengambil kesimpulan.",
                      "Fairness disclaimer: adverse impact is a statistical indicator — not proof of discrimination. Findings must be followed up with manual investigation (stage context, rubrics, evaluators) before drawing conclusions.",
                    )}
                  </p>
                </CardContent>
              </Card>

              {/* per tahap */}
              {adverse.stages.length === 0 ? (
                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardContent className="pt-6">
                    <EmptyState
                      icon={Scale}
                      title={t("Belum ada data tahap seleksi", "No selection stage data yet")}
                      description={t("Analisis akan muncul setelah kandidat melewati tahap seleksi aktif.", "The analysis will appear once candidates pass through active selection stages.")}
                    />
                  </CardContent>
                </Card>
              ) : (
                adverse.stages.map((st) => (
                  <Card key={st.stage} className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {st.stage}
                        {st.processOrder != null && (
                          <Badge variant="secondary" className="font-mono text-[9px]">#{st.processOrder}</Badge>
                        )}
                        {st.dims.some((d) => d.flagged) && (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                            {t("ada flag 4/5ths", "4/5ths flag present")}
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {t(
                          "Pass-through demografis kandidat yang pernah masuk tahap ini (pseudonymisasi — tanpa identitas individu).",
                          "Demographic pass-through of candidates who entered this stage (pseudonymized — no individual identity).",
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {st.dims.map((dim) => (
                        <div key={dim.dim}>
                          <p className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                            {dimLabel(dim.dim, t)}
                            <span className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                              dim.flagged
                                ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                                : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
                            )}>
                              {t("impact ratio {r}", "impact ratio {r}", { r: dim.impactRatio != null ? String(dim.impactRatio).replace(".", ",") : "—" })}
                              {dim.flagged ? ` · ${t("FLAG < 0,8", "FLAG < 0.8")}` : ""}
                            </span>
                          </p>
                          <div className="overflow-x-auto">
                            <Table className="min-w-[560px]">
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t("Kelompok", "Group")}</TableHead>
                                  <TableHead className="text-right">{t("Masuk", "Entered")}</TableHead>
                                  <TableHead className="text-right">{t("Lulus", "Passed")}</TableHead>
                                  <TableHead>{t("Rate Lulus", "Pass Rate")}</TableHead>
                                  <TableHead className="text-right">{t("Penanda", "Markers")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {dim.groups.map((g) => (
                                  <TableRow key={g.label}>
                                    <TableCell className="font-medium text-slate-800 dark:text-slate-200">{groupLabel(g.label, lang)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{g.entered}</TableCell>
                                    <TableCell className="text-right tabular-nums">{g.passed}</TableCell>
                                    <TableCell><RateBar rate={g.rate} /></TableCell>
                                    <TableCell className="space-x-1 text-right">
                                      {g.flag && (
                                        <span className="inline-block whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                                          4/5ths
                                        </span>
                                      )}
                                      {g.small && (
                                        <span className="inline-block whitespace-nowrap rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                                          {t("n kecil", "small n")}
                                        </span>
                                      )}
                                      {!g.flag && !g.small && <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))
              )}
            </>
          )}
        </TabsContent>

        {/* ==================== TAB: PROYEKSI ==================== */}
        <TabsContent value="projections" className="mt-4 space-y-4">
          {projApi.loading && !proj ? (
            <LoadingRows rows={4} />
          ) : projApi.error ? (
            errBox(t("Proyeksi gagal dimuat", "Failed to load projections"), projApi.error)
          ) : !proj ? null : (
            <>
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t(
                  "Heuristik rata-rata historis — bukan ML. Estimasi = rata-rata hari PR Fulfilled pada posisi yang sama (fallback rata-rata global bila sampel kosong).",
                  "Historical-average heuristic — not ML. The estimate is the average days of Fulfilled requisitions for the same position (falling back to the global average when there is no sample).",
                )}
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* estimasi per posisi (min-w-0 — cegah grid blowout tabel di mobile) */}
                <Card className="min-w-0 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <Target className="h-4 w-4 ov-text-accent" aria-hidden />
                      {t("Estimasi Hari Penyelesaian per Posisi", "Projected Days to Fill per Position")}
                      <Badge variant="secondary" className="font-mono text-[9px]">{proj.method}</Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t(
                        "Rata-rata global {n} hari (fallback bila posisi tanpa sampel).",
                        "Global average {n} days (fallback for positions without samples).",
                        { n: String(proj.globalAvgDays ?? "—") },
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {proj.positions.length === 0 ? (
                      <EmptyState
                        icon={Target}
                        title={t("Belum ada posisi", "No positions yet")}
                        description={t("Belum ada PR terpenuhi untuk dihitung rata-rata historisnya.", "No fulfilled requisitions yet to average historically.")}
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table className="min-w-[420px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("Posisi", "Position")}</TableHead>
                              <TableHead className="text-right">{t("Rata-rata Hari", "Avg Days")}</TableHead>
                              <TableHead className="text-right">{t("Sampel", "Samples")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {proj.positions.map((p) => (
                              <TableRow key={p.position}>
                                <TableCell className="font-medium text-slate-800 dark:text-slate-200">{p.position}</TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">{p.avgFillDays ?? "—"}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-500">{p.sampleSize}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* PR berisiko */}
                <Card className="min-w-0 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
                      {t("PR Berisiko", "At-Risk Requisitions")}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t(
                        "PR aktif yang umurnya melewati proyeksi × 1,5 (amber = mendekati, merah = terlampaui).",
                        "Active requisitions whose age exceeds the projection × 1.5 (amber = approaching, red = exceeded).",
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {proj.atRisk.length === 0 ? (
                      <EmptyState
                        title={t("Tidak ada PR berisiko", "No at-risk requisitions")}
                        description={t("Semua PR aktif masih dalam batas estimasi penyelesaian.", "All active requisitions are still within the estimated completion bound.")}
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table className="min-w-[460px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>PR</TableHead>
                              <TableHead>{t("Posisi", "Position")}</TableHead>
                              <TableHead className="text-right">{t("Umur / Proyeksi", "Age / Projection")}</TableHead>
                              <TableHead className="text-right">{t("Faktor", "Factor")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {proj.atRisk.map((r) => (
                              <TableRow key={r.prNo}>
                                <TableCell className="font-mono text-xs font-semibold">{r.prNo}</TableCell>
                                <TableCell className="max-w-[180px] truncate text-slate-700 dark:text-slate-300" title={r.positionTitle ?? ""}>
                                  {r.positionTitle ?? "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-slate-500">
                                  {t("{a} / {p} hari", "{a} / {p} days", { a: String(r.ageDays), p: String(r.projection) })}
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className={cn(
                                    "inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums",
                                    r.overdueFactor >= 1.5
                                      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                                      : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
                                  )}>
                                    ×{Math.round(r.overdueFactor * 100) / 100}
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* ==================== TAB: DOKUMEN LAPORAN ==================== */}
        <TabsContent value="documents" className="mt-4 space-y-4">
          <RecruitmentReportDocumentsTab />
        </TabsContent>

        {/* ==================== TAB: TAMPILAN TERSIMPAN ==================== */}
        <TabsContent value="views" className="mt-4 space-y-4">
          {viewsApi.loading && !views ? (
            <LoadingRows rows={4} />
          ) : viewsApi.error ? (
            errBox(t("Tampilan tersimpan gagal dimuat", "Failed to load saved views"), viewsApi.error)
          ) : (
            <>
              {/* form simpan tampilan saat ini */}
              {canViews ? (
                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <Save className="h-4 w-4 ov-text-accent" aria-hidden />
                      {t("Simpan Tampilan Saat Ini", "Save the Current View")}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t(
                        "Menyimpan tab aktif ({tab}) sebagai tampilan pribadi — bisa dijadwalkan jadi ringkasan email mingguan.",
                        "Saves the active tab ({tab}) as a personal view — can be scheduled as a weekly email digest.",
                        { tab: tabLabel(savedTab) },
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={viewName}
                        onChange={(e) => setViewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void saveView(); }}
                        placeholder={t("Nama tampilan (mis. Dashboard Mingguan)", "View name (e.g. Weekly Dashboard)")}
                        maxLength={80}
                        className="sm:max-w-sm"
                      />
                      <Button onClick={() => void saveView()} disabled={busySave} className="gap-1.5 font-bold">
                        <Save className="h-4 w-4" aria-hidden />
                        {busySave ? t("Menyimpan…", "Saving…") : t("Simpan Tampilan", "Save View")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <p className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t(
                    "Anda tidak punya izin mengelola tampilan tersimpan (hanya melihat daftar).",
                    "You lack permission to manage saved views (list is read-only).",
                  )}
                </p>
              )}

              {/* daftar tampilan */}
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <CalendarClock className="h-4 w-4 ov-text-accent" aria-hidden />
                    {t("Tampilan Tersimpan Saya", "My Saved Views")}
                    <Badge variant="secondary" className="font-mono">{views?.length ?? 0}</Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {t(
                      "Milik akun Anda — orang lain tidak dapat mengubah/menghapusnya. Jadwal mingguan dikirim setiap Senin.",
                      "Owned by your account — others cannot modify/delete them. The weekly digest is sent every Monday.",
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!views || views.length === 0 ? (
                    <EmptyState
                      icon={CalendarClock}
                      title={t("Belum ada tampilan tersimpan", "No saved views yet")}
                      description={t(
                        "Simpan konfigurasi tab aktif untuk membuka cepat dan menerima ringkasan mingguan.",
                        "Save the active tab configuration for quick access and weekly digests.",
                      )}
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[720px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("Nama", "Name")}</TableHead>
                            <TableHead>{t("View", "View")}</TableHead>
                            <TableHead>{t("Filter", "Filters")}</TableHead>
                            <TableHead>{t("Jadwal", "Schedule")}</TableHead>
                            <TableHead className="w-64 text-right">{t("Aksi", "Actions")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {views.map((v) => (
                            <TableRow key={v.id}>
                              <TableCell className="font-semibold text-slate-800 dark:text-slate-200">{v.name}</TableCell>
                              <TableCell><span className="font-mono text-[11px] text-slate-500">{v.view}</span></TableCell>
                              <TableCell className="max-w-[220px] truncate text-xs text-slate-500" title={prettyFilters(v.filters)}>
                                {prettyFilters(v.filters)}
                              </TableCell>
                              <TableCell><SchedulePill schedule={v.schedule} t={t} /></TableCell>
                              <TableCell className="text-right">
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <Button
                                    size="sm" variant="outline"
                                    className="h-7 gap-1 px-2 text-[10px] font-bold"
                                    onClick={() => applyView(v)}
                                  >
                                    {t("Terapkan", "Apply")}
                                  </Button>
                                  {canViews && (
                                    <>
                                      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300" title={t("Ringkasan email mingguan", "Weekly email digest")}>
                                        <Switch
                                          checked={v.schedule === "weekly"}
                                          disabled={busySchedule === v.id}
                                          onCheckedChange={() => void toggleSchedule(v)}
                                          className="scale-75"
                                        />
                                        {t("Mingguan", "Weekly")}
                                      </label>
                                      <Button
                                        size="sm" variant="outline"
                                        className="h-7 gap-1 border-rose-200 px-2 text-[10px] font-bold text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
                                        disabled={busySchedule === v.id}
                                        onClick={() => void deleteView(v)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("Hapus", "Delete")}
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
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
