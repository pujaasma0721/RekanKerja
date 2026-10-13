"use client";
// ============================================================================
// PERFORMANCE — Check-in & Monitoring (P2 — §20 P2, §27 Alur 3, §14.2 menu
// "checkins"): riwayat 1-on-1 terdokumentasi per peserta (jadwal → catat
// hasil ringkas dua arah → terlewat), checkpoint tengah tahun (midActual per
// KPI + progress %), dan revisi target mid-year (ajukan alasan → approval
// ringan atasan-atas L2 → terapkan, jejak ActivityLog §27-4/§35-5).
// ============================================================================
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  MessagesSquare, Plus, Search, Loader2, CalendarPlus, CheckCircle2, AlertTriangle,
  PencilLine, RefreshCcw, TrendingUp, ChevronDown, Clock, UserRound,
} from "lucide-react";

// ---------- tipe (kontrak API) ----------

interface CycleRow { id: string; code: string; name: string; status: string; midStart: string | null; midEnd: string | null }
interface ParticipantRow {
  appraisalId: string; docNo: string; status: string; employeeNo: string; fullName: string;
  kpiCount: number; progressPct: number; locked: boolean;
}
interface CheckinRow {
  id: string; appraisalId: string; heldAt: string; agenda: string | null;
  notesJson: string; managerComment: string | null; nextCheckInAt: string | null;
  status: string; employeeNo: string; fullName: string; managerName: string | null; docNo: string; cycleCode: string;
}
interface MidRow {
  cycle: { code: string; status: string; midStart: string | null; midEnd: string | null };
  employee: { employeeNo: string; fullName: string };
  total: number; filled: number; pct: number;
  rows: { id: string; title: string; unit: string; polarity: string; target: number; midActual: number | null; finalActual: number | null; weight: number }[];
}
interface RevisionRow {
  requestId: string; appraisalId: string; createdAt: string;
  employee: string; approverName: string | null; approverId: string | null; reason: string;
  changes: { kpiId: string; title: string; oldTarget: number; newTarget: number; oldWeight: number; newWeight: number }[];
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
const num = (v: string | number | null | undefined, fb = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fb;
};

// ============================================================================
// HALAMAN
// ============================================================================

export function PerformanceCheckinsPage() {
  const { t } = useI18n();
  const cycles = useApi<{ rows: CycleRow[] }>("/api/rekankerja/performance/cycles");
  const [cycleId, setCycleId] = useState("");
  const [appraisalId, setAppraisalId] = useState<string | null>(null);

  const active = cycles.data?.rows ?? [];
  const cycle = active.find((c) => c.id === cycleId) ?? active.find((c) => c.status === "Ongoing") ?? active[0];
  const effCycleId = cycleId || cycle?.id || "";
  const ongoing = cycle?.status === "Ongoing";

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Performance · P2"
        title={t("Check-in", "Check-ins")}
        description={t(
          "1-on-1 terdokumentasi dua arah + checkpoint tengah tahun + revisi target mid-year (approval atasan berjenjang).",
          "Documented two-way 1-on-1s + mid-year checkpoint + mid-year target revision (manager-chain approval).",
        )}
        actions={(
          <Select value={effCycleId} onValueChange={(v) => { setCycleId(v); setAppraisalId(null); }}>
            <SelectTrigger className="w-56" aria-label={t("Pilih siklus", "Select cycle")}>
              <SelectValue placeholder={t("Pilih siklus…", "Select cycle…")} />
            </SelectTrigger>
            <SelectContent>
              {active.map((c) => (<SelectItem key={c.id} value={c.id}>{c.code} — {c.status}</SelectItem>))}
            </SelectContent>
          </Select>
        )}
      />

      {cycle && (
        <>
          {!ongoing && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
              {t(
                `Fase siklus ${cycle.status} — check-in & revisi target hanya sah saat Ongoing (§35-5/6). Riwayat tetap terbaca.`,
                `Cycle phase is ${cycle.status} — check-ins & target revision are valid during Ongoing only (§35-5/6). History remains readable.`,
              )}
            </div>
          )}
          {appraisalId
            ? <ParticipantDetail cycleId={cycle.id} cycleStatus={cycle.status} appraisalId={appraisalId} onBack={() => setAppraisalId(null)} />
            : <ParticipantPicker cycleId={cycle.id} ongoing={ongoing} onOpen={setAppraisalId} />}
          {ongoing && <RevisionPanel cycleId={cycle.id} />}
        </>
      )}
    </div>
  );
}

