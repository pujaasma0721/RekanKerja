"use client";
// ============================================================================
// PERFORMANCE — Hasil & 9-Box (P4 — §31 Alur 7 + §18-6 + §11.3):
//   TAB HASIL — daftar peserta: skor diri/atasan/final + rating + 9-box band +
//     status acknowledgement + status banding; toolbar: PUBLISH (§35-12 — semua
//     Finalized atau force ter-log + notifikasi massal) + TUTUP HASIL
//     (§35-16 — read-only permanen) + info jendela banding D6.
//   TAB 9-BOX — matriks 3×3 performance × potential interaktif (klik sel →
//     daftar karyawan) — akses HR/Direksi saja (§11.3; karyawan & atasan
//     tidak melihat 9-box perusahaan).
//   Banding masuk dari ESS karyawan (Penilaian Saya); HR memutuskan di sini
//     (Rejected / Adjusted = CalibrationDecision baru §35-15).
// Dwibahasa t() semua; mobile 375 tanpa h-scroll (grid + kartu).
// ============================================================================
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ClipboardCheck, AlertTriangle, Loader2, Users, Grid3X3, Megaphone, Lock, CheckCircle2,
  MailCheck, Scale, Info, Search,
} from "lucide-react";

// ---------- tipe (kontrak API §17) ----------

interface CycleRow { id: string; code: string; name: string; status: string }
interface ResultRow {
  appraisalId: string; docNo: string; status: string;
  employeeNo: string; fullName: string; unitName: string | null; managerName: string | null;
  selfScore: number | null; managerScore: number | null; finalScore: number | null; finalRating: number | null;
  ratingLabel: string | null; ratingLabelEn: string | null; ratingColor: string | null;
  potentialBand: number | null; acknowledgedAt: string | null;
  appealStatus: string | null; appealNote: string | null; appealDecidedBy: string | null;
}
interface ResultsData {
  cycle: { code: string; status: string; publishAt: string | null };
  appealWindow: { days: number; deadline: string | null; open: boolean; daysLeft: number | null };
  stats: { total: number; scored: number; finalized: number; published: number; acknowledged: number; appealed: number };
  rows: ResultRow[];
}
interface NineBoxData {
  cycle: { code: string; status: string };
  grid: { perf: number; potential: number; count: number; rows: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string; unitName: string | null;
    finalRating: number; potentialBand: number;
  }[] }[];
  unplaced: { appraisalId: string; docNo: string; fullName: string; finalRating: number | null; potentialBand: number | null }[];
  totals: { placed: number; unplaced: number };
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
const RATING_COLORS: Record<number, string> = { 1: "#f43f5e", 2: "#f97316", 3: "#f59e0b", 4: "#14b8a6", 5: "#10b981" };
const PERF_LABELS: Record<number, { id: string; en: string }> = {
  1: { id: "Rendah (rating 1–2)", en: "Low (rating 1–2)" },
  2: { id: "Memenuhi (rating 3)", en: "Meets (rating 3)" },
  3: { id: "Tinggi (rating 4–5)", en: "High (rating 4–5)" },
};
const POT_LABELS: Record<number, { id: string; en: string }> = {
  3: { id: "Potensi tinggi", en: "High potential" },
  2: { id: "Potensi sedang", en: "Medium potential" },
  1: { id: "Potensi berkembang", en: "Growth potential" },
};

// ============================================================================
// HALAMAN
// ============================================================================

