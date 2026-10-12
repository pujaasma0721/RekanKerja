"use client";
// P4-PERF — Hasil & 9-Box (§17 results; §31 alur 7; §18-6 scatter 3×3 interaktif):
// grid 9-box (potentialBand 1–3 × kinerja rendah/tengah/tinggi dari finalRating —
// klik sel → daftar karyawan; lensa HR/Direksi, bukan palu), tabel hasil per peserta
// (skor final, rating, band, acknowledge, banding) + aksi HR atas nama
// (acknowledge offline ter-log / banding atas nama / putus banding D6).
// P5-PERF — tab Merit & Konsekuensi (§32 alur 8): usulan otomatis peserta Closed
// (matrix × rating, nominal vault), approval AS-MERIT-STD (L2 Direktur > Rp 10 jt
// D12), toPayroll (appliedRunNo bukti) / toPersonnelAction (PA + guard promosi),
// surat hasil PERF_RESULT (idempoten), usul PIP rating ≤2 + alasan tidak.
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { Grid3x3, CheckCircle2, BellRing, Gavel, Info, Sparkles, Banknote, ArrowUpRight, FileText, XCircle, Send, Ban, ShieldAlert } from "lucide-react";

const CYCLES_API = "/api/rekankerja/performance/cycles";
const RESULTS_API = "/api/rekankerja/performance/results";
const MERIT_API = "/api/rekankerja/performance/merit";

interface ResultsRow {
  appraisalId: string; docNo: string; employeeName: string; employeeNo: string;
  unit: string | null; managerName: string | null;
  status: string; finalScore: number | null; finalRating: number | null; potentialBand: number | null;
  acknowledgedAt: string | null; appealStatus: string | null; appealNote: string | null;
}
interface ResultsData {
  cycle: { id: string; code: string; status: string; publishAt: string | null };
  rows: ResultsRow[];
  ninebox: { cells: { pot: number; perf: 1 | 2 | 3; participants: { docNo: string; name: string; unit: string | null; score: number | null; rating: number | null }[] }[] };
  unplaced: ResultsRow[];
}

interface MeritRow {
  id: string; docNo: string; appraisalId: string; appraisalDocNo: string; cycleCode: string;
  employeeName: string; employeeNo: string; unit: string | null;
  finalScore: number | null; finalRating: number | null; potentialBand: number | null;
  bonusMonths: number | null; bonusAmount: number | null; raisePct: number | null; raiseAmount: number | null;
  note: string | null; status: string; personnelActionId: string | null; appliedRunNo: string | null;
  letterRefNo: string | null;
  chain: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}
interface PipProposal {
  appraisalId: string; docNo: string; employeeName: string; employeeNo: string;
  unit: string | null; finalScore: number | null; finalRating: number | null; existingPipStatus: string | null;
}

/** Label 9-box per (pot × perf) — dwibahasa, ringan (§443 "9-box ringan"). */
const CELL_META: Record<string, { id: string; en: string; tone: string }> = {
  "3|3": { id: "Bintang — calon pemimpin", en: "Star — future leader", tone: "bg-emerald-100 border-emerald-300 dark:bg-emerald-950" },
  "3|2": { id: "Potensi tinggi, belum optimal", en: "High potential, not yet optimal", tone: "bg-teal-50 border-teal-200 dark:bg-teal-950" },
  "3|1": { id: "Perlu diteliti — enigma", en: "Needs review — enigma", tone: "bg-amber-50 border-amber-200 dark:bg-amber-950" },
  "2|3": { id: "Ahli andal", en: "Reliable expert", tone: "bg-teal-50 border-teal-200 dark:bg-teal-950" },
  "2|2": { id: "Tulang punggung", en: "Backbone", tone: "bg-slate-50 border-slate-200 dark:bg-slate-900" },
  "2|1": { id: "Perlu pembinaan", en: "Needs coaching", tone: "bg-amber-50 border-amber-200 dark:bg-amber-950" },
  "1|3": { id: "Performa tinggi, batas potensi", en: "High performer, limited potential", tone: "bg-teal-50 border-teal-200 dark:bg-teal-950" },
  "1|2": { id: "Stabil terbatas", en: "Steady, limited", tone: "bg-slate-50 border-slate-200 dark:bg-slate-900" },
  "1|1": { id: "Risiko — kandidat PIP", en: "Risk — PIP candidate", tone: "bg-rose-50 border-rose-200 dark:bg-rose-950" },
};

const fmtRp = (n: number | null | undefined) => n == null ? "—" : `Rp ${n.toLocaleString("id-ID")}`;

/** Status usulan yang masih bisa diubah/diajukan ulang (kamus EN R4 — nilai identik). */
const MERIT_EDITABLE = ["Draft", "Rejected"];
const MERIT_EDITABLE_EN = ["Draft", "Rejected"];

