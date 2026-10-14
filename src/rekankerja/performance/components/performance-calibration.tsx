"use client";
// ============================================================================
// PERFORMANCE — Kalibrasi (P4 — §30 Alur 6 + §18.10 Bell Curve + §35-9/10/11):
//   TAB DISTRIBUSI — rating per atasan & per unit + rata-rata skor + flag
//     anomali §8/D19 (leniency/strictness/central tendency) + toggle
//     sebelum/sesudah kalibrasi.
//   TAB KURVA BELL §18.10 — histogram skor (bin 5 poin) + overlay kurva
//     normal (μ,σ) + pilihan lingkup (perusahaan/unit/atasan) + tabel z per
//     atasan (z≤−1 pelis / z≥+1 royal amber; |z|≥2 merah; σ_tim < ½ σ
//     perusahaan = central tendency) + klik bin → daftar peserta + klik
//     atasan → kurva timnya di grafik yang sama. Kurva = lensa kewajaran
//     BUKAN kuota (D2 OFF) — tooltip edukatif.
//   TAB SESI — buat sesi kalibrasi (unit + peserta atasan + ketua + tanggal)
//     + keputusan per peserta (skor lama→baru, alasan WAJIB §35-9,
//     potentialBand 9-box 1–3) + tutup sesi.
//   TAB FINALISASI — checkbox peserta ManagerDone → submit batch approval
//     PerformanceAppraisal + KOTAK PERSETUJUAN (chain status per dokumen +
//     Setujui/Tolak — pola PR approval) + L3 Direktur aktif hanya utk
//     rating ekstrem/PIP/grade tinggi (§11.1).
// Dwibahasa t() semua; mobile 375 tanpa h-scroll (tabel desktop-only + kartu).
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  ClipboardCheck, AlertTriangle, Loader2, Users, BarChart3, Bell, CalendarClock, Gavel,
  CheckCircle2, XCircle, Info, Search, Plus, Lock, Send, Scale, Sigma, TrendingDown, TrendingUp,
} from "lucide-react";

// ---------- tipe (kontrak API §17) ----------

interface CycleRow { id: string; code: string; name: string; status: string }
interface DistGroup {
  key: string; label: string; sublabel: string | null; n: number; avg: number; sigma: number;
  ratings: { r1: number; r2: number; r3: number; r4: number; r5: number };
  z: number | null; flag: string | null; flagLevel: string | null; centralTendency: boolean;
}
interface DistributionData {
  cycle: { code: string; status: string };
  mode: "before" | "after";
  company: { n: number; mean: number; sigma: number };
  byManager: DistGroup[];
  byUnit: DistGroup[];
  participants: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string;
    unitName: string | null; managerName: string | null; status: string;
    score: number | null; rating: number | null;
  }[];
}
interface CurveData {
  cycle: { code: string; status: string };
  mode: "before" | "after";
  company: { mean: number; sigma: number };
  histogram: { from: number; to: number; label: string; count: number }[];
  curve: { x: number; y: number }[];
  n: number;
  zTable: {
    managerId: string | null; managerName: string; n: number; mean: number; sigmaTeam: number;
    z: number | null; flag: string | null; flagLevel: string | null; centralTendency: boolean;
  }[];
  participants: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string;
    unitName: string | null; managerName: string | null; score: number; binIndex: number;
  }[];
}
interface SessionRow {
  id: string; heldAt: string; orgUnitName: string | null; chairName: string | null; notes: string | null;
  participants: string[]; participantNames: string[]; decisionCount: number;
  closedAt: string | null; closedBy: string | null; closeNote: string | null;
}
interface FinalizeBoard {
  cycle: { code: string; status: string };
  structure: { code: string; levels: number } | null;
  managerDone: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string; managerName: string | null;
    candidateScore: number | null; candidateRating: number | null; highPlacement: boolean;
    needL3: boolean; calibrated: boolean;
  }[];
  pending: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string;
    candidateScore: number | null; candidateRating: number | null; needL3: boolean;
    chain: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null };
  }[];
  finalized: { appraisalId: string; docNo: string; fullName: string; finalScore: number | null; finalRating: number | null }[];
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
const RATING_COLORS: Record<number, string> = { 1: "#f43f5e", 2: "#f97316", 3: "#f59e0b", 4: "#14b8a6", 5: "#10b981" };
const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--background)", border: "1px solid var(--color-border)",
  borderRadius: 8, fontSize: 11, padding: "6px 10px", color: "var(--color-foreground)",
};

// ============================================================================
// HALAMAN
// ============================================================================

