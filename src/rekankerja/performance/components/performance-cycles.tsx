"use client";
// ============================================================================
// PERFORMANCE — Halaman Siklus Penilaian + TAB Command Center (P1 — §20,
// §14.2 menu "cycles", §18.8 AM2 Command Center & Nudge multi-kanal).
// Struktur: daftar siklus → detail siklus (fase + aksi gerbang + peserta) →
// TAB Command Center (matriks peserta × fase, agregat per atasan, Remind /
// Remind All dengan konfirmasi jumlah penerima + pratinjau pesan + kanal).
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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CalendarRange, Plus, ChevronLeft, Users, UserPlus, Play, Megaphone, Bell, Mail, MessageCircle,
  Search, Filter, CheckCircle2, Circle, Clock, AlertTriangle, Trash2, Copy, Loader2, ListChecks,
} from "lucide-react";

// ---------- tipe data (kontrak API §17) ----------

interface CycleRow {
  id: string; code: string; name: string; cycleType: string;
  periodStart: string; periodEnd: string;
  goalStart: string | null; goalEnd: string | null;
  midStart: string | null; midEnd: string | null;
  selfStart: string | null; selfEnd: string | null;
  mgrStart: string | null; mgrEnd: string | null;
  calibStart: string | null; calibEnd: string | null; publishAt: string | null;
  weightsJson: string; feedback360: boolean; status: string;
  participantCount: number; goalApprovedCount: number;
}

interface GoalParticipantRow {
  appraisalId: string; docNo: string; status: string;
  employeeNo: string; fullName: string;
  kpiCount: number; progressPct: number;
  hasProposal: boolean; goalsCopiedFrom: string | null; locked: boolean;
  lastSavedAt: string | null;
}

interface CCRow {
  appraisalId: string; docNo: string; employeeNo: string; fullName: string;
  unit: string | null; position: string | null; managerName: string | null; managerId: string | null;
  status: string; goalDone: boolean; selfDone: boolean; managerDone: boolean; calibDone: boolean; ackDone: boolean;
  kpiCount: number; progressPct: number; goalsCopiedFrom: string | null;
  lastSavedAt: string | null; phaseLagging: boolean; lagReason: string | null;
  lagTarget: "manager" | "employee" | "hr" | null;
  lastNudge: { channel: string; at: string } | null;
}

interface CCData {
  cycle: CycleRow;
  rows: CCRow[];
  managers: { managerId: string | null; managerName: string; total: number; goalDone: number; avgProgress: number }[];
  tile: { phase: string; laggingCount: number; participantCount: number };
}

interface NudgeResult {
  appraisalId: string; docNo: string; employeeNo: string; fullName: string; recipientName: string | null;
  results: { channel: string; status: string; note: string }[];
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

// ============================================================================
// HALAMAN UTAMA
// ============================================================================

export function PerformanceCyclesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return selectedId
    ? <CycleDetail cycleId={selectedId} onBack={() => setSelectedId(null)} />
    : <CycleList onOpen={setSelectedId} />;
}

// ============================================================================
// DAFTAR SIKLUS
// ============================================================================