export function PerformanceResultsPage() {
  const { t, lang } = useI18n();
  const [cycleId, setCycleId] = useState("");
  const [tab, setTab] = useState("results");
  const cyclesApi = useApi<{ rows: { id: string; code: string; name: string; status: string }[] }>(`${CYCLES_API}?limit=100`);
  useEffect(() => {
    if (cycleId || !cyclesApi.data?.rows?.length) return;
    const active = cyclesApi.data.rows.find((r) => ["Published", "Appealed"].includes(r.status))
      ?? cyclesApi.data.rows.find((r) => r.status === "Calibration")
      ?? cyclesApi.data.rows.find((r) => r.status === "Closed")
      ?? cyclesApi.data.rows[0];
    if (active) setCycleId(active.id);
  }, [cyclesApi.data, cycleId]);
  const resApi = useApi<ResultsData>(cycleId ? `${RESULTS_API}?cycleId=${cycleId}` : null, [cycleId]);
  const meritApi = useApi<{ rows: MeritRow[] }>(cycleId && tab === "merit" ? `${MERIT_API}?cycleId=${cycleId}` : null, [cycleId, tab]);
  const pipApi = useApi<{ proposals: PipProposal[] }>(cycleId && tab === "merit" ? `${MERIT_API}?cycleId=${cycleId}&pipProposals=1` : null, [cycleId, tab]);

  const [busyFlag, setBusyFlag] = useState(false);
  const [openCell, setOpenCell] = useState<ResultsData["ninebox"]["cells"][number] | null>(null);
  const [ackTarget, setAckTarget] = useState<ResultsRow | null>(null);
  const [ackReason, setAckReason] = useState("");
  const [appealTarget, setAppealTarget] = useState<ResultsRow | null>(null);
  const [appealNote, setAppealNote] = useState("");
  const [decideTarget, setDecideTarget] = useState<ResultsRow | null>(null);
  const [decideForm, setDecideForm] = useState({ decision: "Rejected", newScore: "", reason: "" });

  // merit dialogs
  const [editMerit, setEditMerit] = useState<MeritRow | null>(null);
  const [editForm, setEditForm] = useState({ bonusMonths: "", bonusAmount: "", raisePct: "", raiseAmount: "", note: "" });
  const [paTarget, setPaTarget] = useState<MeritRow | null>(null);
  const [paForm, setPaForm] = useState({ type: "SalaryAdjustment", effectiveDate: "", overrideReason: "" });
  const [cancelTarget, setCancelTarget] = useState<MeritRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [dismissTarget, setDismissTarget] = useState<PipProposal | null>(null);
  const [dismissReason, setDismissReason] = useState("");

  const data = resApi.data;
  const cycle = cyclesApi.data?.rows.find((r) => r.id === cycleId) ?? null;

  const ackCount = (data?.rows ?? []).filter((r) => r.acknowledgedAt).length;
  const pendingAppeals = (data?.rows ?? []).filter((r) => r.appealStatus === "Submitted");

  const doAck = async () => {
    if (!ackTarget) return;
    setBusyFlag(true);
    try {
      await apiSend(RESULTS_API, "POST", { action: "acknowledge", appraisalId: ackTarget.appraisalId, reason: ackReason });
      toast.success(t("Acknowledge tercatat (komunikasi offline, ter-audit)", "Acknowledgement recorded (offline communication, audited)"));
      setAckTarget(null); setAckReason("");
      resApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  const doAppealOnBehalf = async () => {
    if (!appealTarget) return;
    setBusyFlag(true);
    try {
      await apiSend(RESULTS_API, "POST", { action: "appeal", appraisalId: appealTarget.appraisalId, note: appealNote });
      toast.success(t("Banding diajukan atas nama karyawan", "Appeal filed on behalf of employee"));
      setAppealTarget(null); setAppealNote("");
      resApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  const doDecideAppeal = async () => {
    if (!decideTarget) return;
    setBusyFlag(true);
    try {
      await apiSend(RESULTS_API, "POST", {
        action: "decideAppeal", appraisalId: decideTarget.appraisalId,
        decision: decideForm.decision,
        newScore: decideForm.decision === "Adjusted" ? decideForm.newScore : undefined,
        reason: decideForm.reason,
      });
      toast.success(t("Keputusan banding tercatat", "Appeal decision recorded"));
      setDecideTarget(null); setDecideForm({ decision: "Rejected", newScore: "", reason: "" });
      resApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyFlag(false); }
  };

  const meritAction = async (body: Record<string, unknown>, okMsg: string, refreshPip = false) => {
    setBusyFlag(true);
    try {
      const res = await apiSend<Record<string, unknown>>(MERIT_API, "POST", body);
      toast.success(okMsg);
      if (typeof res.noSalary === "object" && Array.isArray(res.noSalary) && (res.noSalary as string[]).length > 0) {
        toast.info(t("{n} karyawan tanpa gaji pokok — nominal diisi manual", "{n} employees without base salary — fill nominal manually", { n: String((res.noSalary as string[]).length) }));
      }
      meritApi.refresh();
      if (refreshPip) pipApi.refresh();
      return res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
      return null;
    } finally { setBusyFlag(false); }
  };

  if (!cyclesApi.data && cyclesApi.loading) return <LoadingRows />;
  const cycles = cyclesApi.data?.rows ?? [];
  if (cycles.length === 0) {
    return <EmptyState title={t("Belum ada siklus", "No cycles yet")} description={t("Buat siklus penilaian pertama Anda di menu Siklus.", "Create your first appraisal cycle in the Cycles menu.")} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Hasil & 9-Box", "Results & 9-Box")}
        description={t("Hasil final per peserta, acknowledgement, banding D6, lensa 9-box talenta, dan konsekuensi merit (bonus/kenaikan → payroll & PA).", "Final results per participant, acknowledgement, D6 appeals, the 9-box talent lens, and merit consequences (bonus/raise → payroll & PA).")}
        actions={
          <div className="flex items-center gap-2">
            <Select value={cycleId} onValueChange={setCycleId}>
              <SelectTrigger className="w-56" aria-label={t("Siklus", "Cycle")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {cycles.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {cycle && (
        <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h3 className="font-semibold">{cycle.code} — <StatusPill status={cycle.status} /></h3>
            <p className="text-xs text-slate-500">
              {data?.cycle.publishAt
                ? t("Dipublikasikan {d} · jendela banding 7 hari (D6).", "Published {d} · 7-day appeal window (D6).", { d: new Date(data.cycle.publishAt).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID") })
                : t("Belum dipublikasi — hasil final tampil setelah publish (menu Kalibrasi → Publikasi).", "Not published yet — final results appear after publish (Calibration → Publish tab).")}
            </p>
          </div>
          <div className="flex gap-4 text-center">
            <div><p className="text-2xl font-bold tabular-nums">{data?.rows.length ?? 0}</p><p className="text-xs text-slate-500">{t("Peserta", "Participants")}</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-emerald-600">{ackCount}</p><p className="text-xs text-slate-500">{t("Acknowledge", "Acknowledged")}</p></div>
            <div><p className="text-2xl font-bold tabular-nums text-amber-600">{pendingAppeals.length}</p><p className="text-xs text-slate-500">{t("Banding aktif", "Active appeals")}</p></div>
          </div>
        </CardContent></Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
          <TabsTrigger value="results"><Grid3x3 className="mr-1 h-3.5 w-3.5" aria-hidden />{t("Hasil & 9-Box", "Results & 9-Box")}</TabsTrigger>
          <TabsTrigger value="merit"><Banknote className="mr-1 h-3.5 w-3.5" aria-hidden />{t("Merit & Konsekuensi", "Merit & Consequences")}</TabsTrigger>
        </TabsList>

        {/* ============ TAB HASIL & 9-BOX ============ */}
        <TabsContent value="results" className="space-y-4">
          {!data ? <LoadingRows /> : (
            <>
              {/* ===== 9-BOX (§18-6 — scatter 3×3 interaktif) ===== */}
              <Card>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold"><Grid3x3 className="mr-1 inline h-4 w-4" aria-hidden />{t("9-Box Talenta", "9-Box Talent Grid")}</h3>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Info className="h-3 w-3" aria-hidden />
                      {t("Klik sel untuk daftar karyawan. Band diisi saat kalibrasi.", "Click a cell for the employee list. Bands are set during calibration.")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex flex-col justify-between py-1">
                      <span className="rotate-180 text-[10px] font-medium uppercase tracking-wide text-slate-400 [writing-mode:vertical-rl]">{t("Potensi ↑", "Potential ↑")}</span>
                    </div>
                    <div className="grid flex-1 grid-cols-3 gap-2">
                      {[3, 2, 1].map((pot) => [3, 2, 1].map((perf) => {
                        const cell = data.ninebox.cells.find((c) => c.pot === pot && c.perf === perf);
                        const meta = CELL_META[`${pot}|${perf}`];
                        return (
                          <button
                            key={`${pot}|${perf}`}
                            type="button"
                            onClick={() => { if ((cell?.participants.length ?? 0) > 0) setOpenCell(cell ?? null); }}
                            className={cn(
                              "min-h-24 rounded-md border p-2 text-left transition hover:shadow-md md:min-h-28",
                              meta.tone,
                              (cell?.participants.length ?? 0) === 0 && "opacity-60",
                            )}
                            aria-label={`${t("Potensi", "Potential")} ${pot} × ${t("Kinerja", "Performance")} ${perf}: ${lang === "en" ? meta.en : meta.id} — ${cell?.participants.length ?? 0}`}
                          >
                            <p className="text-[11px] font-medium leading-tight text-slate-600 dark:text-slate-300">{lang === "en" ? meta.en : meta.id}</p>
                            <p className="mt-1 text-xl font-bold tabular-nums">{cell?.participants.length ?? 0}</p>
                            {(cell?.participants.length ?? 0) > 0 && (
                              <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">{cell!.participants.slice(0, 3).map((p) => p.name.split(" ")[0]).join(", ")}{(cell!.participants.length > 3) ? "…" : ""}</p>
                            )}
                          </button>
                        );
                      }))}
                    </div>
                  </div>
                  <div className="mt-1 flex justify-between pl-6">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{t("Kinerja: rendah ←", "Performance: low ←")}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{t("→ tinggi", "→ high")}</span>
                  </div>
                  {data.unplaced.length > 0 && (
                    <p className="mt-2 text-xs text-amber-600">
                      {t("{n} peserta belum punya band potensi (diisi via keputusan kalibrasi).", "{n} participants have no potential band yet (set via calibration decision).", { n: String(data.unplaced.length) })}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* ===== TABEL HASIL ===== */}
              <Card className="min-w-0">
                <CardContent className="p-4">
                  <h3 className="mb-2 font-semibold">{t("Hasil per peserta", "Results per participant")}</h3>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{t("Dokumen", "Document")}</TableHead>
                        <TableHead>{t("Karyawan", "Employee")}</TableHead>
                        <TableHead>{t("Unit", "Unit")}</TableHead>
                        <TableHead className="text-right">{t("Skor final", "Final score")}</TableHead>
                        <TableHead>★</TableHead>
                        <TableHead>{t("Band", "Band")}</TableHead>
                        <TableHead>{t("Status", "Status")}</TableHead>
                        <TableHead>{t("Acknowledge", "Acknowledged")}</TableHead>
                        <TableHead>{t("Banding", "Appeal")}</TableHead>
                        <TableHead className="w-44"></TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {data.rows.map((r) => (
                          <TableRow key={r.appraisalId}>
                            <TableCell className="font-mono text-xs">{r.docNo}</TableCell>
                            <TableCell className="text-sm">
                              <p className="font-medium">{r.employeeName}</p>
                              <p className="text-xs text-slate-500">{r.managerName ?? "—"}</p>
                            </TableCell>
                            <TableCell className="text-xs">{r.unit ?? "—"}</TableCell>
                            <TableCell className="text-right font-bold tabular-nums">{r.finalScore?.toFixed(1) ?? "—"}</TableCell>
                            <TableCell className="tabular-nums">{r.finalRating ?? "—"}</TableCell>
                            <TableCell className="text-center text-xs">{r.potentialBand ?? <span className="text-slate-400">—</span>}</TableCell>
                            <TableCell><StatusPill status={r.status} /></TableCell>
                            <TableCell className="text-xs">
                              {r.acknowledgedAt
                                ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{new Date(r.acknowledgedAt).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID")}</span>
                                : <span className="text-slate-400">—</span>}
                            </TableCell>
                            <TableCell className="text-xs">
                              {r.appealStatus
                                ? <Badge variant={r.appealStatus === "Submitted" ? "destructive" : "secondary"}>{r.appealStatus}</Badge>
                                : <span className="text-slate-400">—</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {["Published", "Appealed"].includes(r.status) && !r.acknowledgedAt && (
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => { setAckTarget(r); setAckReason(""); }}>
                                    {t("Ack atas nama", "Ack on behalf")}
                                  </Button>
                                )}
                                {r.status === "Published" && !r.appealStatus && (
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => { setAppealTarget(r); setAppealNote(""); }}>
                                    {t("Banding atas nama", "Appeal on behalf")}
                                  </Button>
                                )}
                                {r.appealStatus === "Submitted" && (
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => { setDecideTarget(r); setDecideForm({ decision: "Rejected", newScore: "", reason: "" }); }}>
                                    <Gavel className="h-3 w-3" aria-hidden /> {t("Putuskan", "Decide")}
                                  </Button>
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

        {/* ============ TAB MERIT & KONSEKUENSI (P5 — §32 alur 8) ============ */}
        <TabsContent value="merit" className="space-y-4">
          {!meritApi.data ? <LoadingRows /> : (
            <>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <h3 className="font-semibold"><Sparkles className="mr-1 inline h-4 w-4 text-teal-500" aria-hidden />{t("Usulan Merit", "Merit Recommendations")}</h3>
                    <p className="text-xs text-slate-500">
                      {t("Draf otomatis dari MeritMatrix aktif × rating final peserta Closed. Nominal dienkripsi vault; approval L2 Direktur bila > Rp 10 jt (D12).", "Auto-drafted from the active MeritMatrix × final rating of Closed participants. Nominals vault-encrypted; Director L2 approval when > Rp 10M (D12).")}
                    </p>
                  </div>
                  <Button size="sm" disabled={busyFlag} onClick={() => meritAction({ action: "recommend", cycleId }, t("Usulan dibuat", "Recommendations created"))}>
                    <Sparkles className="h-4 w-4" aria-hidden /> {t("Buat usulan otomatis", "Auto-draft")}
                  </Button>
                </CardContent>
              </Card>

              {(meritApi.data.rows ?? []).length === 0 ? (
                <EmptyState icon={Banknote} title={t("Belum ada usulan merit", "No merit recommendations yet")} description={t("Klik \u201cBuat usulan otomatis\u201d untuk peserta siklus ini.", "Click \u201cAuto-draft\u201d for this cycle's participants.")} />
              ) : (
                <Card className="min-w-0">
                  <CardContent className="p-4">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>{t("Dokumen", "Document")}</TableHead>
                          <TableHead>{t("Karyawan", "Employee")}</TableHead>
                          <TableHead>★</TableHead>
                          <TableHead className="text-right">{t("Bonus (bln)", "Bonus (mo)")}</TableHead>
                          <TableHead className="text-right">{t("Nominal bonus", "Bonus amount")}</TableHead>
                          <TableHead className="text-right">{t("Kenaikan", "Raise")}</TableHead>
                          <TableHead className="text-right">{t("Nominal kenaikan", "Raise amount")}</TableHead>
                          <TableHead>{t("Status", "Status")}</TableHead>
                          <TableHead className="w-56"></TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {(meritApi.data.rows ?? []).map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-mono text-xs">
                                {r.docNo}
                                {r.appliedRunNo && <p className="text-[10px] text-emerald-600">→ {r.appliedRunNo}</p>}
                                {r.personnelActionId && <p className="text-[10px] text-teal-600">→ PA</p>}
                                {r.letterRefNo && <p className="text-[10px] text-slate-500">✉ {r.letterRefNo}</p>}
                              </TableCell>
                              <TableCell className="text-sm">
                                <p className="font-medium">{r.employeeName}</p>
                                <p className="text-xs text-slate-500">{r.appraisalDocNo} · {r.unit ?? "—"}</p>
                              </TableCell>
                              <TableCell className="tabular-nums">{r.finalRating ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{r.bonusMonths ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtRp(r.bonusAmount)}</TableCell>
                              <TableCell className="text-right tabular-nums">{r.raisePct != null ? `${r.raisePct}%` : "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtRp(r.raiseAmount)}</TableCell>
                              <TableCell>
                                <StatusPill status={r.status} />
                                {r.chain && r.status === "Submitted" && (
                                  <p className="mt-0.5 text-[10px] text-slate-500">L{r.chain.currentLevel}/{r.chain.totalLevels} · {r.chain.currentApprover?.slice(0, 24)}</p>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {MERIT_EDITABLE.includes(r.status) && (
                                    <>
                                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => { setEditMerit(r); setEditForm({ bonusMonths: String(r.bonusMonths ?? ""), bonusAmount: r.bonusAmount != null ? String(r.bonusAmount) : "", raisePct: r.raisePct != null ? String(r.raisePct) : "", raiseAmount: r.raiseAmount != null ? String(r.raiseAmount) : "", note: r.note ?? "" }); }}>
                                        {t("Ubah", "Edit")}
                                      </Button>
                                      <Button size="sm" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => meritAction({ action: "submit", id: r.id }, t("Diajukan ke persetujuan", "Submitted for approval"))}>
                                        <Send className="h-3 w-3" aria-hidden /> {t("Ajukan", "Submit")}
                                      </Button>
                                    </>
                                  )}
                                  {r.status === "Submitted" && r.chain?.status === "InProgress" && (
                                    <>
                                      <Button size="sm" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => meritAction({ action: "decide", id: r.id, decision: "approve" }, t("Jenjang disetujui", "Level approved"))}>
                                        {t("Setujui", "Approve")}
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => {
                                        const note = window.prompt(t("Alasan penolakan (opsional):", "Rejection reason (optional):")) ?? "";
                                        meritAction({ action: "decide", id: r.id, decision: "reject", note }, t("Ditolak di jenjang", "Rejected at level"));
                                      }}>
                                        {t("Tolak", "Reject")}
                                      </Button>
                                    </>
                                  )}
                                  {r.status === "Approved" && (
                                    <>
                                      {r.bonusAmount != null && !r.appliedRunNo && (
                                        <Button size="sm" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => meritAction({ action: "toPayroll", id: r.id }, t("Bonus diserap ke payroll", "Bonus absorbed into payroll"))}>
                                          <Banknote className="h-3 w-3" aria-hidden /> {t("Ke Payroll", "To Payroll")}
                                        </Button>
                                      )}
                                      {!r.personnelActionId && r.raisePct != null && (
                                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => { setPaTarget(r); setPaForm({ type: "SalaryAdjustment", effectiveDate: "", overrideReason: "" }); }}>
                                          <ArrowUpRight className="h-3 w-3" aria-hidden /> {t("Gulirkan PA", "Roll out PA")}
                                        </Button>
                                      )}
                                    </>
                                  )}
                                  {r.status === "Approved" && !r.letterRefNo && (
                                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => meritAction({ action: "issueLetter", meritId: r.id }, t("Surat hasil terbit", "Result letter issued"))}>
                                      <FileText className="h-3 w-3" aria-hidden /> {t("Surat", "Letter")}
                                    </Button>
                                  )}
                                  {!["Applied", "Cancelled"].includes(r.status) && (
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-600" disabled={busyFlag} onClick={() => { setCancelTarget(r); setCancelReason(""); }}>
                                      <Ban className="h-3 w-3" aria-hidden />
                                    </Button>
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
              )}

              {/* ===== USUL PIP (§32-5) ===== */}
              {(pipApi.data?.proposals ?? []).length > 0 && (
                <Card className="min-w-0 border-amber-200 dark:border-amber-900">
                  <CardContent className="p-4">
                    <h3 className="mb-1 font-semibold"><ShieldAlert className="mr-1 inline h-4 w-4 text-amber-500" aria-hidden />{t("Usul PIP — rating ≤ 2", "PIP Proposals — rating ≤ 2")}</h3>
                    <p className="mb-2 text-xs text-slate-500">{t("Karyawan dengan rating akhir ≤2 otomatis diusulkan masuk Alur 9 (Program Perbaikan Kinerja). HR memutuskan menjalankan atau mencatat alasannya.", "Employees with final rating ≤2 are auto-proposed for Flow 9 (PIP). HR decides to run it or records a reason not to.")}</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>{t("Karyawan", "Employee")}</TableHead>
                          <TableHead>★</TableHead>
                          <TableHead className="text-right">{t("Skor", "Score")}</TableHead>
                          <TableHead>{t("PIP", "PIP")}</TableHead>
                          <TableHead className="w-40"></TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {(pipApi.data?.proposals ?? []).map((p) => (
                            <TableRow key={p.appraisalId}>
                              <TableCell className="text-sm">
                                <p className="font-medium">{p.employeeName}</p>
                                <p className="text-xs text-slate-500">{p.docNo} · {p.unit ?? "—"}</p>
                              </TableCell>
                              <TableCell><Badge variant="destructive">{p.finalRating ?? "—"}</Badge></TableCell>
                              <TableCell className="text-right tabular-nums">{p.finalScore?.toFixed(1) ?? "—"}</TableCell>
                              <TableCell className="text-xs">
                                {p.existingPipStatus
                                  ? <Badge variant="secondary">{p.existingPipStatus}</Badge>
                                  : <span className="text-slate-400">{t("belum ada", "none yet")}</span>}
                              </TableCell>
                              <TableCell>
                                {!p.existingPipStatus && (
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busyFlag} onClick={() => { setDismissTarget(p); setDismissReason(""); }}>
                                    {t("Catat alasan tidak", "Record reason not to")}
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
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ---- dialog: isi sel 9-box ---- */}
      <Dialog open={openCell !== null} onOpenChange={(o) => { if (!o) setOpenCell(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {openCell && CELL_META[`${openCell.pot}|${openCell.perf}`]
                ? t(CELL_META[`${openCell.pot}|${openCell.perf}`].id, CELL_META[`${openCell.pot}|${openCell.perf}`].en)
                : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableBody>
                {(openCell?.participants ?? []).map((p) => (
                  <TableRow key={p.docNo}>
                    <TableCell>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-slate-500">{p.docNo} · {p.unit ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <p className="font-bold tabular-nums">{p.score?.toFixed(1) ?? "—"}</p>
                      <p className="text-xs text-slate-500">★ {p.rating ?? "—"}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: acknowledge atas nama ---- */}
      <Dialog open={ackTarget !== null} onOpenChange={(o) => { if (!o) setAckTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("Acknowledge atas nama", "Acknowledge on behalf")}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Tandai hasil {doc} — {name} telah dikomunikasikan secara offline (mis. tatap muka). Bukti ter-audit.", "Mark result {doc} — {name} as communicated offline (e.g. face-to-face). Audited proof.", { doc: ackTarget?.docNo ?? "", name: ackTarget?.employeeName ?? "" })}
          </p>
          <div className="space-y-1">
            <Label>{t("Catatan komunikasi (≥10 karakter)", "Communication note (≥10 characters)")}</Label>
            <Textarea rows={3} value={ackReason} onChange={(e) => setAckReason(e.target.value)} placeholder={t("Contoh: disampaikan langsung dalam 1-on-1 tanggal …", "e.g. delivered face-to-face in a 1-on-1 on …")} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doAck} disabled={busyFlag}><CheckCircle2 className="h-4 w-4" aria-hidden /> {t("Catat", "Record")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: banding atas nama ---- */}
      <Dialog open={appealTarget !== null} onOpenChange={(o) => { if (!o) setAppealTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle><BellRing className="mr-1 inline h-4 w-4 text-amber-500" aria-hidden />{t("Banding atas nama karyawan", "Appeal on behalf of employee")}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Ajukan banding {doc} — {name} (bila karyawan tidak bisa mengakses ESS).", "File an appeal for {doc} — {name} (when the employee cannot access ESS).", { doc: appealTarget?.docNo ?? "", name: appealTarget?.employeeName ?? "" })}
          </p>
          <div className="space-y-1">
            <Label>{t("Alasan banding (≥20 karakter)", "Appeal reason (≥20 characters)")}</Label>
            <Textarea rows={3} value={appealNote} onChange={(e) => setAppealNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppealTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doAppealOnBehalf} disabled={busyFlag}>{t("Ajukan", "File")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: putuskan banding ---- */}
      <Dialog open={decideTarget !== null} onOpenChange={(o) => { if (!o) setDecideTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("Putuskan banding {doc}", "Decide appeal {doc}", { doc: decideTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          {decideTarget?.appealNote && (
            <p className="rounded-md bg-slate-50 p-2 text-xs italic text-slate-600 dark:bg-slate-900 dark:text-slate-300">“{decideTarget.appealNote}”</p>
          )}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("Keputusan", "Decision")}</Label>
              <Select value={decideForm.decision} onValueChange={(v) => setDecideForm((f) => ({ ...f, decision: v }))}>
                <SelectTrigger aria-label={t("Keputusan", "Decision")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Rejected">{t("Tolak banding", "Reject appeal")}</SelectItem>
                  <SelectItem value="Adjusted">{t("Setuju — sesuaikan skor", "Accept — adjust score")}</SelectItem>
                  <SelectItem value="Withdrawn">{t("Tarik (atas permintaan)", "Withdraw (on request)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {decideForm.decision === "Adjusted" && (
              <div className="space-y-1">
                <Label>{t("Skor baru (0–120)", "New score (0–120)")}</Label>
                <Input type="number" min={0} max={120} value={decideForm.newScore} onChange={(e) => setDecideForm((f) => ({ ...f, newScore: e.target.value }))} />
              </div>
            )}
            <div className="space-y-1">
              <Label>{t("Alasan keputusan (≥10 karakter)", "Decision reason (≥10 characters)")}</Label>
              <Textarea rows={3} value={decideForm.reason} onChange={(e) => setDecideForm((f) => ({ ...f, reason: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecideTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doDecideAppeal} disabled={busyFlag}><Gavel className="h-4 w-4" aria-hidden /> {t("Putuskan", "Decide")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: ubah draf merit ---- */}
      <Dialog open={editMerit !== null} onOpenChange={(o) => { if (!o) setEditMerit(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("Sesuaikan usulan {doc}", "Adjust recommendation {doc}", { doc: editMerit?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("Bonus (bulan)", "Bonus (months)")}</Label>
              <Input type="number" step="0.5" min={0} value={editForm.bonusMonths} onChange={(e) => setEditForm((f) => ({ ...f, bonusMonths: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>{t("Nominal bonus (Rp)", "Bonus amount (Rp)")}</Label>
              <Input type="number" min={0} value={editForm.bonusAmount} onChange={(e) => setEditForm((f) => ({ ...f, bonusAmount: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>{t("Kenaikan (%)", "Raise (%)")}</Label>
              <Input type="number" step="0.1" min={0} value={editForm.raisePct} onChange={(e) => setEditForm((f) => ({ ...f, raisePct: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>{t("Nominal kenaikan (Rp)", "Raise amount (Rp)")}</Label>
              <Input type="number" min={0} value={editForm.raiseAmount} onChange={(e) => setEditForm((f) => ({ ...f, raiseAmount: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("Catatan", "Note")}</Label>
            <Textarea rows={2} value={editForm.note} onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMerit(null)}>{t("Batal", "Cancel")}</Button>
            <Button disabled={busyFlag} onClick={async () => {
              if (!editMerit) return;
              const res = await meritAction({
                action: "update", id: editMerit.id,
                bonusMonths: editForm.bonusMonths === "" ? null : Number(editForm.bonusMonths),
                bonusAmount: editForm.bonusAmount === "" ? null : Number(editForm.bonusAmount),
                raisePct: editForm.raisePct === "" ? null : Number(editForm.raisePct),
                raiseAmount: editForm.raiseAmount === "" ? null : Number(editForm.raiseAmount),
                note: editForm.note,
              }, t("Draf diperbarui", "Draft updated"));
              if (res) setEditMerit(null);
            }}>{t("Simpan", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: gulirkan PA ---- */}
      <Dialog open={paTarget !== null} onOpenChange={(o) => { if (!o) setPaTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("Gulirkan Personnel Action — {doc}", "Roll out Personnel Action — {doc}", { doc: paTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Kenaikan gaji {pct}% → Rp {amt}. Promosi hanya bila rating ≥4 & band 9-box = 3 (override direksi wajib alasan).", "Raise {pct}% → Rp {amt}. Promotion requires rating ≥4 & 9-box band 3 (Director override needs a reason).", { pct: String(paTarget?.raisePct ?? "—"), amt: fmtRp(paTarget?.raiseAmount) })}
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("Jenis PA", "PA type")}</Label>
              <Select value={paForm.type} onValueChange={(v) => setPaForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger aria-label={t("Jenis PA", "PA type")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SalaryAdjustment">{t("Penyesuaian Gaji", "Salary Adjustment")}</SelectItem>
                  <SelectItem value="Promotion">{t("Promosi", "Promotion")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("Tanggal efektif", "Effective date")}</Label>
              <Input type="date" value={paForm.effectiveDate} onChange={(e) => setPaForm((f) => ({ ...f, effectiveDate: e.target.value }))} />
            </div>
            {paForm.type === "Promotion" && (
              <div className="space-y-1">
                <Label>{t("Alasan override direksi (bila tak memenuhi guard)", "Director override reason (if guard unmet)")}</Label>
                <Textarea rows={2} value={paForm.overrideReason} onChange={(e) => setPaForm((f) => ({ ...f, overrideReason: e.target.value }))} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button disabled={busyFlag} onClick={async () => {
              if (!paTarget) return;
              const res = await meritAction({
                action: "toPersonnelAction", id: paTarget.id, type: paForm.type,
                effectiveDate: paForm.effectiveDate || undefined,
                overrideReason: paForm.overrideReason || undefined,
              }, t("PA digulirkan (menu Pengajuan HR)", "PA rolled out (HR Requests menu)"));
              if (res) setPaTarget(null);
            }}>{t("Gulirkan", "Roll out")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: batalkan merit ---- */}
      <Dialog open={cancelTarget !== null} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle><XCircle className="mr-1 inline h-4 w-4 text-rose-500" aria-hidden />{t("Batalkan usulan {doc}?", "Cancel recommendation {doc}?", { doc: cancelTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>{t("Alasan pembatalan (≥10 karakter)", "Cancellation reason (≥10 characters)")}</Label>
            <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" disabled={busyFlag} onClick={async () => {
              if (!cancelTarget) return;
              const res = await meritAction({ action: "cancel", id: cancelTarget.id, reason: cancelReason }, t("Usulan dibatalkan", "Recommendation cancelled"));
              if (res) setCancelTarget(null);
            }}>{t("Batalkan", "Cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: alasan tidak menjalankan PIP ---- */}
      <Dialog open={dismissTarget !== null} onOpenChange={(o) => { if (!o) setDismissTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("Alasan tidak menjalankan PIP — {name}", "Reason not to run PIP — {name}", { name: dismissTarget?.employeeName ?? "" })}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Keputusan ini ter-audit. Program PIP tetap bisa dibuat nanti dari menu PIP bila situasi berubah.", "This decision is audited. A PIP can still be created later from the PIP menu if the situation changes.")}
          </p>
          <div className="space-y-1">
            <Label>{t("Alasan (≥10 karakter)", "Reason (≥10 characters)")}</Label>
            <Textarea rows={3} value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} placeholder={t("Contoh: karyawan sedang mutasi unit — PIP ditunda ke siklus berikutnya", "e.g. employee is transferring units — PIP deferred to next cycle")} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button disabled={busyFlag} onClick={async () => {
              if (!dismissTarget) return;
              const res = await meritAction({ action: "dismissPipProposal", appraisalId: dismissTarget.appraisalId, reason: dismissReason }, t("Keputusan tercatat", "Decision recorded"), true);
              if (res) setDismissTarget(null);
            }}>{t("Catat", "Record")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
