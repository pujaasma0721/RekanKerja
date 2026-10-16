"use client";
// ============================================================================
// RekanKerja ESS P3-PERF — "Penilaian Saya" (§17 ess/my-appraisal, Alur 5
// §29-2, §18.11 AI assist self, §18.7 autosave mirror lokal):
//   • Fase Assessment → form self-assessment: kompetensi radio 1–5 + komentar
//     (tombol "✨ Susun dengan AI") + usulan final aktual utk KPI manual +
//     bukti catatan; draf MIRROR localStorage (pulihkan/buang — server = sumber
//     kebenaran) + progress bar; SUBMIT sekali di akhir (§35-7).
//   • Fase Published → hasil final read-only (skor/rating/rincian + ringkasan
//     360) + P4 §31: acknowledge "telah dibaca & dipahami" (BUKAN persetujuan
//     isi §35-13) + banding D6 jendela appealDays sejak publishAt (alasan wajib
//     §35-14) + tarik banding — kartu tetap tampil meski karyawan terdaftar di
//     siklus baru (perbaikan P4: sebelumnya hanya saat !current).
//   • Tab "Periode lalu" — riwayat siklus final (read-only §18.3 gaya).
//   • P6 §33-3 — seksi "Program Perbaikan Kinerja (PIP)": progres program
//     milik sendiri (sasaran + checkpoint 30/60/90 + capaian) — read-only.
//   • P9 §7.3 — seksi "Permintaan Data Saya (UU PDP)": daftar DSR data kinerja
//     milik sendiri + ajukan mandiri (Access/Export/Erase — SLA 7 hari).
// Estimator dampak TIDAK ada di ESS (D21 — karyawan tidak melihat).
// ============================================================================
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProgressTrackerBar, AiComposeDialog } from "@/rekankerja/performance/components/perf-form-kit";
import { ESS_BASE } from "./ess-api";
import {
  ClipboardCheck, AlertTriangle, Loader2, Sparkles, Send, RotateCcw, History,
  ChevronDown, Info, ShieldAlert, CheckCircle2, Scale, Clock, Download, ShieldCheck,
} from "lucide-react";

// ---------- tipe (kontrak API) ----------

interface SelfComp {
  competencyId: string; code: string; name: string; kind: string;
  weight: number; levels: { level: number; label: string; descriptor: string }[];
  selfScore: number | null; selfComment: string | null; selfAiAssisted: boolean;
}
interface SelfData {
  appraisal: {
    id: string; docNo: string; status: string;
    employeeNo: string; fullName: string; unit: string | null;
    selfScore: number | null; managerScore: number | null;
    finalScore: number | null; finalRating: number | null;
  };
  cycle: { code: string; status: string; periodStart: string; periodEnd: string; selfStart: string | null; selfEnd: string | null };
  selfWindowOpen: boolean;
  canSubmit: boolean;
  comps: SelfComp[];
  manualKpis: { id: string; title: string; unit: string; target: number; midActual: number | null; finalActual: number | null; evidenceJson: string | null; metricText: string | null }[];
  autoKpis: { id: string; title: string; unit: string; target: number; finalActual: number | null; metricText: string | null }[];
  progress: { total: number; filled: number };
}
interface PublishedData {
  appraisal: {
    id: string; docNo: string; status: string;
    selfScore: number | null; managerScore: number | null;
    finalScore: number | null; finalRating: number | null; acknowledgedAt: string | null;
    appealStatus: string | null; appealNote: string | null; appealDecidedBy: string | null;
  };
  cycle: { code: string; status: string; periodStart: string; periodEnd: string };
  rating: { value: number; labelId: string; labelEn: string; color: string } | null;
  appealWindow: { days: number; deadline: string | null; open: boolean; daysLeft: number | null };
  kpis: { title: string; unit: string; target: number; finalActual: number | null; midActual: number | null; weight: number }[];
  comps: { name: string; kind: string; score: number; selfScore: number | null; comment: string | null; selfComment: string | null }[];
  feedback360: { perCompetency: { name: string; avg: number | null; count: number; comments: string[] | null }[]; reviewers: { submitted: number }; hidden: string | null } | null;
}
interface PrevRow {
  appraisalId: string; docNo: string; cycleCode: string;
  periodStart: string; periodEnd: string;
  selfScore: number | null; managerScore: number | null; finalScore: number | null;
  finalRating: number | null; rating: { value: number; labelId: string; labelEn: string; color: string } | null;
}

