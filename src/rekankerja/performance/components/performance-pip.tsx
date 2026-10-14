"use client";
// P6-impl — PIP End-to-End (§17 pip; §33 alur 9): register program perbaikan
// kinerja + ringkasan status & tingkat pemulihan + pencarian + filter status.
// Draf: buat manual (alasan wajib bila tanpa tautan penilaian §35-20) / sunting
// (patch — jadwal checkpoint dibangun ulang bila tanggal berubah). Aktivasi via
// approval AS-PIP-STD (L1 atasan langsung karyawan dibina → L2 HR — §33-1);
// badge "Menunggu approval" diturunkan dari chain; Setujui/Tolak per jenjang.
// Active/Extended: review checkpoint (capaian 0–150, catatan wajib < 60%),
// perpanjang 1× (bulan 1–2, total ≤ 3 bln, pratinjau tenggat baru §35-21),
// putuskan hasil (Recovered wajib checkpoint terakhir-Reviewed ≥ 100;
// NotRecovered → panel saran SP jenjang + PA Termination — eksekusi manual di
// HR Base §33-4). Detail: targets mini-KPI + timeline checkpoint + chain.
// Mobile ≤640px: tabel → kartu. Dwibahasa penuh.
import { useEffect, useMemo, useState } from "react";
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
import { Waypoints, Plus, Search, Send, CheckCircle2, Ban, CalendarClock, ShieldAlert, FileText, Hourglass, Flag, Info, Trash2, ChevronDown } from "lucide-react";

const PIP_API = "/api/rekankerja/performance/pip";

interface PipTarget { title: string; metric: string; target: string; weight: number }
interface PipCheckpoint {
  id: string; seq: number; dueDate: string; achievementPct: number | null;
  notes: string | null; status: string; reviewedBy: string | null; reviewedAt: string | null;
}
interface PipRow {
  id: string; docNo: string;
  employeeId: string; employeeName: string; employeeNo: string; unit: string | null;
  appraisalId: string | null; appraisalDocNo: string | null; finalRating: number | null;
  startDate: string; endDate: string; months: number; daysRemaining: number;
  reviewerId: string; reviewerName: string | null; advisorId: string | null; advisorName: string | null;
  targets: PipTarget[]; checkpoints: PipCheckpoint[];
  status: string; outcomeNotes: string | null; letterRefNo: string | null;
  chain: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}
interface PipStats {
  total: number; draft: number; active: number; extended: number;
  recovered: number; notRecovered: number; cancelled: number; recoveryRate: number | null;
}
interface Suggestion {
  existingSpCount: number; lastWarningLevel: string | null; suggestedNextLevel: string;
  priorRecords: { level: string; issuedAt: string; violation: string }[];
  note: string; paSuggestion: string;
}
interface PipDetail {
  row: PipRow;
  chainSteps: { levelNo: number; approverType: string; approverLabel: string; status: string; note: string | null; decidedBy: string | null; decidedAt: string | null }[] | null;
  suggestion: Suggestion | null;
}
interface EmpOpt { id: string; employeeNo: string; fullName: string; position: string | null; orgUnit: string | null }
interface RefereeOpt { id: string; fullName: string; employeeNo: string; position?: string | null }
interface LinkableAppr { id: string; docNo: string; finalRating: number | null; cycleCode: string }

/** PIP yang SK-nya terbit & program berjalan (checkpoint/extend/outcome). */
const pipLive = (s: string) => s === "Active" || s === "Extended";
/** PIP masih terbuka (Draft/Active/Extended). */
const pipOpen = (s: string) => s === "Draft" || s === "Active" || s === "Extended";
/** PIP terminal (Recovered/NotRecovered/Cancelled). */
const pipTerminal = (s: string) => !pipOpen(s);

