"use client";
// P4-PERF — Kalibrasi & Finalisasi (§30 alur 6–7; §18.10 bell curve AMANDEMEN 2):
// dashboard distribusi + histogram + overlay kurva normal + z-flag pelis/royal D19
// + central tendency; sesi kalibrasi & keputusan ter-audit; finalisasi berjenjang
// (approval PerformanceAppraisal AS-PERF-STD); publikasi/penutupan + banding D6.
// Kurva = lensa bukan palu (D2 forced-distribution OFF) — tooltip edukatif.
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { BellRing, CalendarPlus, Gavel, Megaphone, Send, CheckCircle2, XCircle, Scale, LineChart, Info } from "lucide-react";

const CYCLES_API = "/api/rekankerja/performance/cycles";
const CALIB_API = "/api/rekankerja/performance/calibration";

interface Bin { from: number; to: number; count: number; participants: { appraisalId: string; docNo: string; name: string; unit: string | null; managerName: string | null; score: number; rating: number | null }[] }
interface ManagerZ { managerId: string | null; managerName: string; teamSize: number; teamMean: number; teamSigma: number; z: number | null; flag: string; flagLabelId: string; flagLabelEn: string }
interface DashboardData {
  metric: "manager" | "final";
  cycle: { id: string; code: string; status: string };
  n: number; mean: number | null; sigma: number | null;
  bins: Bin[]; curve: { x: number; y: number }[];
  managers: ManagerZ[];
  byUnit: { unit: string; counts: number[]; mean: number | null }[];
}
interface SessionRow {
  id: string; heldAt: string; orgUnitId: string | null; chairName: string | null; notes: string | null; decisionCount: number;
  decisions: { id: string; appraisalId: string; docNo: string; oldScore: number | null; newScore: number | null; oldRating: number | null; newRating: number | null; potentialBand: number | null; reason: string; decidedBy: string; decidedAt: string }[];
}
interface FinRow {
  appraisalId: string; docNo: string; employeeName: string; employeeNo: string; managerName: string | null;
  status: string; managerScore: number | null; finalScore: number | null; finalRating: number | null; potentialBand: number | null;
  acknowledgedAt: string | null; appealStatus: string | null; appealNote: string | null;
  chain: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}

const RATING_COLORS = ["bg-rose-500", "bg-orange-400", "bg-amber-400", "bg-teal-500", "bg-emerald-500"];

