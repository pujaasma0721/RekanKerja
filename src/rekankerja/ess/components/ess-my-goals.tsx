"use client";
// ============================================================================
// RekanKerja ESS P1-PERF — "Target Saya" (§14.6, §18.3, §26-6):
//   • Target siklus AKTIF: rincian KPI terlihat SETELAH atasan mengunci
//     (GoalApproved) — sebelum itu hanya status (draf atasan+HR tidak bocor).
//   • Tab/accordion "Periode lalu": riwayat KPI siklus terdahulu read-only
//     (judul · target · bobot · capaian akhir ringkas) — karyawan tahu apa
//     yang dikerjakan tahun sebelumnya tanpa minta file ke HR.
//   • Mode MBO (§26-4): tombol "Usulkan KPI" saat fase GoalSetting —
//     mengusulkan baris (status GoalProposed); atasan menyetujui/mengubah/
//     menolak di sisi atasan.
// ============================================================================
import { useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ESS_BASE } from "./ess-api";
import { ListChecks, History, Sparkles, Loader2, ChevronDown, Copy, CheckCircle2, Info, Gauge, Ruler } from "lucide-react";

// ---------- tipe (mirror kontrak GET /ess/my-goals) ----------

interface MyGoalKpi {
  id: string; title: string; polarity: string; unit: string;
  description: string | null; measureMode: string; metric: string | null;
  thresholdMin: number | null; target: number; stretchValue: number | null;
  weight: number; isCritical: boolean; origin: string; proposedBy: string;
}
interface MyGoalCycle { code: string; name: string; status: string; periodStart: string; periodEnd: string }
interface MyGoalBlock {
  appraisalId: string; docNo: string; status: string; cycle: MyGoalCycle;
  goalsCopiedFrom: string | null;
  kpis: MyGoalKpi[];
  proposalOpen: boolean; canPropose: boolean;
  finalScore: number | null; finalRating: number | null;
  finalActuals: { title: string; finalActual: number | null; midActual: number | null; unit: string; weight: number }[];
}
interface MyGoalsResp { current: MyGoalBlock | null; previous: MyGoalBlock[] }