// ============================================================================
// PEMILIH PESERTA
// ============================================================================

function ParticipantPicker({ cycleId, ongoing, onOpen }: { cycleId: string; ongoing: boolean; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const { data, loading, error } = useApi<{ rows: ParticipantRow[] }>(
    `/api/rekankerja/performance/goals?cycleId=${cycleId}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    [cycleId, q],
  );
  const rows = (data?.rows ?? []).filter((r) => r.locked || ongoing);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{t("Peserta", "Participants")}</h3>
        <span className="text-xs text-slate-400">{t("pilih peserta untuk riwayat 1-on-1", "pick a participant for the 1-on-1 history")}</span>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="w-44 pl-8" placeholder={t("Cari…", "Search…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Cari peserta", "Search participants")} />
        </div>
      </div>
      {error && <EmptyState icon={AlertTriangle} title={t("Gagal memuat", "Failed to load")} description={error} />}
      {loading && <LoadingRows rows={5} />}
      {data && rows.length === 0 && (
        <EmptyState icon={MessagesSquare} title={t("Belum ada peserta dengan target terkunci", "No participants with locked goals")}
          description={t("Check-in mengikuti peserta yang targetnya sudah dikunci atasan.", "Check-ins follow participants whose goals are already locked by the manager.")} />
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <button key={r.appraisalId} onClick={() => onOpen(r.appraisalId)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 p-3 text-left transition hover:border-brand/40 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.fullName} <span className="font-mono text-[11px] text-slate-400">{r.employeeNo}</span></p>
              <p className="text-[11px] text-slate-500">{t(`${r.kpiCount} KPI`, `${r.kpiCount} KPIs`)} · <StatusPill status={r.status} /></p>
            </div>
            <MessagesSquare className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// DETAIL PESERTA — timeline 1-on-1 + checkpoint mid + revisi
// ============================================================================

function ParticipantDetail({ cycleId, cycleStatus, appraisalId, onBack }: {
  cycleId: string; cycleStatus: string; appraisalId: string; onBack: () => void;
}) {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<{ rows: CheckinRow[] }>(
    `/api/rekankerja/performance/checkins?appraisalId=${appraisalId}`,
    [appraisalId],
  );
  const mid = useApi<MidRow>(`/api/rekankerja/performance/checkins?mid=1&appraisalId=${appraisalId}`, [appraisalId]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [logFor, setLogFor] = useState<CheckinRow | null>(null);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [midEdits, setMidEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const ongoing = cycleStatus === "Ongoing";

  const saveMid = async () => {
    const rows = Object.entries(midEdits)
      .filter(([, v]) => v !== "")
      .map(([kpiId, v]) => ({ kpiId, midActual: v === "" ? null : Number(v) }));
    if (!rows.length) { toast.info(t("Belum ada perubahan capaian tengah tahun", "No mid-year actual changes yet")); return; }
    setBusy(true);
    try {
      const out = await apiSend<{ updated: number }>("/api/rekankerja/performance/checkins", "POST", { action: "saveMidActual", appraisalId, rows });
      toast.success(t(`${out.updated} KPI midActual tersimpan`, `${out.updated} KPI mid-actuals saved`));
      setMidEdits({});
      mid.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>← {t("Semua peserta", "All participants")}</Button>
        {ongoing && (
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setReviseOpen(true)}>
              <RefreshCcw className="h-4 w-4" /> {t("Ajukan Revisi Target", "Propose Target Revision")}
            </Button>
            <Button size="sm" onClick={() => setScheduleOpen(true)}>
              <CalendarPlus className="h-4 w-4" /> {t("Jadwalkan Check-in", "Schedule Check-in")}
            </Button>
          </div>
        )}
      </div>

      {error && <EmptyState icon={AlertTriangle} title={t("Gagal memuat", "Failed to load")} description={error} />}
      {loading && <LoadingRows rows={4} />}

      {/* riwayat 1-on-1 */}
      <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4 sm:p-5">
          <h3 className="mb-3 text-sm font-semibold">{t("Riwayat 1-on-1", "1-on-1 History")}</h3>
          {data && data.rows.length === 0 && (
            <EmptyState icon={MessagesSquare} title={t("Belum ada check-in", "No check-ins yet")}
              description={t("Jadwalkan 1-on-1 pertama — capaian sejauh ini / hambatan / rencana lanjut.", "Schedule the first 1-on-1 — progress so far / blockers / next steps.")} />
          )}
          <div className="space-y-2">
            {(data?.rows ?? []).map((c) => <CheckinCard key={c.id} c={c} onLog={() => setLogFor(c)} />)}
          </div>
        </CardContent>
      </Card>

      {/* checkpoint tengah tahun */}
      {ongoing && mid.data && (
        <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{t("Checkpoint Tengah Tahun", "Mid-Year Checkpoint")}</h3>
              <Badge variant="outline">{t(`jendela ${fmtD(mid.data.cycle.midStart)} – ${fmtD(mid.data.cycle.midEnd)}`, `window ${fmtD(mid.data.cycle.midStart)} – ${fmtD(mid.data.cycle.midEnd)}`)}</Badge>
              <span className="ml-auto text-xs tabular-nums text-slate-500">
                {t(`${mid.data.filled}/${mid.data.total} terisi · ${mid.data.pct}%`, `${mid.data.filled}/${mid.data.total} filled · ${mid.data.pct}%`)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-1.5 pr-2 font-medium">{t("KPI", "KPI")}</th>
                    <th className="py-1.5 pr-2 font-medium">{t("Target", "Target")}</th>
                    <th className="py-1.5 pr-2 font-medium">{t("Capaian tengah tahun", "Mid actual")}</th>
                    <th className="py-1.5 font-medium">{t("Bobot", "Weight")}</th>
                  </tr>
                </thead>
                <tbody>
                  {mid.data.rows.map((k) => (
                    <tr key={k.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                      <td className="py-1.5 pr-2 font-medium">{k.title}<span className="block text-[10px] text-slate-400">{k.unit}</span></td>
                      <td className="py-1.5 pr-2 tabular-nums">{k.target}</td>
                      <td className="py-1.5 pr-2">
                        {k.midActual != null && midEdits[k.id] === undefined
                          ? <span className="tabular-nums font-medium text-emerald-700 dark:text-emerald-400">{k.midActual}</span>
                          : (
                            <Input type="number" inputMode="decimal" className="h-8 w-24"
                              value={midEdits[k.id] ?? ""} placeholder={k.midActual != null ? String(k.midActual) : "—"}
                              onChange={(e) => setMidEdits((s) => ({ ...s, [k.id]: e.target.value }))}
                              aria-label={t("Capaian tengah tahun", "Mid actual")} />
                          )}
                      </td>
                      <td className="py-1.5 tabular-nums">{k.weight}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={saveMid} disabled={busy || Object.values(midEdits).every((v) => v === "")}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Simpan Capaian Tengah Tahun", "Save Mid-Year Actuals")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {scheduleOpen && <ScheduleDialog appraisalId={appraisalId} onClose={() => setScheduleOpen(false)} onDone={refresh} />}
      {logFor && <LogDialog c={logFor} onClose={() => setLogFor(null)} onDone={refresh} />}
      {reviseOpen && (
        <ReviseDialog appraisalId={appraisalId} midRows={mid.data?.rows ?? []} onClose={() => setReviseOpen(false)} />
      )}
      <span className="hidden">{cycleId}</span>
    </div>
  );
}

function CheckinCard({ c, onLog }: { c: CheckinRow; onLog: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const notes = useMemo(() => {
    try { return JSON.parse(c.notesJson) as { wins: string[]; blockers: string[]; next: string[]; employee?: { wins: string[]; blockers: string[]; next: string[] } }; }
    catch { return { wins: [], blockers: [], next: [] }; }
  }, [c.notesJson]);
  const hasEmployee = !!notes.employee && !!(notes.employee.wins?.length || notes.employee.blockers?.length || notes.employee.next?.length);
  return (
    <div className={cn("rounded-lg border p-3", c.status === "Held" ? "border-emerald-200 dark:border-emerald-900/50" : c.status === "Missed" ? "border-rose-200 dark:border-rose-900/50" : "border-slate-200 dark:border-slate-800")}>
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {fmtD(c.heldAt)} {c.agenda ? <span className="font-normal text-slate-500">— {c.agenda}</span> : ""}
          </p>
          <p className="text-[11px] text-slate-500">
            <StatusPill status={c.status} />
            {c.nextCheckInAt ? ` · ${t("berikutnya", "next")}: ${fmtD(c.nextCheckInAt)}` : ""}
            {hasEmployee ? ` · ${t("bagian karyawan terisi", "employee part filled")}` : ""}
          </p>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {c.status === "Planned" && (
            <Button size="sm" variant="outline" className="h-7" onClick={onLog}>
              <PencilLine className="h-3.5 w-3.5" /> {t("Catat Hasil", "Log Result")}
            </Button>
          )}
          <NotesSection label={t("Capaian sejauh ini", "Wins")} items={notes.wins} tone="emerald" />
          <NotesSection label={t("Hambatan", "Blockers")} items={notes.blockers} tone="rose" />
          <NotesSection label={t("Rencana lanjut", "Next steps")} items={notes.next} tone="slate" />
          {notes.employee && (notes.employee.wins?.length || notes.employee.blockers?.length || notes.employee.next?.length) ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
              <p className="mb-1 font-semibold text-amber-700 dark:text-amber-400"><UserRound className="mr-1 inline h-3 w-3" />{t("Bagian karyawan (dua arah §27-2)", "Employee part (two-way §27-2)")}</p>
              <NotesSection label={t("Capaian", "Wins")} items={notes.employee.wins} tone="emerald" />
              <NotesSection label={t("Hambatan", "Blockers")} items={notes.employee.blockers} tone="rose" />
              <NotesSection label={t("Rencana", "Next")} items={notes.employee.next} tone="slate" />
            </div>
          ) : null}
          {c.managerComment && (
            <p className="rounded-lg bg-slate-50 p-2 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
              <span className="font-semibold">{t("Catatan atasan:", "Manager note:")}</span> {c.managerComment}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NotesSection({ label, items, tone }: { label: string; items: string[]; tone: "emerald" | "rose" | "slate" }) {
  const { t } = useI18n();
  if (!items?.length) return null;
  return (
    <div>
      <p className="font-semibold text-slate-600 dark:text-slate-300">{label}</p>
      <ul className="ml-4 list-disc space-y-0.5">
        {items.map((x, i) => (
          <li key={i} className={cn(
            tone === "emerald" ? "text-emerald-700 dark:text-emerald-400" : tone === "rose" ? "text-rose-700 dark:text-rose-400" : "text-slate-600 dark:text-slate-300",
          )}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// DIALOG JADWAL
// ============================================================================

function ScheduleDialog({ appraisalId, onClose, onDone }: { appraisalId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [heldAt, setHeldAt] = useState("");
  const [agenda, setAgenda] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/checkins", "POST", {
        action: "schedule", appraisalId, heldAt, agenda: agenda || null, nextCheckInAt: next || null,
      });
      toast.success(t("Check-in dijadwalkan", "Check-in scheduled"));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Jadwalkan Check-in 1-on-1", "Schedule a 1-on-1 Check-in")}</DialogTitle>
          <DialogDescription>{t("Rencana diskusi ringkas: capaian sejauh ini / hambatan / rencana lanjut (§27-1).", "Plan a short discussion: progress so far / blockers / next steps (§27-1).")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t("Tanggal", "Date")}</Label>
            <Input type="date" value={heldAt} onChange={(e) => setHeldAt(e.target.value)} aria-label={t("Tanggal", "Date")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Agenda (opsional)", "Agenda (optional)")}</Label>
            <Input value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder={t("mis. Review capaian Q3", "e.g. Q3 progress review")} aria-label={t("Agenda", "Agenda")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Jadwal berikutnya (opsional)", "Next schedule (optional)")}</Label>
            <Input type="date" value={next} onChange={(e) => setNext(e.target.value)} aria-label={t("Jadwal berikutnya", "Next schedule")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy || !heldAt}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Jadwalkan", "Schedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DIALOG CATAT HASIL (§27-2 dua arah)
// ============================================================================

function LogDialog({ c, onClose, onDone }: { c: CheckinRow; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [w, setW] = useState<string[]>([""]);
  const [b, setB] = useState<string[]>([""]);
  const [n, setN] = useState<string[]>([""]);
  const [mc, setMc] = useState("");
  const [busy, setBusy] = useState(false);
  const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);

  const submit = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/checkins", "POST", {
        action: "log", id: c.id, heldAt: c.heldAt,
        wins: clean(w), blockers: clean(b), next: clean(n), managerComment: mc || null,
      });
      toast.success(t("Hasil 1-on-1 dicatat (Held)", "1-on-1 result logged (Held)"));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const ArrEditor = ({ label, items, set }: { label: string; items: string[]; set: (v: string[]) => void }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {items.map((x, i) => (
        <div key={i} className="flex gap-1.5">
          <Input value={x} onChange={(e) => set(items.map((y, j) => (j === i ? e.target.value : y)))}
            placeholder={t("tambah poin…", "add a point…")} aria-label={label} />
          {items.length > 1 && (
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400" onClick={() => set(items.filter((_, j) => j !== i))} aria-label={t("Hapus poin", "Remove point")}>×</Button>
          )}
        </div>
      ))}
      <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={() => set([...items, ""])}>
        <Plus className="h-3 w-3" />{t("tambah baris", "add row")}
      </Button>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(`Catat Hasil — ${fmtD(c.heldAt)}`, `Log Result — ${fmtD(c.heldAt)}`)}</DialogTitle>
          <DialogDescription>
            {t("Ringkas & terstruktur. Bagian karyawan dapat diisi karyawan dari ESS (dua arah §27-2).", "Short & structured. The employee can fill their part from ESS (two-way §27-2).")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ArrEditor label={t("Capaian sejauh ini", "Wins")} items={w} set={setW} />
          <ArrEditor label={t("Hambatan", "Blockers")} items={b} set={setB} />
          <ArrEditor label={t("Rencana lanjut", "Next steps")} items={n} set={setN} />
          <div className="space-y-1">
            <Label className="text-xs">{t("Catatan atasan", "Manager note")}</Label>
            <textarea className="min-h-16 w-full rounded-lg border border-slate-200 bg-transparent p-2.5 text-sm outline-none focus:border-brand dark:border-slate-800"
              value={mc} onChange={(e) => setMc(e.target.value)} aria-label={t("Catatan atasan", "Manager note")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Simpan", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DIALOG REVISI TARGET MID-YEAR (§27-4)
// ============================================================================

function ReviseDialog({ appraisalId, midRows, onClose }: { appraisalId: string; midRows: MidRow["rows"]; onClose: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [edits, setEdits] = useState<Record<string, { target?: string; weight?: string }>>({});
  const [busy, setBusy] = useState(false);
  const touched = Object.entries(edits).filter(([, v]) => (v.target ?? "") !== "" || (v.weight ?? "") !== "");

  const submit = async () => {
    setBusy(true);
    try {
      const changes = touched.map(([kpiId, v]) => ({
        kpiId,
        ...(v.target !== "" && v.target != null ? { target: Number(v.target) } : {}),
        ...(v.weight !== "" && v.weight != null ? { weight: Number(v.weight) } : {}),
      }));
      const out = await apiSend<{ requestId: string; approverName: string | null }>(
        "/api/rekankerja/performance/checkins", "POST", { action: "revise", appraisalId, changes, reason },
      );
      toast.success(t(
        `Revisi diajukan — menunggu keputusan atasan berjenjang (L2): ${out.approverName ?? "HR"}`,
        `Revision proposed — awaiting manager-chain (L2) decision: ${out.approverName ?? "HR"}`,
      ));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Ajukan Revisi Target (Mid-Year)", "Propose Target Revision (Mid-Year)")}</DialogTitle>
          <DialogDescription>
            {t(
              "Saat realita berubah (reorganisasi/krisis): atasan mengajukan, ATASAN BERJENJANG (L2) menyetujui → baris diperbarui + jejak ActivityLog (§27-4).",
              "When reality changes (reorg/crisis): the manager proposes, the MANAGER CHAIN (L2) approves → rows updated + ActivityLog trail (§27-4).",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
              <tr className="text-left text-slate-500">
                <th className="p-2 font-medium">{t("KPI", "KPI")}</th>
                <th className="p-2 font-medium">{t("Target lama", "Old target")}</th>
                <th className="p-2 font-medium">{t("Target baru", "New target")}</th>
                <th className="p-2 font-medium">{t("Bobot baru", "New weight")}</th>
              </tr>
            </thead>
            <tbody>
              {midRows.map((k) => (
                <tr key={k.id} className="border-t border-slate-100 dark:border-slate-800/60">
                  <td className="p-2">{k.title}</td>
                  <td className="p-2 tabular-nums text-slate-500">{k.target} {k.unit}</td>
                  <td className="p-2">
                    <Input type="number" inputMode="decimal" className="h-8 w-24" placeholder="—"
                      value={edits[k.id]?.target ?? ""}
                      onChange={(e) => setEdits((s) => ({ ...s, [k.id]: { ...s[k.id], target: e.target.value } }))}
                      aria-label={t("Target baru", "New target")} />
                  </td>
                  <td className="p-2">
                    <Input type="number" inputMode="decimal" className="h-8 w-20" placeholder={String(k.weight)}
                      value={edits[k.id]?.weight ?? ""}
                      onChange={(e) => setEdits((s) => ({ ...s, [k.id]: { ...s[k.id], weight: e.target.value } }))}
                      aria-label={t("Bobot baru", "New weight")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("Alasan revisi (wajib)", "Revision reason (required)")}</Label>
          <textarea className="min-h-16 w-full rounded-lg border border-slate-200 bg-transparent p-2.5 text-sm outline-none focus:border-brand dark:border-slate-800"
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={t("mis. Reorganisasi unit — KPI X tidak lagi relevan dengan pekerjaan", "e.g. Unit reorg — KPI X is no longer relevant to the job")}
            aria-label={t("Alasan revisi", "Revision reason")} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy || !reason.trim() || touched.length === 0}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Ajukan ke L2", "Submit to L2")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// PANEL PERMINTAAN REVISI (menunggu keputusan L2/HR §27-4)
// ============================================================================

function RevisionPanel({ cycleId }: { cycleId: string }) {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ rows: RevisionRow[] }>(
    `/api/rekankerja/performance/checkins?revisions=1&cycleId=${cycleId}`,
    [cycleId],
  );
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (requestId: string, action: "approveRevision" | "rejectRevision") => {
    setBusy(requestId);
    try {
      const out = await apiSend<{ applied: number }>("/api/rekankerja/performance/checkins", "POST", { action, requestId });
      toast.success(action === "approveRevision"
        ? t(`Revisi disetujui — ${out.applied} baris diterapkan`, `Revision approved — ${out.applied} rows applied`)
        : t("Revisi ditolak", "Revision rejected"));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  };

  if (!loading && (data?.rows ?? []).length === 0) return null;
  return (
    <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/10">
      <CardContent className="p-4 sm:p-5">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <TrendingUp className="h-4 w-4" />{t("Permintaan Revisi Menunggu Keputusan L2", "Revision Requests Awaiting L2 Decision")}
        </h3>
        <p className="mb-3 text-xs text-amber-700/80 dark:text-amber-400/80">
          {t("Hanya atasan berjenjang (atasan dari atasan) atau HR yang melihat & memutuskan (§27-4).", "Only the manager chain (manager of the manager) or HR can see & decide (§27-4).")}
        </p>
        {loading && <LoadingRows rows={2} />}
        <div className="space-y-2">
          {(data?.rows ?? []).map((r) => (
            <div key={r.requestId} className="rounded-lg border border-amber-200 bg-white/80 p-3 dark:border-amber-900/50 dark:bg-slate-900/80">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{r.employee}</span>
                <span className="text-xs text-slate-400">{fmtD(r.createdAt)}</span>
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7" disabled={busy === r.requestId} onClick={() => decide(r.requestId, "rejectRevision")}>
                    {t("Tolak", "Reject")}
                  </Button>
                  <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" disabled={busy === r.requestId} onClick={() => decide(r.requestId, "approveRevision")}>
                    {busy === r.requestId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{t("Setujui", "Approve")}
                  </Button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300"><span className="font-semibold">{t("Alasan:", "Reason:")}</span> {r.reason}</p>
              <ul className="mt-1 space-y-0.5 pl-4 text-xs text-slate-500 dark:text-slate-400">
                {r.changes.map((c) => (
                  <li key={c.kpiId}>• {c.title}: {t("target", "target")} {c.oldTarget} → <span className="font-semibold text-amber-700 dark:text-amber-400">{c.newTarget}</span>, {t("bobot", "weight")} {c.oldWeight}% → {c.newWeight}%</li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-slate-400">{t(`L2: ${r.approverName ?? "HR"}`, `L2: ${r.approverName ?? "HR"}`)}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
