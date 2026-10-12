"use client";
// P1-PERF — ESS Target Saya (§14.3; §26-4 MBO usulan KPI; §18.3 AMANDEMEN 1
// tab periode lalu + "Usulkan KPI yang sama dengan periode lalu").
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { Target, Zap, Copy, Plus, Trash2, Send, History, Info, MessagesSquare } from "lucide-react";

const API = "/api/rekankerja/ess/my-goals";

interface Kpi {
  id: string; title: string; polarity: string; unit: string;
  thresholdMin: number | null; target: number; stretchValue: number | null;
  weight: number; dataSource: string; proposedBy: string; origin: string; midActual: number | null;
}
interface GoalsData {
  active: {
    appraisalId: string; docNo: string; status: string;
    cycle: { code: string; name: string; goalEnd: string | null; status: string };
    kpis: Kpi[]; goalsCopiedFrom: string | null;
  } | null;
  past: { cycleCode: string; finalScore: number | null; finalRating: number | null; kpis: { id: string; title: string; target: number; weight: number; finalActual: number | null }[] } | null;
  canPropose: boolean;
  note?: string;
  checkins?: { id: string; heldAt: string; agenda: string | null; status: string; notesJson: string; managerComment: string | null; nextCheckInAt: string | null }[];
}

type Draft = { kpiDefId?: string | null; title: string; polarity: string; unit: string; thresholdMin: number | null; target: number; stretchValue?: number | null; weight: number; isCritical?: boolean };