function CycleList({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const { data, loading, error, refresh } = useApi<{ rows: CycleRow[] }>(
    `/api/rekankerja/performance/cycles${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    [q],
  );
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Performance · P1"
        title={t("Siklus Penilaian", "Appraisal Cycles")}
        description={t(
          "Kelola siklus penilaian kinerja: periode, jendela fase, peserta, dan Command Center pengejaran formulir.",
          "Manage performance cycles: period, phase windows, participants, and the form-chasing Command Center.",
        )}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="w-44 pl-8" placeholder={t("Cari kode/nama…", "Search code/name…")}
                value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Cari siklus", "Search cycles")}
              />
            </div>
            <Button onClick={() => setCreateOpen(true)} size="sm">
              <Plus className="h-4 w-4" /> {t("Buat Siklus", "New Cycle")}
            </Button>
          </div>
        )}
      />

      {error && <EmptyState icon={AlertTriangle} title={t("Gagal memuat siklus", "Failed to load cycles")} description={error} />}
      {loading && <LoadingRows rows={5} />}

      {data && (
        data.rows.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title={t("Belum ada siklus penilaian", "No appraisal cycles yet")}
            description={t(
              "Buat siklus pertama (mis. PER-2026), enroll peserta, lalu buka fase penetapan target.",
              "Create the first cycle (e.g. PER-2026), enroll participants, then open the goal-setting phase.",
            )}
          />
        ) : (
          <div className="space-y-3">
            {data.rows.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpen(c.id)}
                className="block w-full rounded-xl border border-slate-200 bg-white/80 p-4 text-left transition hover:border-brand/40 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/80"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{c.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-600 dark:text-slate-300">{c.name}</span>
                  <StatusPill status={c.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1"><CalendarRange className="h-3.5 w-3.5" />{fmtD(c.periodStart)} → {fmtD(c.periodEnd)}</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{t(`${c.participantCount} peserta`, `${c.participantCount} participants`)}</span>
                  <span className="inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" />{t(`${c.goalApprovedCount}/${c.participantCount} target terkunci`, `${c.goalApprovedCount}/${c.participantCount} targets locked`)}</span>
                  {c.feedback360 && <Badge variant="outline" className="h-5 text-[10px]">360°</Badge>}
                </div>
              </button>
            ))}
          </div>
        )
      )}

      <CreateCycleDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); refresh(); }} />
    </div>
  );
}

// ============================================================================
// DIALOG BUAT SIKLUS
// ============================================================================

function CreateCycleDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: "", name: "", cycleType: "Annual",
    periodStart: "", periodEnd: "",
    goalStart: "", goalEnd: "", midStart: "", midEnd: "",
    selfStart: "", selfEnd: "", mgrStart: "", mgrEnd: "",
    calibStart: "", calibEnd: "", publishAt: "",
    wKpi: 70, wComp: 20, wCore: 10, feedback360: false,
  });
  const set = (k: keyof typeof form, v: string | number | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/cycles", "POST", {
        action: "create",
        code: form.code, name: form.name, cycleType: form.cycleType,
        periodStart: form.periodStart, periodEnd: form.periodEnd,
        goalStart: form.goalStart || null, goalEnd: form.goalEnd || null,
        midStart: form.midStart || null, midEnd: form.midEnd || null,
        selfStart: form.selfStart || null, selfEnd: form.selfEnd || null,
        mgrStart: form.mgrStart || null, mgrEnd: form.mgrEnd || null,
        calibStart: form.calibStart || null, calibEnd: form.calibEnd || null,
        publishAt: form.publishAt || null,
        weightsJson: JSON.stringify({ kpi: Number(form.wKpi), competency: Number(form.wComp), core: Number(form.wCore) }),
        feedback360: form.feedback360,
      });
      toast.success(t(`Siklus ${form.code} dibuat (Draft)`, `Cycle ${form.code} created (Draft)`));
      setForm({ ...form, code: "", name: "" });
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const DateField = ({ k, label }: { k: keyof typeof form; label: string }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="date" value={String(form[k])} onChange={(e) => set(k, e.target.value)} aria-label={label} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Buat Siklus Penilaian", "Create Appraisal Cycle")}</DialogTitle>
          <DialogDescription>
            {t(
              "Status awal Draft — enroll peserta lalu buka fase target. Jendela fase boleh kosong (fase dilewati).",
              "Starts as Draft — enroll participants then open the goal phase. Phase windows may be empty (phase skipped).",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{t("Kode siklus", "Cycle code")}</Label>
            <Input placeholder={t("PER-2026", "PER-2026")} value={form.code} onChange={(e) => set("code", e.target.value)} aria-label={t("Kode siklus", "Cycle code")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Nama siklus", "Cycle name")}</Label>
            <Input placeholder={t("Penilaian Tahunan 2026", "Annual Appraisal 2026")} value={form.name} onChange={(e) => set("name", e.target.value)} aria-label={t("Nama siklus", "Cycle name")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Jenis", "Type")}</Label>
            <Select value={form.cycleType} onValueChange={(v) => set("cycleType", v)}>
              <SelectTrigger aria-label={t("Jenis siklus", "Cycle type")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Annual">{t("Tahunan", "Annual")}</SelectItem>
                <SelectItem value="MidYearOnly">{t("Tengah Tahun", "Mid-Year Only")}</SelectItem>
                <SelectItem value="OffCycle">{t("Luar Siklus", "Off-Cycle")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DateField k="periodStart" label={t("Awal periode", "Period start")} />
          <DateField k="periodEnd" label={t("Akhir periode", "Period end")} />
          <DateField k="publishAt" label={t("Publikasi hasil", "Publish at")} />
        </div>

        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{t("Jendela fase (opsional — kosong = dilewati)", "Phase windows (optional — empty = skipped)")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField k="goalStart" label={t("Target — mulai", "Goals — start")} />
            <DateField k="goalEnd" label={t("Target — selesai", "Goals — end")} />
            <DateField k="midStart" label={t("Mid-year — mulai", "Mid-year — start")} />
            <DateField k="midEnd" label={t("Mid-year — selesai", "Mid-year — end")} />
            <DateField k="selfStart" label={t("Penilaian diri — mulai", "Self — start")} />
            <DateField k="selfEnd" label={t("Penilaian diri — selesai", "Self — end")} />
            <DateField k="mgrStart" label={t("Penilaian atasan — mulai", "Manager — start")} />
            <DateField k="mgrEnd" label={t("Penilaian atasan — selesai", "Manager — end")} />
            <DateField k="calibStart" label={t("Kalibrasi — mulai", "Calibration — start")} />
            <DateField k="calibEnd" label={t("Kalibrasi — selesai", "Calibration — end")} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">{t("Bobot KPI %", "KPI weight %")}</Label>
            <Input type="number" min={0} max={100} value={form.wKpi} onChange={(e) => set("wKpi", Number(e.target.value))} aria-label={t("Bobot KPI", "KPI weight")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Kompetensi %", "Competency %")}</Label>
            <Input type="number" min={0} max={100} value={form.wComp} onChange={(e) => set("wComp", Number(e.target.value))} aria-label={t("Bobot kompetensi", "Competency weight")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Nilai inti %", "Core values %")}</Label>
            <Input type="number" min={0} max={100} value={form.wCore} onChange={(e) => set("wCore", Number(e.target.value))} aria-label={t("Bobot nilai inti", "Core values weight")} />
          </div>
          <div className="flex items-end">
            <p className={cn("text-xs", Number(form.wKpi) + Number(form.wComp) + Number(form.wCore) === 100 ? "text-emerald-600" : "text-amber-600")}>
              Σ {Number(form.wKpi) + Number(form.wComp) + Number(form.wCore)}% {t("(harus 100)", "(must be 100)")}
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.feedback360} onCheckedChange={(v) => set("feedback360", v === true)} aria-label={t("Aktifkan 360", "Enable 360")} />
          {t("Aktifkan umpan balik 360° untuk siklus ini", "Enable 360° feedback for this cycle")}
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy || !form.code || !form.name || !form.periodStart || !form.periodEnd}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Buat", "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DETAIL SIKLUS — fase + aksi + peserta + Command Center
// ============================================================================

function CycleDetail({ cycleId, onBack }: { cycleId: string; onBack: () => void }) {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<{ cycle: CycleRow }>(
    `/api/rekankerja/performance/cycles?detail=${cycleId}`,
  );
  const [tab, setTab] = useState<"participants" | "command">("participants");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [phaseBusy, setPhaseBusy] = useState<string | null>(null);

  const c = data?.cycle;

  const runPhase = async (action: string, extra: Record<string, unknown> = {}, okMsg?: string) => {
    setPhaseBusy(action);
    try {
      const res = await apiSend<{ prefill?: { filled: number; templateFilled: number; noSource: number } | null }>(
        "/api/rekankerja/performance/cycles", "POST", { action, cycleId, ...extra },
      );
      toast.success(okMsg ?? t("Fase siklus diperbarui", "Cycle phase updated"));
      if (res?.prefill) {
        toast.info(t(
          `Prefill: ${res.prefill.filled} peserta disalin dari periode lalu · ${res.prefill.templateFilled} dari template · ${res.prefill.noSource} tanpa sumber`,
          `Prefill: ${res.prefill.filled} copied from previous period · ${res.prefill.templateFilled} from template · ${res.prefill.noSource} without source`,
        ));
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setPhaseBusy(null);
    }
  };

  const phases: { key: string; label: string; labelEn: string; start: string | null; end: string | null }[] = c ? [
    { key: "goal", label: "Target", labelEn: "Goals", start: c.goalStart, end: c.goalEnd },
    { key: "mid", label: "Mid-year", labelEn: "Mid-year", start: c.midStart, end: c.midEnd },
    { key: "self", label: "Penilaian diri", labelEn: "Self", start: c.selfStart, end: c.selfEnd },
    { key: "mgr", label: "Penilaian atasan", labelEn: "Manager", start: c.mgrStart, end: c.mgrEnd },
    { key: "calib", label: "Kalibrasi", labelEn: "Calibration", start: c.calibStart, end: c.calibEnd },
    { key: "pub", label: "Publikasi", labelEn: "Publish", start: c.publishAt, end: c.publishAt },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4" />{t("Kembali", "Back")}</Button>
      </div>

      {error && <EmptyState icon={AlertTriangle} title={t("Gagal memuat siklus", "Failed to load cycle")} description={error} />}
      {loading && <LoadingRows rows={4} />}

      {c && (
        <>
          <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-base font-semibold">{c.code}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-600 dark:text-slate-300">{c.name}</span>
                <StatusPill status={c.status} />
              </div>

              {/* linimasa fase */}
              <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {phases.map((p) => {
                  const active =
                    (p.key === "goal" && c.status === "GoalSetting") ||
                    (p.key === "mid" && c.status === "Ongoing") ||
                    (p.key === "self" && c.status === "Assessment") ||
                    (p.key === "mgr" && c.status === "Assessment") ||
                    (p.key === "calib" && c.status === "Calibration") ||
                    (p.key === "pub" && c.status === "Published");
                  const skipped = !p.start && !p.end;
                  return (
                    <div key={p.key} className={cn(
                      "rounded-lg border p-2.5 text-xs",
                      active ? "border-brand/50 bg-brand/5" : "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40",
                    )}>
                      <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                        {skipped ? <Circle className="h-3 w-3 text-slate-300" /> : active ? <Play className="h-3 w-3 text-brand" /> : <Clock className="h-3 w-3 text-slate-400" />}
                        {t(p.label, p.labelEn)}
                      </div>
                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                        {skipped ? t("dilewati", "skipped") : `${fmtD(p.start)} → ${fmtD(p.end)}`}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* aksi gerbang fase */}
              <div className="mt-4 flex flex-wrap gap-2">
                {c.status === "Draft" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>
                      <UserPlus className="h-4 w-4" /> {t("Enroll Peserta", "Enroll Participants")}
                    </Button>
                    <ConfirmPhaseButton
                      label={t("Buka Fase Target", "Open Goal Phase")}
                      description={t(
                        "Peserta akan dinotifikasi: fase penetapan target dibuka. Jendela goal wajib sudah terisi (§35-1).",
                        "Participants will be notified: the goal-setting phase is open. The goal window must be filled (§35-1).",
                      )}
                      prefillOption
                      busy={phaseBusy === "openGoal"}
                      onConfirm={(prefill) => runPhase("openGoal", { prefill })}
                    />
                    <ConfirmPhaseButton
                      label={t("Hapus Draft", "Delete Draft")}
                      description={t("Siklus Draft dan seluruh pesertanya dihapus. Tidak dapat dibatalkan.", "The Draft cycle and all its participants will be deleted. Cannot be undone.")}
                      destructive
                      busy={phaseBusy === "deleteDraft"}
                      onConfirm={() => runPhase("deleteDraft").then(onBack)}
                    />
                  </>
                )}
                {c.status === "GoalSetting" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>
                      <UserPlus className="h-4 w-4" /> {t("Tambah Peserta", "Add Participants")}
                    </Button>
                    <ConfirmPhaseButton
                      label={t("Mulai Ongoing", "Start Ongoing")}
                      description={t(
                        "Siklus berjalan. Peserta yang targetnya belum dikunci tetap terlihat tertinggal di Command Center.",
                        "The cycle is ongoing. Participants without locked targets remain flagged in the Command Center.",
                      )}
                      busy={phaseBusy === "startOngoing"}
                      onConfirm={() => runPhase("startOngoing")}
                    />
                  </>
                )}
                {c.status === "Ongoing" && (
                  <ConfirmPhaseButton
                    label={t("Buka Penilaian", "Open Assessment")}
                    description={t("Fase penilaian diri lalu atasan dibuka sesuai jendela self/manager.", "Self then manager assessment opens per the self/manager windows.")}
                    busy={phaseBusy === "startAssessment"}
                    onConfirm={() => runPhase("startAssessment")}
                  />
                )}
                {c.status === "Assessment" && (
                  <ConfirmPhaseButton
                    label={t("Buka Kalibrasi", "Open Calibration")}
                    description={t("Fase kalibrasi dibuka untuk pembahasan hasil.", "The calibration phase opens to discuss results.")}
                    busy={phaseBusy === "startCalibration"}
                    onConfirm={() => runPhase("startCalibration")}
                  />
                )}
                {c.status === "Calibration" && (
                  <ConfirmPhaseButton
                    label={t("Publikasikan", "Publish")}
                    description={t(
                      "Hasil diterbitkan ke karyawan. Peserta ManagerDone yang belum final akan memblokir — kecuali force (ter-ActivityLog).",
                      "Results are released to employees. Pending ManagerDone participants block publishing — unless forced (ActivityLog-recorded).",
                    )}
                    forceOption
                    busy={phaseBusy === "publish"}
                    onConfirm={(force) => runPhase("publish", { force })}
                  />
                )}
                {c.status === "Published" && (
                  <ConfirmPhaseButton
                    label={t("Tutup Siklus", "Close Cycle")}
                    description={t("Siklus ditutup setelah semua banding selesai (§35-16).", "The cycle closes after all appeals are settled (§35-16).")}
                    busy={phaseBusy === "close"}
                    onConfirm={() => runPhase("close")}
                  />
                )}
              </div>
            </CardContent>
          </Card>

          {/* TAB */}
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50/60 p-1 dark:border-slate-800 dark:bg-slate-900/40" role="tablist">
            <button role="tab" aria-selected={tab === "participants"} onClick={() => setTab("participants")}
              className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition", tab === "participants" ? "bg-white shadow-sm dark:bg-slate-800" : "text-slate-500 hover:text-slate-700 dark:text-slate-400")}>
              <Users className="mr-1.5 inline h-4 w-4" />{t("Peserta", "Participants")}
            </button>
            <button role="tab" aria-selected={tab === "command"} onClick={() => setTab("command")}
              className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition", tab === "command" ? "bg-white shadow-sm dark:bg-slate-800" : "text-slate-500 hover:text-slate-700 dark:text-slate-400")}>
              <Megaphone className="mr-1.5 inline h-4 w-4" />{t("Command Center", "Command Center")}
            </button>
          </div>

          {tab === "participants"
            ? <ParticipantsTab cycleId={cycleId} cycle={c} onChanged={refresh} />
            : <CommandCenterTab cycleId={cycleId} cycle={c} />}

          <EnrollDialog open={enrollOpen} cycleId={c.id} cycleStatus={c.status} onClose={() => setEnrollOpen(false)} onDone={refresh} />
        </>
      )}
    </div>
  );
}

/** Tombol aksi fase dengan dialog konfirmasi (+ opsi prefill/force bila relevan). */
function ConfirmPhaseButton({ label, description, onConfirm, destructive, prefillOption, forceOption, busy }: {
  label: string; description: string;
  onConfirm: (opt?: boolean) => void | Promise<void>;
  destructive?: boolean; prefillOption?: boolean; forceOption?: boolean; busy?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [opt, setOpt] = useState(false);
  return (
    <>
      <Button size="sm" variant={destructive ? "destructive" : "default"} disabled={busy} onClick={() => setOpen(true)}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : prefillOption ? <Copy className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {prefillOption && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
              <Checkbox checked={opt} onCheckedChange={(v) => setOpt(v === true)} className="mt-0.5" aria-label={t("Prefill dari periode lalu", "Prefill from previous period")} />
              <span>
                {t("Prefill dari periode lalu (§18.2-d)", "Prefill from previous period (§18.2-d)")}
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {t("Peserta dengan siklus sumber di-isi salinan KPI; tanpa sumber diberi baris template. Semua tetap menunggu review + submit atasan.", "Participants with a source cycle get copied KPI rows; those without get template rows. All still await manager review + submit.")}
                </span>
              </span>
            </label>
          )}
          {forceOption && (
            <label className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm dark:border-rose-900/60 dark:bg-rose-950/30">
              <Checkbox checked={opt} onCheckedChange={(v) => setOpt(v === true)} className="mt-0.5" aria-label={t("Publikasikan paksa", "Force publish")} />
              <span>{t("Publikasikan paksa (peserta ManagerDone dipaksa — ter-ActivityLog)", "Force publish (pending ManagerDone forced — ActivityLog-recorded)")}</span>
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal", "Cancel")}</Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              onClick={async () => { setOpen(false); await onConfirm(opt); }}
            >
              {t("Lanjutkan", "Continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================================
// TAB PESERTA
// ============================================================================

function ParticipantsTab({ cycleId, cycle, onChanged }: { cycleId: string; cycle: CycleRow; onChanged: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const { data, loading, error } = useApi<{ rows: GoalParticipantRow[] }>(
    `/api/rekankerja/performance/goals?cycleId=${cycleId}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    [cycleId, q],
  );
  void onChanged;

  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{t("Peserta Siklus", "Cycle Participants")}</h3>
          <span className="text-xs text-slate-400">{t("snapshot atasan terkunci saat enroll", "manager snapshot locked at enroll")}</span>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="w-44 pl-8" placeholder={t("Cari peserta…", "Search participant…")} value={q}
              onChange={(e) => setQ(e.target.value)} aria-label={t("Cari peserta", "Search participants")} />
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {loading && <LoadingRows rows={6} />}
        {data && data.rows.length === 0 && (
          <EmptyState
            icon={Users}
            title={t("Belum ada peserta", "No participants yet")}
            description={t(
              cycle.status === "Draft"
                ? "Enroll karyawan aktif — snapshot atasan (siapa menilai siapa) dikunci saat enroll."
                : "Siklus sudah berjalan tanpa peserta — enroll untuk mengejar.",
              cycle.status === "Draft"
                ? "Enroll active employees — the manager snapshot (who appraises whom) is locked at enroll."
                : "The cycle is running without participants — enroll to catch up.",
            )}
          />
        )}
        {data && data.rows.length > 0 && (
          <>
            {/* desktop tabel */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-2 pr-2 font-medium">{t("Karyawan", "Employee")}</th>
                    <th className="py-2 pr-2 font-medium">{t("Status", "Status")}</th>
                    <th className="py-2 pr-2 font-medium">{t("KPI", "KPIs")}</th>
                    <th className="py-2 pr-2 font-medium">{t("Progres", "Progress")}</th>
                    <th className="py-2 pr-2 font-medium">{t("Terakhir disimpan", "Last saved")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.appraisalId} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                      <td className="py-2 pr-2">
                        <span className="font-mono text-xs text-slate-400">{r.employeeNo}</span>{" "}
                        <span className="font-medium">{r.fullName}</span>
                        {r.goalsCopiedFrom && (
                          <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] text-brand border-brand/40">
                            <Copy className="mr-0.5 h-2.5 w-2.5" />{r.goalsCopiedFrom}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-2"><StatusPill status={r.status} /></td>
                      <td className="py-2 pr-2 tabular-nums">{r.kpiCount}</td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div className={cn("h-full rounded-full", r.progressPct >= 100 ? "bg-emerald-500" : "bg-brand")} style={{ width: `${Math.min(r.progressPct, 100)}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-slate-500">{r.progressPct}%</span>
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-xs text-slate-400">{r.lastSavedAt ? new Date(r.lastSavedAt).toLocaleString("id-ID") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* mobile kartu */}
            <div className="space-y-2 md:hidden">
              {data.rows.map((r) => (
                <div key={r.appraisalId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.fullName}</p>
                      <p className="font-mono text-[11px] text-slate-400">{r.employeeNo} · {r.docNo}</p>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <span>{t(`${r.kpiCount} KPI`, `${r.kpiCount} KPIs`)}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className={cn("h-full rounded-full", r.progressPct >= 100 ? "bg-emerald-500" : "bg-brand")} style={{ width: `${Math.min(r.progressPct, 100)}%` }} />
                    </div>
                    <span className="tabular-nums">{r.progressPct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// DIALOG ENROLL
// ============================================================================

function EnrollDialog({ open, cycleId, cycleStatus, onClose, onDone }: {
  open: boolean; cycleId: string; cycleStatus: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"all" | "unit">("all");
  const [unitId, setUnitId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{
    enrolled: { employeeNo: string; fullName: string; managerName: string | null }[];
    skippedDuplicate: { employeeNo: string; fullName: string }[];
    needManager: { employeeNo: string; fullName: string }[];
  } | null>(null);
  const units = useApi<{ units: { id: string; name: string }[] }>("/api/rekankerja/org-units");

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ report: typeof report }>(
        "/api/rekankerja/performance/cycles", "POST",
        { action: "enroll", cycleId, mode, unitId: mode === "unit" ? unitId : undefined },
      );
      setReport(res.report);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReport(null); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Enroll Peserta", "Enroll Participants")}</DialogTitle>
          <DialogDescription>
            {t(
              `Karyawan Aktif yang didaftarkan; atasan (snapshot) diambil dari penempatan aktif — siapa menilai siapa terkunci & tercatat. Siklus saat ini: ${cycleStatus}.`,
              `Active employees are enrolled; the manager snapshot comes from the active placement — who appraises whom is locked & recorded. Current cycle status: ${cycleStatus}.`,
            )}
          </DialogDescription>
        </DialogHeader>
        {!report ? (
          <>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode("all")}
                  className={cn("rounded-lg border p-3 text-left text-sm transition", mode === "all" ? "border-brand bg-brand/5" : "border-slate-200 hover:border-slate-300 dark:border-slate-800")}
                  aria-pressed={mode === "all"}
                >
                  <Users className="mb-1 h-4 w-4" />
                  <div className="font-medium">{t("Semua karyawan aktif", "All active employees")}</div>
                  <div className="text-xs text-slate-500">{t("Seluruh tenant", "Whole tenant")}</div>
                </button>
                <button
                  onClick={() => setMode("unit")}
                  className={cn("rounded-lg border p-3 text-left text-sm transition", mode === "unit" ? "border-brand bg-brand/5" : "border-slate-200 hover:border-slate-300 dark:border-slate-800")}
                  aria-pressed={mode === "unit"}
                >
                  <Filter className="mb-1 h-4 w-4" />
                  <div className="font-medium">{t("Per unit", "By unit")}</div>
                  <div className="text-xs text-slate-500">{t("Pilih unit organisasi", "Pick an org unit")}</div>
                </button>
              </div>
              {mode === "unit" && (
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger aria-label={t("Unit organisasi", "Org unit")}><SelectValue placeholder={t("Pilih unit…", "Select unit…")} /></SelectTrigger>
                  <SelectContent>
                    {(units.data?.units ?? []).map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("Duplikat (sudah terdaftar) otomatis dilompati (§35-2). Karyawan tanpa atasan tetap didaftarkan + ditandai.", "Duplicates (already enrolled) are skipped automatically (§35-2). Employees without a manager are still enrolled + flagged.")}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
              <Button onClick={submit} disabled={busy || (mode === "unit" && !unitId)}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Enroll", "Enroll")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mr-1 inline h-4 w-4" />
                {t(`${report.enrolled.length} peserta ditambahkan`, `${report.enrolled.length} participants added`)}
              </p>
              <div className="mt-1 max-h-40 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
                {report.enrolled.map((e) => (
                  <p key={e.employeeNo}>
                    <span className="font-mono">{e.employeeNo}</span> {e.fullName}
                    {e.managerName ? ` — ${t("atasan", "manager")}: ${e.managerName}` : ""}
                  </p>
                ))}
              </div>
            </div>
            {report.skippedDuplicate.length > 0 && (
              <p className="text-xs text-slate-500">{t(`${report.skippedDuplicate.length} duplikat dilompati`, `${report.skippedDuplicate.length} duplicates skipped`)}</p>
            )}
            {report.needManager.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900/60 dark:bg-amber-950/30">
                <p className="font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                  {t(`${report.needManager.length} karyawan tanpa atasan — butuh penunjukan manual`, `${report.needManager.length} employees without a manager — manual assignment needed`)}
                </p>
                <div className="mt-1 max-h-32 overflow-y-auto text-slate-600 dark:text-slate-300">
                  {report.needManager.map((e) => (<p key={e.employeeNo}><span className="font-mono">{e.employeeNo}</span> {e.fullName}</p>))}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button onClick={onClose}>{t("Selesai", "Done")}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB COMMAND CENTER (§18.8)
// ============================================================================

function CommandCenterTab({ cycleId, cycle }: { cycleId: string; cycle: CycleRow }) {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<CCData>(
    `/api/rekankerja/performance/cycles?commandCenter=1&cycleId=${cycleId}`,
    [cycleId],
  );
  const [q, setQ] = useState("");
  const [unitF, setUnitF] = useState("all");
  const [mgrF, setMgrF] = useState("all");
  const [lagOnly, setLagOnly] = useState(false);
  const [nudgeAllOpen, setNudgeAllOpen] = useState(false);
  const [rowNudge, setRowNudge] = useState<CCRow | null>(null);

  const units = useMemo(() => {
    const s = new Set<string>();
    (data?.rows ?? []).forEach((r) => { if (r.unit) s.add(r.unit); });
    return [...s].sort();
  }, [data]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return (data?.rows ?? []).filter((r) =>
      (!ql || r.fullName.toLowerCase().includes(ql) || r.employeeNo.toLowerCase().includes(ql)) &&
      (unitF === "all" || r.unit === unitF) &&
      (mgrF === "all" || r.managerId === mgrF) &&
      (!lagOnly || r.phaseLagging),
    );
  }, [data, q, unitF, mgrF, lagOnly]);

  const phaseLabel: Record<string, [string, string]> = {
    GoalSetting: ["penetapan target", "goal setting"],
    Ongoing: ["siklus berjalan", "ongoing"],
    Assessment: ["penilaian", "assessment"],
    Calibration: ["kalibrasi", "calibration"],
    Published: ["acknowledgement", "acknowledgement"],
  };
  const [phId, phEn] = phaseLabel[cycle.status] ?? ["-", "-"];

  return (
    <div className="space-y-4">
      {/* tile ringkasan */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-slate-500">{t("Belum mengisi " + phId, "Lagging on " + phEn)}</p>
            {loading ? <Skeleton className="mt-2 h-7 w-20" /> : (
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {data?.tile.laggingCount ?? 0}
                <span className="text-base font-normal text-slate-400">/{data?.tile.participantCount ?? 0}</span>
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-slate-500">{t("Fase aktif", "Active phase")}</p>
            <div className="mt-1.5"><StatusPill status={cycle.status} /></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4">
            <p className="mb-2 text-xs font-medium text-slate-500">{t("Agregat per atasan (paling tertinggal)", "Per-manager aggregates (most behind)")}</p>
            <div className="max-h-24 space-y-0.5 overflow-y-auto text-xs">
              {(data?.managers ?? []).slice(0, 8).map((mg) => (
                <div key={mg.managerId ?? "none"} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-600 dark:text-slate-300">{mg.managerName}</span>
                  <span className="shrink-0 tabular-nums text-slate-400">{mg.goalDone}/{mg.total} · {mg.avgProgress}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="w-44 pl-8" placeholder={t("Cari peserta…", "Search…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Cari peserta", "Search participants")} />
        </div>
        <Select value={unitF} onValueChange={setUnitF}>
          <SelectTrigger className="w-40" aria-label={t("Filter unit", "Filter unit")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua unit", "All units")}</SelectItem>
            {units.map((u) => (<SelectItem key={u} value={u}>{u}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={mgrF} onValueChange={setMgrF}>
          <SelectTrigger className="w-40" aria-label={t("Filter atasan", "Filter manager")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua atasan", "All managers")}</SelectItem>
            {(data?.managers ?? []).filter((m) => m.managerId).map((m) => (<SelectItem key={m.managerId} value={m.managerId as string}>{m.managerName}</SelectItem>))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
          <Checkbox checked={lagOnly} onCheckedChange={(v) => setLagOnly(v === true)} aria-label={t("Hanya tertinggal", "Lagging only")} />
          {t("Hanya tertinggal", "Lagging only")}
        </label>
        <div className="ml-auto">
          <Button size="sm" variant="default" onClick={() => setNudgeAllOpen(true)} disabled={!data || data.tile.laggingCount === 0}>
            <Megaphone className="h-4 w-4" /> {t("Remind All", "Remind All")}
          </Button>
        </div>
      </div>

      {error && <EmptyState icon={AlertTriangle} title={t("Gagal memuat Command Center", "Failed to load Command Center")} description={error} />}
      {loading && <LoadingRows rows={6} />}

      {/* matriks */}
      {data && (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-2 pr-2 font-medium">{t("Peserta", "Participant")}</th>
                  <th className="py-2 pr-2 font-medium">{t("Atasan", "Manager")}</th>
                  <th className="py-2 pr-2 font-medium">{t("Target", "Goals")}</th>
                  <th className="py-2 pr-2 font-medium">{t("Diri", "Self")}</th>
                  <th className="py-2 pr-2 font-medium">{t("Atasan nilai", "Mgr")}</th>
                  <th className="py-2 pr-2 font-medium">{t("Kalibrasi", "Calib")}</th>
                  <th className="py-2 pr-2 font-medium">{t("Ack", "Ack")}</th>
                  <th className="py-2 pr-2 font-medium">{t("Nudge terakhir", "Last nudge")}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.appraisalId} className={cn("border-b border-slate-100 last:border-0 dark:border-slate-800/60", r.phaseLagging && "bg-amber-50/50 dark:bg-amber-950/10")}>
                    <td className="py-2 pr-2">
                      <span className="font-mono text-xs text-slate-400">{r.employeeNo}</span>{" "}
                      <span className="font-medium">{r.fullName}</span>
                      <span className="block text-[11px] text-slate-400">{r.unit ?? "—"}</span>
                    </td>
                    <td className="py-2 pr-2 text-slate-600 dark:text-slate-300">{r.managerName ?? t("(tanpa atasan)", "(no manager)")}</td>
                    <td className="py-2 pr-2">
                      <PhaseCell done={r.goalDone} pct={r.progressPct} />
                    </td>
                    <td className="py-2 pr-2"><BoolCell done={r.selfDone} /></td>
                    <td className="py-2 pr-2"><BoolCell done={r.managerDone} /></td>
                    <td className="py-2 pr-2"><BoolCell done={r.calibDone} /></td>
                    <td className="py-2 pr-2"><BoolCell done={r.ackDone} /></td>
                    <td className="py-2 pr-2 text-[11px] text-slate-400">
                      {r.lastNudge
                        ? `${r.lastNudge.channel} · ${new Date(r.lastNudge.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`
                        : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {r.phaseLagging && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setRowNudge(r)}>
                          <Bell className="h-3.5 w-3.5" /> {t("Remind", "Remind")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* mobile kartu */}
          <div className="space-y-2 lg:hidden">
            {filtered.map((r) => (
              <div key={r.appraisalId} className={cn("rounded-lg border p-3 dark:border-slate-800", r.phaseLagging ? "border-amber-300 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/10" : "border-slate-200")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.fullName}</p>
                    <p className="font-mono text-[11px] text-slate-400">{r.employeeNo} · {r.managerName ?? t("tanpa atasan", "no manager")}</p>
                  </div>
                  {r.phaseLagging && (
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setRowNudge(r)}>
                      <Bell className="h-3.5 w-3.5" /> {t("Remind", "Remind")}
                    </Button>
                  )}
                </div>
                {r.phaseLagging && r.lagReason && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{r.lagReason}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span>{t("Target", "Goals")}: <PhaseCellInline done={r.goalDone} pct={r.progressPct} /></span>
                  <span>{t("Diri", "Self")}: <BoolCellInline done={r.selfDone} /></span>
                  <span>{t("Atasan", "Mgr")}: <BoolCellInline done={r.managerDone} /></span>
                  <span>Ack: <BoolCellInline done={r.ackDone} /></span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {rowNudge && (
        <NudgeDialog
          open onClose={() => setRowNudge(null)} onDone={refresh}
          title={t(`Remind — ${rowNudge.fullName}`, `Remind — ${rowNudge.fullName}`)}
          defaultLagReason={rowNudge.lagReason}
          recipients={t(
            `Penerima: ${rowNudge.lagTarget === "manager" ? `atasan ${rowNudge.managerName ?? "-"}` : rowNudge.fullName}`,
            `Recipient: ${rowNudge.lagTarget === "manager" ? `manager ${rowNudge.managerName ?? "-"}` : rowNudge.fullName}`,
          )}
          payload={{ action: "nudge", cycleId, appraisalIds: [rowNudge.appraisalId] }}
        />
      )}
      {nudgeAllOpen && data && (
        <NudgeDialog
          open onClose={() => setNudgeAllOpen(false)} onDone={refresh}
          title={t("Remind All — semua peserta tertinggal", "Remind All — all lagging participants")}
          defaultLagReason={t(`belum menyelesaikan fase ${phId}`, `have not completed the ${phEn} phase`)}
          recipients={t(
            `${data.tile.laggingCount} penerima (semua peserta tertinggal di fase aktif)`,
            `${data.tile.laggingCount} recipients (all participants lagging in the active phase)`,
          )}
          payload={{ action: "nudgeAll", cycleId }}
        />
      )}
    </div>
  );
}

function PhaseCell({ done, pct }: { done: boolean; pct: number }) {
  const { t } = useI18n();
  if (done) return (
    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" />{t("terkunci", "locked")}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500">{pct}%</span>
    </span>
  );
}
function PhaseCellInline({ done, pct }: { done: boolean; pct: number }) {
  const { t } = useI18n();
  return done ? t("✓", "✓") : `${pct}%`;
}
function BoolCell({ done }: { done: boolean }) {
  return done
    ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="done" />
    : <Circle className="h-4 w-4 text-slate-300 dark:text-slate-600" aria-label="pending" />;
}
function BoolCellInline({ done }: { done: boolean }) {
  return done ? "✓" : "—";
}

// ============================================================================
// DIALOG NUDGE (per baris + Remind All — §18.8 D17)
// ============================================================================

function NudgeDialog({ open, onClose, onDone, title, recipients, defaultLagReason, payload }: {
  open: boolean; onClose: () => void; onDone: () => void;
  title: string; recipients: string; defaultLagReason: string | null;
  payload: Record<string, unknown>;
}) {
  const { t } = useI18n();
  const [channels, setChannels] = useState<string[]>(["in-app"]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<NudgeResult[] | null>(null);

  const defaultPreview = t(
    `Halo, mohon segera menyelesaikan ${defaultLagReason ?? "formulir kinerja Anda"}. Buka RekanKerja → Performance → Target & KPI. Terima kasih.`,
    `Hello, please complete ${defaultLagReason ?? "your performance form"} soon. Open RekanKerja → Performance → Goals & KPIs. Thank you.`,
  );

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ results: NudgeResult[] }>(
        "/api/rekankerja/performance/cycles", "POST",
        { ...payload, channels, message: message.trim() || null },
      );
      setResults(res.results);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const channelOpts: { key: string; label: string; labelEn: string; icon: React.ElementType }[] = [
    { key: "in-app", label: "In-app", labelEn: "In-app", icon: Bell },
    { key: "email", label: "Email", labelEn: "Email", icon: Mail },
    { key: "wa", label: "WhatsApp", labelEn: "WhatsApp", icon: MessageCircle },
  ];

  const summary = results
    ? {
      sent: results.flatMap((r) => r.results).filter((x) => x.status === "sent").length,
      rate: results.flatMap((r) => r.results).filter((x) => x.status === "skipped-rate-limit").length,
      queued: results.flatMap((r) => r.results).filter((x) => x.status === "queued").length,
      other: results.flatMap((r) => r.results).filter((x) => !["sent", "skipped-rate-limit", "queued"].includes(x.status)).length,
    }
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setResults(null); setMessage(""); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {recipients}.{" "}
            {t("Rate-limit 1 per peserta per kanal per 6 jam; pengiriman hanya jam kerja (malam → antre otomatis).", "Rate limit 1 per participant per channel per 6 hours; sends only during working hours (night → auto-queued).")}
          </DialogDescription>
        </DialogHeader>

        {!results ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">{t("Kanal", "Channels")}</Label>
              <div className="flex flex-wrap gap-2">
                {channelOpts.map((ch) => {
                  const on = channels.includes(ch.key);
                  return (
                    <button
                      key={ch.key}
                      onClick={() => setChannels((cs) => on ? cs.filter((c) => c !== ch.key) : [...cs, ch.key])}
                      aria-pressed={on}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition",
                        on ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:text-slate-300",
                      )}
                    >
                      <ch.icon className="h-3.5 w-3.5" />
                      {t(ch.label, ch.labelEn)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Pesan (kosong = default)", "Message (empty = default)")}</Label>
              <textarea
                className="min-h-20 w-full rounded-lg border border-slate-200 bg-transparent p-2.5 text-sm outline-none focus:border-brand dark:border-slate-800"
                placeholder={defaultPreview}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-label={t("Pesan nudge", "Nudge message")}
              />
              <p className="text-[11px] text-slate-400">
                {t("Pratinjau default:", "Default preview:")} {message.trim() || defaultPreview}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
              <Button onClick={submit} disabled={busy || channels.length === 0}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("Kirim Pengingat", "Send Reminder")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">{t(`${summary!.sent} terkirim`, `${summary!.sent} sent`)}</Badge>
              {summary!.rate > 0 && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">{t(`${summary!.rate} rate-limit (6 jam)`, `${summary!.rate} rate-limited (6h)`)}</Badge>}
              {summary!.queued > 0 && <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t(`${summary!.queued} diantre jam kerja`, `${summary!.queued} queued for working hours`)}</Badge>}
              {summary!.other > 0 && <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">{t(`${summary!.other} gagal/tanpa kontak`, `${summary!.other} failed/no-contact`)}</Badge>}
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr className="text-left text-slate-500">
                    <th className="p-2 font-medium">{t("Penerima", "Recipient")}</th>
                    <th className="p-2 font-medium">{t("Kanal", "Channel")}</th>
                    <th className="p-2 font-medium">{t("Hasil", "Result")}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.flatMap((r) => r.results.map((x, i) => (
                    <tr key={`${r.appraisalId}-${i}`} className="border-t border-slate-100 dark:border-slate-800/60">
                      <td className="p-2">{r.recipientName ?? r.fullName}<span className="block text-[10px] text-slate-400">{t(`peserta ${r.employeeNo}`, `participant ${r.employeeNo}`)}</span></td>
                      <td className="p-2">{x.channel}</td>
                      <td className="p-2">
                        <span className={cn(
                          x.status === "sent" ? "text-emerald-600 dark:text-emerald-400" :
                          x.status === "queued" ? "text-slate-500" :
                          x.status === "skipped-rate-limit" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400",
                        )}>
                          {x.status}
                        </span>
                        <span className="block text-[10px] text-slate-400">{x.note}</span>
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button onClick={() => { setResults(null); onClose(); }}>{t("Tutup", "Close")}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