export function PerformanceCalibrationPage() {
  const { t, lang } = useI18n();
  const [cycleId, setCycleId] = useState("");
  const [metric, setMetric] = useState<"manager" | "final">("manager");
  const cyclesApi = useApi<{ rows: { id: string; code: string; name: string; status: string }[] }>(`${CYCLES_API}?limit=100`);
  useEffect(() => {
    if (cycleId || !cyclesApi.data?.rows?.length) return;
    const active = cyclesApi.data.rows.find((r) => r.status === "Calibration")
      ?? cyclesApi.data.rows.find((r) => r.status === "Assessment")
      ?? cyclesApi.data.rows.find((r) => r.status === "Published")
      ?? cyclesApi.data.rows[0];
    if (active) setCycleId(active.id);
    // siklus sudah terpublikasi/tutup hanya punya finalScore → default metric final
    if (active && ["Published", "Closed"].includes(active.status)) setMetric("final");
  }, [cyclesApi.data, cycleId]);

  const [tab, setTab] = useState("curve");
  const dashApi = useApi<DashboardData>(cycleId ? `${CALIB_API}?cycleId=${cycleId}&metric=${metric}` : null, [cycleId, metric, tab]);
  const sessionsApi = useApi<{ sessions: SessionRow[] }>(cycleId && tab === "sessions" ? `${CALIB_API}?cycleId=${cycleId}&sessions=1` : null, [cycleId, tab]);
  const finApi = useApi<{ rows: FinRow[] }>(cycleId && (tab === "finalize" || tab === "publish") ? `${CALIB_API}?cycleId=${cycleId}&finalizations=1` : null, [cycleId, tab]);
  const [busyFlag, setBusyFlag] = useState(false);

  const [openBin, setOpenBin] = useState<Bin | null>(null);
  const [sessDialog, setSessDialog] = useState(false);
  const [sessForm, setSessForm] = useState({ heldAt: "", chairId: "", notes: "" });
  const [decideTarget, setDecideTarget] = useState<FinRow | null>(null);
  const [decideForm, setDecideForm] = useState({ newScore: "", newRating: "", potentialBand: "", reason: "", sessionId: "" });
  const [finalizeSel, setFinalizeSel] = useState<Set<string>>(new Set());
  const [appealTarget, setAppealTarget] = useState<FinRow | null>(null);
  const [appealForm, setAppealForm] = useState({ decision: "Rejected", newScore: "", reason: "" });

  const cycle = cyclesApi.data?.rows.find((r) => r.id === cycleId) ?? null;
  const d = dashApi.data;
  const canDecide = (r: FinRow) => r.chain?.status === "InProgress";

  const toggleSel = (id: string) => {
    const n = new Set(finalizeSel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setFinalizeSel(n);
  };

  const startFinalize = async (ids: string[]) => {
    if (ids.length === 0) { toast.error(t("Pilih peserta dulu", "Select participants first")); return; }
    setBusyFlag(true);
    try {
      const res = await apiSend<{ started: number; skipped: { docNo: string; reason: string }[] }>(CALIB_API, "POST", { action: "startFinalize", appraisalIds: ids });
      toast.success(t("{n} finalisasi diajukan ke persetujuan", "{n} finalizations submitted for approval", { n: String(res.started) }));
      if (res.skipped.length > 0) toast.info(res.skipped.map((s) => `${s.docNo}: ${s.reason}`).join(" · ").slice(0, 220));
      finApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  const decideChain = async (row: FinRow, decision: "approve" | "reject") => {
    const note = decision === "reject" ? window.prompt(t("Alasan penolakan (opsional):", "Rejection reason (optional):")) ?? "" : "";
    setBusyFlag(true);
    try {
      const res = await apiSend<{ final: boolean; status: string }>(CALIB_API, "POST", { action: "decideFinalize", appraisalId: row.appraisalId, decision, note });
      toast.success(res.final
        ? t("Finalisasi disetujui penuh — Finalized", "Fully approved — Finalized")
        : t("Jenjang disetujui — menunggu jenjang berikutnya", "Level approved — awaiting next level"));
      finApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  const doPublish = async (force: boolean) => {
    if (force && !window.confirm(t("Paksa publikasi meski ada peserta belum Finalized? (ter-ActivityLog)", "Force publish even with non-finalized participants? (logged)"))) return;
    if (!force && !window.confirm(t("Publikasikan hasil ke semua peserta? Jendela banding 7 hari dibuka.", "Publish results to all participants? 7-day appeal window opens."))) return;
    setBusyFlag(true);
    try {
      const res = await apiSend<{ published: number; forced: number }>(CALIB_API, "POST", { action: "publish", cycleId, force });
      toast.success(t("{n} hasil dipublikasikan", "{n} results published", { n: String(res.published) }));
      finApi.refresh();
      cyclesApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  const doClose = async () => {
    if (!window.confirm(t("Tutup siklus hasil? Semua menjadi read-only permanen.", "Close results cycle? Everything becomes permanently read-only."))) return;
    setBusyFlag(true);
    try {
      const res = await apiSend<{ closed: number }>(CALIB_API, "POST", { action: "close", cycleId });
      toast.success(t("Siklus hasil ditutup ({n} peserta)", "Results cycle closed ({n} participants)", { n: String(res.closed) }));
      finApi.refresh();
      cyclesApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  const submitDecision = async () => {
    if (!decideTarget) return;
    setBusyFlag(true);
    try {
      await apiSend(CALIB_API, "POST", {
        action: "recordDecision",
        sessionId: decideForm.sessionId,
        appraisalId: decideTarget.appraisalId,
        newScore: decideForm.newScore || undefined,
        newRating: decideForm.newRating || undefined,
        potentialBand: decideForm.potentialBand || undefined,
        reason: decideForm.reason,
      });
      toast.success(t("Keputusan kalibrasi tercatat (ter-audit)", "Calibration decision recorded (audited)"));
      setDecideTarget(null);
      finApi.refresh(); sessionsApi.refresh(); dashApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  const submitAppealDecision = async () => {
    if (!appealTarget) return;
    setBusyFlag(true);
    try {
      await apiSend(CALIB_API, "POST", {
        action: "decideAppeal", appraisalId: appealTarget.appraisalId,
        decision: appealForm.decision,
        newScore: appealForm.decision === "Adjusted" ? appealForm.newScore : undefined,
        reason: appealForm.reason,
      });
      toast.success(t("Keputusan banding tercatat", "Appeal decision recorded"));
      setAppealTarget(null);
      finApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  const createSession = async () => {
    setBusyFlag(true);
    try {
      await apiSend(CALIB_API, "POST", { action: "createSession", cycleId, heldAt: sessForm.heldAt, chairId: sessForm.chairId || undefined, notes: sessForm.notes || undefined, participantIds: [] });
      toast.success(t("Sesi kalibrasi dijadwalkan", "Calibration session scheduled"));
      setSessDialog(false);
      sessionsApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  // ---- SVG bell curve (histogram + overlay normal) ----
  const chart = useMemo(() => {
    if (!d || d.bins.length === 0) return null;
    const W = 720, H = 240, PAD = 34;
    const maxCount = Math.max(...d.bins.map((b) => b.count), ...(d.curve.length ? [Math.max(...d.curve.map((p) => p.y))] : []), 1);
    const x0 = d.bins[0].from, x1 = d.bins[d.bins.length - 1].to;
    const sx = (v: number) => PAD + ((v - x0) / (x1 - x0)) * (W - 2 * PAD);
    const sy = (v: number) => H - PAD - (v / maxCount) * (H - 2 * PAD);
    const bars = d.bins.map((b) => ({ x: sx(b.from), w: Math.max(2, sx(b.to) - sx(b.from) - 2), y: sy(b.count), h: H - PAD - sy(b.count), bin: b }));
    const path = d.curve.length ? "M" + d.curve.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" L") : "";
    const xTicks = Array.from({ length: Math.ceil((x1 - x0) / 10) + 1 }, (_, i) => x0 + i * 10).filter((v) => v <= x1);
    return { W, H, PAD, bars, path, xTicks, sx, sy, maxCount };
  }, [d]);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Performance · Kalibrasi")}
        title={t("Kalibrasi & Finalisasi", "Calibration & Finalization")}
        description={t(
          "Kurva nilai (bell curve) = lensa kewajaran antar atasan — BUKAN kuota paksa (D2 OFF). Setiap penyesuaian nilai lewat keputusan kalibrasi ter-audit (dari → ke + alasan wajib). Finalisasi berjenjang: L1 atasan → L2 HR → L3 Direktur (rating ekstrem).",
          "The bell curve is a fairness lens across managers — NOT a forced quota (D2 OFF). Every score adjustment goes through audited calibration decisions (from → to + mandatory reason). Tiered finalization: L1 manager → L2 HR → L3 Director (extreme ratings).",
        )}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Select value={cycleId} onValueChange={setCycleId}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(cyclesApi.data?.rows ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.code} · {c.status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="curve"><LineChart className="mr-1 h-3.5 w-3.5" aria-hidden />{t("Kurva Nilai", "Bell Curve")}</TabsTrigger>
          <TabsTrigger value="sessions"><Gavel className="mr-1 h-3.5 w-3.5" aria-hidden />{t("Sesi & Keputusan", "Sessions & Decisions")}</TabsTrigger>
          <TabsTrigger value="finalize"><Scale className="mr-1 h-3.5 w-3.5" aria-hidden />{t("Finalisasi", "Finalization")}</TabsTrigger>
          <TabsTrigger value="publish"><Megaphone className="mr-1 h-3.5 w-3.5" aria-hidden />{t("Publikasi & Banding", "Publish & Appeals")}</TabsTrigger>
        </TabsList>

        {/* ============ TAB KURVA (§18.10) ============ */}
        <TabsContent value="curve" className="space-y-4">
          {dashApi.loading && !d ? <LoadingRows /> : !d || d.n === 0 ? (
            <Card><CardContent className="p-6"><EmptyState icon={LineChart} title={t("Belum ada skor penilaian", "No appraisal scores yet")} description={t("Kurva muncul setelah atasan men-submit penilaian (fase Assessment).", "The curve appears once managers submit appraisals (Assessment phase).")} /></CardContent></Card>
          ) : (
            <>
              <Card>
                <CardContent className="p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{t("Sebaran skor + kurva normal", "Score distribution + normal curve")}</h3>
                      <p className="text-xs text-slate-500">
                        n={d.n} · μ={d.mean ?? "—"} · σ={d.sigma ?? "—"} ·{" "}
                        <span className="inline-flex items-center gap-1"><Info className="h-3 w-3" aria-hidden />{t("bin 5 poin; kurva N(μ,σ) dari data", "5-pt bins; N(μ,σ) curve from data")}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {(["manager", "final"] as const).map((m) => (
                        <Button key={m} size="sm" variant={metric === m ? "default" : "outline"} onClick={() => setMetric(m)}>
                          {m === "manager" ? t("Sebelum kalibrasi", "Before calibration") : t("Sesudah kalibrasi", "After calibration")}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <svg viewBox={`0 0 ${chart?.W ?? 0} ${chart?.H ?? 0}`} className="h-56 w-full min-w-[560px]" role="img" aria-label={t("Histogram skor dengan overlay kurva normal", "Score histogram with normal curve overlay")}>
                      {chart?.bars.map((b, i) => (
                        <g key={i} className="cursor-pointer" onClick={() => setOpenBin(b.bin)}>
                          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="2" className={cn("fill-teal-500/70 hover:fill-teal-400", b.bin.count === 0 && "fill-slate-300/40 dark:fill-slate-700/40")} />
                          {b.bin.count > 0 && <text x={b.x + b.w / 2} y={b.y - 3} textAnchor="middle" className="fill-current text-[9px] font-bold text-slate-500 dark:text-slate-400">{b.bin.count}</text>}
                        </g>
                      ))}
                      {chart?.path && <path d={chart.path} fill="none" className="stroke-violet-500" strokeWidth="2" strokeDasharray="5 3" />}
                      {chart?.xTicks.map((v) => (
                        <text key={v} x={chart.sx(v)} y={chart.H - chart.PAD + 13} textAnchor="middle" className="fill-current text-[9px] text-slate-400">{v}</text>
                      ))}
                      {d.mean != null && chart && (
                        <line x1={chart.sx(d.mean)} y1={chart.PAD - 8} x2={chart.sx(d.mean)} y2={chart.H - chart.PAD} className="stroke-amber-500" strokeWidth="1.5" />
                      )}
                    </svg>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">{t("Klik batang untuk melihat peserta di bin. Garis kuning = rata-rata perusahaan.", "Click a bar to see participants in the bin. Yellow line = company mean.")}</p>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardContent className="p-4">
                    <h3 className="mb-1 font-semibold">{t("Kewajaran atasan (z-score — D19)", "Manager fairness (z-score — D19)")}</h3>
                    <p className="mb-3 text-xs text-slate-500">{t("z = (rata tim − rata perusahaan) ÷ σ. Lensa diskusi forum — bukan alat hukuman.", "z = (team mean − company mean) ÷ σ. A forum discussion lens — not a punishment tool.")}</p>
                    {d.managers.length === 0 ? <p className="text-sm text-slate-500">{t("Belum cukup data (atasan perlu ≥2 bawahan dinilai).", "Not enough data yet (managers need ≥2 appraised reports).")}</p> : (
                      <div className="max-h-72 overflow-y-auto">
                        <Table>
                          <TableHeader><TableRow>
                            <TableHead>{t("Atasan", "Manager")}</TableHead>
                            <TableHead className="text-right">n</TableHead>
                            <TableHead className="text-right">{t("Rata tim", "Team mean")}</TableHead>
                            <TableHead className="text-right">z</TableHead>
                            <TableHead>{t("Bendera", "Flag")}</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>
                            {d.managers.map((m) => (
                              <TableRow key={m.managerId ?? m.managerName}>
                                <TableCell className="font-medium">{m.managerName}</TableCell>
                                <TableCell className="text-right">{m.teamSize}</TableCell>
                                <TableCell className="text-right">{m.teamMean}</TableCell>
                                <TableCell className="text-right font-bold">{m.z ?? "—"}</TableCell>
                                <TableCell>
                                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold",
                                    m.flag === "red-pelis" || m.flag === "red-royal" ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                                    : m.flag === "amber-pelis" || m.flag === "amber-royal" || m.flag === "central" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300")}>
                                    {lang === "en" ? m.flagLabelEn : m.flagLabelId}
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

                <Card>
                  <CardContent className="p-4">
                    <h3 className="mb-1 font-semibold">{t("Distribusi rating per unit", "Rating distribution per unit")}</h3>
                    <p className="mb-3 text-xs text-slate-500">{t("Bahan diskusi forum kalibrasi (rating konversi skor bila belum final).", "Calibration forum material (score-converted ratings until final).")}</p>
                    <div className="space-y-2">
                      {d.byUnit.map((u) => (
                        <div key={u.unit}>
                          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
                            <span className="font-medium">{u.unit}</span>
                            <span className="text-slate-500">{t("rata", "mean")} {u.mean ?? "—"}</span>
                          </div>
                          <div className="flex h-3.5 w-full overflow-hidden rounded-full">
                            {u.counts.map((c, i) => c > 0 ? (
                              <div key={i} className={cn(RATING_COLORS[i])} style={{ width: `${(c / Math.max(1, u.counts.reduce((s, x) => s + x, 0))) * 100}%` }} title={`rating ${i + 1}: ${c}`} />
                            ) : null)}
                          </div>
                          <p className="mt-0.5 text-[10px] text-slate-400">{u.counts.map((c, i) => c > 0 ? `${i + 1}★:${c}` : null).filter(Boolean).join(" · ")}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* ============ TAB SESI & KEPUTUSAN ============ */}
        <TabsContent value="sessions" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setSessForm({ heldAt: new Date().toISOString().slice(0, 10), chairId: "", notes: "" }); setSessDialog(true); }} disabled={busyFlag}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> {t("Jadwal sesi", "Schedule session")}
            </Button>
          </div>
          {sessionsApi.loading && !sessionsApi.data ? <LoadingRows /> : (sessionsApi.data?.sessions ?? []).length === 0 ? (
            <Card><CardContent className="p-6"><EmptyState icon={Gavel} title={t("Belum ada sesi kalibrasi", "No calibration sessions yet")} description={t("Jadwalkan forum penyetaraan standar antar atasan (§30-2).", "Schedule a cross-manager standard-setting forum (§30-2).")} /></CardContent></Card>
          ) : (
            (sessionsApi.data?.sessions ?? []).map((s) => (
              <Card key={s.id}>
                <CardContent className="p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{new Date(s.heldAt).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID")}{s.chairName ? ` · ${t("ketua", "chair")}: ${s.chairName}` : ""}</p>
                      {s.notes && <p className="text-xs text-slate-500">{s.notes}</p>}
                    </div>
                    <Badge variant="secondary">{s.decisionCount} {t("keputusan", "decisions")}</Badge>
                  </div>
                  {s.decisions.length > 0 && (
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>{t("Dokumen", "Document")}</TableHead>
                          <TableHead>{t("Dari → Ke", "From → To")}</TableHead>
                          <TableHead>{t("Alasan", "Reason")}</TableHead>
                          <TableHead>{t("Oleh", "By")}</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {s.decisions.map((dec) => (
                            <TableRow key={dec.id}>
                              <TableCell className="font-mono text-xs">{dec.docNo}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs">
                                {dec.oldScore?.toFixed(1) ?? "—"} → <strong>{dec.newScore?.toFixed(1) ?? "—"}</strong>
                                {dec.newRating != null && <span className="ml-1 text-slate-400">(★{dec.newRating})</span>}
                                {dec.potentialBand != null && <span className="ml-1 text-violet-500">9-box {dec.potentialBand}</span>}
                              </TableCell>
                              <TableCell className="max-w-64 text-xs italic">“{dec.reason}”</TableCell>
                              <TableCell className="text-xs">{dec.decidedBy}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ============ TAB FINALISASI ============ */}
        <TabsContent value="finalize" className="space-y-4">
          {finApi.loading && !finApi.data ? <LoadingRows /> : !cycle || !["Calibration"].includes(cycle.status) ? (
            <Card><CardContent className="p-6"><EmptyState icon={Scale} title={t("Finalisasi hanya saat fase Calibration", "Finalization requires Calibration phase")} description={t(`Fase siklus saat ini: ${cycle?.status ?? "—"}. Naikkan fase lewat detail Siklus Penilaian (ter-ActivityLog).`, `Current cycle phase: ${cycle?.status ?? "—"}. Advance the phase via the Cycle detail (logged).`)} /></CardContent></Card>
          ) : (finApi.data?.rows ?? []).length === 0 ? (
            <Card><CardContent className="p-6"><EmptyState icon={Scale} title={t("Belum ada peserta selesai dinilai", "No completed appraisals yet")} /></CardContent></Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">{t("Rating ekstrem (≤2 / =5) otomatis menambah jenjang L3 Direktur (§11.1).", "Extreme ratings (≤2 / =5) automatically add the L3 Director level (§11.1).")}</p>
                <Button size="sm" disabled={busyFlag || finalizeSel.size === 0} onClick={() => startFinalize(Array.from(finalizeSel))}>
                  <Send className="h-4 w-4" aria-hidden /> {t("Ajukan finalisasi ({n})", "Submit finalization ({n})", { n: String(finalizeSel.size) })}
                </Button>
              </div>
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>{t("Dokumen", "Document")}</TableHead>
                        <TableHead>{t("Karyawan", "Employee")}</TableHead>
                        <TableHead className="text-right">{t("Skor atasan", "Manager score")}</TableHead>
                        <TableHead className="text-right">{t("Skor final", "Final score")}</TableHead>
                        <TableHead>★</TableHead>
                        <TableHead>9-box</TableHead>
                        <TableHead>{t("Status", "Status")}</TableHead>
                        <TableHead>{t("Persetujuan", "Approval")}</TableHead>
                        <TableHead className="w-40"></TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {(finApi.data?.rows ?? []).map((r) => (
                          <TableRow key={r.appraisalId} className={cn(finalizeSel.has(r.appraisalId) && "bg-fuchsia-50/50 dark:bg-fuchsia-950/20")}>
                            <TableCell>
                              <input type="checkbox" className="h-4 w-4 accent-fuchsia-600" checked={finalizeSel.has(r.appraisalId)}
                                disabled={!["ManagerDone", "Calibrating"].includes(r.status) || r.chain?.status === "InProgress"}
                                onChange={() => toggleSel(r.appraisalId)} aria-label={t("pilih", "select")} />
                            </TableCell>
                            <TableCell className="font-mono text-xs">{r.docNo}</TableCell>
                            <TableCell>
                              <p className="text-sm font-medium">{r.employeeName}</p>
                              <p className="text-xs text-slate-500">{r.employeeNo}{r.managerName ? ` · ${r.managerName}` : ""}</p>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{r.managerScore?.toFixed(1) ?? "—"}</TableCell>
                            <TableCell className="text-right font-bold tabular-nums">{r.finalScore?.toFixed(1) ?? "—"}</TableCell>
                            <TableCell>{r.finalRating ?? "—"}</TableCell>
                            <TableCell>{r.potentialBand ?? "—"}</TableCell>
                            <TableCell><StatusPill status={r.status} /></TableCell>
                            <TableCell className="text-xs">
                              {r.chain ? (
                                <span className={cn(r.chain.status === "Approved" && "text-emerald-600 dark:text-emerald-400", r.chain.status === "InProgress" && "text-amber-600 dark:text-amber-400", r.chain.status === "Rejected" && "text-rose-600 dark:text-rose-400")}>
                                  {r.chain.status === "InProgress"
                                    ? `${r.chain.currentLevel}/${r.chain.totalLevels} · ${r.chain.currentApprover ?? ""}`
                                    : t(r.chain.status, r.chain.status)}
                                </span>
                              ) : <span className="text-slate-400">—</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {["ManagerDone", "Calibrating"].includes(r.status) && (
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => {
                                    setDecideTarget(r);
                                    setDecideForm({ newScore: r.finalScore?.toFixed(1) ?? r.managerScore?.toFixed(1) ?? "", newRating: r.finalRating != null ? String(r.finalRating) : "", potentialBand: r.potentialBand != null ? String(r.potentialBand) : "", reason: "", sessionId: (sessionsApi.data?.sessions ?? [])[0]?.id ?? "" });
                                    if (!(sessionsApi.data?.sessions ?? []).length) toast.info(t("Buat sesi kalibrasi dulu di tab Sesi (keputusan wajib ter-jejak sesi).", "Create a calibration session first (decisions must be tied to a session)."));
                                  }}>{t("Kalibrasi", "Calibrate")}</Button>
                                )}
                                {canDecide(r) && (
                                  <>
                                    <Button size="sm" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => decideChain(r, "approve")}><CheckCircle2 className="h-3 w-3" aria-hidden /></Button>
                                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => decideChain(r, "reject")}><XCircle className="h-3 w-3" aria-hidden /></Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ============ TAB PUBLIKASI & BANDING ============ */}
        <TabsContent value="publish" className="space-y-4">
          {!cycle ? <LoadingRows /> : (
            <>
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{cycle.code} — <StatusPill status={cycle.status} /></h3>
                      <p className="text-xs text-slate-500">
                        {cycle.status === "Calibration" && t("Publikasikan setelah semua peserta Finalized (atau paksa — ter-ActivityLog). Jendela banding 7 hari (D6).", "Publish after all participants are Finalized (or force — logged). 7-day appeal window (D6).")}
                        {cycle.status === "Published" && t("Hasil terpublikasi. Tutup setelah semua banding selesai.", "Results published. Close after all appeals are resolved.")}
                        {["Finalized", "Closed"].includes(cycle.status) && t("Siklus hasil sudah ditutup — read-only permanen.", "Results cycle closed — permanently read-only.")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {cycle.status === "Calibration" && (
                        <>
                          <Button size="sm" disabled={busyFlag} onClick={() => doPublish(false)}><Megaphone className="h-4 w-4" aria-hidden /> {t("Publikasikan", "Publish")}</Button>
                          <Button size="sm" variant="outline" disabled={busyFlag} onClick={() => doPublish(true)}>{t("Paksa", "Force")}</Button>
                        </>
                      )}
                      {cycle.status === "Published" && (
                        <Button size="sm" variant="outline" disabled={busyFlag} onClick={doClose}>{t("Tutup siklus hasil", "Close results cycle")}</Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {(finApi.data?.rows ?? []).filter((r) => r.appealStatus).length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <h3 className="mb-2 font-semibold"><BellRing className="mr-1 inline h-4 w-4 text-amber-500" aria-hidden />{t("Banding (jendela D6)", "Appeals (window D6)")}</h3>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>{t("Dokumen", "Document")}</TableHead>
                          <TableHead>{t("Karyawan", "Employee")}</TableHead>
                          <TableHead>{t("Alasan banding", "Appeal reason")}</TableHead>
                          <TableHead>{t("Status", "Status")}</TableHead>
                          <TableHead className="w-32"></TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {(finApi.data?.rows ?? []).filter((r) => r.appealStatus).map((r) => (
                            <TableRow key={r.appraisalId}>
                              <TableCell className="font-mono text-xs">{r.docNo}</TableCell>
                              <TableCell className="text-sm">{r.employeeName}</TableCell>
                              <TableCell className="max-w-72 text-xs italic">“{r.appealNote}”</TableCell>
                              <TableCell><Badge variant={r.appealStatus === "Submitted" ? "destructive" : "secondary"}>{r.appealStatus}</Badge></TableCell>
                              <TableCell>
                                {r.appealStatus === "Submitted" && (
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setAppealTarget(r); setAppealForm({ decision: "Rejected", newScore: "", reason: "" }); }}>
                                    {t("Putuskan", "Decide")}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-2 font-semibold">{t("Ringkasan peserta", "Participant summary")}</h3>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{t("Dokumen", "Document")}</TableHead>
                        <TableHead>{t("Karyawan", "Employee")}</TableHead>
                        <TableHead className="text-right">{t("Skor final", "Final score")}</TableHead>
                        <TableHead>★</TableHead>
                        <TableHead>{t("Status", "Status")}</TableHead>
                        <TableHead>{t("Acknowledge", "Acknowledged")}</TableHead>
                        <TableHead>{t("Banding", "Appeal")}</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {(finApi.data?.rows ?? []).map((r) => (
                          <TableRow key={r.appraisalId}>
                            <TableCell className="font-mono text-xs">{r.docNo}</TableCell>
                            <TableCell className="text-sm">{r.employeeName}</TableCell>
                            <TableCell className="text-right font-bold tabular-nums">{r.finalScore?.toFixed(1) ?? "—"}</TableCell>
                            <TableCell>{r.finalRating ?? "—"}</TableCell>
                            <TableCell><StatusPill status={r.status} /></TableCell>
                            <TableCell className="text-xs">{r.acknowledgedAt ? new Date(r.acknowledgedAt).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID") : <span className="text-slate-400">—</span>}</TableCell>
                            <TableCell className="text-xs">{r.appealStatus ?? <span className="text-slate-400">—</span>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ---- dialog: bin peserta ---- */}
      <Dialog open={openBin !== null} onOpenChange={(o) => { if (!o) setOpenBin(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t("Peserta di bin {a}–{b}", "Participants in bin {a}–{b}", { a: String(openBin?.from ?? 0), b: String(openBin?.to ?? 0) })}</DialogTitle></DialogHeader>
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableBody>
                {(openBin?.participants ?? []).map((p) => (
                  <TableRow key={p.appraisalId}>
                    <TableCell>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-slate-500">{p.docNo} · {p.unit ?? "—"} · {p.managerName ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{p.score}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: sesi baru ---- */}
      <Dialog open={sessDialog} onOpenChange={setSessDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("Jadwal sesi kalibrasi", "Schedule calibration session")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="sess-held">{t("Tanggal sesi", "Session date")}</Label>
              <Input id="sess-held" type="date" value={sessForm.heldAt} onChange={(e) => setSessForm({ ...sessForm, heldAt: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sess-notes">{t("Catatan forum (opsional)", "Forum notes (optional)")}</Label>
              <Textarea id="sess-notes" rows={2} value={sessForm.notes} onChange={(e) => setSessForm({ ...sessForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSessDialog(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={createSession} disabled={busyFlag || !sessForm.heldAt}>{t("Jadwalkan", "Schedule")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: keputusan kalibrasi ---- */}
      <Dialog open={decideTarget !== null} onOpenChange={(o) => { if (!o) setDecideTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t("Keputusan kalibrasi — {d}", "Calibration decision — {d}", { d: decideTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              {t("Skor saat ini", "Current score")}: <strong>{decideTarget?.finalScore?.toFixed(1) ?? decideTarget?.managerScore?.toFixed(1) ?? "—"}</strong>
              {decideTarget?.finalRating != null ? ` (★${decideTarget.finalRating})` : ""}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="cd-score">{t("Skor baru", "New score")}</Label>
                <Input id="cd-score" inputMode="decimal" value={decideForm.newScore} onChange={(e) => setDecideForm({ ...decideForm, newScore: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cd-rating">★ {t("baru", "new")}</Label>
                <Select value={decideForm.newRating} onValueChange={(v) => setDecideForm({ ...decideForm, newRating: v === "keep" ? "" : v })}>
                  <SelectTrigger id="cd-rating" className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">{t("— otomatis —", "— auto —")}</SelectItem>
                    {[1, 2, 3, 4, 5].map((v) => <SelectItem key={v} value={String(v)}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cd-band">9-box</Label>
                <Select value={decideForm.potentialBand} onValueChange={(v) => setDecideForm({ ...decideForm, potentialBand: v === "keep" ? "" : v })}>
                  <SelectTrigger id="cd-band" className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">—</SelectItem>
                    {[1, 2, 3].map((v) => <SelectItem key={v} value={String(v)}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{t("Sesi (ter-jejak)", "Session (audited)")}</Label>
              <Select value={decideForm.sessionId} onValueChange={(v) => setDecideForm({ ...decideForm, sessionId: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(sessionsApi.data?.sessions ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{new Date(s.heldAt).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID")}{s.chairName ? ` · ${s.chairName}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cd-reason">{t("Alasan (WAJIB ≥10 karakter — ter-audit §30-3)", "Reason (MANDATORY ≥10 chars — audited §30-3)")}</Label>
              <Textarea id="cd-reason" rows={3} value={decideForm.reason} onChange={(e) => setDecideForm({ ...decideForm, reason: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecideTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitDecision} disabled={busyFlag || decideForm.reason.trim().length < 10 || !decideForm.sessionId}>{t("Catat keputusan", "Record decision")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: putusan banding ---- */}
      <Dialog open={appealTarget !== null} onOpenChange={(o) => { if (!o) setAppealTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t("Putusan banding — {d}", "Appeal decision — {d}", { d: appealTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="rounded-lg bg-slate-50 p-2 text-xs italic text-slate-600 dark:bg-slate-900 dark:text-slate-300">“{appealTarget?.appealNote}”</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t("Keputusan", "Decision")}</Label>
                <Select value={appealForm.decision} onValueChange={(v) => setAppealForm({ ...appealForm, decision: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Rejected">{t("Tolak banding", "Reject appeal")}</SelectItem>
                    <SelectItem value="Adjusted">{t("Setuju — sesuaikan skor", "Accept — adjust score")}</SelectItem>
                    <SelectItem value="Withdrawn">{t("Tarik (atas permintaan)", "Withdraw (on request)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {appealForm.decision === "Adjusted" && (
                <div>
                  <Label htmlFor="ap-score">{t("Skor baru", "New score")}</Label>
                  <Input id="ap-score" inputMode="decimal" value={appealForm.newScore} onChange={(e) => setAppealForm({ ...appealForm, newScore: e.target.value })} />
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="ap-reason">{t("Alasan putusan (≥10 karakter — ter-audit)", "Decision reason (≥10 chars — audited)")}</Label>
              <Textarea id="ap-reason" rows={3} value={appealForm.reason} onChange={(e) => setAppealForm({ ...appealForm, reason: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppealTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitAppealDecision} disabled={busyFlag || appealForm.reason.trim().length < 10 || (appealForm.decision === "Adjusted" && !appealForm.newScore)}>{t("Putuskan", "Decide")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
