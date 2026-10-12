"use client";
// P1-PERF — Siklus Penilaian (§14.2 performance:cycles; §25–26 alur 1–2;
// §18.8 Command Center AMANDEMEN 2): daftar siklus + gerbang fase + enroll
// peserta + prefill/salin tim + Command Center matriks + nudge multi-kanal.
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useNav } from "@/rekankerja/shared/lib/store";
import { cn } from "@/lib/utils";
import {
  Plus, Pencil, Users, ChevronLeft, Send, Megaphone, Zap, Search, ClipboardPen, CalendarClock,
  Copy, UserPlus, ArrowRight, Bell, FileSpreadsheet, Layers,
} from "lucide-react";

const CYCLES_API = "/api/rekankerja/performance/cycles";

const CYCLE_STATUS: Record<string, { id: string; en: string; tone: string }> = {
  Draft: { id: "Draft", en: "Draft", tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  GoalSetting: { id: "Fase Target", en: "Goal Setting", tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400" },
  Ongoing: { id: "Berjalan", en: "Ongoing", tone: "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400" },
  Assessment: { id: "Fase Penilaian", en: "Assessment", tone: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-400" },
  Calibration: { id: "Kalibrasi", en: "Calibration", tone: "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-400" },
  Published: { id: "Terpublikasi", en: "Published", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" },
  Closed: { id: "Tutup", en: "Closed", tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
};

function fmtDate(d: string | null | undefined, lang: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

interface CycleRow {
  id: string; code: string; name: string; cycleType: string; status: string;
  periodStart: string; periodEnd: string; goalEnd: string | null; participantCount: number;
}
interface ParticipantRow {
  appraisalId: string; docNo: string; employeeNo: string; employeeName: string; position: string | null;
  orgUnit: string | null; managerId: string | null; managerName: string | null; status: string;
  goalsCopiedFrom: string | null; kpiCount: number; weightSum: number; progressPct: number; acknowledgedAt: string | null;
}
interface EnrollableEmp { id: string; employeeNo: string; fullName: string; position: string | null; orgUnit: string | null; enrolled: boolean }

export function PerformanceCyclesPage() {
  const { t, lang } = useI18n();
  const nav = useNav();
  const cycleIdParam = nav.params.id;

  // ==================== DAFTAR SIKLUS ====================
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const listUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (dq) p.set("q", dq);
    if (statusFilter !== "all") p.set("status", statusFilter);
    return `${CYCLES_API}?${p.toString()}`;
  }, [dq, statusFilter]);
  const listApi = useApi<{ rows: CycleRow[]; total: number }>(listUrl, [listUrl]);

  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const emptyForm = {
    id: "", code: "", name: "", cycleType: "Annual",
    periodStart: `${new Date().getFullYear()}-01-01`, periodEnd: `${new Date().getFullYear()}-12-31`,
    goalStart: "", goalEnd: "", midStart: "", midEnd: "", selfStart: "", selfEnd: "",
    mgrStart: "", mgrEnd: "", calibStart: "", calibEnd: "", feedback360: false,
  };
  const [form, setForm] = useState(emptyForm);

  const openNew = () => { setForm({ ...emptyForm, code: `PER-${new Date().getFullYear()}` }); setDialog(true); };
  const openEdit = (r: CycleRow) => {
    setForm({
      id: r.id, code: r.code, name: r.name, cycleType: r.cycleType,
      periodStart: r.periodStart.slice(0, 10), periodEnd: r.periodEnd.slice(0, 10),
      goalStart: "", goalEnd: "", midStart: "", midEnd: "", selfStart: "", selfEnd: "",
      mgrStart: "", mgrEnd: "", calibStart: "", calibEnd: "", feedback360: false,
    });
    setDialog(true);
    // isi jendela dari detail
    void fetchDetailForEdit(r.id);
  };
  const fetchDetailForEdit = async (id: string) => {
    try {
      const res = await fetch(`${CYCLES_API}?id=${id}`, { credentials: "include" });
      const d = await res.json();
      if (d.cycle) {
        setForm((f) => ({
          ...f,
          goalStart: d.cycle.goalStart?.slice(0, 10) ?? "", goalEnd: d.cycle.goalEnd?.slice(0, 10) ?? "",
          midStart: d.cycle.midStart?.slice(0, 10) ?? "", midEnd: d.cycle.midEnd?.slice(0, 10) ?? "",
          selfStart: d.cycle.selfStart?.slice(0, 10) ?? "", selfEnd: d.cycle.selfEnd?.slice(0, 10) ?? "",
          mgrStart: d.cycle.mgrStart?.slice(0, 10) ?? "", mgrEnd: d.cycle.mgrEnd?.slice(0, 10) ?? "",
          calibStart: d.cycle.calibStart?.slice(0, 10) ?? "", calibEnd: d.cycle.calibEnd?.slice(0, 10) ?? "",
          feedback360: d.cycle.feedback360 === true,
        }));
      }
    } catch { /* abaikan */ }
  };

  const save = async () => {
    setBusy(true);
    try {
      if (form.id) await apiSend(CYCLES_API, "PATCH", form);
      else await apiSend(CYCLES_API, "POST", { action: "create", ...form });
      toast.success(form.id ? t("Siklus diperbarui", "Cycle updated") : t("Siklus dibuat (Draft)", "Cycle created (Draft)"));
      setDialog(false);
      listApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally { setBusy(false); }
  };

  // ==================== DETAIL SIKLUS ====================
  const detailApi = useApi<{ cycle: CycleRow & Record<string, string | null>; participants: ParticipantRow[] }>(
    cycleIdParam ? `${CYCLES_API}?id=${cycleIdParam}` : null, [cycleIdParam],
  );
  const cycle = detailApi.data?.cycle;
  const participants = detailApi.data?.participants ?? [];

  // enroll dialog
  const [enrollDialog, setEnrollDialog] = useState(false);
  const [enrollQ, setEnrollQ] = useState("");
  const [enrollSel, setEnrollSel] = useState<Set<string>>(new Set());
  const enrollApi = useApi<{ employees: EnrollableEmp[] }>(
    enrollDialog && cycle ? `${CYCLES_API}?employees=1&cycleId=${cycle.id}&q=${encodeURIComponent(enrollQ)}` : null,
    [enrollDialog, cycle?.id, enrollQ],
  );

  // salin tim dialog
  const [copyTeamDialog, setCopyTeamDialog] = useState(false);
  const srcApi = useApi<{ cycles: { cycleId: string; cycleCode: string; cycleName: string; participantsWithSource: number }[] }>(
    copyTeamDialog && cycle ? `/api/rekankerja/performance/goals?cycleId=${cycle.id}&copySources=1` : null,
    [copyTeamDialog, cycle?.id],
  );
  const [copySource, setCopySource] = useState("auto");

  // nudge dialog
  const [nudgeDialog, setNudgeDialog] = useState(false);
  const [nudgeMsg, setNudgeMsg] = useState("");
  const [nudgeChannels, setNudgeChannels] = useState<Record<string, boolean>>({ in_app: true, email: true, whatsapp: false });
  const [nudgeTargets, setNudgeTargets] = useState<string[]>([]); // appraisalIds

  // command center
  const ccApi = useApi<{
    participants: (ParticipantRow & { targetDone: boolean; selfDone: boolean; managerDone: boolean; acknowledged: boolean })[];
    managers: { managerId: string; managerName: string; team: number; targetDone: number; selfDone: number; managerDone: number; progressPct: number }[];
    totals: { participants: number; targetDone: number; selfDone: number; managerDone: number; acknowledged: number };
  }>(cycleIdParam ? `${CYCLES_API}?commandCenter=1&cycleId=${cycleIdParam}` : null, [cycleIdParam]);

  const doEnroll = async () => {
    if (!cycle) return;
    setBusy(true);
    try {
      const res = await apiSend<{ enrolled: number; skipped: number; needManager: string[] }>(CYCLES_API, "POST", {
        action: "enroll", cycleId: cycle.id, employeeIds: Array.from(enrollSel),
      });
      toast.success(t("{n} peserta didaftarkan {m}", "{n} participants enrolled {m}", {
        n: String(res.enrolled), m: res.needManager.length ? `· ${res.needManager.length} ${t("perlu penunjukan atasan", "need a manager")}` : "",
      }));
      setEnrollDialog(false);
      setEnrollSel(new Set());
      detailApi.refresh();
      listApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const doEnrollAll = async () => {
    if (!cycle) return;
    if (!window.confirm(t("Daftarkan SEMUA karyawan Active ke siklus ini?", "Enroll ALL Active employees into this cycle?"))) return;
    setBusy(true);
    try {
      const res = await apiSend<{ enrolled: number; needManager: string[] }>(CYCLES_API, "POST", {
        action: "enroll", cycleId: cycle.id, allActive: true,
      });
      toast.success(t("{n} peserta didaftarkan", "{n} participants enrolled", { n: String(res.enrolled) }));
      detailApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const doAdvance = async (action: string, label: string, prefill?: boolean) => {
    if (!cycle) return;
    const confirmMsg = action === "openGoal"
      ? t(`Buka fase penetapan target untuk ${cycle.code}? Semua atasan & karyawan akan dinotifikasi.`, `Open the goal-setting phase for ${cycle.code}? All managers & employees will be notified.`)
      : t(`Jalankan aksi "${label}" pada ${cycle.code}?`, `Run "${label}" on ${cycle.code}?`);
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const res = await apiSend<Record<string, unknown>>(CYCLES_API, "POST", { action, cycleId: cycle.id, prefill });
      if (action === "openGoal" && prefill) {
        const pf = res.prefill as { copied: number; noSource: { employeeName: string }[]; skipped: { employeeName: string }[] } | undefined;
        if (pf) toast.success(t("Fase target dibuka — prefill: {c} terisi, {n} tanpa sumber, {s} dilewati", "Goal phase opened — prefill: {c} filled, {n} without source, {s} skipped", { c: String(pf.copied), n: String(pf.noSource.length), s: String(pf.skipped.length) }));
      } else {
        toast.success(t("Fase: {s}", "Phase: {s}", { s: label }));
      }
      detailApi.refresh();
      listApi.refresh();
      ccApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const doCopyTeam = async () => {
    if (!cycle) return;
    setBusy(true);
    try {
      const res = await apiSend<{ copied: number; noSource: { employeeName: string }[]; skipped: { employeeName: string }[] }>(CYCLES_API, "POST", {
        action: "copyTeam", cycleId: cycle.id, ...(copySource !== "auto" ? { sourceCycleId: copySource } : {}),
      });
      toast.success(t("Salin tim: {c} terisi · {n} tanpa sumber (tawarkan template) · {s} dilewati (sudah isi)", "Team copy: {c} filled · {n} without source (offer template) · {s} skipped (already filled)", {
        c: String(res.copied), n: String(res.noSource.length), s: String(res.skipped.length),
      }));
      setCopyTeamDialog(false);
      detailApi.refresh();
      ccApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const doNudge = async (all: boolean) => {
    if (!cycle) return;
    const channels = Object.keys(nudgeChannels).filter((k) => nudgeChannels[k]);
    if (channels.length === 0) { toast.error(t("Pilih minimal satu kanal", "Pick at least one channel")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ sent: { employeeName: string; channels: string[] }[]; rateLimited: string[]; queuedOutsideWorkHours: boolean; phase?: string; recipients?: number }>(CYCLES_API, "POST", {
        action: all ? "nudgeAll" : "nudge",
        cycleId: cycle.id,
        ...(all ? {} : { appraisalIds: nudgeTargets }),
        channels,
        message: nudgeMsg || undefined,
      });
      toast.success(t("Nudge terkirim ke {n} peserta ({rl} dibatasi rate-limit){q}", "Nudges sent to {n} participants ({rl} rate-limited){q}", {
        n: String(res.sent.length),
        rl: String(res.rateLimited.length),
        q: res.queuedOutsideWorkHours ? t(" — di luar jam kerja, diantrekan", " — outside work hours, queued") : "",
      }));
      setNudgeDialog(false);
      setNudgeMsg("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const openNudge = (targets: string[]) => {
    setNudgeTargets(targets);
    setNudgeDialog(true);
  };

  // ==================== RENDER: DETAIL ====================
  if (cycleIdParam && cycle) {
    const st = CYCLE_STATUS[cycle.status] ?? CYCLE_STATUS.Draft;
    const phaseActions: { action: string; label: { id: string; en: string }; prefill?: boolean }[] = [];
    if (cycle.status === "Draft") phaseActions.push({ action: "openGoal", label: { id: "Buka Fase Target", en: "Open Goal Phase" } });
    if (cycle.status === "GoalSetting") phaseActions.push({ action: "startOngoing", label: { id: "Mulai Fase Berjalan", en: "Start Ongoing" } });
    if (cycle.status === "Ongoing") phaseActions.push({ action: "startAssessment", label: { id: "Mulai Fase Penilaian", en: "Start Assessment" } });
    if (cycle.status === "Assessment") phaseActions.push({ action: "startCalibration", label: { id: "Mulai Kalibrasi", en: "Start Calibration" } });
    if (cycle.status === "Calibration") phaseActions.push({ action: "publish", label: { id: "Publikasikan Hasil", en: "Publish Results" } });
    if (cycle.status === "Published") phaseActions.push({ action: "close", label: { id: "Tutup Siklus", en: "Close Cycle" } });

    const lagging = ccApi.data?.participants.filter((p) => !p.targetDone).length ?? 0;
    return (
      <div>
        <PageHeader
          eyebrow={t("Performance · Siklus Penilaian")}
          title={`${cycle.code} — ${cycle.name}`}
          description={t(
            `Periode ${fmtDate(cycle.periodStart, lang)} – ${fmtDate(cycle.periodEnd, lang)} · ${participants.length} peserta`,
            `Period ${fmtDate(cycle.periodStart, lang)} – ${fmtDate(cycle.periodEnd, lang)} · ${participants.length} participants`,
          )}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => nav.navigate("performance", "cycles")}>
                <ChevronLeft className="h-4 w-4" aria-hidden /> {t("Daftar Siklus", "Cycle List")}
              </Button>
              {phaseActions.map((a) => (
                a.action === "openGoal" ? (
                  <Button key={a.action} onClick={() => doAdvance(a.action, t(a.label.id, a.label.en))}>
                    <Zap className="h-4 w-4" aria-hidden /> {t(a.label.id, a.label.en)}
                  </Button>
                ) : (
                  <Button key={a.action} variant="outline" onClick={() => doAdvance(a.action, t(a.label.id, a.label.en))}>
                    <ArrowRight className="h-4 w-4" aria-hidden /> {t(a.label.id, a.label.en)}
                  </Button>
                )
              ))}
            </div>
          )}
        />

        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", st.tone)}>{t(st.id, st.en)}</span>
          {cycle.status === "Draft" && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEnrollDialog(true)}><UserPlus className="h-3.5 w-3.5" aria-hidden /> {t("Enroll Peserta", "Enroll Participants")}</Button>
              <Button size="sm" variant="outline" onClick={doEnrollAll}><Users className="h-3.5 w-3.5" aria-hidden /> {t("Semua Active", "All Active")}</Button>
              <Button size="sm" variant="ghost" onClick={() => openEdit(cycle)}><Pencil className="h-3.5 w-3.5" aria-hidden /> {t("Ubah")}</Button>
            </>
          )}
          {cycle.status === "GoalSetting" && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEnrollDialog(true)}><UserPlus className="h-3.5 w-3.5" aria-hidden /> {t("Enroll", "Enroll")}</Button>
              <Button size="sm" variant="outline" onClick={() => setCopyTeamDialog(true)}><Copy className="h-3.5 w-3.5" aria-hidden /> {t("Salin Tim dari Periode Lalu", "Copy Team from Previous")}</Button>
              <Button size="sm" variant="outline" onClick={() => nav.setParams({ ...nav.params, wizard: "import" })}><FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> {t("Impor Excel Target", "Import Target Excel")}</Button>
            </>
          )}
        </div>

        <Tabs defaultValue="participants" className="w-full">
          <TabsList className="mb-3 bg-slate-100 p-1 dark:bg-slate-900">
            <TabsTrigger value="participants"><Users className="h-3.5 w-3.5" aria-hidden /> {t("Peserta", "Participants")} ({participants.length})</TabsTrigger>
            <TabsTrigger value="command"><Megaphone className="h-3.5 w-3.5" aria-hidden /> {t("Command Center", "Command Center")}</TabsTrigger>
          </TabsList>

          <TabsContent value="participants">
            <Card>
              <CardContent className="p-0">
                {detailApi.loading && !detailApi.data ? (
                  <div className="p-4"><LoadingRows /></div>
                ) : participants.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title={t("Belum ada peserta", "No participants yet")}
                      description={t("Enroll karyawan Active ke siklus ini — atasan penilai di-snapshot otomatis dari penempatan.", "Enroll Active employees — the rater manager is snapshotted from placement.")}
                      icon={Users}
                    />
                  </div>
                ) : (
                  <div className="max-h-[34rem] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                        <TableRow>
                          <TableHead>{t("Dokumen")}</TableHead>
                          <TableHead>{t("Karyawan", "Employee")}</TableHead>
                          <TableHead className="hidden md:table-cell">{t("Atasan Penilai", "Rater Manager")}</TableHead>
                          <TableHead>{t("Target")}</TableHead>
                          <TableHead className="hidden lg:table-cell">{t("Progres")}</TableHead>
                          <TableHead>{t("Status")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {participants.map((p) => (
                          <TableRow key={p.appraisalId} className="cursor-pointer" onClick={() => nav.navigate("performance", "goals", { id: p.appraisalId })}>
                            <TableCell className="font-mono text-xs">{p.docNo}</TableCell>
                            <TableCell>
                              <p className="font-semibold">{p.employeeName}</p>
                              <p className="text-xs text-slate-500">{p.employeeNo} · {p.position ?? "—"}</p>
                              {p.goalsCopiedFrom && (
                                <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-fuchsia-50 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-400">
                                  <Copy className="h-2.5 w-2.5" aria-hidden /> {t("disalin dari", "copied from")} {p.goalsCopiedFrom}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="hidden text-sm md:table-cell">{p.managerName ?? <span className="text-rose-500">{t("perlu atasan", "needs manager")}</span>}</TableCell>
                            <TableCell className="text-sm">
                              {p.kpiCount > 0 ? (
                                <span>{p.kpiCount} KPI · Σ{Math.round(p.weightSum)}%</span>
                              ) : <span className="text-slate-400">—</span>}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                  <div className={cn("h-full rounded-full", p.progressPct >= 100 ? "bg-emerald-500" : p.progressPct >= 50 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${p.progressPct}%` }} />
                                </div>
                                <span className="text-xs tabular-nums text-slate-500">{p.progressPct}%</span>
                              </div>
                            </TableCell>
                            <TableCell><StatusPill status={p.status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="command">
            <Card>
              <CardContent className="p-4">
                {ccApi.loading && !ccApi.data ? (
                  <LoadingRows />
                ) : !ccApi.data ? (
                  <EmptyState title={t("Command Center", "Command Center")} icon={Megaphone} description="" />
                ) : (
                  <>
                    {/* ringkasan fase */}
                    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: t("Target terkunci", "Targets locked"), n: ccApi.data.totals.targetDone, total: ccApi.data.totals.participants },
                        { label: t("Self selesai", "Self done"), n: ccApi.data.totals.selfDone, total: ccApi.data.totals.participants },
                        { label: t("Atasan selesai", "Manager done"), n: ccApi.data.totals.managerDone, total: ccApi.data.totals.participants },
                        { label: t("Acknowledge", "Acknowledged"), n: ccApi.data.totals.acknowledged, total: ccApi.data.totals.participants },
                      ].map((x) => (
                        <div key={x.label} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                          <p className="text-xs text-slate-500 dark:text-slate-400">{x.label}</p>
                          <p className="text-xl font-bold tabular-nums">{x.n}<span className="text-sm font-normal text-slate-400">/{x.total}</span></p>
                        </div>
                      ))}
                    </div>
                    {/* agregat per atasan */}
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <Layers className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Agregat per Atasan", "Per-Manager Aggregate")}
                    </h3>
                    <div className="mb-4 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("Atasan", "Manager")}</TableHead>
                            <TableHead>{t("Tim", "Team")}</TableHead>
                            <TableHead>{t("Target")}</TableHead>
                            <TableHead className="hidden sm:table-cell">{t("Self")}</TableHead>
                            <TableHead className="hidden sm:table-cell">{t("Mgr")}</TableHead>
                            <TableHead>{t("Rata-rata Progres", "Avg Progress")}</TableHead>
                            <TableHead className="w-24" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ccApi.data.managers.map((m) => (
                            <TableRow key={m.managerId} className={cn(m.progressPct < 50 && "bg-amber-50/50 dark:bg-amber-950/20")}>
                              <TableCell className="font-semibold">{m.managerName}</TableCell>
                              <TableCell className="tabular-nums">{m.team}</TableCell>
                              <TableCell className="tabular-nums">{m.targetDone}/{m.team}</TableCell>
                              <TableCell className="hidden tabular-nums sm:table-cell">{m.selfDone}/{m.team}</TableCell>
                              <TableCell className="hidden tabular-nums sm:table-cell">{m.managerDone}/{m.team}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                    <div className={cn("h-full rounded-full", m.progressPct >= 80 ? "bg-emerald-500" : m.progressPct >= 40 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${m.progressPct}%` }} />
                                  </div>
                                  <span className="text-xs tabular-nums">{m.progressPct}%</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Button size="sm" variant="outline" onClick={() => openNudge(ccApi.data!.participants.filter((p) => p.managerId === m.managerId && !p.targetDone).map((p) => p.appraisalId))}>
                                  <Bell className="h-3.5 w-3.5" aria-hidden /> {t("Remind", "Remind")}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {/* matriks peserta */}
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{t("Matriks Peserta", "Participant Matrix")}</h3>
                      <Button size="sm" onClick={() => openNudge(ccApi.data!.participants.filter((p) => !p.targetDone).map((p) => p.appraisalId))} disabled={lagging === 0}>
                        <Send className="h-3.5 w-3.5" aria-hidden /> {t("Remind All — {n} penerima", "Remind All — {n} recipients", { n: String(lagging) })}
                      </Button>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                          <TableRow>
                            <TableHead>{t("Karyawan", "Employee")}</TableHead>
                            <TableHead>{t("Target")}</TableHead>
                            <TableHead>{t("Self")}</TableHead>
                            <TableHead>{t("Mgr")}</TableHead>
                            <TableHead className="hidden sm:table-cell">{t("Ack")}</TableHead>
                            <TableHead className="w-20" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ccApi.data.participants.map((p) => (
                            <TableRow key={p.appraisalId}>
                              <TableCell>
                                <p className="font-medium">{p.employeeName}</p>
                                <p className="text-xs text-slate-500">{p.orgUnit ?? "—"} · {p.managerName ?? "—"}</p>
                              </TableCell>
                              <TableCell>{p.targetDone ? "✅" : <span className="text-amber-500">◻</span>}</TableCell>
                              <TableCell>{p.selfDone ? "✅" : <span className="text-slate-300">◻</span>}</TableCell>
                              <TableCell>{p.managerDone ? "✅" : <span className="text-slate-300">◻</span>}</TableCell>
                              <TableCell className="hidden sm:table-cell">{p.acknowledged ? "✅" : <span className="text-slate-300">◻</span>}</TableCell>
                              <TableCell>
                                {!p.targetDone && (
                                  <Button size="sm" variant="ghost" onClick={() => openNudge([p.appraisalId])} aria-label={t("Ingatkan", "Remind")}>
                                    <Bell className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* enroll dialog */}
        <Dialog open={enrollDialog} onOpenChange={setEnrollDialog}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader><DialogTitle>{t("Enroll Peserta", "Enroll Participants")}</DialogTitle></DialogHeader>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input value={enrollQ} onChange={(e) => setEnrollQ(e.target.value)} placeholder={t("Cari karyawan…", "Search employees…")} className="pl-8" />
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
              {(enrollApi.data?.employees ?? []).map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
                  <Checkbox
                    checked={enrollSel.has(e.id) || e.enrolled}
                    disabled={e.enrolled}
                    onCheckedChange={(v) => {
                      const next = new Set(enrollSel);
                      if (v) next.add(e.id); else next.delete(e.id);
                      setEnrollSel(next);
                    }}
                  />
                  <span className="flex-1">
                    <span className="font-medium">{e.fullName}</span>
                    <span className="ml-2 text-xs text-slate-500">{e.employeeNo} · {e.position ?? "—"} · {e.orgUnit ?? "—"}</span>
                  </span>
                  {e.enrolled && <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{t("sudah peserta", "already enrolled")}</span>}
                </label>
              ))}
            </div>
            <DialogFooter>
              <span className="mr-auto text-xs text-slate-500">{t("{n} dipilih", "{n} selected", { n: String(enrollSel.size) })}</span>
              <Button variant="outline" onClick={() => setEnrollDialog(false)}>{t("Batal")}</Button>
              <Button onClick={doEnroll} disabled={busy || enrollSel.size === 0}>{t("Enroll {n} Peserta", "Enroll {n} Participants", { n: String(enrollSel.size) })}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* salin tim dialog */}
        <Dialog open={copyTeamDialog} onOpenChange={setCopyTeamDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Copy className="h-5 w-5 ov-text-accent" aria-hidden /> {t("Salin Tim dari Periode Lalu", "Copy Team from Previous Cycle")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="rounded-lg bg-fuchsia-50 p-3 text-xs text-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300">
                {t(
                  "Tiap peserta TANPA baris KPI akan diisi dari siklus sumber masing-masing (D15: periode terdekat milik peserta sama). Peserta yang sudah punya baris DILEWATI (bukan error). Hasil = baris draf — tiap peserta tetap menunggu review + submit.",
                  "Each participant WITHOUT KPI rows gets filled from their own source cycle (D15: nearest previous period of the same participant). Participants with existing rows are SKIPPED (not an error). Result = draft rows — each still awaits review + submit.",
                )}
              </p>
              <div className="space-y-1.5">
                <Label>{t("Siklus sumber", "Source cycle")}</Label>
                <Select value={copySource} onValueChange={setCopySource}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t("Otomatis per peserta (disarankan)", "Auto per participant (recommended)")}</SelectItem>
                    {(srcApi.data?.cycles ?? []).map((c) => (
                      <SelectItem key={c.cycleId} value={c.cycleId}>{c.cycleCode} · {c.cycleName} ({c.participantsWithSource})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCopyTeamDialog(false)}>{t("Batal")}</Button>
              <Button onClick={doCopyTeam} disabled={busy}>{busy ? t("Menyalin…", "Copying…") : t("Salin Tim", "Copy Team")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* nudge dialog */}
        <Dialog open={nudgeDialog} onOpenChange={setNudgeDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5 ov-text-accent" aria-hidden /> {t("Kirim Pengingat (Nudge)", "Send Reminder (Nudge)")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm">
                {t("{n} penerima dipilih.", "{n} recipients selected.", { n: String(nudgeTargets.length) })}
                <span className="ml-1 text-xs text-slate-500">{t("Rate-limit: 1 per peserta per kanal per 6 jam (D17).", "Rate limit: 1 per participant per channel per 6 hours (D17).")}</span>
              </p>
              <div className="space-y-1.5">
                <Label>{t("Kanal", "Channels")}</Label>
                <div className="flex flex-wrap gap-4">
                  {[
                    ["in_app", t("Dalam aplikasi", "In-app")],
                    ["email", t("Email")],
                    ["whatsapp", t("WhatsApp (adapter)", "WhatsApp (adapter)")],
                  ].map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={nudgeChannels[k]}
                        disabled={k === "whatsapp" && !process.env.NEXT_PUBLIC_WA_ENABLED}
                        onCheckedChange={(v) => setNudgeChannels({ ...nudgeChannels, [k]: Boolean(v) })}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Pesan (opsional — kosongkan utk pesan standar)", "Message (optional — leave blank for the standard message)")}</Label>
                <Input value={nudgeMsg} onChange={(e) => setNudgeMsg(e.target.value)} placeholder={t("mis. Mohon selesai sebelum akhir bulan", "e.g. Please finish before month end")} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNudgeDialog(false)}>{t("Batal")}</Button>
              <Button onClick={() => doNudge(nudgeTargets.length === 0)} disabled={busy}><Send className="h-4 w-4" aria-hidden /> {t("Kirim", "Send")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ==================== RENDER: DAFTAR ====================
  const rows = listApi.data?.rows ?? [];
  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Siklus Penilaian")}
        title={t("Siklus Penilaian", "Appraisal Cycles")}
        description={t(
          "Kelola siklus tahunan/paruh tahun: periode, jendela fase tergerbang, enroll peserta (atasan di-snapshot), Command Center nudge multi-kanal.",
          "Manage annual/semi-annual cycles: period, gated phase windows, participant enrollment (manager snapshotted), multi-channel Command Center nudges.",
        )}
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" aria-hidden /> {t("Siklus Baru", "New Cycle")}</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setDq(q); }} placeholder={t("Cari kode / nama… (Enter)", "Search code / name… (Enter)")} className="w-64 pl-8" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua status", "All statuses")}</SelectItem>
            {Object.entries(CYCLE_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{t(v.id, v.en)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-0">
          {listApi.loading && !listApi.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={t("Belum ada siklus — buat siklus pertama Anda", "No cycles yet — create your first cycle")}
                description={t("Siklus menampung periode, fase, peserta, dan seluruh penilaian.", "A cycle holds the period, phases, participants, and all appraisals.")}
                icon={CalendarClock}
              />
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead>{t("Kode", "Code")}</TableHead>
                    <TableHead>{t("Nama", "Name")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Periode")}</TableHead>
                    <TableHead>{t("Peserta", "Participants")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const st = CYCLE_STATUS[r.status] ?? CYCLE_STATUS.Draft;
                    return (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => nav.navigate("performance", "cycles", { id: r.id })}>
                        <TableCell className="font-mono text-xs font-semibold">{r.code}</TableCell>
                        <TableCell>
                          <p className="font-semibold">{r.name}</p>
                          <p className="text-xs text-slate-500">{t("Tahunan", "Annual")}</p>
                        </TableCell>
                        <TableCell className="hidden text-sm md:table-cell">{fmtDate(r.periodStart, lang)} – {fmtDate(r.periodEnd, lang)}</TableCell>
                        <TableCell className="tabular-nums">{r.participantCount}</TableCell>
                        <TableCell><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.tone)}>{t(st.id, st.en)}</span></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* dialog create/edit siklus */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ClipboardPen className="h-5 w-5 ov-text-accent" aria-hidden />
              {form.id ? t("Ubah Siklus", "Edit Cycle") : t("Siklus Baru", "New Cycle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Kode *", "Code *")}</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={Boolean(form.id)} placeholder={t("mis. PER-2026", "e.g. PER-2026")} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Nama *", "Name *")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("Penilaian Kinerja 2026", "Performance Appraisal 2026")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Tipe")}</Label>
              <Select value={form.cycleType} onValueChange={(v) => setForm({ ...form, cycleType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Annual">{t("Tahunan", "Annual")}</SelectItem>
                  <SelectItem value="MidYearOnly">{t("Paruh Tahun", "Mid-Year Only")}</SelectItem>
                  <SelectItem value="OffCycle">{t("Luar Siklus", "Off-Cycle")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("Periode Awal *", "Period Start *")}</Label>
                <Input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Periode Akhir *", "Period End *")}</Label>
                <Input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
              </div>
            </div>
            <p className="sm:col-span-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              {t("Jendela fase (kosongkan untuk melewati fase — kronologis dalam periode)", "Phase windows (leave blank to skip a phase — chronological within the period)")}
            </p>
            {([
              ["goalStart", "goalEnd", t("Target (Goal)", "Goal")],
              ["midStart", "midEnd", t("Tengah Tahun (Mid)", "Mid-Year")],
              ["selfStart", "selfEnd", t("Penilaian Diri (Self)", "Self")],
              ["mgrStart", "mgrEnd", t("Penilaian Atasan (Mgr)", "Manager")],
              ["calibStart", "calibEnd", t("Kalibrasi", "Calibration")],
            ] as [keyof typeof form, keyof typeof form, string][]).map(([s, e, label]) => (
              <div key={String(s)} className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{label} — {t("awal", "start")}</Label>
                  <Input type="date" value={String(form[s] ?? "")} onChange={(ev) => setForm({ ...form, [s]: ev.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{label} — {t("akhir", "end")}</Label>
                  <Input type="date" value={String(form[e] ?? "")} onChange={(ev) => setForm({ ...form, [e]: ev.target.value })} />
                </div>
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={form.feedback360} onCheckedChange={(v) => setForm({ ...form, feedback360: Boolean(v) })} />
              {t("Aktifkan umpan balik 360 pada siklus ini (D3 — opsional)", "Enable 360 feedback for this cycle (D3 — optional)")}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal")}</Button>
            <Button onClick={save} disabled={busy}>{busy ? t("Menyimpan…", "Saving…") : t("Simpan")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