export function EssMyGoalsPage() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<MyGoalsResp>(`${ESS_BASE}/my-goals`);
  const [tab, setTab] = useState<"current" | "previous">("current");
  const [proposeFor, setProposeFor] = useState<MyGoalBlock | null>(null);

  const cur = data?.current;
  const reveal = !!cur && cur.kpis.length > 0;
  const sumW = cur?.kpis.reduce((s, k) => s + k.weight, 0) ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Target Saya", "My Goals")}
        description={t(
          "Target KPI periode berjalan + riwayat periode lalu. Usulan KPI (MBO) bisa diajukan saat fase penetapan target dibuka.",
          "KPI targets for the running period + previous-period history. KPI proposals (MBO) can be submitted while the goal-setting phase is open.",
        )}
      />

      {/* tab */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50/60 p-1 dark:border-slate-800 dark:bg-slate-900/40" role="tablist">
        <button role="tab" aria-selected={tab === "current"} onClick={() => setTab("current")}
          className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition", tab === "current" ? "bg-white shadow-sm dark:bg-slate-800" : "text-slate-500")}>
          <ListChecks className="mr-1.5 inline h-4 w-4" />{t("Periode Berjalan", "Current Period")}
        </button>
        <button role="tab" aria-selected={tab === "previous"} onClick={() => setTab("previous")}
          className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition", tab === "previous" ? "bg-white shadow-sm dark:bg-slate-800" : "text-slate-500")}>
          <History className="mr-1.5 inline h-4 w-4" />{t("Periode Lalu", "Previous Periods")}
        </button>
      </div>

      {error && <EmptyState title={t("Gagal memuat target", "Failed to load goals")} description={error} icon={ListChecks} />}
      {loading && <LoadingRows rows={4} />}

      {tab === "current" && data && (
        !cur ? (
          <EmptyState
            icon={ListChecks}
            title={t("Belum ada siklus penilaian", "No appraisal cycle yet")}
            description={t("Anda belum terdaftar di siklus penilaian mana pun. HR akan mendaftarkan Anda saat siklus dibuka.", "You are not enrolled in any appraisal cycle yet. HR will enroll you when a cycle opens.")}
          />
        ) : (
          <>
            <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{cur.cycle.code}</span>
                  <StatusPill status={cur.status} />
                  <span className="ml-auto font-mono text-xs text-slate-400">{cur.docNo}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {cur.cycle.periodStart.slice(0, 10)} → {cur.cycle.periodEnd.slice(0, 10)}
                  {cur.goalsCopiedFrom && (
                    <Badge variant="outline" className="ml-2 h-4 px-1 text-[9px] text-brand border-brand/40">
                      <Copy className="mr-0.5 h-2.5 w-2.5" />{t(`disalin dari ${cur.goalsCopiedFrom}`, `copied from ${cur.goalsCopiedFrom}`)}
                    </Badge>
                  )}
                </p>

                {reveal ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <th className="py-1.5 pr-2 font-medium">{t("KPI", "KPI")}</th>
                          <th className="py-1.5 pr-2 font-medium">{t("Ambang", "Threshold")}</th>
                          <th className="py-1.5 pr-2 font-medium">{t("Target", "Target")}</th>
                          <th className="py-1.5 pr-2 font-medium">Stretch</th>
                          <th className="py-1.5 font-medium">{t("Bobot", "Weight")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cur.kpis.map((k) => (
                          <tr key={k.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                            <td className="py-1.5 pr-2">
                              <span className="font-medium">{k.title}</span>
                              {k.isCritical && <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px] text-rose-600">{t("kritis", "critical")}</Badge>}
                              {k.measureMode === "Descriptor" && <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px] text-brand border-brand/40">{t("Deskriptif 1–5", "Descriptor 1–5")}</Badge>}
                              <span className="block text-[10px] text-slate-400">{k.unit} · {k.polarity}</span>
                              {k.description && <span className="mt-0.5 block max-w-md text-[10px] text-slate-500 dark:text-slate-400">{k.description}</span>}
                              {(() => {
                                if (!k.metric) return null;
                                return (
                                  <details className="mt-1">
                                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-brand hover:underline">
                                      <Ruler className="h-3 w-3" />{t("Metric / Measure of Success", "Metric / Measure of Success")}
                                    </summary>
                                    <p className="mt-1 max-w-md whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50/60 p-2 text-[10px] leading-snug text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">{k.metric}</p>
                                  </details>
                                );
                              })()}
                            </td>
                            <td className="py-1.5 pr-2 tabular-nums">{k.thresholdMin ?? (k.polarity === "Boolean" ? "—" : "—")}</td>
                            <td className="py-1.5 pr-2 tabular-nums font-medium">{k.target}</td>
                            <td className="py-1.5 pr-2 tabular-nums text-slate-500">{k.stretchValue ?? "—"}</td>
                            <td className="py-1.5 tabular-nums">{k.weight}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-slate-400">Σ {t("bobot", "weight")} {sumW}%</p>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                    <Info className="mb-1 inline h-4 w-4 text-slate-400" />
                    {t(
                      "Atasan Anda belum mengunci target untuk periode ini. Rincian akan muncul di sini setelah target ditetapkan.",
                      "Your manager has not locked goals for this period yet. Details will appear here once goals are set.",
                    )}
                  </div>
                )}

                {cur.canPropose && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => setProposeFor(cur)}>
                      <Sparkles className="h-4 w-4" /> {t("Usulkan KPI (MBO)", "Propose KPI (MBO)")}
                    </Button>
                    <span className="text-xs text-slate-500">
                      {t("Atasan akan menyetujui / mengubah / menolak usulan Anda (§26-4).", "Your manager will approve / amend / reject your proposal (§26-4).")}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )
      )}

      {tab === "previous" && data && (
        data.previous.length === 0 ? (
          <EmptyState
            icon={History}
            title={t("Belum ada riwayat periode lalu", "No previous periods yet")}
            description={t("Riwayat target periode terdahulu akan muncul setelah siklus pertama Anda selesai.", "Past-period target history will appear after your first cycle completes.")}
          />
        ) : (
          <div className="space-y-2">
            {data.previous.map((p) => (
              <PrevPeriodCard key={p.appraisalId} block={p} />
            ))}
          </div>
        )
      )}

      {proposeFor && (
        <ProposeDialog
          block={proposeFor}
          onClose={() => setProposeFor(null)}
          onDone={() => { setProposeFor(null); refresh(); }}
        />
      )}
    </div>
  );
}

/** Kartu riwayat "Periode lalu" §18.3 — read-only + capaian akhir ringkas. */
function PrevPeriodCard({ block }: { block: MyGoalBlock }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ratingBadge =
    block.finalRating != null
      ? { 1: "bg-rose-100 text-rose-700", 2: "bg-orange-100 text-orange-700", 3: "bg-amber-100 text-amber-700", 4: "bg-teal-100 text-teal-700", 5: "bg-emerald-100 text-emerald-700" }[block.finalRating] ?? "bg-slate-100 text-slate-600"
      : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <button className="flex w-full items-center gap-2 p-3.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-semibold">{block.cycle.code}</p>
          <p className="text-xs text-slate-500">
            {block.cycle.periodStart.slice(0, 10)} → {block.cycle.periodEnd.slice(0, 10)} · {block.kpis.length} KPI
            {block.finalScore != null && ` · ${t("skor akhir", "final score")} ${block.finalScore}`}
          </p>
        </div>
        {ratingBadge && (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ratingBadge)}>
            {t(`rating ${block.finalRating}`, `rating ${block.finalRating}`)}
          </span>
        )}
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-slate-100 p-3 dark:border-slate-800/60">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2 font-medium">{t("KPI", "KPI")}</th>
                <th className="py-1 pr-2 font-medium">{t("Target", "Target")}</th>
                <th className="py-1 pr-2 font-medium">{t("Capaian akhir", "Final actual")}</th>
                <th className="py-1 font-medium">{t("Bobot", "Weight")}</th>
              </tr>
            </thead>
            <tbody>
              {(block.finalActuals.length ? block.finalActuals : block.kpis.map((k) => ({ title: k.title, finalActual: null, midActual: null, unit: k.unit, weight: k.weight }))).map((f, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-800/60">
                  <td className="py-1 pr-2">{f.title}</td>
                  <td className="py-1 pr-2 tabular-nums">{block.kpis[i]?.target ?? "—"} {f.unit}</td>
                  <td className="py-1 pr-2 tabular-nums font-medium">{f.finalActual ?? "—"}</td>
                  <td className="py-1 tabular-nums">{f.weight}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Dialog usulan KPI MBO (§26-4 — dari ESS; guard §35-4 di server). */
function ProposeDialog({ block, onClose, onDone }: { block: MyGoalBlock; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<{ title: string; polarity: string; unit: string; target: string; weight: string; description: string; metric: string }[]>([
    { title: "", polarity: "Higher", unit: "%", target: "", weight: "10", description: "", metric: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const kpiLib = useApi<{ rows: { id: string; name: string; polarity: string; unit: string; description: string | null; measureMode: string; metric: string | null }[] }>(
    "/api/rekankerja/performance/masters?type=kpi",
  );

  const submit = async () => {
    setBusy(true);
    try {
      const valid = items.filter((i) => i.title.trim());
      if (!valid.length) throw new Error(t("Isi minimal satu judul KPI", "Fill at least one KPI title"));
      await apiSend(`${ESS_BASE}/my-goals`, "POST", {
        action: "propose",
        appraisalId: block.appraisalId,
        items: valid.map((i) => ({
          title: i.title.trim(), polarity: i.polarity, unit: i.unit || "%",
          description: i.description.trim() || null,
          metric: i.metric.trim() || null,
          target: i.target === "" ? 0 : Number(i.target),
          weight: i.weight === "" ? 10 : Number(i.weight),
        })),
      });
      toast.success(t(
        "Usulan KPI terkirim — status Anda menjadi GoalProposed; atasan akan menilai usulan ini.",
        "KPI proposal sent — your status becomes GoalProposed; your manager will review it.",
      ));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const setItem = (i: number, patch: Partial<typeof items[number]>) =>
    setItems((xs) => xs.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Usulkan KPI (MBO)", "Propose KPI (MBO)")}</DialogTitle>
          <DialogDescription>
            {t(
              `Siklus ${block.cycle.code} sedang fase penetapan target. Atasan dapat menerima, mengubah, atau menolak usulan Anda.`,
              `Cycle ${block.cycle.code} is in the goal-setting phase. Your manager may accept, amend, or reject your proposal.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
              <div className="col-span-2 space-y-1">
                <Label className="text-[10px]">{t("Judul / pilih dari pustaka", "Title / pick from library")}</Label>
                <Input list="kpi-lib-list" value={it.title} onChange={(e) => {
                  const picked = (kpiLib.data?.rows ?? []).find((k) => k.name === e.target.value);
                  setItem(i, picked
                    ? { title: e.target.value, polarity: picked.polarity, unit: picked.unit, description: picked.description ?? "", metric: picked.metric ?? "" }
                    : { title: e.target.value });
                }}
                  placeholder={t("ketik bebas / pilih KPI baku", "free text / pick a standard KPI")} aria-label={t("Judul KPI", "KPI title")} />
                <datalist id="kpi-lib-list">
                  {(kpiLib.data?.rows ?? []).map((k) => (<option key={k.id} value={k.name} />))}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t("Polaritas", "Polarity")}</Label>
                <Select value={it.polarity} onValueChange={(v) => setItem(i, { polarity: v })}>
                  <SelectTrigger aria-label={t("Polaritas", "Polarity")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Higher">{t("Lebih tinggi lebih baik", "Higher is better")}</SelectItem>
                    <SelectItem value="Lower">{t("Lebih rendah lebih baik", "Lower is better")}</SelectItem>
                    <SelectItem value="Boolean">{t("Boolean", "Boolean")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t("Satuan", "Unit")}</Label>
                <Input value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} aria-label={t("Satuan", "Unit")} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t("Target", "Target")}</Label>
                <Input type="number" inputMode="decimal" value={it.target} onChange={(e) => setItem(i, { target: e.target.value })} aria-label={t("Target", "Target")} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t("Bobot % (usulan)", "Weight % (proposed)")}</Label>
                <Input type="number" inputMode="decimal" value={it.weight} onChange={(e) => setItem(i, { weight: e.target.value })} aria-label={t("Bobot", "Weight")} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-[10px]">{t("Definisi (opsional)", "Definition (optional)")}</Label>
                <Textarea rows={2} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} aria-label={t("Definisi KPI", "KPI definition")} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-[10px]">
                  <Ruler className="mr-1 inline h-3 w-3" />
                  {t("Metric / Measure of Success", "Metric / Measure of Success")}
                </Label>
                <Textarea rows={5} value={it.metric}
                  onChange={(e) => setItem(i, { metric: e.target.value })}
                  placeholder={t(
                    "1: Tidak submit / submit ulang usulan…\n2: Disetujui atasan & Division Manager/Direktur…\n3: Disetujui, berkualitas baik, berdampak…\n4: Dijalankan dalam lingkup departemen\n5: Dijalankan lingkup lebih luas, terukur, tepat guna",
                    "1: No proposal submitted / re-submitted…\n2: Approved by manager & Division Manager/Director…\n3: Approved, good quality, impactful…\n4: Executed within the department\n5: Executed on a wider scale, measurable, effective",
                  )}
                  aria-label={t("Metric / Measure of Success", "Metric / Measure of Success")}
                  className="text-xs" />
                <p className="text-[10px] text-slate-400">{t("Satu kolom teks bebas — atasan melengkapi bila kosong; pilih dari pustaka untuk mengisi otomatis.", "One free-text field — the manager completes it if blank; pick from the library to auto-fill.")}</p>
              </div>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setItems((xs) => [...xs, { title: "", polarity: "Higher", unit: "%", target: "", weight: "10", description: "", metric: "" }])}>
            {t("+ Tambah baris", "+ Add row")}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("Kirim Usulan", "Send Proposal")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
