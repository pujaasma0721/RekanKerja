"use client";
// P6-PERF — PIP End-to-End (§17 pip; §33 alur 9): daftar program perbaikan
// kinerja + filter status, create/edit draf (target mini-KPI 3–5 item Σbobot
// 100 + pembina + HR advisor + durasi 1–3 bln D7 + tautan penilaian sumber),
// submit → approval AS-PIP-STD (L1 atasan → L2 HR; Setujui/Tolak jenjang),
// checkpoint timeline + catat review (achievementPct 0–150 sekali jalan),
// perpanjangan 1× (total ≤3 bln D7), outcome Recovered/NotRecovered (+ saran SP
// per jenjang riwayat — eksekusi manual di HR Base, bukan otomatis), batalkan.
// Karyawan melihat progresnya sendiri di ESS (ess-my-appraisal — §33-3).
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
import { Waypoints, Plus, Search, Send, CheckCircle2, Ban, CalendarClock, ShieldAlert, FileText, Hourglass, Flag, Info, Trash2 } from "lucide-react";

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
interface EmpOpt { id: string; employeeNo: string; fullName: string; position: string | null; orgUnit: string | null }
interface RefereeOpt { id: string; fullName: string; employeeNo: string; position?: string | null }
interface LinkableAppr { id: string; docNo: string; finalRating: number | null; cycleCode: string }

/** PIP yang SK-nya sudah terbit (program berjalan — checkpoint/extend/outcome). */
const pipLive = (s: string) => s === "Active" || s === "Extended";
/** PIP masih terbuka (Draft/Active/Extended) — bukan terminal. */
const pipOpen = (s: string) => s === "Draft" || s === "Active" || s === "Extended";
/** PIP terminal (Recovered/NotRecovered/Cancelled). */
const pipTerminal = (s: string) => !pipOpen(s);