export function PerformanceResultsPage() {
  const { t } = useI18n();
  const cycles = useApi<{ rows: CycleRow[] }>("/api/rekankerja/performance/cycles");
  const [picked, setPicked] = useState("");
  const [tab, setTab] = useState("results");

  // default DERIVED (bukan setState-in-effect): Published > Calibration > teratas
  const rows = cycles.data?.rows ?? [];
  const cycle = rows.find((c) => c.id === picked)
    ?? rows.find((c) => c.status === "Published")
    ?? rows.find((c) => c.status === "Calibration")
    ?? rows[0] ?? null;
  const cycleId = cycle?.id ?? "";

  return (
    <div>
      <PageHeader
        eyebrow={t("PERFORMANCE · HASIL")}
        title={t("Hasil & 9-Box", "Results & 9-Box")}
        description={t(
          "Publikasi hasil ke karyawan (notifikasi massal + jendela acknowledgement & banding D6), matriks talenta 9-box, dan penutupan hasil siklus.",
          "Publish results to employees (mass notification + acknowledgement & appeal window D6), the 9-box talent matrix, and closing the cycle results.",
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
                  <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <StatusPill status={cycle.status} />
          </div>

          <Tabs value={tab} onValueChange={setTab} className="space-y-4">
            <TabsList className="h-auto w-full flex-wrap justify-start rounded-xl ov-tile p-1 sm:w-auto">
              <TabsTrigger value="results" className="h-9 gap-1.5 rounded-lg px-3 text-xs font-semibold data-[state=active]:ov-fill">
                <Users className="h-3.5 w-3.5" /> {t("Hasil", "Results")}
              </TabsTrigger>
              <TabsTrigger value="ninebox" className="h-9 gap-1.5 rounded-lg px-3 text-xs font-semibold data-[state=active]:ov-fill">
                <Grid3X3 className="h-3.5 w-3.5" /> {t("9-Box", "9-Box")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="results"><ResultsTab cycleId={cycleId} /></TabsContent>
            <TabsContent value="ninebox"><NineBoxTab cycleId={cycleId} /></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// ============================================================================
// TAB HASIL (§31-1, §35-12/15/16)
// ============================================================================

function ResultsTab({ cycleId }: { cycleId: string }) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const canPublish = perms.canOp("performance", "results", "publish");
  const canDecideAppeal = perms.canOp("performance", "results", "appeal");
  const canClose = perms.canOp("performance", "results", "close");
  const api = useApi<ResultsData>(`/api/rekankerja/performance/results?cycleId=${cycleId}`, [cycleId]);
  const [q, setQ] = useState("");
  const [publishing, setPublishing] = useState<null | "normal" | "force">(null);
  const [closing, setClosing] = useState(false);
  const [deciding, setDeciding] = useState<ResultRow | null>(null);

  const rows = (api.data?.rows ?? []).filter((r) =>
    !q || r.fullName.toLowerCase().includes(q.toLowerCase()) || r.docNo.toLowerCase().includes(q.toLowerCase()));

  const doPublish = async () => {
    if (!publishing) return;
    try {
      const res = await apiSend<{ code: string; notified: number }>("/api/rekankerja/performance/results", "POST", {
        action: "publish", cycleId, force: publishing === "force",
      });
      toast.success(t(
        `Hasil ${res.code} dipublikasikan — ${res.notified} notifikasi terkirim`,
        `${res.code} results published — ${res.notified} notifications sent`,
      ));
      setPublishing(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  };

  const doClose = async () => {
    try {
      const res = await apiSend<{ code: string }>("/api/rekankerja/performance/results", "POST", {
        action: "closeResults", cycleId,
      });
      toast.success(t(`Hasil ${res.code} ditutup (read-only permanen)`, `Results ${res.code} closed (permanently read-only)`));
      setClosing(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  };

  const cycleStatus = api.data?.cycle.status ?? "";

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-60">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="h-8 pl-8 text-xs" placeholder={t("Cari peserta…", "Search participant…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Cari peserta", "Search participant")} />
        </div>
        {api.data && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
            <Badge variant="outline">{t("final {n}/{m}", "final {n}/{m}", { n: String(api.data.stats.finalized), m: String(api.data.stats.total) })}</Badge>
            <Badge variant="outline"><MailCheck className="mr-1 h-3 w-3" />{t("ack {n}", "ack {n}", { n: String(api.data.stats.acknowledged) })}</Badge>
            <Badge variant="outline"><Scale className="mr-1 h-3 w-3" />{t("banding {n}", "appeals {n}", { n: String(api.data.stats.appealed) })}</Badge>
            {api.data.appealWindow.deadline && (
              <Badge variant="outline" className={api.data.appealWindow.open ? "text-emerald-600 dark:text-emerald-400" : ""}>
                {t("banding s.d.", "appeals until")} {fmtD(api.data.appealWindow.deadline)}
              </Badge>
            )}
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {canPublish && cycleStatus === "Calibration" && (
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setPublishing("normal")}>
              <Megaphone className="h-3.5 w-3.5" /> {t("Publikasikan", "Publish")}
            </Button>
          )}
          {canPublish && cycleStatus === "Calibration" && (api.data?.stats.total ?? 0) > (api.data?.stats.finalized ?? 0) && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-400" onClick={() => setPublishing("force")}>
              <AlertTriangle className="h-3.5 w-3.5" /> {t("Publikasikan (force)", "Publish (force)")}
            </Button>
          )}
          {canClose && cycleStatus === "Published" && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setClosing(true)}>
              <Lock className="h-3.5 w-3.5" /> {t("Tutup Hasil", "Close Results")}
            </Button>
          )}
        </div>
      </div>

      {api.loading && !api.data ? <LoadingRows rows={5} /> :
        api.error ? <EmptyState title={t("Gagal memuat hasil", "Failed to load results")} description={api.error} icon={AlertTriangle} /> :
        rows.length === 0 ? (
          <EmptyState icon={Users} title={t("Belum ada peserta", "No participants yet")}
            description={t("Enroll peserta ke siklus dahulu.", "Enroll participants into the cycle first.")} />
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <Card key={r.appraisalId} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
                <CardContent className="p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="font-mono text-[10px] text-slate-400">{r.docNo}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.fullName}</p>
                      <p className="truncate text-[11px] text-slate-400">{r.unitName ?? "—"} · {r.managerName ?? "—"}</p>
                    </div>
                    <StatusPill status={r.status} />
                    {r.finalRating != null && r.ratingLabel && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]" style={{ color: RATING_COLORS[r.finalRating] }}>
                        {r.finalRating} · {r.ratingLabel}
                      </Badge>
                    )}
                    {r.potentialBand != null && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-violet-600 dark:text-violet-300">
                        9-box {r.potentialBand}
                      </Badge>
                    )}
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold tabular-nums">{r.finalScore ?? "—"}</p>
                      <p className="text-[10px] text-slate-400">{t("final", "final")}</p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{t("diri", "self")} {r.selfScore ?? "—"} · {t("atasan", "manager")} {r.managerScore ?? "—"}</span>
                    {r.acknowledgedAt ? (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> {t("acknowledge {d}", "acknowledged {d}", { d: fmtD(r.acknowledgedAt) })}
                      </span>
                    ) : ["Published", "Appealed"].includes(r.status) ? (
                      <span className="text-amber-600 dark:text-amber-400">{t("belum acknowledge", "not acknowledged")}</span>
                    ) : null}
                    {r.appealStatus && (
                      <span className="flex items-center gap-1">
                        <Scale className="h-3 w-3" />
                        {t("banding:", "appeal:")}
                        <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]",
                          r.appealStatus === "Submitted" && "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400",
                          r.appealStatus === "Adjusted" && "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300",
                          r.appealStatus === "Rejected" && "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400",
                          r.appealStatus === "Withdrawn" && "border-slate-300 text-slate-500 dark:border-slate-700")}>
                          {r.appealStatus}
                        </Badge>
                        {r.appealStatus === "Adjusted" && r.appealDecidedBy ? ` (${r.appealDecidedBy})` : ""}
                      </span>
                    )}
                    {r.appealStatus === "Submitted" && canDecideAppeal && (
                      <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-[11px]" onClick={() => setDeciding(r)}>
                        <Scale className="h-3.5 w-3.5" /> {t("Putuskan Banding", "Decide Appeal")}
                      </Button>
                    )}
                  </div>
                  {r.appealStatus === "Submitted" && r.appealNote && (
                    <p className="mt-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] italic text-slate-500 dark:bg-slate-900/60 dark:text-slate-400" title={r.appealNote}>
                      “{r.appealNote.length > 160 ? r.appealNote.slice(0, 160) + "…" : r.appealNote}”
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      {/* dialog publish */}
      <Dialog open={publishing != null} onOpenChange={(o) => { if (!o) setPublishing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{publishing === "force" ? t("Publikasikan dengan FORCE?", "Publish with FORCE?") : t("Publikasikan Hasil?", "Publish Results?")}</DialogTitle>
            <DialogDescription>
              {publishing === "force"
                ? t(
                  "Masih ada peserta yang belum final. FORCE menerbitkan apa adanya (peserta ManagerDone ikut) dan TER-LOG — gunakan hanya bila kalibrasi memang dinyatakan selesai.",
                  "Some participants are not final yet. FORCE publishes as-is (ManagerDone participants included) and IS LOGGED — use only when calibration is declared done.",
                )
                : t(
                  "Semua peserta Finalized akan diterbitkan ke ESS karyawan (notifikasi massal + deep-link Penilaian Saya). Jendela banding D6 dimulai hari ini.",
                  "All Finalized participants are released to the employees' ESS (mass notification + deep-link to My Appraisal). The D6 appeal window starts today.",
                )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishing(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doPublish} className={publishing === "force" ? "bg-amber-600 hover:bg-amber-700" : ""}>
              <Megaphone className="h-4 w-4" /> {t("Publikasikan", "Publish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog close */}
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Tutup Hasil Siklus?", "Close Cycle Results?")}</DialogTitle>
            <DialogDescription>
              {t(
                "Semua banding harus sudah diputuskan (§35-16). Setelah ditutup, hasil bersifat read-only permanen (arsip sesuai retensi).",
                "All appeals must have been decided (§35-16). Once closed, results are permanently read-only (archived per retention).",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doClose} variant="destructive"><Lock className="h-4 w-4" /> {t("Tutup Permanen", "Close Permanently")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deciding && <DecideAppealDialog row={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); api.refresh(); }} />}
    </div>
  );
}

function DecideAppealDialog({ row, onClose, onDone }: { row: ResultRow; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [decision, setDecision] = useState<"Rejected" | "Adjusted">("Rejected");
  const [note, setNote] = useState("");
  const [newScore, setNewScore] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!note.trim()) { toast.error(t("Catatan keputusan WAJIB diisi (§35-15)", "A decision note is REQUIRED (§35-15)")); return; }
    if (decision === "Adjusted" && !newScore) { toast.error(t("Skor baru wajib diisi utk penyesuaian", "A new score is required for an adjustment")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/results", "POST", {
        action: "decideAppeal", appraisalId: row.appraisalId, decision,
        note: note.trim(), newScore: decision === "Adjusted" ? Number(newScore) : undefined,
      });
      toast.success(t("Keputusan banding tercatat", "Appeal decision recorded"));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-amber-500" /> {t("Putuskan Banding {no}", "Decide Appeal {no}", { no: row.docNo })}</DialogTitle>
          <DialogDescription>
            {t(
              `${row.fullName} · skor final saat ini ${row.finalScore ?? "—"} (rating ${row.finalRating ?? "—"}). Adjusted = CalibrationDecision baru (alasan wajib) + skor baru.`,
              `${row.fullName} · current final score ${row.finalScore ?? "—"} (rating ${row.finalRating ?? "—"}). Adjusted = a new CalibrationDecision (reason required) + a new score.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-xs italic text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            “{row.appealNote ?? "—"}”
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("Keputusan", "Decision")}</Label>
              <Select value={decision} onValueChange={(v) => setDecision(v === "Adjusted" ? "Adjusted" : "Rejected")}>
                <SelectTrigger className="text-xs" aria-label={t("Keputusan banding", "Appeal decision")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Rejected">{t("Ditolak (Rejected)", "Rejected")}</SelectItem>
                  <SelectItem value="Adjusted">{t("Disesuaikan (Adjusted)", "Adjusted")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {decision === "Adjusted" && (
              <div className="space-y-1">
                <Label className="text-xs">{t("Skor final baru *", "New final score *")}</Label>
                <Input type="number" inputMode="decimal" value={newScore} onChange={(e) => setNewScore(e.target.value)} placeholder="0–120" aria-label={t("Skor final baru", "New final score")} />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Catatan keputusan *", "Decision note *")}</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t("Dasar keputusan (ter-audit; tanpa catatan → ditolak §35-15)…", "Basis of the decision (audited; without a note → rejected §35-15)…")}
              aria-label={t("Catatan keputusan", "Decision note")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />} {t("Putuskan", "Decide")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB 9-BOX (§18-6 — interaktif; akses HR/Direksi §11.3)
// ============================================================================

function NineBoxTab({ cycleId }: { cycleId: string }) {
  const { t, locale } = useI18n();
  const api = useApi<NineBoxData>(`/api/rekankerja/performance/results?ninebox=1&cycleId=${cycleId}`, [cycleId]);
  const [cell, setCell] = useState<{ perf: number; potential: number } | null>(null);

  const cellOf = (perf: number, potential: number) =>
    api.data?.grid.find((g) => g.perf === perf && g.potential === potential) ?? null;
  const cellRows = cell ? cellOf(cell.perf, cell.potential)?.rows ?? [] : [];

  return (
    <div className="space-y-3">
      {api.loading && !api.data ? <LoadingRows rows={4} /> :
        api.error ? <EmptyState title={t("9-box tidak tersedia", "9-box unavailable")} description={api.error} icon={AlertTriangle} /> :
        api.data && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{t("{n} terpetakan", "{n} placed", { n: String(api.data.totals.placed) })}</Badge>
              <Badge variant="outline" className="text-[10px]">{t("{n} belum punya band", "{n} without a band", { n: String(api.data.totals.unplaced) })}</Badge>
              <span className="flex items-center gap-1 text-[10px] text-slate-400">
                <Info className="h-3 w-3" /> {t("klik sel → daftar karyawan", "click a cell → employee list")}
              </span>
            </div>

            {/* grid 3×3: kolom = performance (kiri→kanan), baris = potential (atas→bawah) */}
            <div className="overflow-x-auto">
              <div className="min-w-0 space-y-1.5">
                <div className="grid grid-cols-[minmax(64px,84px)_repeat(3,minmax(88px,1fr))] gap-1.5 text-[10px]">
                  <div />
                  {([1, 2, 3] as const).map((p) => (
                    <div key={p} className="text-center font-semibold text-slate-500 dark:text-slate-400">
                      {t(PERF_LABELS[p].id, PERF_LABELS[p].en)}
                    </div>
                  ))}
                </div>
                {([3, 2, 1] as const).map((pot) => (
                  <div key={pot} className="grid grid-cols-[minmax(64px,84px)_repeat(3,minmax(88px,1fr))] gap-1.5">
                    <div className="flex items-end justify-start pb-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      <span className="leading-tight">{t(POT_LABELS[pot].id, POT_LABELS[pot].en)}</span>
                    </div>
                    {([1, 2, 3] as const).map((perf) => {
                      const c = cellOf(perf, pot);
                      const active = cell?.perf === perf && cell?.potential === pot;
                      return (
                        <button key={perf}
                          onClick={() => setCell(active ? null : { perf, potential: pot })}
                          aria-label={t(`Sel ${perf}/${pot} — ${c?.count ?? 0} karyawan`, `Cell ${perf}/${pot} — ${c?.count ?? 0} employees`)}
                          className={cn(
                            "flex min-h-20 flex-col items-center justify-center rounded-xl border-2 px-2 py-3 transition",
                            active ? "border-brand bg-brand/10" : "border-slate-200 bg-white/70 hover:border-brand/50 dark:border-slate-800 dark:bg-slate-900/70",
                            pot === 3 && perf === 3 && "bg-emerald-50/70 dark:bg-emerald-500/5",
                            pot === 1 && perf === 1 && "bg-rose-50/60 dark:bg-rose-500/5",
                          )}>
                          <span className="text-2xl font-bold tabular-nums">{c?.count ?? 0}</span>
                          <span className="text-[9px] text-slate-400">P{perf}×{pot}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              {t(
                "Sumbu performance = rating final (band 1–2 / 3 / 4–5); sumbu potential = band potensi 1–3 (diisi saat kalibrasi). 9-box hanya untuk HR/Direksi (§11.3).",
                "Performance axis = final rating (bands 1–2 / 3 / 4–5); potential axis = potential band 1–3 (set during calibration). The 9-box is for HR/Directors only (§11.3).",
              )}
            </p>

            {cell && (
              <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
                <CardContent className="p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold">
                      {t(PERF_LABELS[cell.perf].id, PERF_LABELS[cell.perf].en)} × {t(POT_LABELS[cell.potential].id, POT_LABELS[cell.potential].en)}
                    </h4>
                    <Badge variant="outline" className="text-[10px]">{t("{n} karyawan", "{n} employees", { n: String(cellRows.length) })}</Badge>
                    <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setCell(null)}>{t("Tutup", "Close")}</Button>
                  </div>
                  {cellRows.length === 0 ? (
                    <p className="text-xs text-slate-400">{t("Sel kosong.", "Empty cell.")}</p>
                  ) : (
                    <div className="space-y-1">
                      {cellRows.map((r) => (
                        <p key={r.appraisalId} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                          <span className="font-mono text-[10px] text-slate-400">{r.docNo}</span>
                          <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                          <span className="text-slate-400">{r.unitName ?? "—"}</span>
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]" style={{ color: RATING_COLORS[r.finalRating] }}>rating {r.finalRating}</Badge>
                        </p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {api.data.unplaced.length > 0 && (
              <details className="rounded-xl border border-dashed border-slate-300 px-3 py-2 dark:border-slate-700">
                <summary className="cursor-pointer text-xs font-medium text-slate-500">
                  {t("{n} peserta belum terpetakan (rating/band belum ada)", "{n} participants not placed yet (missing rating/band)", { n: String(api.data.unplaced.length) })}
                </summary>
                <div className="mt-2 space-y-0.5">
                  {api.data.unplaced.map((r) => (
                    <p key={r.appraisalId} className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-slate-500">
                      <span className="font-mono text-[10px] text-slate-400">{r.docNo}</span>
                      <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                      <span>rating {r.finalRating ?? "—"} · band {r.potentialBand ?? "—"}</span>
                    </p>
                  ))}
                </div>
              </details>
            )}
            <span className="sr-only">{locale.startsWith("en") ? "9-box talent matrix" : "matriks talenta 9-box"}</span>
          </>
        )}
    </div>
  );
}