export function PerformanceCalibrationPage() {
  const { t } = useI18n();
  const cycles = useApi<{ rows: CycleRow[] }>("/api/rekankerja/performance/cycles");
  const [picked, setPicked] = useState<string>("");
  const [tab, setTab] = useState<string>("distribution");

  // default DERIVED (bukan setState-in-effect): siklus Calibration terbaru, else teratas
  const rows = cycles.data?.rows ?? [];
  const cycle = rows.find((c) => c.id === picked) ?? rows.find((c) => c.status === "Calibration") ?? rows[0] ?? null;
  const cycleId = cycle?.id ?? "";

  return (
    <div>
      <PageHeader
        eyebrow={t("PERFORMANCE · KALIBRASI")}
        title={t("Kalibrasi & Finalisasi", "Calibration & Finalization")}
        description={t(
          "Dashboard distribusi & kurva nilai (lensa kewajaran — bukan kuota, D2 OFF), sesi kalibrasi ter-audit, lalu finalisasi via approval berjenjang PerformanceAppraisal.",
          "Distribution dashboard & bell curve (a fairness lens — not a quota, D2 OFF), audited calibration sessions, then finalization via the tiered PerformanceAppraisal approval.",
        )}
      />

      {cycles.loading && !cycles.data && <LoadingRows rows={4} />}
      {cycles.error && <EmptyState title={t("Gagal memuat siklus", "Failed to load cycles")} description={cycles.error} icon={AlertTriangle} />}
      {cycles.data && cycles.data.rows.length === 0 && (
        <EmptyState icon={ClipboardCheck} title={t("Belum ada siklus", "No cycle yet")}
          description={t("Buat siklus penilaian dahulu di menu Siklus Penilaian.", "Create an appraisal cycle first in the Cycles menu.")} />
      )}

      {cycle && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={cycleId} onValueChange={setPicked}>
              <SelectTrigger className="w-full sm:w-72" aria-label={t("Siklus penilaian", "Appraisal cycle")}>
                <SelectValue placeholder={t("Pilih siklus…", "Select cycle…")} />
              </SelectTrigger>
              <SelectContent>
                {cycles.data?.rows.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <StatusPill status={cycle.status} />
          </div>

          <Tabs value={tab} onValueChange={setTab} className="space-y-4">
            <TabsList className="h-auto w-full flex-wrap justify-start rounded-xl ov-tile p-1 sm:w-auto">
              <TabsTrigger value="distribution" className="h-9 gap-1.5 rounded-lg px-3 text-xs font-semibold data-[state=active]:ov-fill">
                <BarChart3 className="h-3.5 w-3.5" /> {t("Distribusi", "Distribution")}
              </TabsTrigger>
              <TabsTrigger value="curve" className="h-9 gap-1.5 rounded-lg px-3 text-xs font-semibold data-[state=active]:ov-fill">
                <Bell className="h-3.5 w-3.5" /> {t("Kurva Bell", "Bell Curve")}
              </TabsTrigger>
              <TabsTrigger value="sessions" className="h-9 gap-1.5 rounded-lg px-3 text-xs font-semibold data-[state=active]:ov-fill">
                <Users className="h-3.5 w-3.5" /> {t("Sesi Kalibrasi", "Calibration Sessions")}
              </TabsTrigger>
              <TabsTrigger value="finalize" className="h-9 gap-1.5 rounded-lg px-3 text-xs font-semibold data-[state=active]:ov-fill">
                <Gavel className="h-3.5 w-3.5" /> {t("Finalisasi", "Finalization")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="distribution"><DistributionTab cycleId={cycleId} /></TabsContent>
            <TabsContent value="curve"><CurveTab cycleId={cycleId} /></TabsContent>
            <TabsContent value="sessions"><SessionsTab cycleId={cycleId} /></TabsContent>
            <TabsContent value="finalize"><FinalizeTab cycleId={cycleId} /></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// ============================================================================
// FLAG §8/D19 (dipakai distribusi & kurva)
// ============================================================================

function FlagBadges({ g, t }: { g: { flag: string | null; flagLevel: string | null; centralTendency: boolean; z: number | null }; t: ReturnType<typeof useI18n>["t"] }) {
  if (!g.flag && !g.centralTendency) {
    return <span className="text-xs text-slate-400">{g.z != null ? `z ${g.z > 0 ? "+" : ""}${g.z}` : "—"}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {g.z != null && <span className="font-mono text-[11px] text-slate-500">z {g.z > 0 ? "+" : ""}{g.z}</span>}
      {g.flag === "strictness" && (
        <Badge variant="outline" className={cn("h-5 gap-1 px-1.5 text-[10px]",
          g.flagLevel === "red" ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400")}>
          <TrendingDown className="h-3 w-3" />{t("terlalu pelis", "too strict")}
        </Badge>
      )}
      {g.flag === "leniency" && (
        <Badge variant="outline" className={cn("h-5 gap-1 px-1.5 text-[10px]",
          g.flagLevel === "red" ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400")}>
          <TrendingUp className="h-3 w-3" />{t("terlalu royal", "too lenient")}
        </Badge>
      )}
      {g.centralTendency && (
        <Badge variant="outline" className="h-5 gap-1 border-violet-300 bg-violet-50 px-1.5 text-[10px] text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
          <Sigma className="h-3 w-3" />{t("central tendency", "central tendency")}
        </Badge>
      )}
    </div>
  );
}

function RatingBar({ ratings, n }: { ratings: DistGroup["ratings"]; n: number }) {
  if (n === 0) return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className="flex h-2.5 w-full max-w-56 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
      {([5, 4, 3, 2, 1] as const).map((r) => {
        const v = ratings[`r${r}` as "r1"];
        if (!v) return null;
        return <span key={r} style={{ width: `${(v / n) * 100}%`, background: RATING_COLORS[r] }} />;
      })}
    </div>
  );
}

function GroupCard({ g, t, onClick }: { g: DistGroup; t: ReturnType<typeof useI18n>["t"]; onClick?: () => void }) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/80", onClick && "cursor-pointer hover:border-brand/50")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{g.label}</p>
        <p className="text-[11px] text-slate-400">{t("{n} peserta", "{n} participants", { n: String(g.n) })} · σ {g.sigma}</p>
      </div>
      <div className="w-24 shrink-0 text-right">
        <p className="font-mono text-sm font-semibold tabular-nums">{g.avg}</p>
        <p className="text-[10px] text-slate-400">{t("rata-rata", "average")}</p>
      </div>
      <div className="w-36 shrink-0 md:w-44"><RatingBar ratings={g.ratings} n={g.n} /></div>
      <FlagBadges g={g} t={t} />
    </div>
  );
}

function ModeToggle({ mode, setMode, t }: { mode: "before" | "after"; setMode: (m: "before" | "after") => void; t: ReturnType<typeof useI18n>["t"] }) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
      <button onClick={() => setMode("before")} aria-pressed={mode === "before"}
        className={cn("rounded-md px-2.5 py-1 text-[11px] font-medium transition", mode === "before" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}>
        {t("Sebelum kalibrasi", "Before calibration")}
      </button>
      <button onClick={() => setMode("after")} aria-pressed={mode === "after"}
        className={cn("rounded-md px-2.5 py-1 text-[11px] font-medium transition", mode === "after" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}>
        {t("Sesudah kalibrasi", "After calibration")}
      </button>
    </div>
  );
}

// ============================================================================
// TAB DISTRIBUSI (§30-1)
// ============================================================================

function DistributionTab({ cycleId }: { cycleId: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"before" | "after">("before");
  const api = useApi<DistributionData>(
    `/api/rekankerja/performance/calibration?cycleId=${cycleId}&mode=${mode}`,
    [cycleId, mode],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeToggle mode={mode} setMode={setMode} t={t} />
        {api.data && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Badge variant="outline" className="text-[10px]">{t("{n} ber-skor", "{n} scored", { n: String(api.data.company.n) })}</Badge>
            <Badge variant="outline" className="text-[10px]">μ {api.data.company.mean}</Badge>
            <Badge variant="outline" className="text-[10px]">σ {api.data.company.sigma}</Badge>
          </div>
        )}
      </div>

      {api.loading && !api.data ? <LoadingRows rows={5} /> :
        api.error ? <EmptyState title={t("Gagal memuat distribusi", "Failed to load distribution")} description={api.error} icon={AlertTriangle} /> :
        api.data && api.data.company.n === 0 ? (
          <EmptyState icon={BarChart3}
            title={t("Belum ada peserta ber-skor", "No scored participants yet")}
            description={t("Distribusi muncul setelah atasan men-submit penilaian (status ManagerDone).", "The distribution appears once managers submit their appraisals (ManagerDone status).")} />
        ) : api.data && (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("Per Atasan Penilai", "Per Rating Manager")}</h3>
              {api.data.byManager.map((g) => <GroupCard key={g.key} g={g} t={t} />)}
              {api.data.byManager.length === 0 && <p className="text-xs text-slate-400">{t("—", "—")}</p>}
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("Per Unit Organisasi", "Per Org Unit")}</h3>
              {api.data.byUnit.map((g) => <GroupCard key={g.key} g={g} t={t} />)}
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("Peserta Ber-skor", "Scored Participants")}</h3>
              <div className="space-y-1.5">
                {api.data.participants.map((p) => (
                  <div key={p.appraisalId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
                    <span className="font-mono text-[10px] text-slate-400">{p.docNo}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{p.fullName}</span>
                    <span className="truncate text-slate-400">{p.managerName ?? "—"}</span>
                    {p.rating != null && <Badge variant="outline" className="h-5 px-1.5 text-[10px]" style={{ color: RATING_COLORS[p.rating] }}>{t("rating", "rating")} {p.rating}</Badge>}
                    <span className="font-mono font-semibold tabular-nums">{p.score ?? "—"}</span>
                    <StatusPill status={p.status} />
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
    </div>
  );
}

// ============================================================================
// TAB KURVA BELL (§18.10 — AMANDEMEN 2)
// ============================================================================

function CurveTab({ cycleId }: { cycleId: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"before" | "after">("before");
  const [unitId, setUnitId] = useState<string>("");
  const [managerId, setManagerId] = useState<string>("");
  const [bin, setBin] = useState<number | null>(null);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ curve: "1", cycleId, mode });
    if (unitId) sp.set("unitId", unitId);
    if (managerId) sp.set("managerId", managerId);
    return `/api/rekankerja/performance/calibration?${sp.toString()}`;
  }, [cycleId, mode, unitId, managerId]);
  const api = useApi<CurveData>(url, [url]);
  const units = useApi<{ units: { id: string; name: string }[] }>("/api/rekankerja/org-units");

  // data chart: bin + kurva di-titik-tengah bin (overlay Line pada histogram)
  const chartData = useMemo(() => {
    const d = api.data;
    if (!d) return [];
    return d.histogram.map((h) => {
      const center = (h.from + h.to) / 2;
      let best: { x: number; y: number } | null = d.curve[0] ?? null;
      for (const p of d.curve) {
        if (best == null || Math.abs(p.x - center) < Math.abs(best.x - center)) best = p;
      }
      return { label: h.label, count: h.count, curveY: best != null ? Math.round(best.y * 10) / 10 : null };
    });
  }, [api.data]);

  const binParticipants = api.data && bin != null
    ? api.data.participants.filter((p) => p.binIndex === bin)
    : [];
  const scoped = unitId || managerId;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ModeToggle mode={mode} setMode={setMode} t={t} />
        <Select value={unitId || "all"} onValueChange={(v) => { setUnitId(v === "all" ? "" : v); setManagerId(""); setBin(null); }}>
          <SelectTrigger className="h-8 w-full text-xs sm:w-48" aria-label={t("Lingkup unit", "Unit scope")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua unit", "All units")}</SelectItem>
            {(units.data?.units ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={managerId || "all"} onValueChange={(v) => { setManagerId(v === "all" ? "" : v); setUnitId(""); setBin(null); }}>
          <SelectTrigger className="h-8 w-full text-xs sm:w-48" aria-label={t("Lingkup atasan", "Manager scope")}>
            <SelectValue placeholder={t("Semua atasan", "All managers")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua atasan", "All managers")}</SelectItem>
            {(api.data?.zTable ?? []).filter((z) => z.managerId).map((z) => (
              <SelectItem key={z.managerId as string} value={z.managerId as string}>{z.managerName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scoped && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setUnitId(""); setManagerId(""); setBin(null); }}>
            {t("Reset lingkup", "Reset scope")}
          </Button>
        )}
      </div>

      {api.loading && !api.data ? <LoadingRows rows={5} /> :
        api.error ? <EmptyState title={t("Gagal memuat kurva", "Failed to load curve")} description={api.error} icon={AlertTriangle} /> :
        api.data && api.data.n === 0 ? (
          <EmptyState icon={Bell}
            title={t("Belum ada skor utk kurva", "No scores for the curve yet")}
            description={t("Kurva nilai muncul setelah ada peserta ber-skor (ManagerDone+).", "The bell curve appears once there are scored participants (ManagerDone+).")} />
        ) : api.data && (
          <div className="space-y-3">
            <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{t("Kurva Nilai (skor)", "Score Bell Curve")}</h3>
                  <Badge variant="outline" className="text-[10px]">{t("{n} peserta", "{n} participants", { n: String(api.data.n) })}</Badge>
                  <Badge variant="outline" className="text-[10px]">μ {api.data.company.mean} · σ {api.data.company.sigma}</Badge>
                  <span className="ml-auto text-[10px] text-slate-400">{t("klik batang → daftar peserta", "click a bar → participant list")}</span>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 700 }} cursor={{ fill: "var(--color-muted)" }} />
                      <Bar dataKey="count" name={t("jumlah peserta", "participants")} fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={26}
                        onClick={(d: unknown) => { const i = chartData.findIndex((c) => c.label === (d as { label?: string })?.label); setBin(i >= 0 ? i : null); }} />
                      <Line dataKey="curveY" name={t("kurva normal", "normal curve")} stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls type="monotone" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {t(
                      "Kurva adalah lensa KEWAJARAN antar-unit, bukan kuota (forced distribution OFF — D2). Penyesuaian nilai tetap hanya lewat keputusan kalibrasi beralasan (ter-audit).",
                      "The curve is a FAIRNESS lens across units, not a quota (forced distribution OFF — D2). Score adjustments still go only through reasoned calibration decisions (audited).",
                    )}
                  </span>
                </div>
              </CardContent>
            </Card>

            {bin != null && (
              <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <h4 className="text-sm font-semibold">
                      {t("Bin skor", "Score bin")} {api.data.histogram[bin]?.label ?? "—"} — {t("{n} peserta", "{n} participants", { n: String(binParticipants.length) })}</h4>
                    <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setBin(null)}>{t("Tutup", "Close")}</Button>
                  </div>
                  <div className="space-y-1">
                    {binParticipants.map((p) => (
                      <p key={p.appraisalId} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="font-mono text-[10px] text-slate-400">{p.docNo}</span>
                        <span className="min-w-0 flex-1 truncate">{p.fullName}</span>
                        <span className="text-slate-400">{p.managerName ?? "—"}</span>
                        <span className="font-mono font-semibold tabular-nums">{p.score}</span>
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-4">
                <h3 className="mb-1 text-sm font-semibold">{t("Deteksi Bias Atasan (z-score — D19)", "Manager Bias Detection (z-score — D19)")}</h3>
                <p className="mb-2 text-[11px] text-slate-400">
                  {t(
                    "z = (rata-rata tim − rata-rata perusahaan) / sebaran perusahaan. z ≤ −1 cenderung pelis / z ≥ +1 cenderung royal (amber); |z| ≥ 2 merah. σ tim < ½ σ perusahaan = central tendency. Klik baris → kurva timnya di atas.",
                    "z = (team mean − company mean) / company st. dev. z ≤ −1 leans strict / z ≥ +1 leans lenient (amber); |z| ≥ 2 red. Team σ < ½ company σ = central tendency. Click a row → the team curve above.",
                  )}
                </p>
                <div className="space-y-1.5">
                  {api.data.zTable.map((z) => (
                    <div key={z.managerId ?? "none"}
                      className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 text-xs hover:border-brand/50 dark:border-slate-800"
                      onClick={() => { setManagerId(z.managerId ?? ""); setUnitId(""); setBin(null); }}
                      role="button">
                      <span className="min-w-0 flex-1 truncate font-medium">{z.managerName}</span>
                      <span className="text-slate-400">{t("{n} org", "{n} ppl", { n: String(z.n) })}</span>
                      <span className="font-mono tabular-nums">{t("mean", "mean")} {z.mean}</span>
                      <span className="font-mono text-slate-400 tabular-nums">σ {z.sigmaTeam}</span>
                      <FlagBadges g={z} t={t} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
    </div>
  );
}

// ============================================================================
// TAB SESI (§30-2/3, §35-9)
// ============================================================================

function SessionsTab({ cycleId }: { cycleId: string }) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const canDecide = perms.canOp("performance", "calibration", "decide");
  const api = useApi<{ sessions: SessionRow[] }>(`/api/rekankerja/performance/calibration?sessions=1&cycleId=${cycleId}`, [cycleId]);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<SessionRow | null>(null);
  const [closing, setClosing] = useState<SessionRow | null>(null);
  const dist = useApi<DistributionData>(`/api/rekankerja/performance/calibration?cycleId=${cycleId}&mode=after`, [cycleId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t(
            "Forum penyetaraan standar antar atasan: peserta = atasan-atasan + ketua. Setiap penyesuaian hasil = keputusan ter-audit (alasan wajib §35-9).",
            "A forum to align standards across managers: participants are the managers + a chair. Every result change is an audited decision (reason required §35-9).",
          )}
        </p>
        <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> {t("Buat Sesi", "Open Session")}
        </Button>
      </div>

      {api.loading && !api.data ? <LoadingRows rows={3} /> :
        api.error ? <EmptyState title={t("Gagal memuat sesi", "Failed to load sessions")} description={api.error} icon={AlertTriangle} /> :
        (api.data?.sessions ?? []).length === 0 ? (
          <EmptyState icon={Users} title={t("Belum ada sesi kalibrasi", "No calibration session yet")}
            description={t("Jadwalkan forum diskusi hasil per unit — bahan: distribusi & kurva nilai.", "Schedule a results forum per unit — material: the distribution & bell curve.")} />
        ) : (
          <div className="space-y-2.5">
            {api.data?.sessions.map((s) => (
              <Card key={s.id} className={cn("border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80", s.closedAt && "opacity-80")}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-slate-400" />
                    <span className="font-mono text-sm font-semibold">{fmtD(s.heldAt)}</span>
                    {s.orgUnitName && <Badge variant="outline" className="text-[10px]">{s.orgUnitName}</Badge>}
                    {s.closedAt ? (
                      <Badge variant="outline" className="gap-1 text-[10px]"><Lock className="h-3 w-3" />{t("ditutup", "closed")}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{t("aktif", "open")}</Badge>
                    )}
                    <span className="ml-auto text-[11px] text-slate-400">
                      {t("{n} keputusan", "{n} decisions", { n: String(s.decisionCount) })}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {t("Peserta", "Participants")}: {s.participantNames.join(", ") || "—"}
                    {s.chairName ? ` · ${t("ketua", "chair")}: ${s.chairName}` : ""}
                  </p>
                  {s.notes && <p className="mt-1 text-xs italic text-slate-400">{s.notes}</p>}
                  {s.closeNote && <p className="mt-1 text-[11px] text-slate-400">[{t("penutupan", "closing")}: {s.closeNote}]</p>}
                  {!s.closedAt && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {canDecide && (
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setDeciding(s)}>
                          <Scale className="h-3.5 w-3.5" /> {t("Keputusan", "Decision")}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setClosing(s)}>
                        <Lock className="h-3.5 w-3.5" /> {t("Tutup Sesi", "Close Session")}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      }

      {creating && <OpenSessionDialog cycleId={cycleId} onClose={() => setCreating(false)} onDone={() => api.refresh()} />}
      {deciding && (
        <DecideDialog
          session={deciding}
          participants={(dist.data?.participants ?? []).filter((p) => p.status === "ManagerDone")}
          onClose={() => setDeciding(null)}
          onDone={() => { api.refresh(); dist.refresh(); }}
        />
      )}
      {closing && (
        <CloseSessionDialog session={closing} onClose={() => setClosing(null)} onDone={() => api.refresh()} />
      )}
    </div>
  );
}

function OpenSessionDialog({ cycleId, onClose, onDone }: { cycleId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const units = useApi<{ units: { id: string; name: string }[] }>("/api/rekankerja/org-units");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [heldAt, setHeldAt] = useState(new Date().toISOString().slice(0, 10));
  const [chairId, setChairId] = useState("");
  const [participants, setParticipants] = useState<{ employeeId: string; employeeNo: string; fullName: string }[]>([]);
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const results = useApi<{ employees: { id: string; employeeNo: string; fullName: string }[] }>(
    q.length >= 2 ? `/api/rekankerja/employees?q=${encodeURIComponent(q)}&limit=8&status=Active` : null, [q],
  );

  const add = (e: { id: string; employeeNo: string; fullName: string }) => {
    if (participants.some((p) => p.employeeId === e.id)) return;
    setParticipants([...participants, { employeeId: e.id, employeeNo: e.employeeNo, fullName: e.fullName }]);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/calibration", "POST", {
        action: "openSession", cycleId,
        orgUnitId: orgUnitId || undefined, heldAt, notes: notes || undefined,
        chairId: chairId || undefined, participants: participants.map((p) => p.employeeId),
      });
      toast.success(t("Sesi kalibrasi dibuat", "Calibration session created"));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Buat Sesi Kalibrasi", "Open Calibration Session")}</DialogTitle>
          <DialogDescription>
            {t(
              "Peserta sesi = atasan-atasan yang hadir forum (opsional ketua). Keputusan per karyawan diambil dari tab ini setelah sesi dibuat.",
              "Session participants = the managers attending the forum (optional chair). Per-employee decisions are recorded in this tab after the session is created.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("Unit (lingkup diskusi)", "Unit (discussion scope)")}</Label>
              <Select value={orgUnitId || "none"} onValueChange={(v) => setOrgUnitId(v === "none" ? "" : v)}>
                <SelectTrigger className="text-xs" aria-label={t("Unit organisasi", "Org unit")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("— semua unit —", "— all units —")}</SelectItem>
                  {(units.data?.units ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Tanggal sesi", "Session date")}</Label>
              <Input type="date" value={heldAt} onChange={(e) => setHeldAt(e.target.value)} aria-label={t("Tanggal sesi", "Session date")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Tambah peserta (atasan)", "Add participants (managers)")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-8 text-xs" placeholder={t("Cari karyawan (nama / kode)…", "Search employee (name / no.)…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Cari peserta", "Search participants")} />
            </div>
            {q.length >= 2 && (results.data?.employees ?? []).length > 0 && (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5 dark:border-slate-800">
                {results.data?.employees.map((e) => (
                  <button key={e.id} onClick={() => add(e)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <Plus className="h-3 w-3 shrink-0 text-brand" />
                    <span className="font-mono text-[10px] text-slate-400">{e.employeeNo}</span>
                    <span className="min-w-0 flex-1 truncate">{e.fullName}</span>
                  </button>
                ))}
              </div>
            )}
            {participants.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {participants.map((p) => (
                  <Badge key={p.employeeId} variant="outline" className="gap-1 text-[10px]">
                    {p.fullName}
                    <button className="text-slate-400 hover:text-rose-500" aria-label={t("Keluarkan {n}", "Remove {n}", { n: p.fullName })}
                      onClick={() => setParticipants(participants.filter((x) => x.employeeId !== p.employeeId))}>×</button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Ketua sesi (opsional)", "Session chair (optional)")}</Label>
            <Select value={chairId || "none"} onValueChange={(v) => setChairId(v === "none" ? "" : v)}>
              <SelectTrigger className="text-xs" aria-label={t("Ketua", "Chair")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— tanpa ketua —", "— no chair —")}</SelectItem>
                {participants.map((p) => <SelectItem key={p.employeeId} value={p.employeeId}>{p.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Catatan (opsional)", "Notes (optional)")}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label={t("Catatan sesi", "Session notes")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy || participants.length === 0 || !heldAt}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Buat Sesi", "Open Session")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({ session, participants, onClose, onDone }: {
  session: SessionRow;
  participants: DistributionData["participants"];
  onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [appraisalId, setAppraisalId] = useState("");
  const [newScore, setNewScore] = useState("");
  const [newRating, setNewRating] = useState("");
  const [potentialBand, setPotentialBand] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const target = participants.find((p) => p.appraisalId === appraisalId) ?? null;

  const submit = async () => {
    if (!appraisalId) { toast.error(t("Pilih peserta yang diputuskan", "Pick the participant to decide")); return; }
    if (!reason.trim()) { toast.error(t("Alasan keputusan WAJIB diisi (§35-9)", "A decision reason is REQUIRED (§35-9)")); return; }
    if (!newScore && !newRating && !potentialBand) {
      toast.error(t("Isi skor/rating baru atau potential band", "Fill a new score/rating or the potential band"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/calibration", "POST", {
        action: "decide", sessionId: session.id, appraisalId,
        newScore: newScore || undefined, newRating: newRating || undefined, potentialBand: potentialBand || undefined,
        reason: reason.trim(),
      });
      toast.success(t("Keputusan kalibrasi tercatat (ter-audit)", "Calibration decision recorded (audited)"));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Keputusan Kalibrasi", "Calibration Decision")}</DialogTitle>
          <DialogDescription>
            {t(
              "Sesi " + fmtD(session.heldAt) + " — setiap perubahan ter-audit (CalibrationDecision) dengan alasan wajib.",
              "Session " + fmtD(session.heldAt) + " — every change is audited (CalibrationDecision) with a required reason.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t("Peserta (ManagerDone)", "Participant (ManagerDone)")}</Label>
            <Select value={appraisalId || "none"} onValueChange={(v) => setAppraisalId(v === "none" ? "" : v)}>
              <SelectTrigger className="text-xs" aria-label={t("Pilih peserta", "Pick participant")}><SelectValue placeholder={t("Pilih…", "Pick…")} /></SelectTrigger>
              <SelectContent>
                {participants.length === 0 && <SelectItem value="none" disabled>{t("tidak ada peserta ManagerDone", "no ManagerDone participants")}</SelectItem>}
                {participants.map((p) => (
                  <SelectItem key={p.appraisalId} value={p.appraisalId}>
                    {p.docNo} · {p.fullName} ({p.score ?? "—"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {target && (
              <p className="text-[11px] text-slate-400">
                {t("atasan", "manager")}: {target.managerName ?? "—"} · {t("skor saat ini", "current score")}: {target.score ?? "—"}
                {target.rating != null ? ` · ${t("rating", "rating")} ${target.rating}` : ""}
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("Skor baru", "New score")}</Label>
              <Input type="number" inputMode="decimal" value={newScore} onChange={(e) => setNewScore(e.target.value)} placeholder="0–120" aria-label={t("Skor baru", "New score")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Rating baru", "New rating")}</Label>
              <Select value={newRating || "none"} onValueChange={(v) => setNewRating(v === "none" ? "" : v)}>
                <SelectTrigger className="text-xs" aria-label={t("Rating baru", "New rating")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("auto", "auto")}</SelectItem>
                  {[1, 2, 3, 4, 5].map((r) => <SelectItem key={r} value={String(r)}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("9-box band", "9-box band")}</Label>
              <Select value={potentialBand || "none"} onValueChange={(v) => setPotentialBand(v === "none" ? "" : v)}>
                <SelectTrigger className="text-xs" aria-label={t("Potential band 9-box", "Potential band 9-box")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("—", "—")}</SelectItem>
                  {[1, 2, 3].map((b) => <SelectItem key={b} value={String(b)}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Alasan keputusan *", "Decision reason *")}</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={t("mis. forum menyepakati standar kehadiran lebih ketat utk unit produksi…", "e.g. the forum agreed a stricter attendance standard for the production unit…")}
              aria-label={t("Alasan keputusan", "Decision reason")} />
            <p className="text-[10px] text-slate-400">{t("rating mengikuti skala bila skor diubah (auto) §4.4", "the rating follows the scale when the score changes (auto) §4.4")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />} {t("Catat Keputusan", "Record Decision")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseSessionDialog({ session, onClose, onDone }: { session: SessionRow; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/calibration", "POST", {
        action: "closeSession", sessionId: session.id, notes: notes || undefined,
      });
      toast.success(t("Sesi ditutup", "Session closed"));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Tutup Sesi Kalibrasi?", "Close Calibration Session?")}</DialogTitle>
          <DialogDescription>
            {t(
              `${session.decisionCount} keputusan ter-audit pada sesi ini. Sesi tertutup tidak dapat menerima keputusan baru.`,
              `${session.decisionCount} decisions are audited in this session. A closed session cannot receive new decisions.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs">{t("Catatan penutupan (opsional)", "Closing note (optional)")}</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label={t("Catatan penutupan", "Closing note")} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} {t("Tutup Sesi", "Close Session")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB FINALISASI (§30-4/5, §35-10/11 — + kotak approval PerformanceAppraisal)
// ============================================================================

function FinalizeTab({ cycleId }: { cycleId: string }) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const canFinalize = perms.canOp("performance", "calibration", "finalize");
  const canApprove = perms.canOp("performance", "calibration", "approve");
  const api = useApi<FinalizeBoard>(`/api/rekankerja/performance/calibration?finalize=1&cycleId=${cycleId}`, [cycleId]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [decide, setDecide] = useState<{ row: FinalizeBoard["pending"][number]; action: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
  };
  const toggleAll = () => {
    const rows = api.data?.managerDone ?? [];
    setChecked(checked.size === rows.length ? new Set() : new Set(rows.map((r) => r.appraisalId)));
  };

  const submitBatch = async () => {
    if (checked.size === 0) return;
    setBusy(true);
    try {
      const res = await apiSend<{ submitted: { docNo: string }[]; skipped: { docNo: string; reason: string }[] }>(
        "/api/rekankerja/performance/calibration", "POST",
        { action: "finalize", appraisalIds: [...checked] },
      );
      toast.success(t(
        `${res.submitted.length} dokumen diajukan ke approval · ${res.skipped.length} dilewati`,
        `${res.submitted.length} documents submitted for approval · ${res.skipped.length} skipped`,
      ));
      for (const s of res.skipped.slice(0, 3)) toast.warning(`${s.docNo}: ${s.reason}`);
      setChecked(new Set());
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  const submitDecide = async () => {
    if (!decide) return;
    if (decide.action === "reject" && !note.trim()) {
      toast.error(t("Alasan penolakan wajib diisi", "A rejection note is required"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; status: string; final: boolean; approval: { currentApprover: string | null } | null }>(
        "/api/rekankerja/performance/calibration", "POST",
        { action: decide.action, appraisalId: decide.row.appraisalId, note: note.trim() || undefined },
      );
      if (decide.action === "approve" && !res.final && res.approval) {
        toast.success(t(
          `Disetujui jenjang ini — lanjut ke ${res.approval.currentApprover ?? "approver berikutnya"}`,
          `Approved at this tier — forwarded to ${res.approval.currentApprover ?? "the next approver"}`,
        ));
      } else {
        toast.success(decide.action === "approve"
          ? t(`${res.docNo} FINAL — finalScore/finalRating resmi`, `${res.docNo} FINAL — finalScore/finalRating official`)
          : t(`${res.docNo} ditolak — kembali ke ManagerDone`, `${res.docNo} rejected — back to ManagerDone`));
      }
      setDecide(null);
      setNote("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {api.loading && !api.data ? <LoadingRows rows={4} /> :
        api.error ? <EmptyState title={t("Gagal memuat board finalisasi", "Failed to load the finalization board")} description={api.error} icon={AlertTriangle} /> :
        api.data && (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t(
                `Struktur ${api.data.structure?.code ?? "—"}: L1 atasan penilai → L2 HR → L3 Direktur HANYA bila rating ekstrem (1/2/5), pemicu PIP, atau grade/level tinggi (§11.1 — pemohon = karyawan yang dinilai).`,
                `Structure ${api.data.structure?.code ?? "—"}: L1 rating manager → L2 HR → L3 Director ONLY for extreme ratings (1/2/5), PIP triggers, or high grade/level (§11.1 — requester = the appraised employee).`,
              )}
            </p>

            {/* A — siap finalisasi */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{t("Siap Finalisasi (ManagerDone)", "Ready to Finalize (ManagerDone)")}</h3>
                <Badge variant="outline" className="text-[10px]">{t("{n} peserta", "{n} participants", { n: String(api.data.managerDone.length) })}</Badge>
                {canFinalize && api.data.managerDone.length > 0 && (
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <label className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Checkbox checked={checked.size === api.data.managerDone.length && api.data.managerDone.length > 0} onCheckedChange={toggleAll} aria-label={t("Pilih semua", "Select all")} />
                      {t("Pilih semua", "Select all")}
                    </label>
                    <Button size="sm" onClick={submitBatch} disabled={busy || checked.size === 0} className="gap-1.5">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {t("Ajukan {n} dokumen", "Submit {n} documents", { n: String(checked.size) })}
                    </Button>
                  </div>
                )}
              </div>
              {api.data.managerDone.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400 dark:border-slate-700">
                  {t("Tidak ada peserta ManagerDone — selesaikan penilaian atasan dahulu.", "No ManagerDone participants — finish the manager appraisals first.")}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {api.data.managerDone.map((r) => (
                    <div key={r.appraisalId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/80">
                      {canFinalize && (
                        <Checkbox checked={checked.has(r.appraisalId)} onCheckedChange={() => toggle(r.appraisalId)} aria-label={t("Pilih {n}", "Select {n}", { n: r.fullName })} />
                      )}
                      <span className="font-mono text-[10px] text-slate-400">{r.docNo}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.fullName}</p>
                        <p className="truncate text-[11px] text-slate-400">{r.managerName ?? "—"}</p>
                      </div>
                      {r.calibrated && <Badge variant="outline" className="text-[9px] text-violet-600 dark:text-violet-300">{t("terkalibrasi", "calibrated")}</Badge>}
                      <span className="font-mono text-sm font-semibold tabular-nums">{r.candidateScore ?? "—"}</span>
                      {r.candidateRating != null && <Badge variant="outline" className="h-5 px-1.5 text-[10px]" style={{ color: RATING_COLORS[r.candidateRating] }}>rating {r.candidateRating}</Badge>}
                      {r.needL3 ? (
                        <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" /> {t("+L3 Direktur", "+L3 Director")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-slate-400">L1–L2</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* B — kotak persetujuan PerformanceAppraisal */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                {t("Kotak Persetujuan Finalisasi", "Finalization Approval Inbox")}
                <span className="ml-2 text-[11px] font-normal text-slate-400">docType PerformanceAppraisal</span>
              </h3>
              {api.data.pending.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400 dark:border-slate-700">
                  {t("Tidak ada dokumen menunggu keputusan.", "No documents awaiting a decision.")}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {api.data.pending.map((r) => (
                    <div key={r.appraisalId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/5">
                      <span className="font-mono text-[10px] text-slate-400">{r.docNo}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.fullName}</p>
                        <p className="text-[11px] text-slate-400">
                          {t("jenjang", "tier")} {r.chain.currentLevel}/{r.chain.totalLevels} · {r.chain.currentApprover ?? "—"}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-semibold tabular-nums">{r.candidateScore ?? "—"}</span>
                      {r.needL3 && <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">L3</Badge>}
                      <StatusPill status={r.chain.status === "InProgress" ? "Submitted" : r.chain.status} />
                      {canApprove && (
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="h-7 gap-1 border-emerald-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400"
                            onClick={() => { setDecide({ row: r, action: "approve" }); setNote(""); }}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> {t("Setujui", "Approve")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 gap-1 border-rose-300 px-2 text-[11px] text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-400"
                            onClick={() => { setDecide({ row: r, action: "reject" }); setNote(""); }}>
                            <XCircle className="h-3.5 w-3.5" /> {t("Tolak", "Reject")}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* C — final */}
            {api.data.finalized.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t("Final ({n})", "Finalized ({n})", { n: String(api.data.finalized.length) })}</h3>
                <div className="space-y-1">
                  {api.data.finalized.map((r) => (
                    <div key={r.appraisalId} className="flex flex-wrap items-center gap-x-3 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-1.5 text-xs dark:border-emerald-500/30 dark:bg-emerald-500/5">
                      <span className="font-mono text-[10px] text-slate-400">{r.docNo}</span>
                      <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                      <span className="font-mono font-semibold tabular-nums">{r.finalScore ?? "—"}</span>
                      {r.finalRating != null && <Badge variant="outline" className="h-5 px-1.5 text-[10px]" style={{ color: RATING_COLORS[r.finalRating] }}>rating {r.finalRating}</Badge>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

      {/* dialog keputusan approval */}
      <Dialog open={decide != null} onOpenChange={(o) => { if (!o) setDecide(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={cn("flex items-center gap-2", decide?.action === "reject" && "text-rose-600 dark:text-rose-400")}>
              {decide?.action === "approve" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden /> : <XCircle className="h-5 w-5 text-rose-500" aria-hidden />}
              {decide?.action === "approve"
                ? t("Setujui finalisasi {no}?", "Approve finalization {no}?", { no: decide.row.docNo })
                : t("Tolak finalisasi {no}?", "Reject finalization {no}?", { no: decide?.row.docNo ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {decide && (
                t(
                  `${decide.row.fullName} · skor kandidat ${decide.row.candidateScore ?? "—"} (rating ${decide.row.candidateRating ?? "—"}) · jenjang ${decide.row.chain.currentLevel}/${decide.row.chain.totalLevels}. Approved → finalScore/finalRating RESMI (§30-5). Reject → kembali ManagerDone.`,
                  `${decide.row.fullName} · candidate score ${decide.row.candidateScore ?? "—"} (rating ${decide.row.candidateRating ?? "—"}) · tier ${decide.row.chain.currentLevel}/${decide.row.chain.totalLevels}. Approved → finalScore/finalRating OFFICIAL (§30-5). Reject → back to ManagerDone.`,
                )
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{decide?.action === "reject" ? t("Alasan penolakan *", "Rejection reason *") : t("Catatan (opsional)", "Note (optional)")}</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={decide?.action === "reject" ? t("Jelaskan mengapa finalisasi ditolak…", "Explain why the finalization is rejected…") : t("Catatan untuk jejak audit…", "Note for the audit trail…")}
              aria-label={t("Catatan keputusan", "Decision note")} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecide(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitDecide} disabled={busy}
              className={decide?.action === "reject" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : decide?.action === "approve" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {decide?.action === "approve" ? t("Setujui", "Approve") : t("Tolak", "Reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