const emptyTarget = (): PipTarget => ({ title: "", metric: "", target: "", weight: 0 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

export function PerformancePipPage() {
  const { t, lang } = useI18n();
  const [statusFilter, setStatusFilter] = useState("all");
  const api = useApi<{ rows: PipRow[] }>(
    statusFilter === "all" || statusFilter === "open" ? PIP_API : `${PIP_API}?status=${statusFilter}`,
    [statusFilter],
  );

  // ---- create / edit draf ----
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<PipRow | null>(null); // null = create baru
  const [form, setForm] = useState({
    employeeId: "", startDate: todayISO(), months: "2",
    reviewerId: "", hrAdvisorId: "", appraisalId: "",
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
  const [detail, setDetail] = useState<PipRow | null>(null);
  const [reviewCp, setReviewCp] = useState<{ pip: PipRow; cp: PipCheckpoint } | null>(null);
  const [reviewForm, setReviewForm] = useState({ achievementPct: "", notes: "" });
  const [extendTarget, setExtendTarget] = useState<PipRow | null>(null);
  const [extendForm, setExtendForm] = useState({ newEndDate: "", reason: "" });
  const [outcomeTarget, setOutcomeTarget] = useState<PipRow | null>(null);
  const [outcomeForm, setOutcomeForm] = useState({ outcome: "Recovered", notes: "" });
  const [suggestion, setSuggestion] = useState<{ existingSpCount: number; lastWarningLevel: string | null; suggestedNextLevel: string; note: string } | null>(null);
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
    setForm({ employeeId: "", startDate: todayISO(), months: "2", reviewerId: "", hrAdvisorId: "", appraisalId: "", targets: [emptyTarget(), emptyTarget(), emptyTarget()] });
    setEmpQ("");
    setEditOpen(true);
  };
  const openEdit = (r: PipRow) => {
    setEditing(r);
    setForm({
      employeeId: r.employeeId, startDate: r.startDate.slice(0, 10), months: String(r.months || 2),
      reviewerId: r.reviewerId, hrAdvisorId: r.advisorId ?? "", appraisalId: r.appraisalId ?? "",
      targets: r.targets.length >= 3 ? r.targets.map((x) => ({ ...x, weight: Number(x.weight) || 0 })) : [...r.targets, ...Array.from({ length: 3 - r.targets.length }, emptyTarget)],
    });
    setEditOpen(true);
  };

  const doSave = async () => {
    if (!editing && !form.employeeId) { toast.error(t("Pilih karyawan peserta PIP", "Pick the PIP participant")); return; }
    if (!form.reviewerId) { toast.error(t("Pilih pembina (atasan)", "Pick the coach (manager)")); return; }
    if (!form.startDate) { toast.error(t("Tanggal mulai wajib diisi", "Start date is required")); return; }
    const months = Number(form.months);
    if (!Number.isFinite(months) || months < 1 || months > 3) { toast.error(t("Durasi PIP 1–3 bulan (D7)", "PIP duration is 1–3 months (D7)")); return; }
    if (form.targets.length < 3 || form.targets.length > 5) { toast.error(t("Target PIP harus 3–5 item", "PIP targets must be 3–5 items")); return; }
    if (Math.abs(weightSum - 100) > 0.01) { toast.error(t("Jumlah bobot harus 100 (sekarang {w}).", "Weights must total 100 (now {w}).", { w: String(Math.round(weightSum)) })); return; }
    setBusy(true);
    try {
      if (editing) {
        await apiSend(PIP_API, "PATCH", {
          id: editing.id, startDate: form.startDate, months,
          targets: form.targets, reviewerId: form.reviewerId,
          hrAdvisorId: form.hrAdvisorId || null, appraisalId: form.appraisalId || null,
        });
        toast.success(t("Draf PIP diperbarui", "PIP draft updated"));
      } else {
        await apiSend(PIP_API, "POST", {
          action: "create", employeeId: form.employeeId,
          appraisalId: form.appraisalId || undefined,
          startDate: form.startDate, months,
          targets: form.targets, reviewerId: form.reviewerId,
          hrAdvisorId: form.hrAdvisorId || undefined,
        });
        toast.success(t("Draf PIP dibuat", "PIP draft created"));
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
      return res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
      return null;
    } finally { setBusy(false); }
  };

  const rows = api.data?.rows ?? [];
  // "open" (sedang berjalan) disaring lokal dgn predicate — server = semua status
  const visible = statusFilter === "open" ? rows.filter((r) => !pipTerminal(r.status)) : rows;

  // sinkronkan dialog detail dgn baris terbaru pasca mutasi (review/extend/outcome)
  useEffect(() => {
    setDetail((d) => {
      if (!d) return d;
      const fresh = api.data?.rows.find((r) => r.id === d.id);
      return fresh && fresh !== d ? fresh : d;
    });
  }, [api.data]);

  const fmtD = (iso: string) => new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID");

  if (!api.data && api.loading) return <LoadingRows />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Program Perbaikan Kinerja (PIP)", "Performance Improvement Plan (PIP)")}
        description={t(
          "Alur 9 end-to-end: draf target mini-KPI 3–5 item + checkpoint 30/60/90 → persetujuan atasan & HR (SK terbit) → review checkpoint → perpanjangan maks 1× → outcome pulih / belum pulih (saran SP — eksekusi manual di HR Base).",
          "Flow 9 end-to-end: 3–5 mini-KPI targets + 30/60/90 checkpoints → manager & HR approval (SK letter issued) → checkpoint reviews → max one extension → recovered / not-recovered outcome (SP suggestion — executed manually in HR Base).",
        )}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44" aria-label={t("Filter status", "Status filter")}><SelectValue /></SelectTrigger>
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
            <Button onClick={openCreate}><Plus className="h-4 w-4" aria-hidden /> {t("Buat PIP", "Create PIP")}</Button>
          </div>
        )}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={Waypoints}
          title={t("Belum ada program PIP", "No PIP programs yet")}
          description={t(
            "Usulan otomatis tersedia di tab Merit (rating ≤ 2). Klik \u201cBuat PIP\u201d untuk menyusun program perbaikan kinerja pertama.",
            "Auto-proposals are available in the Merit tab (rating ≤ 2). Click \u201cCreate PIP\u201d to draft the first improvement program.",
          )}
        />
      ) : (
        <Card className="min-w-0">
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
                  <TableHead className="w-52"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {visible.map((r) => {
                    const reviewed = r.checkpoints.filter((c) => c.status === "Reviewed").length;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">
                          <button type="button" className="font-semibold text-fuchsia-600 hover:underline dark:text-fuchsia-400" onClick={() => setDetail(r)}>{r.docNo}</button>
                          {r.letterRefNo && <p className="text-[10px] text-slate-500">✉ {r.letterRefNo}</p>}
                        </TableCell>
                        <TableCell className="text-sm">
                          <p className="font-medium">{r.employeeName}</p>
                          <p className="text-xs text-slate-500">{r.employeeNo} · {r.unit ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.appraisalDocNo
                            ? <span>{r.appraisalDocNo}{r.finalRating != null && <> · <Badge variant="destructive">★ {r.finalRating}</Badge></>}</span>
                            : <span className="text-slate-400">—</span>}
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
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div className={cn("h-full rounded-full", reviewed === r.checkpoints.length ? "bg-emerald-500" : "bg-amber-400")} style={{ width: `${r.checkpoints.length ? (reviewed / r.checkpoints.length) * 100 : 0}%` }} />
                            </div>
                            <span className="text-xs tabular-nums">{reviewed}/{r.checkpoints.length}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusPill status={r.status} />
                          {r.status === "Draft" && r.chain?.status === "InProgress" && (
                            <p className="mt-0.5 text-[10px] text-slate-500">L{r.chain.currentLevel}/{r.chain.totalLevels} · {r.chain.currentApprover?.slice(0, 24)}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDetail(r)}>{t("Detail", "Detail")}</Button>
                            {r.status === "Draft" && r.chain?.status !== "InProgress" && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => openEdit(r)}>{t("Ubah", "Edit")}</Button>
                                <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => pipAction({ action: "submit", id: r.id }, t("Diajukan ke persetujuan", "Submitted for approval"))}>
                                  <Send className="h-3 w-3" aria-hidden /> {t("Ajukan", "Submit")}
                                </Button>
                              </>
                            )}
                            {r.status === "Draft" && r.chain?.status === "InProgress" && (
                              <>
                                <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => pipAction({ action: "decide", id: r.id, decision: "approve" }, t("Jenjang disetujui", "Level approved"))}>
                                  {t("Setujui", "Approve")}
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => {
                                  const note = window.prompt(t("Alasan penolakan (opsional):", "Rejection reason (optional):")) ?? "";
                                  pipAction({ action: "decide", id: r.id, decision: "reject", note }, t("Ditolak di jenjang", "Rejected at level"));
                                }}>
                                  {t("Tolak", "Reject")}
                                </Button>
                              </>
                            )}
                            {r.status === "Active" && (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setExtendTarget(r); setExtendForm({ newEndDate: "", reason: "" }); }}>
                                <CalendarClock className="h-3 w-3" aria-hidden /> {t("Perpanjang", "Extend")}
                              </Button>
                            )}
                            {pipLive(r.status) && (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setOutcomeTarget(r); setOutcomeForm({ outcome: "Recovered", notes: "" }); setSuggestion(null); }}>
                                <Flag className="h-3 w-3" aria-hidden /> {t("Outcome", "Outcome")}
                              </Button>
                            )}
                            {!pipTerminal(r.status) && (
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-600" disabled={busy} aria-label={t("Batalkan", "Cancel")} onClick={() => { setCancelTarget(r); setCancelReason(""); }}>
                                <Ban className="h-3 w-3" aria-hidden />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- dialog: create / edit draf ---- */}
      <Dialog open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("Sunting draf {doc}", "Edit draft {doc}", { doc: editing.docNo }) : t("Buat Program Perbaikan Kinerja", "Create Performance Improvement Plan")}</DialogTitle>
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
                        <SelectItem value="none">{t("Tanpa tautan", "No link")}</SelectItem>
                        {(linkApi.data?.appraisals ?? []).map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.docNo} · ★ {a.finalRating ?? "—"} · {a.cycleCode}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                  "Checkpoint otomatis 3 tahap (≈ tiap sepertiga durasi — 2 bln: +20/+40/+60 hari). Durasi 1–3 bulan (D7, default 2).",
                  "3 checkpoints are scheduled automatically (≈ every third of the duration — 2 mo: +20/+40/+60 days). Duration is 1–3 months (D7, default 2).",
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

      {/* ---- dialog: detail + timeline checkpoint ---- */}
      <Dialog open={detail !== null} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detail && (() => {
            const reviewed = detail.checkpoints.filter((c) => c.status === "Reviewed").length;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    <Waypoints className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" aria-hidden />
                    {detail.docNo}
                    <StatusPill status={detail.status} />
                  </DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <p><span className="text-slate-500">{t("Karyawan", "Employee")}:</span> <strong>{detail.employeeName}</strong> · {detail.employeeNo} · {detail.unit ?? "—"}</p>
                  <p><span className="text-slate-500">{t("Pembina", "Coach")}:</span> {detail.reviewerName ?? "—"}{detail.advisorName ? ` · ${t("HR", "HR")}: ${detail.advisorName}` : ""}</p>
                  <p><span className="text-slate-500">{t("Periode", "Period")}:</span> {fmtD(detail.startDate)} → {fmtD(detail.endDate)} ({detail.months} {t("bln", "mo")})</p>
                  <p>
                    <span className="text-slate-500">{t("Penilaian", "Appraisal")}:</span> {detail.appraisalDocNo ?? "—"}
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
                            <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setReviewCp({ pip: detail, cp: c }); setReviewForm({ achievementPct: "", notes: "" }); }}>
                              <CheckCircle2 className="h-3 w-3" aria-hidden /> {t("Catat review", "Record review")}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {detail.outcomeNotes && (
                  <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    <strong>{t("Catatan outcome", "Outcome note")}:</strong> {detail.outcomeNotes}
                    {detail.status === "Recovered" && <> — {t("dicatat pada penilaian berikutnya (riwayat tetap tersimpan).", "recorded in the next appraisal (history retained).")}</>}
                  </p>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ---- dialog: catat review checkpoint ---- */}
      <Dialog open={reviewCp !== null} onOpenChange={(o) => { if (!o) setReviewCp(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Catat Review Checkpoint {n} — {doc}", "Record Checkpoint {n} Review — {doc}", { n: String(reviewCp?.cp.seq ?? 0), doc: reviewCp?.pip.docNo ?? "" })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Capaian kumulatif sasaran PIP pada tahap ini (0–150%). Review hanya sekali — ter-audit.", "Cumulative achievement of PIP targets at this stage (0–150%). One-time review — audited.")}
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("Capaian (%)", "Achievement (%)")}</Label>
              <Input type="number" min={0} max={150} value={reviewForm.achievementPct} onChange={(e) => setReviewForm((f) => ({ ...f, achievementPct: e.target.value }))} placeholder="mis. 85" />
            </div>
            <div className="space-y-1">
              <Label>{t("Catatan pembina (opsional)", "Coach notes (optional)")}</Label>
              <Textarea rows={3} value={reviewForm.notes} onChange={(e) => setReviewForm((f) => ({ ...f, notes: e.target.value }))} />
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

      {/* ---- dialog: perpanjang ---- */}
      <Dialog open={extendTarget !== null} onOpenChange={(o) => { if (!o) setExtendTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle><CalendarClock className="mr-1 inline h-4 w-4 text-amber-500" aria-hidden />{t("Perpanjang {doc}", "Extend {doc}", { doc: extendTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t(
              "Perpanjangan maksimum 1× (D7) dan total durasi tetap ≤3 bulan sejak mulai. Checkpoint baru ditambahkan pada tenggat baru. Tenggat saat ini: {end}.",
              "Maximum one extension (D7) and total duration stays ≤3 months from start. A new checkpoint is added at the new deadline. Current deadline: {end}.",
              { end: extendTarget ? fmtD(extendTarget.endDate) : "" },
            )}
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("Tanggal berakhir baru", "New end date")}</Label>
              <Input type="date" min={extendTarget ? addDaysISO(extendTarget.endDate.slice(0, 10), 1) : undefined} max={extendTarget ? addDaysISO(extendTarget.startDate.slice(0, 10), 90) : undefined} value={extendForm.newEndDate} onChange={(e) => setExtendForm((f) => ({ ...f, newEndDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>{t("Alasan perpanjangan (≥10 karakter)", "Extension reason (≥10 characters)")}</Label>
              <Textarea rows={3} value={extendForm.reason} onChange={(e) => setExtendForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t("Contoh: progres positif namun belum stabil — perlu 1 bulan tambahan", "e.g. positive but unstable progress — needs 1 extra month")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button disabled={busy} onClick={async () => {
              if (!extendTarget) return;
              const res = await pipAction({
                action: "extend", id: extendTarget.id, newEndDate: extendForm.newEndDate, reason: extendForm.reason,
              }, t("PIP diperpanjang — status Extended", "PIP extended — status Extended"));
              if (res) setExtendTarget(null);
            }}>{t("Perpanjang", "Extend")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: outcome ---- */}
      <Dialog open={outcomeTarget !== null} onOpenChange={(o) => { if (!o) { setOutcomeTarget(null); setSuggestion(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle><Flag className="mr-1 inline h-4 w-4 text-fuchsia-500" aria-hidden />{t("Outcome {doc}", "Outcome {doc}", { doc: outcomeTarget?.docNo ?? "" })}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t(
              "Keputusan akhir program (paling lambat endDate +7 hari). Recovered dicatat pada penilaian berikutnya — riwayat tidak dihapus.",
              "Final program decision (at the latest endDate +7 days). Recovered is recorded in the next appraisal — history is not deleted.",
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
          {suggestion && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <p className="mb-1 flex items-center gap-1 font-semibold"><ShieldAlert className="h-3.5 w-3.5" aria-hidden />{t("Saran tindak lanjut (eksekusi manual)", "Suggested follow-up (manual execution)")}</p>
              <p>
                {t("Riwayat SP karyawan", "Employee's SP history")}: {suggestion.existingSpCount}
                {suggestion.lastWarningLevel ? ` (${t("tertinggi", "highest")}: ${suggestion.lastWarningLevel})` : ""}
                {" → "}
                {t("saran berikutnya", "suggested next")}: <strong>{suggestion.suggestedNextLevel}</strong>
              </p>
              <p className="mt-1 flex items-start gap-1"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{t(
                "Modul ini TIDAK otomatis membuat SP/PHK — jalankan DisciplinaryRecord & PA Termination manual di modul HR Base (bukti PIP + SP = rantai pertahanan §7).",
                "This module does NOT auto-create SP/termination — run DisciplinaryRecord & PA Termination manually in HR Base (PIP + SP evidence = defense chain §7).",
              )}</p>
            </div>
          )}
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
                    setSuggestion(res.suggestion as NonNullable<typeof suggestion>);
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