const emptyTarget = (): PipTarget => ({ title: "", metric: "", target: "", weight: 0 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
const dayDiff = (aIso: string, bIso: string) => Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / (24 * 3600 * 1000));

export function PerformancePipPage() {
  const { t, lang } = useI18n();
  const [statusFilter, setStatusFilter] = useState("all");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  // debounce pencarian 400ms (pola modul lain)
  useEffect(() => {
    const h = setTimeout(() => setQ(qInput.trim()), 400);
    return () => clearTimeout(h);
  }, [qInput]);
  const api = useApi<{ rows: PipRow[]; stats: PipStats }>(
    `${PIP_API}?${new URLSearchParams({
      ...(statusFilter !== "all" && statusFilter !== "open" ? { status: statusFilter } : {}),
      ...(q ? { q } : {}),
    }).toString()}`,
    [statusFilter, q],
  );

  // ---- create / edit draf ----
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<PipRow | null>(null); // null = create baru
  const [form, setForm] = useState({
    employeeId: "", startDate: todayISO(), months: "2",
    reviewerId: "", hrAdvisorId: "", appraisalId: "", reason: "",
    targets: [emptyTarget(), emptyTarget(), emptyTarget()] as PipTarget[],
  });
  const [empQ, setEmpQ] = useState("");
  const empApi = useApi<{ employees: EmpOpt[] }>(
    editOpen && !editing ? `${PIP_API}?employees=1&q=${encodeURIComponent(empQ)}` : null,
    [editOpen, editing, empQ],
  );
  const refApi = useApi<{ reviewers: RefereeOpt[]; advisors: RefereeOpt[] }>(
    editOpen ? `${PIP_API}?referees=1` : null, [editOpen],
  );
  const linkApi = useApi<{ appraisals: LinkableAppr[] }>(
    editOpen && !editing && form.employeeId ? `${PIP_API}?linkable=1&employeeId=${form.employeeId}` : null,
    [editOpen, editing, form.employeeId],
  );

  // ---- dialogs ----
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailApi = useApi<PipDetail>(detailId ? `${PIP_API}?id=${detailId}` : null, [detailId]);
  const detail = detailApi.data?.row ?? null;
  const [activateTarget, setActivateTarget] = useState<PipRow | null>(null);
  const [reviewCp, setReviewCp] = useState<{ pip: PipRow; cp: PipCheckpoint } | null>(null);
  const [reviewForm, setReviewForm] = useState({ achievementPct: "80", notes: "" });
  const [extendTarget, setExtendTarget] = useState<PipRow | null>(null);
  const [extendForm, setExtendForm] = useState({ months: "1", reason: "" });
  const [outcomeTarget, setOutcomeTarget] = useState<PipRow | null>(null);
  const [outcomeForm, setOutcomeForm] = useState({ outcome: "Recovered", notes: "" });
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PipRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedEmp = useMemo(
    () => (empApi.data?.employees ?? []).find((e) => e.id === form.employeeId) ?? null,
    [empApi.data, form.employeeId],
  );
  const weightSum = useMemo(
    () => form.targets.reduce((s, x) => s + (Number(x.weight) || 0), 0),
    [form.targets],
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ employeeId: "", startDate: todayISO(), months: "2", reviewerId: "", hrAdvisorId: "", appraisalId: "", reason: "", targets: [emptyTarget(), emptyTarget(), emptyTarget()] });
    setEmpQ("");
    setEditOpen(true);
  };
  const openEdit = (r: PipRow) => {
    setEditing(r);
    setForm({
      employeeId: r.employeeId, startDate: r.startDate.slice(0, 10), months: String(r.months || 2),
      reviewerId: r.reviewerId, hrAdvisorId: r.advisorId ?? "", appraisalId: r.appraisalId ?? "", reason: "",
      targets: r.targets.length >= 3 ? r.targets.map((x) => ({ ...x, weight: Number(x.weight) || 0 })) : [...r.targets, ...Array.from({ length: 3 - r.targets.length }, emptyTarget)],
    });
    setEditOpen(true);
  };

  const doSave = async () => {
    if (!editing && !form.employeeId) { toast.error(t("Pilih karyawan peserta PIP", "Pick the PIP participant")); return; }
    if (!editing && !form.appraisalId && form.reason.trim().length < 10) {
      toast.error(t("PIP manual (tanpa tautan penilaian) wajib alasan ≥10 karakter (§35-20)", "Manual PIP (without linked appraisal) requires a reason ≥10 characters (§35-20)"));
      return;
    }
    if (!form.reviewerId) { toast.error(t("Pilih pembina (atasan)", "Pick the coach (manager)")); return; }
    if (!form.startDate) { toast.error(t("Tanggal mulai wajib diisi", "Start date is required")); return; }
    const months = Number(form.months);
    if (!Number.isFinite(months) || months < 1 || months > 3) { toast.error(t("Durasi PIP 1–3 bulan (D7)", "PIP duration is 1–3 months (D7)")); return; }
    if (form.targets.length < 3 || form.targets.length > 5) { toast.error(t("Target PIP harus 3–5 item", "PIP targets must be 3–5 items")); return; }
    if (Math.abs(weightSum - 100) > 0.01) { toast.error(t("Jumlah bobot harus 100 (sekarang {w}).", "Weights must total 100 (now {w}).", { w: String(Math.round(weightSum)) })); return; }
    setBusy(true);
    try {
      if (editing) {
        await apiSend(PIP_API, "POST", {
          action: "patch", id: editing.id, startDate: form.startDate, months,
          targets: form.targets, reviewerId: form.reviewerId,
          hrAdvisorId: form.hrAdvisorId || null, appraisalId: form.appraisalId || null,
        });
        toast.success(t("Draf PIP diperbarui", "PIP draft updated"));
      } else {
        await apiSend(PIP_API, "POST", {
          action: "create", employeeId: form.employeeId,
          appraisalId: form.appraisalId || undefined,
          reason: form.reason.trim() || undefined,
          startDate: form.startDate, months,
          targets: form.targets, reviewerId: form.reviewerId,
          hrAdvisorId: form.hrAdvisorId || undefined,
        });
        toast.success(t("Draf PIP dibuat — SK Program Perbaikan Kinerja terbit", "PIP draft created — improvement plan decree issued"));
      }
      setEditOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const pipAction = async (body: Record<string, unknown>, okMsg: string): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    try {
      const res = await apiSend<Record<string, unknown>>(PIP_API, "POST", body);
      toast.success(okMsg);
      api.refresh();
      detailApi.refresh();
      return res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
      return null;
    } finally { setBusy(false); }
  };

  const rows = api.data?.rows ?? [];
  // "open" (sedang berjalan) disaring lokal dgn predicate — server = semua status
  const visible = statusFilter === "open" ? rows.filter((r) => !pipTerminal(r.status)) : rows;
  const stats = api.data?.stats ?? null;

  const fmtD = (iso: string) => new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID");

  if (!api.data && api.loading) return <LoadingRows />;

  // ---- sub-render: aksi per baris (dipakai tabel & kartu mobile) ----
  const rowActions = (r: PipRow) => (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDetailId(r.id)}>{t("Detail", "Detail")}</Button>
      {r.status === "Draft" && r.chain?.status !== "InProgress" && (
        <>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => openEdit(r)}>{t("Ubah", "Edit")}</Button>
          <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => setActivateTarget(r)}>
            <Send className="h-3 w-3" aria-hidden /> {t("Aktivasi", "Activate")}
          </Button>
        </>
      )}
      {r.status === "Draft" && r.chain?.status === "InProgress" && (
        <>
          <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => pipAction({ action: "approve", id: r.id }, t("Jenjang disetujui", "Level approved"))}>
            {t("Setujui", "Approve")}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => {
            const note = window.prompt(t("Alasan penolakan (opsional):", "Rejection reason (optional):")) ?? "";
            pipAction({ action: "reject", id: r.id, note }, t("Ditolak di jenjang — kembali Draft", "Rejected at level — back to Draft"));
          }}>
            {t("Tolak", "Reject")}
          </Button>
        </>
      )}
      {pipLive(r.status) && (
        <>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => {
            const cp = r.checkpoints.find((c) => c.status === "Pending");
            if (!cp) { toast.info(t("Semua checkpoint sudah direview", "All checkpoints already reviewed")); return; }
            setReviewCp({ pip: r, cp });
            setReviewForm({ achievementPct: "80", notes: "" });
          }}>
            <CheckCircle2 className="h-3 w-3" aria-hidden /> {t("Review Checkpoint", "Review Checkpoint")}
          </Button>
          {r.status === "Active" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setExtendTarget(r); setExtendForm({ months: "1", reason: "" }); }}>
              <CalendarClock className="h-3 w-3" aria-hidden /> {t("Perpanjang", "Extend")}
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setOutcomeTarget(r); setOutcomeForm({ outcome: "Recovered", notes: "" }); setSuggestion(null); }}>
            <Flag className="h-3 w-3" aria-hidden /> {t("Putuskan Hasil", "Decide Outcome")}
          </Button>
        </>
      )}
      {!pipTerminal(r.status) && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-600" disabled={busy} aria-label={t("Batalkan", "Cancel")} onClick={() => { setCancelTarget(r); setCancelReason(""); }}>
          <Ban className="h-3 w-3" aria-hidden />
        </Button>
      )}
    </div>
  );

  // ---- sub-render: chip status + menunggu-approval (amber, dari chain) ----
  const statusCell = (r: PipRow) => (
    <div>
      <StatusPill status={r.status} />
      {r.status === "Draft" && r.chain?.status === "InProgress" && (
        <span className="mt-0.5 flex w-fit items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          <Hourglass className="h-2.5 w-2.5" aria-hidden />
          {t("Menunggu approval", "Awaiting approval")}
          <span className="font-normal">· L{r.chain.currentLevel}/{r.chain.totalLevels}</span>
        </span>
      )}
    </div>
  );

  // ---- sub-render: progres checkpoint (x/y + titik 30/60/90) ----
  const progressCell = (r: PipRow) => {
    const reviewed = r.checkpoints.filter((c) => c.status === "Reviewed").length;
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1" aria-label={t("{r} dari {n} checkpoint ter-review", "{r} of {n} checkpoints reviewed", { r: String(reviewed), n: String(r.checkpoints.length) })}>
          {r.checkpoints.map((c) => (
            <span
              key={c.id}
              title={`${t("Checkpoint {n}", "Checkpoint {n}", { n: String(c.seq) })} · ${fmtD(c.dueDate)}${c.achievementPct != null ? ` · ${c.achievementPct}%` : ""}`}
              className={cn("h-2.5 w-2.5 rounded-full border", c.status === "Reviewed" ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-800")}
            />
          ))}
        </div>
        <span className="text-xs tabular-nums text-slate-500">{reviewed}/{r.checkpoints.length}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Program Perbaikan Kinerja (PIP)", "Performance Improvement Plan (PIP)")}
        description={t(
          "Alur 9 end-to-end: draf target mini-KPI 3–5 item + checkpoint 30/60/90 hari → aktivasi via persetujuan atasan & HR (AS-PIP-STD, SK terbit saat draf) → review checkpoint → perpanjangan maks 1× (total ≤3 bulan) → hasil pulih / belum pulih (saran SP — eksekusi manual di HR Base).",
          "Flow 9 end-to-end: 3–5 mini-KPI targets + 30/60/90-day checkpoints → activation via manager & HR approval (AS-PIP-STD, decree issued at draft) → checkpoint reviews → max one extension (total ≤3 months) → recovered / not-recovered outcome (SP suggestion — executed manually in HR Base).",
        )}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t("Cari docNo / karyawan…", "Search doc no / employee…")} className="w-48 pl-8" aria-label={t("Cari", "Search")} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" aria-label={t("Filter status", "Status filter")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua status", "All statuses")}</SelectItem>
                <SelectItem value="open">{t("Sedang berjalan", "Open / running")}</SelectItem>
                <SelectItem value="Draft">{t("Draf", "Draft")}</SelectItem>
                <SelectItem value="Active">{t("Aktif", "Active")}</SelectItem>
                <SelectItem value="Extended">{t("Diperpanjang", "Extended")}</SelectItem>
                <SelectItem value="Recovered">{t("Pulih", "Recovered")}</SelectItem>
                <SelectItem value="NotRecovered">{t("Belum Pulih", "Not Recovered")}</SelectItem>
                <SelectItem value="Cancelled">{t("Dibatalkan", "Cancelled")}</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={openCreate}><Plus className="h-4 w-4" aria-hidden /> {t("Buat PIP Manual", "Create Manual PIP")}</Button>
          </div>
        )}
      />

      {/* ---- tile ringkasan: jumlah per status + tingkat pemulihan (pf42) ---- */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          <Card className="min-w-0"><CardContent className="flex items-center justify-between gap-2 p-4">
            <div>
              <p className="text-xs text-slate-500">{t("Total program", "Total programs")}</p>
              <p className="text-2xl font-bold tabular-nums">{stats.total}</p>
            </div>
            <Waypoints className="h-8 w-8 text-fuchsia-400" aria-hidden />
          </CardContent></Card>
          <Card className="min-w-0"><CardContent className="p-4">
            <p className="text-xs text-slate-500">{t("Berjalan (Draf/Aktif/Perpanjang)", "Running (Draft/Active/Extended)")}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums">{stats.draft + stats.active + stats.extended}</span>
              <span className="text-[11px] text-slate-500">{t("Draf {d} · Aktif {a} · Perpanjang {e}", "Draft {d} · Active {a} · Extended {e}", { d: String(stats.draft), a: String(stats.active), e: String(stats.extended) })}</span>
            </p>
          </CardContent></Card>
          <Card className="min-w-0"><CardContent className="p-4">
            <p className="text-xs text-slate-500">{t("Hasil akhir", "Final outcomes")}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{stats.recovered}</span>
              <span className="text-xs text-slate-500">{t("pulih", "recovered")}</span>
              <span className="text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">{stats.notRecovered}</span>
              <span className="text-xs text-slate-500">{t("belum pulih", "not recovered")}</span>
              <span className="text-lg font-bold tabular-nums text-slate-400">{stats.cancelled}</span>
              <span className="text-xs text-slate-500">{t("batal", "cancelled")}</span>
            </p>
          </CardContent></Card>
          <Card className="min-w-0 border-emerald-200 dark:border-emerald-900"><CardContent className="p-4">
            <p className="text-xs text-slate-500">{t("Tingkat pemulihan", "Recovery rate")}</p>
            <p className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{stats.recoveryRate != null ? `${stats.recoveryRate}%` : "—"}</span>
              <span className="text-[11px] text-slate-500">{t("Recovered / (Recovered + NotRecovered)", "Recovered / (Recovered + Not Recovered)")}</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${stats.recoveryRate ?? 0}%` }} />
            </div>
          </CardContent></Card>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={Waypoints}
          title={t("Belum ada program PIP", "No PIP programs yet")}
          description={t(
            "Usulan otomatis tersedia di tab Merit (rating ≤ 2). Klik \u201cBuat PIP Manual\u201d untuk menyusun program perbaikan kinerja pertama.",
            "Auto-proposals are available in the Merit tab (rating ≤ 2). Click \u201cCreate Manual PIP\u201d to draft the first improvement program.",
          )}
        />
      ) : (
        <>
          {/* ---- tabel (desktop ≥640px) ---- */}
          <Card className="hidden min-w-0 sm:block">
            <CardContent className="p-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t("Dokumen", "Document")}</TableHead>
                    <TableHead>{t("Karyawan", "Employee")}</TableHead>
                    <TableHead>{t("Penilaian", "Appraisal")}</TableHead>
                    <TableHead>{t("Periode", "Period")}</TableHead>
                    <TableHead>{t("Pembina", "Coach")}</TableHead>
                    <TableHead>{t("Checkpoint", "Checkpoints")}</TableHead>
                    <TableHead>{t("Status", "Status")}</TableHead>
                    <TableHead className="w-64"></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {visible.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">
                          <button type="button" className="font-semibold text-fuchsia-600 hover:underline dark:text-fuchsia-400" onClick={() => setDetailId(r.id)}>{r.docNo}</button>
                          {r.letterRefNo && <p className="text-[10px] text-slate-500">✉ {r.letterRefNo}</p>}
                        </TableCell>
                        <TableCell className="text-sm">
                          <p className="font-medium">{r.employeeName}</p>
                          <p className="text-xs text-slate-500">{r.employeeNo} · {r.unit ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.appraisalDocNo
                            ? <span>{r.appraisalDocNo}{r.finalRating != null && <> · <Badge variant="destructive">★ {r.finalRating}</Badge></>}</span>
                            : <Badge variant="outline" className="text-[10px]">{t("Manual", "Manual")}</Badge>}
                        </TableCell>
                        <TableCell className="text-xs">
                          <p>{fmtD(r.startDate)} → {fmtD(r.endDate)}</p>
                          {pipLive(r.status) && (
                            <span className={cn("font-semibold", r.daysRemaining < 0 ? "text-rose-600" : r.daysRemaining < 7 ? "text-amber-600" : "text-slate-500")}>
                              {r.daysRemaining < 0
                                ? t("lewat {n} hari", "{n} days overdue", { n: String(-r.daysRemaining) })
                                : t("sisa {n} hari", "{n} days left", { n: String(r.daysRemaining) })}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <p>{r.reviewerName ?? "—"}</p>
                          {r.advisorName && <p className="text-slate-500">{t("HR", "HR")}: {r.advisorName}</p>}
                        </TableCell>
                        <TableCell>{progressCell(r)}</TableCell>
                        <TableCell>{statusCell(r)}</TableCell>
                        <TableCell>{rowActions(r)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ---- kartu (mobile <640px — pola collapse) ---- */}
          <div className="space-y-3 sm:hidden">
            {visible.map((r) => (
              <Card key={r.id} className="min-w-0"><CardContent className="p-4">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <button type="button" className="font-mono text-sm font-bold text-fuchsia-600 dark:text-fuchsia-400" onClick={() => setDetailId(r.id)}>{r.docNo}</button>
                    {r.letterRefNo && <p className="text-[10px] text-slate-500">✉ {r.letterRefNo}</p>}
                  </div>
                  {statusCell(r)}
                </div>
                <p className="text-sm font-medium">{r.employeeName}</p>
                <p className="text-xs text-slate-500">{r.employeeNo} · {r.unit ?? "—"}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {fmtD(r.startDate)} → {fmtD(r.endDate)} · {t("pembina", "coach")}: {r.reviewerName ?? "—"}
                  {r.appraisalDocNo ? ` · ${r.appraisalDocNo}` : ""}
                </p>
                <div className="mt-2">{progressCell(r)}</div>
                <div className="mt-3">{rowActions(r)}</div>
              </CardContent></Card>
            ))}
          </div>
        </>
      )}

      {/* ---- dialog: create / edit draf ---- */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("Sunting draf {doc}", "Edit draft {doc}", { doc: editing.docNo }) : t("Buat PIP Manual", "Create Manual PIP")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editing && (
              <div className="space-y-1.5">
                <Label>{t("Karyawan peserta", "Participant")}</Label>
                {form.employeeId && selectedEmp ? (
                  <div className="flex items-center justify-between rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 px-3 py-2 text-sm dark:border-fuchsia-900 dark:bg-fuchsia-950/20">
                    <span><strong>{selectedEmp.fullName}</strong> · {selectedEmp.employeeNo} · {selectedEmp.position ?? "—"} · {selectedEmp.orgUnit ?? "—"}</span>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setForm((f) => ({ ...f, employeeId: "", appraisalId: "" }))}>{t("Ganti", "Change")}</Button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                      <Input value={empQ} onChange={(e) => setEmpQ(e.target.value)} placeholder={t("Cari karyawan Active…", "Search active employees…")} className="pl-8" />
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                      {(empApi.data?.employees ?? []).length === 0 && (
                        <p className="px-3 py-3 text-xs text-slate-500">{t("Tidak ada karyawan cocok.", "No matching employees.")}</p>
                      )}
                      {(empApi.data?.employees ?? []).map((e) => (
                        <button key={e.id} type="button" className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                          onClick={() => setForm((f) => ({ ...f, employeeId: e.id, appraisalId: "" }))}>
                          <span className="font-medium">{e.fullName}</span>
                          <span className="ml-2 text-xs text-slate-500">{e.employeeNo} · {e.position ?? "—"} · {e.orgUnit ?? "—"}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {(linkApi.data?.appraisals ?? []).length > 0 && (
                  <div className="space-y-1">
                    <Label>{t("Tautkan penilaian sumber (opsional)", "Link source appraisal (optional)")}</Label>
                    <Select value={form.appraisalId} onValueChange={(v) => setForm((f) => ({ ...f, appraisalId: v === "none" ? "" : v }))}>
                      <SelectTrigger aria-label={t("Tautkan penilaian", "Link appraisal")}><SelectValue placeholder={t("Tanpa tautan", "No link")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("Tanpa tautan (manual — alasan wajib)", "No link (manual — reason required)")}</SelectItem>
                        {(linkApi.data?.appraisals ?? []).map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.docNo} · ★ {a.finalRating ?? "—"} · {a.cycleCode}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {!form.appraisalId && (
                  <div className="space-y-1">
                    <Label>{t("Alasan PIP manual (wajib ≥10 karakter — §35-20)", "Manual PIP reason (required ≥10 characters — §35-20)")}</Label>
                    <Textarea rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t("Contoh: penurunan kinerja berulang dilaporkan atasan lintas 2 bulan terakhir", "e.g. repeated performance decline reported by the manager over the last 2 months")} />
                  </div>
                )}
              </div>
            )}
            {editing && (
              <p className="rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-900">
                <strong>{editing.employeeName}</strong> · {editing.employeeNo} · {editing.unit ?? "—"}
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("Tanggal mulai", "Start date")}</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t("Durasi (bulan, D7)", "Duration (months, D7)")}</Label>
                <Select value={form.months} onValueChange={(v) => setForm((f) => ({ ...f, months: v }))}>
                  <SelectTrigger aria-label={t("Durasi", "Duration")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2 ({t("default", "default")})</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("Pembina (atasan)", "Coach (manager)")}</Label>
                <Select value={form.reviewerId} onValueChange={(v) => setForm((f) => ({ ...f, reviewerId: v }))}>
                  <SelectTrigger aria-label={t("Pembina", "Coach")}><SelectValue placeholder={t("Pilih atasan pembina…", "Pick the coaching manager…")} /></SelectTrigger>
                  <SelectContent>
                    {(refApi.data?.reviewers ?? []).map((rv) => (
                      <SelectItem key={rv.id} value={rv.id}>{rv.fullName} · {rv.position ?? rv.employeeNo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("HR advisor (opsional)", "HR advisor (optional)")}</Label>
              <Select value={form.hrAdvisorId} onValueChange={(v) => setForm((f) => ({ ...f, hrAdvisorId: v === "none" ? "" : v }))}>
                <SelectTrigger aria-label={t("HR advisor", "HR advisor")}><SelectValue placeholder={t("Tanpa advisor", "No advisor")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("Tanpa advisor", "No advisor")}</SelectItem>
                  {(refApi.data?.advisors ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.fullName} · {a.employeeNo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("Sasaran PIP (3–5 item, Σbobot 100)", "PIP targets (3–5 items, Σweight 100)")}</Label>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={form.targets.length >= 5} onClick={() => setForm((f) => ({ ...f, targets: [...f.targets, emptyTarget()] }))}>
                  <Plus className="h-3 w-3" aria-hidden /> {t("Target", "Target")}
                </Button>
              </div>
              <div className="space-y-2">
                {form.targets.map((tg, i) => (
                  <div key={i} className="grid grid-cols-1 gap-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800 sm:grid-cols-[1fr_1fr_1fr_88px_36px]">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500">{t("Judul", "Title")}</Label>
                      <Input className="h-8 text-xs" value={tg.title} onChange={(e) => setForm((f) => ({ ...f, targets: f.targets.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500">{t("Metrik", "Metric")}</Label>
                      <Input className="h-8 text-xs" value={tg.metric} onChange={(e) => setForm((f) => ({ ...f, targets: f.targets.map((x, j) => j === i ? { ...x, metric: e.target.value } : x) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500">{t("Nilai target", "Target value")}</Label>
                      <Input className="h-8 text-xs" value={tg.target} onChange={(e) => setForm((f) => ({ ...f, targets: f.targets.map((x, j) => j === i ? { ...x, target: e.target.value } : x) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500">{t("Bobot %", "Weight %")}</Label>
                      <Input type="number" min={0} max={100} className="h-8 text-xs" value={tg.weight || ""} onChange={(e) => setForm((f) => ({ ...f, targets: f.targets.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) || 0 } : x) }))} />
                    </div>
                    <div className="flex items-end pb-0.5">
                      <Button size="sm" variant="ghost" className="h-8 w-9 px-0 text-slate-400" disabled={form.targets.length <= 3} aria-label={t("Hapus target", "Remove target")} onClick={() => setForm((f) => ({ ...f, targets: f.targets.filter((_, j) => j !== i) }))}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {/* meter Σbobot (pola goals builder) */}
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className={cn("h-full rounded-full transition-all", Math.abs(weightSum - 100) < 0.01 ? "bg-emerald-500" : weightSum > 100 ? "bg-rose-500" : "bg-amber-400")} style={{ width: `${Math.min(100, weightSum)}%` }} />
                </div>
                <span className={cn("text-sm font-bold tabular-nums", Math.abs(weightSum - 100) < 0.01 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>Σ {Math.round(weightSum)}%</span>
                {Math.abs(weightSum - 100) > 0.01 && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setForm((f) => ({ ...f, targets: f.targets.map((x, j, arr) => ({ ...x, weight: j === arr.length - 1 ? 100 - Math.floor(100 / arr.length) * (arr.length - 1) : Math.floor(100 / arr.length) })) }))}>
                    <Hourglass className="h-3 w-3" aria-hidden /> {t("Bagi rata", "Split evenly")}
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {t(
                  "Checkpoint otomatis 3 tahap pada hari ke-30/60/90 sejak mulai. Durasi 1–3 bulan (D7, default 2). SK Program Perbaikan Kinerja terbit saat draf dibuat.",
                  "3 checkpoints are scheduled automatically at day 30/60/90 from the start. Duration is 1–3 months (D7, default 2). The improvement plan decree is issued when the draft is created.",
                )}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t("Batal", "Cancel")}</Button>
            <Button disabled={busy} onClick={doSave}>{editing ? t("Simpan", "Save") : t("Buat Draf", "Create Draft")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: aktivasi (konfirmasi + pratinjau chain) ---- */}
      <Dialog open={activateTarget !== null} onOpenChange={(o) => { if (!o) setActivateTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" aria-hidden /> {t("Aktivasi {doc}", "Activate {doc}", { doc: activateTarget?.docNo ?? "" })}</DialogTitle>
          </DialogHeader>
          {activateTarget && (
            <div className="space-y-3 text-sm">
              <p className="rounded-md bg-slate-50 p-2 dark:bg-slate-900">
                <strong>{activateTarget.employeeName}</strong> · {activateTarget.employeeNo} · {activateTarget.unit ?? "—"}<br />
                {fmtD(activateTarget.startDate)} → {fmtD(activateTarget.endDate)} ({activateTarget.months} {t("bln", "mo")}) · {t("pembina", "coach")}: {activateTarget.reviewerName ?? "—"}{activateTarget.advisorName ? ` · ${t("HR", "HR")}: ${activateTarget.advisorName}` : ""}
                {activateTarget.letterRefNo && <> · <span className="text-emerald-600">✉ {activateTarget.letterRefNo}</span></>}
              </p>
              <div>
                <p className="mb-1 text-xs font-semibold">{t("Sasaran mini-KPI", "Mini-KPI targets")}</p>
                <ul className="space-y-1">
                  {activateTarget.targets.map((tg, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
                      <strong>{tg.title}</strong> — {tg.target} ({tg.metric}) · {t("bobot", "weight")} {Number(tg.weight)}%
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 p-3 text-xs dark:border-fuchsia-900 dark:bg-fuchsia-950/20">
                <p className="mb-1 font-semibold">{t("Jalur persetujuan AS-PIP-STD (2 jenjang)", "AS-PIP-STD approval route (2 levels)")}</p>
                <ol className="list-inside list-decimal space-y-0.5 text-slate-600 dark:text-slate-300">
                  <li>{t("L1 — Atasan langsung karyawan yang dibina (§33-1)", "L1 — Direct manager of the coached employee (§33-1)")}</li>
                  <li>{t("L2 — Admin/HR: verifikasi program PIP", "L2 — Admin/HR: verify the PIP program")}</li>
                </ol>
                <p className="mt-1.5 text-slate-500">{t("Persetujuan penuh mengubah status menjadi Active — program dimulai.", "Full approval switches the status to Active — the program starts.")}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivateTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button disabled={busy} onClick={async () => {
              if (!activateTarget) return;
              const res = await pipAction({ action: "activate", id: activateTarget.id }, t("Diajukan ke persetujuan AS-PIP-STD", "Submitted to AS-PIP-STD approval"));
              if (res) setActivateTarget(null);
            }}>{t("Ajukan Aktivasi", "Submit Activation")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: detail (targets + timeline + chain + outcome) ---- */}
      <Dialog open={detailId !== null} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detailApi.loading && !detail ? <p className="py-6 text-center text-sm text-slate-500">{t("Memuat…", "Loading…")}</p> : detail && (() => {
            const d = detailApi.data;
            const reviewed = detail.checkpoints.filter((c) => c.status === "Reviewed").length;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    <Waypoints className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" aria-hidden />
                    {detail.docNo}
                    <StatusPill status={detail.status} />
                    {detail.status === "Draft" && detail.chain?.status === "InProgress" && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                        <Hourglass className="h-2.5 w-2.5" aria-hidden /> {t("Menunggu approval", "Awaiting approval")}
                      </span>
                    )}
                  </DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <p><span className="text-slate-500">{t("Karyawan", "Employee")}:</span> <strong>{detail.employeeName}</strong> · {detail.employeeNo} · {detail.unit ?? "—"}</p>
                  <p><span className="text-slate-500">{t("Pembina", "Coach")}:</span> {detail.reviewerName ?? "—"}{detail.advisorName ? ` · ${t("HR", "HR")}: ${detail.advisorName}` : ""}</p>
                  <p><span className="text-slate-500">{t("Periode", "Period")}:</span> {fmtD(detail.startDate)} → {fmtD(detail.endDate)} ({detail.months} {t("bln", "mo")})</p>
                  <p>
                    <span className="text-slate-500">{t("Penilaian", "Appraisal")}:</span> {detail.appraisalDocNo ?? t("Manual (alasan ter-audit)", "Manual (audited reason)")}
                    {detail.finalRating != null && <> · <Badge variant="destructive">★ {detail.finalRating}</Badge></>}
                  </p>
                  {detail.letterRefNo && <p><span className="text-slate-500">SK:</span> <span className="inline-flex items-center gap-1 text-emerald-600"><FileText className="h-3.5 w-3.5" aria-hidden />{detail.letterRefNo}</span></p>}
                  {pipLive(detail.status) && (
                    <p className={cn("font-semibold", detail.daysRemaining < 0 ? "text-rose-600" : detail.daysRemaining < 7 ? "text-amber-600" : "")}>
                      {detail.daysRemaining < 0
                        ? t("Lewat tenggat {n} hari", "{n} days past deadline", { n: String(-detail.daysRemaining) })
                        : t("Sisa {n} hari", "{n} days remaining", { n: String(detail.daysRemaining) })}
                    </p>
                  )}
                </div>
                <div>
                  <h4 className="mb-1.5 text-sm font-semibold">{t("Sasaran ({r}/{n} checkpoint ter-review)", "Targets ({r}/{n} checkpoints reviewed)", { r: String(reviewed), n: String(detail.checkpoints.length) })}</h4>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{t("Judul", "Title")}</TableHead>
                        <TableHead>{t("Metrik", "Metric")}</TableHead>
                        <TableHead>{t("Target", "Target")}</TableHead>
                        <TableHead className="text-right">{t("Bobot", "Weight")}</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {detail.targets.map((tg, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm font-medium">{tg.title}</TableCell>
                            <TableCell className="text-xs">{tg.metric}</TableCell>
                            <TableCell className="text-xs">{tg.target}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{Number(tg.weight)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                <div>
                  <h4 className="mb-1.5 text-sm font-semibold">{t("Timeline Checkpoint", "Checkpoint Timeline")}</h4>
                  <div className="space-y-2">
                    {detail.checkpoints.map((c) => (
                      <div key={c.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-sm font-semibold">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fuchsia-100 text-xs font-bold text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300">{c.seq}</span>
                            {t("Checkpoint {n}", "Checkpoint {n}", { n: String(c.seq) })}
                            <span className="text-xs font-normal text-slate-500">· {fmtD(c.dueDate)}</span>
                          </span>
                          <StatusPill status={c.status === "Pending" ? "Pending" : "Reviewed"} />
                        </div>
                        {c.achievementPct != null && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div className={cn("h-full rounded-full", c.achievementPct >= 100 ? "bg-emerald-500" : c.achievementPct >= 75 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${Math.min(100, c.achievementPct)}%` }} />
                            </div>
                            <span className="w-14 text-right text-xs font-bold tabular-nums">{c.achievementPct}%</span>
                          </div>
                        )}
                        {c.notes && <p className="mt-1.5 text-xs italic text-slate-500">“{c.notes}”</p>}
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] text-slate-500">
                            {c.reviewedBy ? `${c.reviewedBy} · ${fmtD(c.reviewedAt ?? c.dueDate)}` : t("belum direview", "not reviewed yet")}
                          </p>
                          {c.status === "Pending" && pipLive(detail.status) && (
                            <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setReviewCp({ pip: detail, cp: c }); setReviewForm({ achievementPct: "80", notes: "" }); }}>
                              <CheckCircle2 className="h-3 w-3" aria-hidden /> {t("Catat review", "Record review")}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {d?.chainSteps && d.chainSteps.length > 0 && (
                  <div>
                    <h4 className="mb-1.5 text-sm font-semibold">{t("Jalur Persetujuan (AS-PIP-STD)", "Approval Route (AS-PIP-STD)")}</h4>
                    <div className="space-y-1">
                      {d.chainSteps.map((s) => (
                        <div key={s.levelNo} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs", s.status === "Current" ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" : "border-slate-200 dark:border-slate-800")}>
                          <span><strong>L{s.levelNo}</strong> · {s.approverLabel}</span>
                          <span className="flex items-center gap-2">
                            {s.note && <span className="italic text-slate-500">“{s.note}”</span>}
                            <StatusPill status={s.status === "Current" ? "Pending" : s.status === "Approved" ? "Approved" : s.status} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail.outcomeNotes && (
                  <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    <strong>{t("Catatan outcome", "Outcome note")}:</strong> {detail.outcomeNotes}
                    {detail.status === "Recovered" && <> — {t("dicatat pada penilaian berikutnya (riwayat tetap tersimpan).", "recorded in the next appraisal (history retained).")}</>}
                  </p>
                )}
                {detail.status === "NotRecovered" && d?.suggestion && <SuggestionPanel s={d.suggestion} t={t} fmtD={fmtD} />}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ---- dialog: catat review checkpoint ---- */}
      <Dialog open={reviewCp !== null} onOpenChange={(o) => { if (!o) setReviewCp(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Review Checkpoint {n} — {doc}", "Checkpoint {n} Review — {doc}", { n: String(reviewCp?.cp.seq ?? 0), doc: reviewCp?.pip.docNo ?? "" })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Capaian kumulatif sasaran PIP pada tahap ini (0–150%). Review hanya sekali — ter-audit.", "Cumulative achievement of PIP targets at this stage (0–150%). One-time review — audited.")}
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("Capaian (%)", "Achievement (%)")}</Label>
              <Input type="number" min={0} max={150} value={reviewForm.achievementPct} onChange={(e) => setReviewForm((f) => ({ ...f, achievementPct: e.target.value }))} placeholder="mis. 85" />
              <div className="flex items-center gap-2">
                <input
                  type="range" min={0} max={150} value={Number(reviewForm.achievementPct) || 0}
                  onChange={(e) => setReviewForm((f) => ({ ...f, achievementPct: e.target.value }))}
                  className="w-full accent-fuchsia-600" aria-label={t("Capaian persen", "Achievement percent")}
                />
                <span className="w-14 text-right text-sm font-bold tabular-nums">{Number(reviewForm.achievementPct) || 0}%</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("Catatan pembina", "Coach notes")}</Label>
              <Textarea rows={3} value={reviewForm.notes} onChange={(e) => setReviewForm((f) => ({ ...f, notes: e.target.value }))} />
              {(Number(reviewForm.achievementPct) || 0) < 60 && (
                <p className="text-xs font-semibold text-amber-600">{t("Capaian < 60% — catatan wajib (perlu perhatian).", "Achievement < 60% — notes are required (needs attention).")}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewCp(null)}>{t("Batal", "Cancel")}</Button>
            <Button disabled={busy} onClick={async () => {
              if (!reviewCp) return;
              const res = await pipAction({
                action: "reviewCheckpoint", id: reviewCp.pip.id, seq: reviewCp.cp.seq,
                achievementPct: Number(reviewForm.achievementPct), notes: reviewForm.notes || undefined,
              }, t("Checkpoint tercatat", "Checkpoint recorded"));
              if (res) setReviewCp(null);
            }}><CheckCircle2 className="h-4 w-4" aria-hidden /> {t("Catat", "Record")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: perpanjang (bulan 1–2 + pratinjau tenggat) ---- */}
      <Dialog open={extendTarget !== null} onOpenChange={(o) => { if (!o) setExtendTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle><CalendarClock className="mr-1 inline h-4 w-4 text-amber-500" aria-hidden />{t("Perpanjang {doc}", "Extend {doc}", { doc: extendTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t(
              "Perpanjangan maksimum 1× (§35-21) dan total durasi tetap ≤3 bulan sejak mulai. Checkpoint baru ditambahkan pada tenggat baru.",
              "Maximum one extension (§35-21) and total duration stays ≤3 months from start. A new checkpoint is added at the new deadline.",
            )}
          </p>
          {extendTarget && (() => {
            const months = Number(extendForm.months) || 1;
            const newEnd = addDaysISO(extendTarget.endDate.slice(0, 10), months * 30);
            const totalDays = dayDiff(extendTarget.startDate.slice(0, 10), newEnd);
            const tooLong = totalDays > 90;
            return (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>{t("Durasi perpanjangan", "Extension duration")}</Label>
                  <Select value={extendForm.months} onValueChange={(v) => setExtendForm((f) => ({ ...f, months: v }))}>
                    <SelectTrigger aria-label={t("Durasi perpanjangan", "Extension duration")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{t("1 bulan", "1 month")}</SelectItem>
                      <SelectItem value="2">{t("2 bulan", "2 months")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className={cn("rounded-lg border p-3 text-xs", tooLong ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400" : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300")}>
                  <p>{t("Tenggat saat ini", "Current deadline")}: <strong>{fmtD(extendTarget.endDate)}</strong></p>
                  <p>{t("Tenggat baru", "New deadline")}: <strong>{fmtD(newEnd)}</strong></p>
                  <p>{t("Total durasi sejak mulai: {d} hari (maks 90)", "Total duration from start: {d} days (max 90)", { d: String(totalDays) })}</p>
                  {tooLong && <p className="font-semibold">{t("Melebihi batas 3 bulan — kurangi durasi perpanjangan.", "Exceeds the 3-month cap — reduce the extension.")}</p>}
                </div>
                <div className="space-y-1">
                  <Label>{t("Alasan perpanjangan (≥10 karakter)", "Extension reason (≥10 characters)")}</Label>
                  <Textarea rows={3} value={extendForm.reason} onChange={(e) => setExtendForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t("Contoh: progres positif namun belum stabil — perlu 1 bulan tambahan", "e.g. positive but unstable progress — needs 1 extra month")} />
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button disabled={busy} onClick={async () => {
              if (!extendTarget) return;
              const months = Number(extendForm.months) || 1;
              const newEnd = addDaysISO(extendTarget.endDate.slice(0, 10), months * 30);
              if (dayDiff(extendTarget.startDate.slice(0, 10), newEnd) > 90) {
                toast.error(t("Total durasi melebihi 3 bulan sejak mulai (§35-21)", "Total duration exceeds 3 months from start (§35-21)"));
                return;
              }
              const res = await pipAction({
                action: "extend", id: extendTarget.id, months, reason: extendForm.reason,
              }, t("PIP diperpanjang — status Extended", "PIP extended — status Extended"));
              if (res) setExtendTarget(null);
            }}>{t("Perpanjang", "Extend")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: putuskan hasil ---- */}
      <Dialog open={outcomeTarget !== null} onOpenChange={(o) => { if (!o) { setOutcomeTarget(null); setSuggestion(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle><Flag className="mr-1 inline h-4 w-4 text-fuchsia-500" aria-hidden />{t("Putuskan Hasil {doc}", "Decide Outcome {doc}", { doc: outcomeTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t(
              "Keputusan akhir program (paling lambat endDate +7 hari §35-22). Recovered mensyaratkan checkpoint terakhir yang direview bercapaian ≥100% dan dicatat pada penilaian berikutnya — riwayat tidak dihapus.",
              "Final program decision (at the latest endDate +7 days §35-22). Recovered requires the last reviewed checkpoint at ≥100% and is recorded in the next appraisal — history is not deleted.",
            )}
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("Hasil program", "Program result")}</Label>
              <Select value={outcomeForm.outcome} onValueChange={(v) => setOutcomeForm((f) => ({ ...f, outcome: v }))}>
                <SelectTrigger aria-label={t("Hasil program", "Program result")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Recovered">{t("Pulih — capaian ≥ target", "Recovered — achievement ≥ target")}</SelectItem>
                  <SelectItem value="NotRecovered">{t("Belum pulih", "Not recovered")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("Catatan outcome (≥10 karakter)", "Outcome note (≥10 characters)")}</Label>
              <Textarea rows={3} value={outcomeForm.notes} onChange={(e) => setOutcomeForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          {suggestion && <SuggestionPanel s={suggestion} t={t} fmtD={fmtD} />}
          <DialogFooter>
            {suggestion ? (
              <Button onClick={() => { setOutcomeTarget(null); setSuggestion(null); }}>{t("Selesai", "Done")}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOutcomeTarget(null)}>{t("Batal", "Cancel")}</Button>
                <Button variant="destructive" disabled={busy} onClick={async () => {
                  if (!outcomeTarget) return;
                  const res = await pipAction({
                    action: "outcome", id: outcomeTarget.id, outcome: outcomeForm.outcome, notes: outcomeForm.notes,
                  }, outcomeForm.outcome === "Recovered"
                    ? t("PIP selesai — pulih (dicatat pada penilaian berikutnya)", "PIP closed — recovered (recorded in next appraisal)")
                    : t("PIP ditutup — belum pulih", "PIP closed — not recovered"));
                  if (res && res.suggestion && typeof res.suggestion === "object") {
                    setSuggestion(res.suggestion as Suggestion);
                  } else if (res) {
                    setOutcomeTarget(null);
                  }
                }}>{t("Putuskan", "Decide")}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: batalkan ---- */}
      <Dialog open={cancelTarget !== null} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle><Ban className="mr-1 inline h-4 w-4 text-rose-500" aria-hidden />{t("Batalkan PIP {doc}?", "Cancel PIP {doc}?", { doc: cancelTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Pembatalan berlaku utk draf/program berjalan (mis. karyawan resign). Jalur persetujuan yang masih berjalan ikut dihentikan.", "Cancellation applies to drafts/running programs (e.g. employee resigns). Any in-progress approval chain is stopped too.")}
          </p>
          <div className="space-y-1">
            <Label>{t("Alasan pembatalan (≥10 karakter)", "Cancellation reason (≥10 characters)")}</Label>
            <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => {
              if (!cancelTarget) return;
              const res = await pipAction({ action: "cancel", id: cancelTarget.id, reason: cancelReason }, t("PIP dibatalkan", "PIP cancelled"));
              if (res) setCancelTarget(null);
            }}>{t("Batalkan", "Cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Panel saran tindak lanjut NotRecovered (§33-4 — eksekusi manual di HR Base). */
function SuggestionPanel({ s, t, fmtD }: { s: Suggestion; t: (a: string, b: string, p?: Record<string, string | number>) => string; fmtD: (iso: string) => string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      <p className="mb-1 flex items-center gap-1 font-semibold"><ShieldAlert className="h-3.5 w-3.5" aria-hidden />{t("Saran tindak lanjut (eksekusi manual)", "Suggested follow-up (manual execution)")}</p>
      <p>
        {t("Riwayat SP karyawan", "Employee's SP history")}: {s.existingSpCount}
        {s.lastWarningLevel ? ` (${t("tertinggi", "highest")}: ${s.lastWarningLevel})` : ""}
        {" → "}
        {t("saran berikutnya", "suggested next")}: <strong>{s.suggestedNextLevel}</strong>
      </p>
      {s.priorRecords.length > 0 && (
        <ul className="mt-1 list-inside list-disc">
          {s.priorRecords.map((r, i) => (
            <li key={i}>{r.level} · {fmtD(r.issuedAt)} · {r.violation}</li>
          ))}
        </ul>
      )}
      <p className="mt-1">{s.note}</p>
      <p className="mt-1 flex items-start gap-1"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{t(
        "Modul ini TIDAK otomatis membuat SP/PHK — jalankan DisciplinaryRecord & PA Termination manual di modul HR Base (bukti PIP + SP = rantai pertahanan §7).",
        "This module does NOT auto-create SP/termination — run DisciplinaryRecord & PA Termination manually in HR Base (PIP + SP evidence = defense chain §7).",
      )}</p>
      <p className="mt-1">{s.paSuggestion}</p>
    </div>
  );
}
