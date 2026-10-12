"use client";
// P4-PERF — Hasil & 9-Box (§17 results; §31 alur 7; §18-6 scatter 3×3 interaktif):
// grid 9-box (potentialBand 1–3 × kinerja rendah/tengah/tinggi dari finalRating —
// klik sel → daftar karyawan; lensa HR/Direksi, bukan palu), tabel hasil per peserta
// (skor final, rating, band, acknowledge, banding) + aksi HR atas nama
// (acknowledge offline ter-log / banding atas nama / putus banding D6).
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { Grid3x3, CheckCircle2, BellRing, Gavel, Info } from "lucide-react";

const CYCLES_API = "/api/rekankerja/performance/cycles";
const RESULTS_API = "/api/rekankerja/performance/results";

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

export function PerformanceResultsPage() {
  const { t, lang } = useI18n();
  const [cycleId, setCycleId] = useState("");
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

  const [busyFlag, setBusyFlag] = useState(false);
  const [openCell, setOpenCell] = useState<ResultsData["ninebox"]["cells"][number] | null>(null);
  const [ackTarget, setAckTarget] = useState<ResultsRow | null>(null);
  const [ackReason, setAckReason] = useState("");
  const [appealTarget, setAppealTarget] = useState<ResultsRow | null>(null);
  const [appealNote, setAppealNote] = useState("");
  const [decideTarget, setDecideTarget] = useState<ResultsRow | null>(null);
  const [decideForm, setDecideForm] = useState({ decision: "Rejected", newScore: "", reason: "" });

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

  if (!cyclesApi.data && cyclesApi.loading) return <LoadingRows />;
  const cycles = cyclesApi.data?.rows ?? [];
  if (cycles.length === 0) {
    return <EmptyState title={t("Belum ada siklus", "No cycles yet")} description={t("Buat siklus penilaian pertama Anda di menu Siklus.", "Create your first appraisal cycle in the Cycles menu.")} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Hasil & 9-Box", "Results & 9-Box")}
        description={t("Hasil final per peserta, acknowledgement, banding D6, dan lensa 9-box talenta.", "Final results per participant, acknowledgement, D6 appeals, and the 9-box talent lens.")}
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
          <Card>
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
    </div>
  );
}