interface SelfDraft {
  scores: Record<string, number>;
  comments: Record<string, string>;
  aiAssistedIds: string[];
  actuals: Record<string, string>;
  evidence: Record<string, string>;
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

// ============================================================================
// HALAMAN
// ============================================================================

export function EssMyAppraisalPage() {
  const { t, lang } = useI18n();
  const { data, loading, error, refresh } = useApi<{ current: CurrentBlock | null; published: PublishedData | null; previous: PrevRow[]; pips?: MyPipRow[]; dsrs?: MyDsrRow[] }>(`${ESS_BASE}/my-appraisal`);
  const [tab, setTab] = useState<"current" | "previous">("current");
  const [exporting, setExporting] = useState(false);

  /** P8 §7.2 PP 35/2021 — ekspor riwayat penilaian sendiri (XLSX, self-scope).
   *  POST → blob → anchor click (GET navigasi tak bisa POST). */
  const exportHistory = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${ESS_BASE}/my-appraisal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "exportHistory", lang }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = /filename="?([^";]+)"?/.exec(cd);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m?.[1] ?? `rekankerja-perf-history.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
      toast.success(t("Riwayat penilaian Anda terunduh (XLSX).", "Your appraisal history was downloaded (XLSX)."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Ekspor gagal", "Export failed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Penilaian Saya", "My Appraisal")}
        description={t(
          "Self-assessment periode berjalan (kompetensi + usulan aktual) + hasil final yang telah dipublikasikan.",
          "Current-period self-assessment (competencies + proposed actuals) + published final results.",
        )}
      />

      {error && <EmptyState title={t("Gagal memuat", "Failed to load")} description={error} icon={AlertTriangle} />}
      {loading && <LoadingRows rows={4} />}

      {data && !data.current && data.previous.length === 0 && (
        <EmptyState
          icon={ClipboardCheck}
          title={t("Belum ada penilaian", "No appraisal yet")}
          description={t("Anda belum terdaftar sebagai peserta siklus penilaian apa pun.", "You are not enrolled in any appraisal cycle yet.")}
        />
      )}

      {data && (data.current || data.previous.length > 0) && (
        <>
          {/* P8 §7.2 PP 35/2021 — riwayat penilaian eksporabel (bukti konversi
              PKWT) — selalu tersedia saat ada riwayat apa pun. */}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportHistory} disabled={exporting} className="gap-1.5 font-bold">
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {t("Ekspor Riwayat Saya (XLSX)", "Export My History (XLSX)")}
            </Button>
          </div>
          {(data.current && !("waiting" in data.current)) && data.previous.length > 0 && (
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
              <button onClick={() => setTab("current")}
                className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition", tab === "current" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
                aria-pressed={tab === "current"}>
                {t("Periode Berjalan", "Current Period")}
              </button>
              <button onClick={() => setTab("previous")}
                className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition", tab === "previous" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
                aria-pressed={tab === "previous"}>
                {t(`Periode Lalu (${data.previous.length})`, `Past Periods (${data.previous.length})`)}
              </button>
            </div>
          )}

          {tab === "current" && data.current && (
            "waiting" in data.current
              ? <WaitingPhase c={data.current} />
              : <SelfAssessmentForm d={data.current} onDone={refresh} />
          )}
          {/* P4: hasil terpublikasi TETAP tampil di bawah form siklus berjalan —
              karyawan aktif di siklus baru harus tetap bisa acknowledge/banding
              hasil siklus sebelumnya yang baru dipublikasikan (§31-1). */}
          {tab === "current" && data.published && <PublishedResultCard d={data.published} onDone={refresh} />}
          {tab === "current" && !data.current && !data.published && data.previous.length > 0 && (
            <EmptyState icon={ClipboardCheck} title={t("Tidak ada siklus berjalan", "No running cycle")}
              description={t("Anda tidak terdaftar di siklus aktif mana pun — lihat Periode Lalu.", "You are not enrolled in any active cycle — see Past Periods.")} />
          )}

          {tab === "previous" && (
            <div className="space-y-2">
              {data.previous.map((p) => (
                <Card key={p.appraisalId} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{p.cycleCode}</span>
                      {p.rating && (
                        <Badge variant="outline" className="text-[10px]">
                          {t(`rating ${p.rating.value}`, `rating ${p.rating.value}`)} · {p.rating.labelId}
                        </Badge>
                      )}
                      <span className="ml-auto font-mono text-xs text-slate-400">{p.docNo}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {t(
                        `Periode ${fmtD(p.periodStart)} – ${fmtD(p.periodEnd)} · skor diri ${p.selfScore ?? "—"} · atasan ${p.managerScore ?? "—"} · final ${p.finalScore ?? "—"}`,
                        `Period ${fmtD(p.periodStart)} – ${fmtD(p.periodEnd)} · self ${p.selfScore ?? "—"} · manager ${p.managerScore ?? "—"} · final ${p.finalScore ?? "—"}`,
                      )}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {data && (data.pips ?? []).length > 0 && <MyPipSection pips={data.pips ?? []} />}

      {/* P9 §7.3 UU PDP — Permintaan Data Saya: selalu tampil (hak subjek data
          karyawan atas data kinerjanya — ajukan mandiri + pantau status SLA). */}
      <MyDsrSection dsrs={data?.dsrs ?? []} onDone={refresh} />
    </div>
  );
}

// ---------- P9 §7.3: Permintaan Data Saya (UU PDP — self-service DSR) ----------

interface MyDsrRow {
  id: string; type: string; status: string; note: string | null;
  dueAt: string; createdAt: string; handledAt: string | null; resultNote: string | null;
}

const DSR_TYPE_OPTS: { key: string; label: string; labelEn: string }[] = [
  { key: "Access", label: "Akses Data", labelEn: "Access" },
  { key: "Export", label: "Ekspor Data", labelEn: "Export" },
  { key: "Erase", label: "Hapus Data", labelEn: "Erase" },
];
const DSR_STATUS_LABEL: Record<string, [string, string]> = {
  New: ["Baru", "New"],
  InProgress: ["Diproses", "In Progress"],
  Completed: ["Selesai", "Completed"],
  Rejected: ["Ditolak", "Rejected"],
};

function MyDsrSection({ dsrs, onDone }: { dsrs: MyDsrRow[]; onDone: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState("Access");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const active = dsrs.filter((d) => d.status === "New" || d.status === "InProgress");
  const st = (s: string) => {
    const m = DSR_STATUS_LABEL[s] ?? [s, s] as [string, string];
    return t(m[0], m[1]);
  };
  const submit = async () => {
    setBusy(true);
    try {
      await apiSend(`${ESS_BASE}/my-appraisal`, "POST", { action: "requestDsr", type, note: note.trim() || null });
      toast.success(t(
        "Permintaan data Anda dicatat — HR menangani maks. 7 hari kerja (UU PDP).",
        "Your data request is recorded — HR will handle it within 7 days (UU PDP).",
      ));
      setFormOpen(false);
      setNote("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan permintaan", "Failed to submit the request"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-5">
        <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}
          aria-expanded={open}>
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="text-sm font-semibold">
              {t("Permintaan Data Saya (UU PDP)", "My Data Requests (UU PDP)")}
            </span>
            <p className="mt-0.5 text-xs text-slate-500">
              {active.length > 0
                ? t(`${active.length} permintaan aktif — SLA maks. 7 hari kerja.`, `${active.length} active request(s) — SLA max. 7 working days.`)
                : t("Hak akses / ekspor / hapus data kinerja Anda (UU PDP No. 27/2022).", "Access / export / erase rights over your performance data (UU PDP No. 27/2022).")}
            </p>
          </div>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
        </button>

        {open && (
          <div className="mt-3 space-y-3">
            {!formOpen ? (
              <Button size="sm" onClick={() => setFormOpen(true)} className="h-8 gap-1.5 text-xs">
                <Send className="h-3.5 w-3.5" aria-hidden /> {t("Ajukan Permintaan Data", "Submit a Data Request")}
              </Button>
            ) : (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("Jenis permintaan *", "Request type *")}</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="h-9 w-full bg-white text-[12.5px] font-semibold dark:bg-slate-900" aria-label={t("Jenis permintaan", "Request type")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DSR_TYPE_OPTS.map((x) => (
                        <SelectItem key={x.key} value={x.key} className="text-[12px] font-semibold">
                          {t(x.label, x.labelEn)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] leading-snug text-slate-400">
                    {t(
                      "Akses = lihat data · Ekspor = paket XLSX identitas + riwayat kinerja · Hapus = keputusan ditangani HR (bukti kepegawaian PP 35/2021 §7.2).",
                      "Access = view data · Export = XLSX package of identity + performance history · Erase = decision handled by HR (employment evidence PP 35/2021 §7.2).",
                    )}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("Catatan (opsional)", "Note (optional)")}</Label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder={t("Konteks permintaan Anda…", "Context of your request…")}
                    className="text-[12.5px]"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setFormOpen(false)} disabled={busy} className="h-8 text-xs">{t("Batal", "Cancel")}</Button>
                  <Button size="sm" onClick={submit} disabled={busy} className="h-8 text-xs">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    {t("Kirim (SLA 7 hari)", "Send (7-day SLA)")}
                  </Button>
                </div>
              </div>
            )}

            {dsrs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-3 text-center text-[11px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                {t("Belum ada permintaan data.", "No data requests yet.")}
              </p>
            ) : (
              <div className="space-y-1.5">
                {dsrs.map((d) => {
                  const tone = d.status === "Completed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : d.status === "Rejected" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                    : d.status === "InProgress" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
                  const overdue = (d.status === "New" || d.status === "InProgress") && new Date(d.dueAt).getTime() < Date.now();
                  return (
                    <div key={d.id} className="rounded-lg border border-slate-200 bg-white/70 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", tone)}>{st(d.status)}</span>
                        <span className="text-xs font-semibold">{t(
                          DSR_TYPE_OPTS.find((x) => x.key === d.type)?.label ?? d.type,
                          DSR_TYPE_OPTS.find((x) => x.key === d.type)?.labelEn ?? d.type,
                        )}</span>
                        {overdue && (
                          <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">{t("lewat SLA", "past SLA")}</span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-slate-400">{fmtD(d.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t(`Tenggat ${fmtD(d.dueAt)}`, `Due ${fmtD(d.dueAt)}`)}
                        {d.resultNote ? ` — ${d.resultNote}` : ""}
                      </p>
                      {d.note && <p className="mt-0.5 text-[10px] text-slate-400">“{d.note}”</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- P6 §33-3: PIP Saya (read-only — karyawan melihat progresnya sendiri) ----------

interface MyPipRow {
  id: string; docNo: string; startDate: string; endDate: string; status: string;
  reviewerName: string | null;
  targets: { title: string; metric: string; target: string; weight: number }[];
  checkpoints: { seq: number; dueDate: string; achievementPct: number | null; status: string; notes: string | null }[];
  outcomeNotes: string | null;
}

function MyPipSection({ pips }: { pips: MyPipRow[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const live = pips.find((p) => p.status === "Active" || p.status === "Extended") ?? pips[0];
  if (!live) return null;
  const reviewed = live.checkpoints.filter((c) => c.status === "Reviewed").length;
  const statusTone: Record<string, string> = {
    Active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    Extended: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    Recovered: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
    NotRecovered: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    Cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    Draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return (
    <Card className="border-amber-200/70 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardContent className="p-4 sm:p-5">
        <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}
          aria-expanded={open}>
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {t("Program Perbaikan Kinerja (PIP)", "Performance Improvement Plan (PIP)")}
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", statusTone[live.status] ?? statusTone.Draft)}>
                {live.status}
              </span>
              <span className="font-mono text-xs text-slate-500">{live.docNo}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {t(
                `${fmtD(live.startDate)} – ${fmtD(live.endDate)} · pembina ${live.reviewerName ?? "—"} · checkpoint direview ${reviewed}/${live.checkpoints.length}`,
                `${fmtD(live.startDate)} – ${fmtD(live.endDate)} · coach ${live.reviewerName ?? "—"} · checkpoints reviewed ${reviewed}/${live.checkpoints.length}`,
              )}
            </p>
          </div>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
        </button>

        {open && (
          <div className="mt-3 space-y-3">
            {live.targets.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-600">{t("Sasaran program", "Program targets")}</p>
                <ul className="space-y-1">
                  {live.targets.map((tg, i) => (
                    <li key={i} className="text-xs text-slate-600">
                      <span className="font-medium">{i + 1}. {tg.title}</span>
                      {tg.metric ? ` (${tg.metric})` : ""} — {t("target", "target")}: {tg.target} · {t("bobot", "weight")} {tg.weight}%
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">{t("Progres checkpoint (30/60/90 hari)", "Checkpoint progress (30/60/90 days)")}</p>
              <div className="space-y-1.5">
                {live.checkpoints.map((c) => (
                  <div key={c.seq} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-900/60">
                    <span className="font-mono text-[11px] text-slate-400">CP{c.seq}</span>
                    <span className="text-xs text-slate-500">{fmtD(c.dueDate)}</span>
                    <span className="ml-auto text-xs font-semibold">
                      {c.status === "Reviewed"
                        ? `${c.achievementPct ?? 0}%`
                        : t("menunggu review", "awaiting review")}
                    </span>
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", c.status === "Reviewed" ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600")} aria-hidden />
                  </div>
                ))}
              </div>
            </div>
            {live.checkpoints.some((c) => c.notes) && (
              <div className="rounded-lg border border-slate-200 bg-white/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/60">
                <p className="mb-1 text-xs font-semibold text-slate-600">{t("Catatan pembina", "Coach notes")}</p>
                <ul className="space-y-1">
                  {live.checkpoints.filter((c) => c.notes).map((c) => (
                    <li key={c.seq} className="text-xs text-slate-600">
                      <span className="font-mono text-[11px] text-slate-400">CP{c.seq}:</span> {c.notes}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {live.outcomeNotes && (
              <p className="text-xs text-slate-500">
                <span className="font-semibold">{t("Hasil program:", "Program outcome:")}</span> {live.outcomeNotes}
              </p>
            )}
            {pips.length > 1 && (
              <p className="text-[11px] text-slate-400">
                {t(`+ ${pips.length - 1} program lain di riwayat`, `+ ${pips.length - 1} other program(s) in history`)}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Blok "current" — form self (fase Assessment) atau penanda menunggu fase. */
type CurrentBlock =
  | SelfData
  | { appraisalId: string; docNo: string; status: string; cycleCode: string; phase: string; waiting: true };

function WaitingPhase({ c }: { c: { docNo: string; status: string; cycleCode: string; phase: string } }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={Info}
      title={t(`Menunggu fase penilaian (${c.phase})`, `Awaiting the appraisal phase (${c.phase})`)}
      description={t(
        `Siklus ${c.cycleCode} masih pada fase ${c.phase}. Formulir penilaian diri terbuka saat fase Assessment.`,
        `Cycle ${c.cycleCode} is still in the ${c.phase} phase. The self-assessment form opens during the Assessment phase.`,
      )}
    />
  );
}

// ============================================================================
// FORM SELF-ASSESSMENT (§29-2 + §18.7 mirror lokal + §18.11 AI)
// ============================================================================

function SelfAssessmentForm({ d, onDone }: { d: SelfData; onDone: () => void }) {
  const { t } = useI18n();
  const storageKey = `rekankerja:perf-draft:self:${d.appraisal.id}`;
  const [draft, setDraft] = useState<SelfDraft>({ scores: {}, comments: {}, aiAssistedIds: [], actuals: {}, evidence: {} });
  const [mirror, setMirror] = useState<SelfDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiFor, setAiFor] = useState<SelfComp | null>(null);

  // muat nilai server → state
  useEffect(() => {
    const s: SelfDraft = { scores: {}, comments: {}, aiAssistedIds: [], actuals: {}, evidence: {} };
    for (const c of d.comps) {
      s.scores[c.competencyId] = c.selfScore ?? 0;
      s.comments[c.competencyId] = c.selfComment ?? "";
    }
    for (const k of d.manualKpis) {
      s.actuals[k.id] = k.finalActual != null ? String(Math.round(k.finalActual * 1e6) / 1e6) : "";
    }
    setDraft(s);
    // mirror lokal §18.7 — tawarkan pulihkan HANYA bila salinan lokal BERBEDA
    // dari state server (banner identik = berisik; pola P1 form-kit).
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw && JSON.stringify(JSON.parse(raw) as SelfDraft) !== JSON.stringify(s)) {
        setMirror(JSON.parse(raw) as SelfDraft);
      }
    } catch { /* storage rusak */ }
  }, [d.appraisal.id]);

  // persist mirror lokal tiap perubahan (autosave klien-side — submit eksplisit di akhir)
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* kuota */ }
  }, [draft, storageKey]);

  const filled = d.comps.filter((c) => (draft.scores[c.competencyId] ?? 0) >= 1).length;
  const pct = d.comps.length ? Math.round((filled / d.comps.length) * 100) : 0;
  const canEdit = d.selfWindowOpen && !["ManagerDone", "Calibrating", "Finalized", "Published", "Closed"].includes(d.appraisal.status);

  const submit = async () => {
    const missing = d.comps.filter((c) => !((draft.scores[c.competencyId] ?? 0) >= 1 && (draft.scores[c.competencyId] ?? 0) <= 5));
    if (missing.length > 0) {
      toast.error(t(`Masih ada ${missing.length} kompetensi belum dinilai — semua baris wajib skor 1–5 (§35-7)`, `${missing.length} competencies unscored — all rows require a 1–5 score (§35-7)`));
      return;
    }
    setBusy(true);
    try {
      const out = await apiSend<{ selfScore: number }>(`${ESS_BASE}/my-appraisal`, "POST", {
        action: "submitSelf",
        appraisalId: d.appraisal.id,
        selfScores: d.comps.map((c) => ({ competencyId: c.competencyId, score: draft.scores[c.competencyId] ?? 0 })),
        selfComments: d.comps.filter((c) => (draft.comments[c.competencyId] ?? "").trim()).map((c) => ({ competencyId: c.competencyId, comment: draft.comments[c.competencyId] })),
        selfAiAssistedIds: draft.aiAssistedIds,
        manualActuals: d.manualKpis
          .filter((k) => (draft.actuals[k.id] ?? "") !== "")
          .map((k) => ({ kpiId: k.id, finalActual: Number(draft.actuals[k.id]) })),
        evidence: d.manualKpis
          .filter((k) => (draft.evidence[k.id] ?? "").trim())
          .map((k) => ({ kpiId: k.id, note: draft.evidence[k.id] })),
      });
      toast.success(t(`Penilaian diri terkirim — skor ${out.selfScore}. Atasan Anda dinotifikasi.`, `Self-assessment submitted — score ${out.selfScore}. Your manager has been notified.`));
      try { localStorage.removeItem(storageKey); } catch { /* never */ }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{d.cycle.code}</span>
            <StatusPill status={d.appraisal.status} />
            <span className="ml-auto font-mono text-xs text-slate-400">{d.appraisal.docNo}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t(
              `Jendela penilaian diri: ${fmtD(d.cycle.selfStart)} – ${fmtD(d.cycle.selfEnd)}${d.selfWindowOpen ? "" : " (sudah tutup)"}. Atasan memverifikasi aktual KPI & menilai setelah ini.`,
              `Self-assessment window: ${fmtD(d.cycle.selfStart)} – ${fmtD(d.cycle.selfEnd)}${d.selfWindowOpen ? "" : " (closed)"}. Your manager verifies KPI actuals & scores after this.`,
            )}
          </p>
          {canEdit && (
            <div className="mt-3">
              <ProgressTrackerBar pct={pct} breakdown={t(`${filled}/${d.comps.length} kompetensi`, `${filled}/${d.comps.length} competencies`)} />
            </div>
          )}
          {mirror && canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="min-w-0 flex-1">{t("Draf lokal tersimpan di perangkat ini — pulihkan untuk melanjutkan mengisi.", "A local draft is saved on this device — restore to continue filling in.")}</span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => { setDraft(mirror); setMirror(null); }}>{t("Pulihkan", "Restore")}</Button>
              <Button size="sm" variant="ghost" className="h-7"
                onClick={() => { try { localStorage.removeItem(storageKey); } catch { /* never */ } setMirror(null); }}>
                {t("Buang", "Discard")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* kompetensi */}
      <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{t("Penilaian Kompetensi Diri", "Self Competency Assessment")}</h3>
            <span className="text-[11px] text-slate-400">{t("semua baris wajib skor 1–5 (§35-7)", "all rows require a 1–5 score (§35-7)")}</span>
          </div>
          <div className="space-y-3">
            {d.comps.map((c) => {
              const score = draft.scores[c.competencyId] ?? 0;
              const comment = draft.comments[c.competencyId] ?? "";
              const descriptor = c.levels.find((l) => l.level === score);
              return (
                <div key={c.competencyId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{c.name}</p>
                    <Badge variant="outline" className="h-4 px-1 text-[9px]">
                      {c.kind === "CoreValue" ? t("nilai inti", "core value") : c.kind === "Managerial" ? t("manajerial", "managerial") : t("teknis", "technical")}
                    </Badge>
                    <span className="text-[10px] text-slate-400">{t(`bobot ${c.weight}%`, `weight ${c.weight}%`)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((v) => {
                      const lv = c.levels.find((l) => l.level === v);
                      return (
                        <label key={v}
                          title={lv ? `${lv.label}: ${lv.descriptor}` : undefined}
                          className={cn(
                            "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold transition",
                            score === v ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400",
                          )}
                        >
                          <input type="radio" className="sr-only" name={`self-${c.competencyId}`} value={v}
                            disabled={!canEdit} checked={score === v}
                            onChange={() => setDraft({ ...draft, scores: { ...draft.scores, [c.competencyId]: v } })}
                            aria-label={t(`${c.name} — level ${v}`, `${c.name} — level ${v}`)} />
                          {v}
                        </label>
                      );
                    })}
                    {descriptor && (
                      <span className="ml-1 min-w-0 flex-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-semibold">{descriptor.label}:</span> {descriptor.descriptor}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Label className="text-xs">{t("Ulasan singkat (opsional)", "Brief review (optional)")}</Label>
                      {canEdit && (
                        <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setAiFor(c)}>
                          <Sparkles className="h-3.5 w-3.5 text-brand" />{t("Susun dengan AI", "Compose with AI")}
                        </Button>
                      )}
                    </div>
                    <Textarea rows={2} value={comment} disabled={!canEdit}
                      placeholder={t("Contoh capaian/perilaku Anda pada kompetensi ini…", "Examples of your achievements/behaviors for this competency…")}
                      onChange={(e) => setDraft({ ...draft, comments: { ...draft.comments, [c.competencyId]: e.target.value } })}
                      aria-label={t(`Ulasan ${c.name}`, `${c.name} review`)} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* KPI manual */}
      {d.manualKpis.length > 0 && (
        <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4 sm:p-5">
            <h3 className="mb-1 text-sm font-semibold">{t("Usulan Capaian KPI Manual", "Proposed Manual KPI Actuals")}</h3>
            <p className="mb-3 text-[11px] text-slate-400">
              {t("KPI bersumber otomatis ditarik atasan (tidak perlu diisi). Usulan Anda diverifikasi atasan saat menilai.", "Auto-sourced KPIs are pulled by the manager (no input needed). Your proposals are verified by the manager when scoring.")}
            </p>
            <div className="space-y-3">
              {d.manualKpis.map((k) => (
                <div key={k.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium">{k.title}</p>
                    <span className="text-[11px] text-slate-400">
                      {t("target", "target")} {k.target} {k.unit}
                      {k.midActual != null ? ` · ${t("tengah tahun", "mid")} ${k.midActual}` : ""}
                    </span>
                  </div>
                  {k.metricText && (
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-[10px] text-slate-500 dark:text-slate-400" title={k.metricText}>
                      <span className="font-semibold">{t("Metric / Measure of Success:", "Metric / Measure of Success:")}</span> {k.metricText}
                    </p>
                  )}
                  <div className="mt-2 grid gap-2 sm:grid-cols-[140px_1fr]">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Capaian akhir", "Final actual")}</Label>
                      <Input type="number" inputMode="decimal" value={draft.actuals[k.id] ?? ""} disabled={!canEdit}
                        onChange={(e) => setDraft({ ...draft, actuals: { ...draft.actuals, [k.id]: e.target.value } })}
                        aria-label={t(`Capaian akhir ${k.title}`, `Final actual ${k.title}`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Catatan bukti (opsional)", "Evidence note (optional)")}</Label>
                      <Input value={draft.evidence[k.id] ?? ""} disabled={!canEdit}
                        placeholder={t("mis. lampiran ada di email tim", "e.g. attachment is in the team email")}
                        onChange={(e) => setDraft({ ...draft, evidence: { ...draft.evidence, [k.id]: e.target.value } })}
                        aria-label={t(`Bukti ${k.title}`, `Evidence ${k.title}`)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {d.autoKpis.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <summary className="flex cursor-pointer items-center gap-1.5 px-4 py-3 text-sm font-medium">
            <Info className="h-4 w-4 text-slate-400" />
            {t(`KPI otomatis (${d.autoKpis.length}) — ditarik dari sistem`, `Auto KPIs (${d.autoKpis.length}) — pulled from the system`)}
            <ChevronDown className="ml-auto h-4 w-4 text-slate-400" />
          </summary>
          <div className="px-4 pb-3 text-xs text-slate-500">
            {d.autoKpis.map((k) => (
              <div key={k.id}>
                <p>• {k.title} — {t("target", "target")} {k.target} {k.unit} · {t("nilai ditarik atasan saat penilaian", "value pulled by the manager during appraisal")}</p>
                {k.metricText && <p className="ml-3 line-clamp-2 max-w-lg whitespace-pre-line text-[10px] text-slate-400" title={k.metricText}>{k.metricText}</p>}
              </div>
            ))}
          </div>
        </details>
      )}

      {canEdit && d.canSubmit && (
        <Button onClick={submit} disabled={busy || filled < d.comps.length} className="w-full sm:w-auto">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {t("Submit Penilaian Diri", "Submit Self-Assessment")}
        </Button>
      )}
      {canEdit && !d.canSubmit && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("Status peserta belum mengizinkan submit — target harus dikunci atasan lebih dulu (§35-7).", "Participant status does not allow submitting — goals must be locked by the manager first (§35-7).")}
        </p>
      )}

      {aiFor && (
        <AiComposeDialog
          title={t(`Ulasan diri — ${aiFor.name}`, `Self review — ${aiFor.name}`)}
          target={{ endpoint: `${ESS_BASE}/my-appraisal`, extra: { scope: "self", appraisalId: d.appraisal.id, competencyId: aiFor.competencyId } }}
          onClose={() => setAiFor(null)}
          onUse={(text) => {
            setDraft((s) => ({
              ...s,
              comments: { ...s.comments, [aiFor.competencyId]: text },
              aiAssistedIds: s.aiAssistedIds.includes(aiFor.competencyId) ? s.aiAssistedIds : [...s.aiAssistedIds, aiFor.competencyId],
            }));
            setAiFor(null);
          }}
        />
      )}
    </div>
  );
}

/** Hasil final (siklus Published) + P4 §31: acknowledge §35-13 + banding §35-14/15 + tarik banding. */
export function PublishedResultCard({ d, onDone }: { d: PublishedData; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [ackBusy, setAckBusy] = useState(false);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealNote, setAppealNote] = useState("");
  const [appealEvidence, setAppealEvidence] = useState("");
  const [appealBusy, setAppealBusy] = useState(false);
  const [confirmAck, setConfirmAck] = useState(false);

  const fmtDT = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale.startsWith("en") ? "en-GB" : "id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

  async function doAcknowledge() {
    setAckBusy(true);
    try {
      const out = await apiSend<{ docNo: string; acknowledgedAt: string; already: boolean }>(`${ESS_BASE}/my-appraisal`, "POST", {
        action: "acknowledge", appraisalId: d.appraisal.id,
      });
      toast.success(t(
        `Konfirmasi penerimaan ${out.docNo} tercatat — terima kasih.`,
        `Acknowledgement for ${out.docNo} recorded — thank you.`,
      ));
      setConfirmAck(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setAckBusy(false);
    }
  }

  async function doAppeal() {
    if (!appealNote.trim()) {
      toast.error(t("Alasan banding wajib diisi (§35-14)", "Appeal reason is required (§35-14)"));
      return;
    }
    setAppealBusy(true);
    try {
      const out = await apiSend<{ docNo: string; appealStatus: string; deadline: string | null }>(`${ESS_BASE}/my-appraisal`, "POST", {
        action: "appeal", appraisalId: d.appraisal.id, note: appealNote.trim(),
        evidence: appealEvidence.trim() || null,
      });
      toast.success(t(
        `Banding ${out.docNo} diajukan — HR akan meninjau (tenggat ${fmtD(out.deadline)}).`,
        `Appeal for ${out.docNo} submitted — HR will review (deadline ${fmtD(out.deadline)}).`,
      ));
      setAppealOpen(false); setAppealNote(""); setAppealEvidence("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setAppealBusy(false);
    }
  }

  async function doWithdraw() {
    setAppealBusy(true);
    try {
      const out = await apiSend<{ docNo: string; appealStatus: string }>(`${ESS_BASE}/my-appraisal`, "POST", {
        action: "withdrawAppeal", appraisalId: d.appraisal.id,
      });
      toast.success(t(`Banding ${out.docNo} ditarik.`, `Appeal for ${out.docNo} withdrawn.`));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setAppealBusy(false);
    }
  }

  const win = d.appealWindow ?? { days: 7, deadline: null, open: false, daysLeft: null };
  const ap = d.appraisal.appealStatus;
  const canAppeal = win.open && (ap == null || ap === "Withdrawn");
  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{d.cycle.code}</span>
          <StatusPill status={d.appraisal.status} />
          {d.rating && (
            <Badge variant="outline" className="text-[10px]">{d.rating.value} · {locale.startsWith("en") ? d.rating.labelEn : d.rating.labelId}</Badge>
          )}
          <span className="ml-auto font-mono text-xs text-slate-400">{d.appraisal.docNo}</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/60">
            <p className="text-[10px] text-slate-400">{t("Skor diri", "Self score")}</p>
            <p className="text-lg font-bold tabular-nums">{d.appraisal.selfScore ?? "—"}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/60">
            <p className="text-[10px] text-slate-400">{t("Skor atasan", "Manager score")}</p>
            <p className="text-lg font-bold tabular-nums">{d.appraisal.managerScore ?? "—"}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/30">
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400">{t("Skor final", "Final score")}</p>
            <p className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{d.appraisal.finalScore ?? "—"}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          {t("Hasil final telah dipublikasikan untuk Anda.", "Your final result has been published.")}
        </p>

        {/* ===== P4 §35-13: acknowledge — konfirmasi telah dibaca & dipahami ===== */}
        <div className="mt-3 rounded-lg border border-dashed border-emerald-300/70 px-3 py-2.5 dark:border-emerald-800">
          {d.appraisal.acknowledgedAt ? (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {t(
                `Anda mengonfirmasi telah membaca & memahami hasil ini (${fmtDT(d.appraisal.acknowledgedAt)}) — konfirmasi penerimaan, bukan persetujuan isi.`,
                `You confirmed reading & understanding this result (${fmtDT(d.appraisal.acknowledgedAt)}) — an acknowledgement of receipt, not agreement.`,
              )}
            </p>
          ) : confirmAck ? (
            <div className="space-y-2 text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                {t(
                  "Konfirmasi bahwa Anda telah membaca dan memahami hasil penilaian ini. Ini BUKAN persetujuan atas isi hasil (§35-13) — bila tidak setuju, gunakan hak banding di bawah.",
                  "Confirm that you have read and understood this appraisal result. This is NOT agreement with the content (§35-13) — if you disagree, use your appeal right below.",
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={doAcknowledge} disabled={ackBusy} className="h-8">
                  {ackBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {t("Ya, saya telah membaca & memahami", "Yes, I have read & understood")}
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setConfirmAck(false)} disabled={ackBusy}>
                  {t("Batal", "Cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <p className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
                {t("Mohon konfirmasi bahwa Anda telah membaca & memahami hasil ini.", "Please confirm you have read & understood this result.")}
              </p>
              <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setConfirmAck(true)}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("Saya telah membaca & memahami", "I have read & understood")}
              </Button>
            </div>
          )}
        </div>

        {/* ===== P4 §35-14: banding D6 (jendela appealDays sejak publish) ===== */}
        <div className="mt-2 rounded-lg border border-dashed border-amber-300/80 px-3 py-2.5 dark:border-amber-800/70">
          {!win.open ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Clock className="h-4 w-4 shrink-0" />
              {t(
                `Jendela banding D6 telah tutup (tenggat ${fmtD(win.deadline)}).`,
                `Appeal window D6 has closed (deadline ${fmtD(win.deadline)}).`,
              )}
            </p>
          ) : ap === "Submitted" ? (
            <div className="space-y-2 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                <Scale className="h-4 w-4 shrink-0" />
                {t("Banding Anda menunggu keputusan HR (§35-15).", "Your appeal is awaiting HR decision (§35-15).")}
              </p>
              {d.appraisal.appealNote && (
                <p className="whitespace-pre-wrap rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  {t("Alasan Anda:", "Your reason:")} {d.appraisal.appealNote}
                </p>
              )}
              <div>
                <Button size="sm" variant="outline" className="h-8" onClick={doWithdraw} disabled={appealBusy}>
                  {appealBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  {t("Tarik Banding", "Withdraw Appeal")}
                </Button>
              </div>
            </div>
          ) : ap === "Rejected" || ap === "Adjusted" ? (
            <div className="space-y-1.5 text-xs">
              <p className={cn("flex items-center gap-1.5 font-medium", ap === "Adjusted" ? "text-emerald-700 dark:text-emerald-400" : "text-slate-600 dark:text-slate-300")}>
                {ap === "Adjusted" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Info className="h-4 w-4 shrink-0" />}
                {ap === "Adjusted"
                  ? t("Banding diputuskan: DISETUJUI — skor disesuaikan.", "Appeal decided: APPROVED — score adjusted.")
                  : t("Banding diputuskan: DITOLAK — hasil tetap.", "Appeal decided: REJECTED — result stands.")}
              </p>
              <p className="text-slate-500 dark:text-slate-400">
                {t("Keputusan oleh", "Decided by")} {d.appraisal.appealDecidedBy ?? "—"}
              </p>
            </div>
          ) : appealOpen ? (
            <div className="space-y-2 text-xs">
              <p className="font-medium text-slate-700 dark:text-slate-200">
                {t(
                  `Ajukan banding bila Anda merasa hasil tidak mencerminkan capaian (sisa ${win.daysLeft ?? win.days} hari dari jendela ${win.days} hari):`,
                  `File an appeal if you feel the result does not reflect your achievement (${win.daysLeft ?? win.days} days left of the ${win.days}-day window):`,
                )}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="appeal-note">{t("Alasan banding (wajib)", "Appeal reason (required)")}</Label>
                <Textarea id="appeal-note" rows={3} value={appealNote} onChange={(e) => setAppealNote(e.target.value)}
                  placeholder={t("Jelaskan capaian/bukti yang menurut Anda belum diperhitungkan…", "Explain achievements/evidence you feel were not accounted for…")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="appeal-evidence">{t("Bukti tambahan (opsional)", "Additional evidence (optional)")}</Label>
                <Input id="appeal-evidence" value={appealEvidence} onChange={(e) => setAppealEvidence(e.target.value)}
                  placeholder={t("mis. nama dokumen/link bukti", "e.g. document name/evidence link")} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={doAppeal} disabled={appealBusy} className="h-8">
                  {appealBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {t("Kirim Banding", "Submit Appeal")}
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAppealOpen(false); setAppealNote(""); setAppealEvidence(""); }} disabled={appealBusy}>
                  {t("Batal", "Cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {ap === "Withdrawn" && (
                <p className="min-w-0 flex-1 text-slate-500 dark:text-slate-400">{t("Banding sebelumnya ditarik — Anda bisa mengajukan ulang.", "Previous appeal withdrawn — you may file again.")}</p>
              )}
              <Button size="sm" variant="outline" className="ml-auto h-8 shrink-0" onClick={() => setAppealOpen(true)} disabled={!canAppeal}>
                <Scale className="h-3.5 w-3.5" />
                {t("Ajukan Banding", "File an Appeal")}
              </Button>
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
          <History className="h-3.5 w-3.5" />{open ? t("Sembunyikan rincian", "Hide details") : t("Lihat rincian", "View details")}
        </Button>
        {open && (
          <div className="mt-2 space-y-3 text-xs">
            <div>
              <p className="mb-1 font-semibold">{t("KPI", "KPIs")}</p>
              {d.kpis.map((k, i) => (
                <p key={i} className="flex flex-wrap items-baseline gap-1.5 py-0.5">
                  <span className="min-w-0 flex-1 truncate">{k.title}</span>
                  <span className="tabular-nums text-slate-500">{k.target} → <span className="font-semibold">{k.finalActual ?? "—"}</span> {k.unit}</span>
                  <span className="w-9 text-right text-slate-400">{k.weight}%</span>
                </p>
              ))}
            </div>
            {d.comps.length > 0 && (
              <div>
                <p className="mb-1 font-semibold">{t("Kompetensi", "Competencies")}</p>
                {d.comps.map((c, i) => (
                  <div key={i} className="py-0.5">
                    <p className="flex flex-wrap items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="tabular-nums">{t(`atasan ${c.score}`, `manager ${c.score}`)}{c.selfScore != null ? ` · ${t(`diri ${c.selfScore}`, `self ${c.selfScore}`)}` : ""}</span>
                    </p>
                    {c.comment && <p className="pl-3 text-[11px] text-slate-500 dark:text-slate-400">{t("catatan atasan:", "manager note:")} {c.comment}</p>}
                  </div>
                ))}
              </div>
            )}
            {d.feedback360 && !d.feedback360.hidden && d.feedback360.perCompetency.length > 0 && (
              <div>
                <p className="mb-1 font-semibold">{t("Ringkasan 360 (anonim)", "360 summary (anonymous)")}</p>
                {d.feedback360.perCompetency.map((p, i) => (
                  <p key={i} className="flex items-baseline gap-1.5 py-0.5">
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="tabular-nums">{p.avg ?? "—"} / 5 · {p.count}x</span>
                  </p>
                ))}
              </div>
            )}
            {d.feedback360?.hidden && (
              <p className="flex items-center gap-1.5 text-slate-400"><ShieldAlert className="h-3.5 w-3.5" />{t("360 dirahasiakan (<3 reviewer)", "360 hidden (<3 reviewers)")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