export function EssMyGoalsPage() {
  const { t } = useI18n();
  const api = useApi<GoalsData>(API);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);

  const data = api.data;
  const weightSum = useMemo(() => drafts.reduce((s, d) => s + (Number(d.weight) || 0), 0), [drafts]);

  const propose = async () => {
    if (drafts.length === 0) return;
    if (Math.abs(weightSum - 100) > 0.01) {
      toast.error(t("Jumlah bobot usulan harus 100 (sekarang {w})", "Proposed weights must total 100 (now {w})", { w: String(Math.round(weightSum)) }));
      return;
    }
    if (!window.confirm(t("Kirim usulan KPI ke atasan? Atasan dapat menerima, mengubah, atau menolak.", "Send KPI proposal to your manager? They may accept, edit, or reject."))) return;
    setBusy(true);
    try {
      await apiSend(API, "POST", { action: "propose", kpis: drafts });
      toast.success(t("Usulan terkirim — status Anda menjadi GoalProposed", "Proposal sent — your status becomes GoalProposed"));
      setDrafts([]);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const proposeFromPast = () => {
    const past = data?.past;
    if (!past || past.kpis.length === 0) return;
    const per = Math.floor(100 / past.kpis.length);
    const first = 100 - per * (past.kpis.length - 1);
    setDrafts(past.kpis.map((k, i) => ({
      title: k.title, polarity: "Higher", unit: "%", thresholdMin: null,
      target: k.target, weight: i === 0 ? first : per,
    })));
    toast.info(t("KPI periode lalu dimuat sebagai nilai awal usulan — sesuaikan sebelum kirim (§18.3).", "Last period's KPIs loaded as initial proposal values — adjust before sending (§18.3)."));
  };

  const a = data?.active;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Target className="h-6 w-6 text-fuchsia-600 dark:text-fuchsia-400" aria-hidden />
          {t("Target Saya", "My Goals")}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("Target KPI periode aktif Anda + progres tengah tahun. Usulan KPI (MBO) dapat diajukan saat fase penetapan target.", "Your active-period KPI targets + mid-year progress. KPI proposals (MBO) can be submitted during the goal-setting phase.")}
        </p>
      </div>

      {api.loading && !api.data ? <LoadingRows /> : !a ? (
        <Card><CardContent className="p-6">
          <EmptyState icon={Target} title={t("Belum terdaftar di siklus penilaian aktif", "Not enrolled in an active appraisal cycle")} description={data?.note ?? ""} />
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="current" className="w-full">
          <TabsList className="bg-slate-100 p-1 dark:bg-slate-900">
            <TabsTrigger value="current">{a.cycle.code}</TabsTrigger>
            {data?.past && <TabsTrigger value="past"><History className="h-3.5 w-3.5" aria-hidden /> {t("Periode lalu", "Past period")}</TabsTrigger>}
          </TabsList>

          <TabsContent value="current" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-fuchsia-50/60 p-3 text-sm dark:bg-fuchsia-950/20">
              <span>
                <strong>{a.docNo}</strong> · {a.cycle.name}
                {a.cycle.goalEnd && <> · {t("tenggat", "deadline")} <strong>{new Date(a.cycle.goalEnd).toLocaleDateString("id-ID")}</strong></>}
              </span>
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold",
                a.status === "GoalApproved" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" :
                a.status === "GoalProposed" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400" :
                "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                {a.status === "GoalApproved" ? t("Target disetujui & terkunci", "Targets approved & locked") :
                 a.status === "GoalProposed" ? t("Usulan menunggu keputusan atasan", "Proposal awaiting manager decision") :
                 t("Menunggu atasan menetapkan target", "Awaiting manager's targets")}
              </span>
            </div>

            {a.kpis.length === 0 ? (
              <Card><CardContent className="p-6 text-sm text-slate-500 dark:text-slate-400">
                {t("Atasan Anda belum menetapkan target KPI. Bila mode MBO aktif, Anda dapat mengusulkan sendiri di bawah.", "Your manager has not set KPI targets yet. If MBO mode is active, you may propose your own below.")}
              </CardContent></Card>
            ) : (
              <div className="grid gap-2">
                {a.kpis.map((k, i) => (
                  <div key={k.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-800">{i + 1}</span>
                      <span className="flex-1 font-semibold">{k.title}</span>
                      {k.dataSource !== "Manual" && <span className="inline-flex items-center gap-0.5 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-950/60 dark:text-teal-400"><Zap className="h-3 w-3" aria-hidden /> AUTO</span>}
                      {k.proposedBy === "Employee" && <span className="rounded bg-fuchsia-50 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-400">{t("usulan Anda", "your proposal")}</span>}
                      <span className="text-xs text-slate-400">{k.weight}%</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {t("Ambang", "Threshold")} {k.thresholdMin ?? "—"} · {t("Target", "Target")} <strong>{k.target}</strong> {k.unit}{k.stretchValue != null ? ` · Stretch ${k.stretchValue}` : ""}
                      {k.midActual != null && <> · {t("progress tengah tahun", "mid-year progress")}: <strong>{k.midActual}</strong></>}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* usulan MBO (§26-4) */}
            {data?.canPropose && (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Usulkan KPI Anda sendiri (MBO)", "Propose your own KPIs (MBO)")}</h3>
                    {data?.past && data.past.kpis.length > 0 && (
                      <Button size="sm" variant="outline" onClick={proposeFromPast}>
                        <Copy className="h-3.5 w-3.5" aria-hidden /> {t("Usulkan KPI yang sama dengan periode lalu", "Propose the same KPIs as last period")}
                      </Button>
                    )}
                  </div>
                  {drafts.length > 0 && (
                    <div className="grid gap-2">
                      {drafts.map((d, i) => (
                        <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800 sm:grid-cols-6">
                          <Input className="sm:col-span-2" value={d.title} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder={t("Judul KPI", "KPI title")} />
                          <Input value={d.unit} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} placeholder={t("satuan", "unit")} />
                          <Input type="number" value={d.target} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)))} placeholder={t("target")} />
                          <Input type="number" value={d.weight} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} placeholder={t("bobot %", "weight %")} />
                          <Button variant="ghost" size="sm" className="text-rose-600 dark:text-rose-400" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                        </div>
                      ))}
                      <p className={cn("text-xs font-semibold", Math.abs(weightSum - 100) < 0.01 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>Σ {Math.round(weightSum)}%</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDrafts([...drafts, { title: "", polarity: "Higher", unit: "", thresholdMin: null, target: 0, weight: 0 }])}>
                      <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah KPI usulan", "Add proposed KPI")}
                    </Button>
                    <Button size="sm" onClick={propose} disabled={busy || drafts.length === 0}>
                      <Send className="h-3.5 w-3.5" aria-hidden /> {t("Kirim Usulan ke Atasan", "Send Proposal to Manager")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {data?.past && (
            <TabsContent value="past">
              <Card><CardContent className="p-4">
                <p className="mb-3 text-sm">
                  <strong>{data.past.cycleCode}</strong>
                  {data.past.finalScore != null && <> · {t("skor akhir", "final score")} <strong>{data.past.finalScore}</strong>{data.past.finalRating != null && <> · {t("rating", "rating")} <strong>{data.past.finalRating}</strong></>}</>}
                </p>
                <div className="grid gap-2">
                  {data.past.kpis.map((k) => (
                    <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                      <span className="font-medium">{k.title}</span>
                      <span className="text-xs text-slate-500">
                        {t("Target", "Target")} {k.target} · {k.weight}%
                        {k.finalActual != null && <> · {t("hasil", "actual")} <strong>{k.finalActual}</strong></>}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t("Read-only — riwayat periode sebelumnya tanpa perlu minta file ke HR (§18.3).", "Read-only — your previous period history without asking HR for files (§18.3).")}
                </p>
              </CardContent></Card>
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* riwayat check-in 1-on-1 (ESS my-checkins §17) */}
      {(data?.checkins ?? []).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><MessagesSquare className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Riwayat Check-in 1-on-1", "1-on-1 Check-in History")}</h3>
            <div className="grid gap-2">
              {(data?.checkins ?? []).map((c) => {
                let notes: { wins?: string[]; blockers?: string[]; next?: string[] } = {};
                try { notes = JSON.parse(c.notesJson); } catch { /* */ }
                return (
                  <div key={c.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{new Date(c.heldAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}{c.agenda ? ` — ${c.agenda}` : ""}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        c.status === "Held" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                        : c.status === "Missed" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>{c.status}</span>
                    </div>
                    {(notes.wins?.length || notes.blockers?.length || notes.next?.length) && (
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {notes.wins?.length ? <p>✅ {t("Capaian", "Wins")}: {notes.wins.join("; ")}</p> : null}
                        {notes.blockers?.length ? <p>⛔ {t("Hambatan", "Blockers")}: {notes.blockers.join("; ")}</p> : null}
                        {notes.next?.length ? <p>➡ {t("Rencana", "Next")}: {notes.next.join("; ")}</p> : null}
                      </div>
                    )}
                    {c.managerComment && <p className="mt-1 text-xs italic text-slate-400">“{c.managerComment}”</p>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
