"use client";
// P2-PERF — Check-in & Monitoring (§27 alur 3): jadwal/log 1-on-1 terdokumentasi
// + checkpoint tengah tahun (midActual per KPI + progress) — pola halaman modul.
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
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { MessagesSquare, CalendarPlus, CheckCircle2, XCircle, Plus, Trash2, Gauge, Save } from "lucide-react";

const CYCLES_API = "/api/rekankerja/performance/cycles";
const CHECKINS_API = "/api/rekankerja/performance/checkins";
const GOALS_API = "/api/rekankerja/performance/goals";

interface CheckinRow {
  id: string; appraisalId: string; docNo: string; employeeNo: string; employeeName: string;
  position: string | null; managerName: string | null; cycleCode: string;
  heldAt: string; agenda: string | null; notesJson: string; managerComment: string | null;
  nextCheckInAt: string | null; status: string;
}
interface MidRow {
  appraisalId: string; docNo: string; employeeNo: string; employeeName: string; status: string;
  midPct: number;
  kpis: { id: string; title: string; unit: string; polarity: string; target: number; midActual: number | null; dataSource: string }[];
}

export function PerformanceCheckinsPage() {
  const { t, lang } = useI18n();
  const [cycleId, setCycleId] = useState("");
  const cyclesApi = useApi<{ rows: { id: string; code: string; name: string; status: string }[] }>(`${CYCLES_API}?limit=100`);
  useEffect(() => {
    if (cycleId || !cyclesApi.data?.rows?.length) return;
    const active = cyclesApi.data.rows.find((r) => r.status === "Ongoing") ?? cyclesApi.data.rows.find((r) => r.status === "GoalSetting") ?? cyclesApi.data.rows[0];
    if (active) setCycleId(active.id);
  }, [cyclesApi.data, cycleId]);

  const listApi = useApi<{ rows: CheckinRow[] }>(cycleId ? `${CHECKINS_API}?cycleId=${cycleId}` : null, [cycleId]);
  const midApi = useApi<{ rows: MidRow[] }>(cycleId ? `${CHECKINS_API}?midCheckpoint=1&cycleId=${cycleId}` : null, [cycleId]);

  // dialog jadwal
  const [schedDialog, setSchedDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const participantsApi = useApi<{ rows: { appraisalId: string; employeeName: string; employeeNo: string; docNo: string }[] }>(
    schedDialog && cycleId ? `${GOALS_API}?cycleId=${cycleId}` : null, [schedDialog, cycleId],
  );
  const [schedForm, setSchedForm] = useState({ appraisalId: "", heldAt: "", agenda: "", nextCheckInAt: "" });

  // dialog log
  const [logTarget, setLogTarget] = useState<CheckinRow | null>(null);
  const [logForm, setLogForm] = useState({ wins: "", blockers: "", next: "", managerComment: "" });

  // midActual editing lokal
  const [midEdits, setMidEdits] = useState<Record<string, string>>({});

  const schedule = async () => {
    if (!schedForm.appraisalId || !schedForm.heldAt) {
      toast.error(t("Pilih peserta & tanggal", "Pick a participant & date"));
      return;
    }
    setBusy(true);
    try {
      await apiSend(CHECKINS_API, "POST", { action: "schedule", ...schedForm, nextCheckInAt: schedForm.nextCheckInAt || null });
      toast.success(t("Check-in dijadwalkan (Planned)", "Check-in scheduled (Planned)"));
      setSchedDialog(false);
      setSchedForm({ appraisalId: "", heldAt: "", agenda: "", nextCheckInAt: "" });
      listApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const log = async () => {
    if (!logTarget) return;
    setBusy(true);
    try {
      await apiSend(CHECKINS_API, "POST", {
        action: "log",
        checkInId: logTarget.id,
        wins: logForm.wins.split("\n").map((x) => x.trim()).filter(Boolean),
        blockers: logForm.blockers.split("\n").map((x) => x.trim()).filter(Boolean),
        next: logForm.next.split("\n").map((x) => x.trim()).filter(Boolean),
        managerComment: logForm.managerComment || undefined,
      });
      toast.success(t("Check-in dicatat (Held)", "Check-in logged (Held)"));
      setLogTarget(null);
      setLogForm({ wins: "", blockers: "", next: "", managerComment: "" });
      listApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const markMissed = async (r: CheckinRow) => {
    if (!window.confirm(t("Tandai check-in ini terlewat (Missed)?", "Mark this check-in as missed?"))) return;
    try {
      await apiSend(CHECKINS_API, "POST", { action: "markMissed", checkInId: r.id });
      listApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  const saveMid = async (kpiId: string) => {
    const v = midEdits[kpiId];
    try {
      await apiSend(CHECKINS_API, "POST", { action: "saveMidActual", kpiId, midActual: v === "" || v === undefined ? null : Number(v) });
      toast.success(t("Checkpoint tengah tahun tersimpan", "Mid-year checkpoint saved"));
      midApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  const parseNotes = (n: string): { wins: string[]; blockers: string[]; next: string[] } => {
    try { return JSON.parse(n); } catch { return { wins: [], blockers: [], next: [] }; }
  };
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Check-in")}
        title={t("Check-in", "Check-ins")}
        description={t(
          "Riwayat 1-on-1 terdokumentasi (capaian/hambatan/rencana) + checkpoint tengah tahun per KPI. Reminder otomatis scheduler untuk check-in terlewat.",
          "Documented 1-on-1 history (wins/blockers/next) + per-KPI mid-year checkpoint. Scheduler auto-reminds overdue check-ins.",
        )}
        actions={(
          <Button onClick={() => setSchedDialog(true)} disabled={!cycleId}>
            <CalendarPlus className="h-4 w-4" aria-hidden /> {t("Jadwalkan Check-in", "Schedule Check-in")}
          </Button>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={cycleId} onValueChange={setCycleId}>
          <SelectTrigger className="w-72"><SelectValue placeholder={t("Pilih siklus…", "Pick a cycle…")} /></SelectTrigger>
          <SelectContent>
            {(cyclesApi.data?.rows ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="history" className="w-full">
        <TabsList className="mb-3 bg-slate-100 p-1 dark:bg-slate-900">
          <TabsTrigger value="history"><MessagesSquare className="h-3.5 w-3.5" aria-hidden /> {t("Riwayat 1-on-1", "1-on-1 History")}</TabsTrigger>
          <TabsTrigger value="mid"><Gauge className="h-3.5 w-3.5" aria-hidden /> {t("Checkpoint Tengah Tahun", "Mid-Year Checkpoint")}</TabsTrigger>
        </TabsList>

        <TabsContent value="history">
          <Card><CardContent className="p-0">
            {listApi.loading && !listApi.data ? (
              <div className="p-4"><LoadingRows /></div>
            ) : (listApi.data?.rows ?? []).length === 0 ? (
              <div className="p-6"><EmptyState icon={MessagesSquare} title={t("Belum ada check-in", "No check-ins yet")} description={t("Jadwalkan 1-on-1 pertama — disarankan rutin bulanan (§27-1).", "Schedule the first 1-on-1 — monthly cadence recommended (§27-1).")} /></div>
            ) : (
              <div className="max-h-[34rem] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                    <TableRow>
                      <TableHead>{t("Tanggal")}</TableHead>
                      <TableHead>{t("Karyawan", "Employee")}</TableHead>
                      <TableHead className="hidden md:table-cell">{t("Agenda / Catatan", "Agenda / Notes")}</TableHead>
                      <TableHead>{t("Status")}</TableHead>
                      <TableHead className="w-40" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(listApi.data?.rows ?? []).map((r) => {
                      const notes = parseNotes(r.notesJson);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="text-sm">{fmtDate(r.heldAt)}</TableCell>
                          <TableCell>
                            <p className="font-semibold">{r.employeeName}</p>
                            <p className="text-xs text-slate-500">{r.employeeNo} · {t("atasan", "manager")}: {r.managerName ?? "—"}</p>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {r.agenda && <p className="text-xs font-medium">{r.agenda}</p>}
                            {r.status === "Held" && (
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {notes.wins.length > 0 && <p>✅ {t("Capaian", "Wins")}: {notes.wins.join("; ")}</p>}
                                {notes.blockers.length > 0 && <p>⛔ {t("Hambatan", "Blockers")}: {notes.blockers.join("; ")}</p>}
                                {notes.next.length > 0 && <p>➡ {t("Rencana", "Next")}: {notes.next.join("; ")}</p>}
                                {r.managerComment && <p className="italic">“{r.managerComment}”</p>}
                              </div>
                            )}
                            {r.nextCheckInAt && <p className="text-[11px] text-slate-400">{t("berikutnya", "next")}: {fmtDate(r.nextCheckInAt)}</p>}
                          </TableCell>
                          <TableCell><StatusPill status={r.status} /></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {r.status === "Planned" && (
                                <>
                                  <Button size="sm" variant="ghost" onClick={() => { setLogTarget(r); setLogForm({ wins: "", blockers: "", next: "", managerComment: "" }); }} aria-label={t("Catat", "Log")}>
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => markMissed(r)} aria-label={t("Terlewat", "Missed")}>
                                    <XCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="mid">
          <Card><CardContent className="p-4">
            {midApi.loading && !midApi.data ? (
              <LoadingRows />
            ) : (midApi.data?.rows ?? []).length === 0 ? (
              <EmptyState icon={Gauge} title={t("Belum ada peserta", "No participants yet")} description="" />
            ) : (
              <div className="grid gap-3">
                {(midApi.data?.rows ?? []).map((p) => (
                  <div key={p.appraisalId} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{p.employeeName} <span className="ml-2 font-mono text-xs text-slate-400">{p.docNo}</span></p>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className={cn("h-full rounded-full", p.midPct >= 100 ? "bg-emerald-500" : p.midPct >= 50 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${p.midPct}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-slate-500">{p.midPct}%</span>
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      {p.kpis.map((k) => (
                        <div key={k.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-900">
                          <span className="min-w-40 flex-1 text-sm">{k.title}</span>
                          <span className="text-xs text-slate-400">{t("Target", "Target")} {k.target} {k.unit}</span>
                          <Input
                            type="number" inputMode="decimal"
                            value={midEdits[k.id] ?? (k.midActual != null ? String(k.midActual) : "")}
                            onChange={(e) => setMidEdits({ ...midEdits, [k.id]: e.target.value })}
                            placeholder={t("capaian mid", "mid actual")}
                            className="h-8 w-28 text-xs"
                          />
                          <Button size="sm" variant="ghost" onClick={() => saveMid(k.id)} aria-label={t("Simpan", "Save")}>
                            <Save className="h-3.5 w-3.5" />
                          </Button>
                          {k.midActual != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">✓ {k.midActual}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                </div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* dialog jadwal */}
      <Dialog open={schedDialog} onOpenChange={setSchedDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarPlus className="h-5 w-5 ov-text-accent" aria-hidden /> {t("Jadwalkan Check-in 1-on-1", "Schedule 1-on-1 Check-in")}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>{t("Peserta *", "Participant *")}</Label>
              <Select value={schedForm.appraisalId} onValueChange={(v) => setSchedForm({ ...schedForm, appraisalId: v })}>
                <SelectTrigger><SelectValue placeholder={t("Pilih karyawan…", "Pick employee…")} /></SelectTrigger>
                <SelectContent>
                  {(participantsApi.data?.rows ?? []).map((p) => (
                    <SelectItem key={p.appraisalId} value={p.appraisalId}>{p.employeeName} · {p.employeeNo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Tanggal pelaksanaan *", "Date held *")}</Label>
              <Input type="date" value={schedForm.heldAt} onChange={(e) => setSchedForm({ ...schedForm, heldAt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Agenda (opsional)", "Agenda (optional)")}</Label>
              <Input value={schedForm.agenda} onChange={(e) => setSchedForm({ ...schedForm, agenda: e.target.value })} placeholder={t("mis. Review progress Q1", "e.g. Q1 progress review")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Check-in berikutnya", "Next check-in")}</Label>
              <Input type="date" value={schedForm.nextCheckInAt} onChange={(e) => setSchedForm({ ...schedForm, nextCheckInAt: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSchedDialog(false)}>{t("Batal")}</Button>
            <Button onClick={schedule} disabled={busy}>{busy ? t("Menyimpan…", "Saving…") : t("Jadwalkan", "Schedule")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog catat hasil */}
      <Dialog open={logTarget !== null} onOpenChange={(o) => { if (!o) setLogTarget(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Catat Check-in — {n}", "Log Check-in — {n}", { n: logTarget?.employeeName ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-xs text-slate-500">{t("Satu poin per baris — ringkas & terstruktur (§2).", "One point per line — concise & structured (§2).")}</p>
            <div className="space-y-1.5">
              <Label>{t("Capaian sejauh ini", "Wins so far")}</Label>
              <Textarea value={logForm.wins} onChange={(e) => setLogForm({ ...logForm, wins: e.target.value })} rows={2} placeholder={t("mis. Laporan Maret tepat waktu", "e.g. March reports on time")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Hambatan", "Blockers")}</Label>
              <Textarea value={logForm.blockers} onChange={(e) => setLogForm({ ...logForm, blockers: e.target.value })} rows={2} placeholder={t("mis. Menunggu data vendor", "e.g. Waiting for vendor data")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Rencana lanjut", "Next steps")}</Label>
              <Textarea value={logForm.next} onChange={(e) => setLogForm({ ...logForm, next: e.target.value })} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Komentar atasan", "Manager comment")}</Label>
              <Textarea value={logForm.managerComment} onChange={(e) => setLogForm({ ...logForm, managerComment: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogTarget(null)}>{t("Batal")}</Button>
            <Button onClick={log} disabled={busy}>{busy ? t("Menyimpan…", "Saving…") : t("Catat (Held)", "Log (Held)")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
