"use client";
// P7-impl — Evaluasi Masa Percobaan (§17 probation; §28 alur 4; §7.1 UU 13/2003
// Ps.60): daftar evaluasi (auto dari onboarding D9 + manual HR) + filter status
// & "jatuh tempo ≤14 hari", penilaian atasan (skor 0–100 + kriteria bobot 3–6
// item Σ100), rekomendasi HR 3 arah — Confirm / Extend (PERINGATAN §7.1:
// perjanjian kerja BARU, bukan perpanjangan percobaan) / Terminate — submit →
// approval AS-PROB-STD (L1 atasan → L2 HR; L3 Direktur hanya Terminate) →
// keputusan → PA ChangeStatus/ExtendProbation/Termination + surat
// PROB_RESULT/PROB_EXTEND (idempoten), batalkan (alasan ter-audit).
// Detail via GET ?id= (jenjang approval lengkap — pola PIP P6).
// Mobile <640px: tabel → kartu. Dwibahasa penuh.
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
import { ShieldCheck, Plus, Search, Send, CheckCircle2, Ban, FileText, Hourglass, Trash2, Scale, ArrowRightLeft } from "lucide-react";

const PROB_API = "/api/rekankerja/performance/probation";

interface ProbCriteria { title: string; weight: number }
interface ProbRow {
  id: string; docNo: string;
  employeeId: string; employeeName: string; employeeNo: string; unit: string | null; position: string | null;
  joinDate: string | null; onboardingId: string | null; onboardingStatus: string | null;
  dueDate: string; daysRemaining: number;
  criteria: ProbCriteria[]; managerScore: number | null; hrNote: string | null;
  recommendation: string | null; decisionDate: string | null; status: string;
  personnelActionId: string | null; personnelActionDocNo: string | null;
  letterRefNos: { key: string; refNo: string }[];
  chain: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}
interface ProbDetail {
  row: ProbRow;
  chainSteps: { levelNo: number; approverType: string; approverLabel: string; status: string; note: string | null; decidedBy: string | null; decidedAt: string | null }[] | null;
}
interface EmpOpt {
  id: string; employeeNo: string; fullName: string; position: string | null; orgUnit: string | null;
  joinDate: string | null; employmentStatus: string | null;
}

/** Status evaluasi yang masih berjalan (belum Decided/Cancelled — §34.5). */
const probOpen = (s: string) => s === "Open" || s === "Assessed" || s === "Recommended";

const emptyCriteria = (): ProbCriteria => ({ title: "", weight: 0 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

export function PerformanceProbationPage() {
  const { t, lang } = useI18n();
  const [statusFilter, setStatusFilter] = useState("all");
  const [dueSoon, setDueSoon] = useState(false);
  const listUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (dueSoon) p.set("dueSoon", "1");
    return `${PROB_API}?${p.toString()}`;
  }, [statusFilter, dueSoon]);
  const api = useApi<{ rows: ProbRow[] }>(listUrl, [listUrl]);

  // ---- create manual ----
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ employeeId: "", joinDate: todayISO(), criteria: [emptyCriteria(), emptyCriteria(), emptyCriteria()] as ProbCriteria[] });
  const [empQ, setEmpQ] = useState("");
  const empApi = useApi<{ employees: EmpOpt[] }>(
    createOpen ? `${PROB_API}?employees=1&q=${encodeURIComponent(empQ)}` : null,
    [createOpen, empQ],
  );

  // ---- dialogs ----
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailApi = useApi<ProbDetail>(detailId ? `${PROB_API}?id=${detailId}` : null, [detailId]);
  const detail = detailApi.data?.row ?? null;
  const [assessTarget, setAssessTarget] = useState<ProbRow | null>(null);
  const [assessForm, setAssessForm] = useState<{ criteria: ProbCriteria[]; managerScore: string; note: string }>({ criteria: [], managerScore: "", note: "" });
  const [recTarget, setRecTarget] = useState<ProbRow | null>(null);
  const [recForm, setRecForm] = useState<{ recommendation: string; hrNote: string }>({ recommendation: "Confirm", hrNote: "" });
  const [cancelTarget, setCancelTarget] = useState<ProbRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedEmp = useMemo(
    () => (empApi.data?.employees ?? []).find((e) => e.id === createForm.employeeId) ?? null,
    [empApi.data, createForm.employeeId],
  );
  const weightSum = (items: ProbCriteria[]) => items.reduce((s, x) => s + (Number(x.weight) || 0), 0);

  const openCreate = () => {
    setCreateForm({ employeeId: "", joinDate: todayISO(), criteria: [emptyCriteria(), emptyCriteria(), emptyCriteria()] });
    setEmpQ("");
    setCreateOpen(true);
  };

  const openAssess = (r: ProbRow) => {
    const base = r.criteria.length >= 3 ? r.criteria.map((c) => ({ ...c, weight: Number(c.weight) || 0 })) : [...r.criteria, ...Array.from({ length: 3 - r.criteria.length }, emptyCriteria)];
    setAssessTarget(r);
    setAssessForm({ criteria: base, managerScore: r.managerScore != null ? String(r.managerScore) : "", note: "" });
  };

  const probAction = async (body: Record<string, unknown>, okMsg: string): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    try {
      const res = await apiSend<Record<string, unknown>>(PROB_API, "POST", body);
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
  const fmtD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID") : "—");

  const recPill = (rec: string | null) => {
    if (!rec) return <span className="text-xs text-slate-400">—</span>;
    if (rec === "Confirm") {
      return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">{t("Confirm", "Confirm")}</Badge>;
    }
    if (rec === "Extend") {
      return (
        <span title={t("Peringatan §7.1: perpanjangan masa percobaan tidak dikenal UU 13/2003 Pasal 60 — jalur yang benar adalah perjanjian kerja baru (PA ExtendProbation + surat perjanjian).", "§7.1 warning: probation extension is not recognized under Law 13/2003 Art. 60 — the correct path is a new employment agreement (ExtendProbation PA + agreement letter).")}>
          <Badge className="cursor-help border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">{t("Extend", "Extend")}</Badge>
        </span>
      );
    }
    return <Badge className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400">{t("Terminate", "Terminate")}</Badge>;
  };

  const dueBadge = (r: ProbRow) => {
    if (r.status === "Decided" || r.status === "Cancelled") return null;
    const d = r.daysRemaining;
    if (d < 0) return <span className="font-semibold text-rose-600 dark:text-rose-400">{t("lewat {n} hari", "{n} days overdue", { n: String(-d) })}</span>;
    if (d <= 14) return <span className="font-semibold text-amber-600 dark:text-amber-400">{t("sisa {n} hari", "{n} days left", { n: String(d) })}</span>;
    return <span className="font-semibold text-emerald-600 dark:text-emerald-400">{t("sisa {n} hari", "{n} days left", { n: String(d) })}</span>;
  };

  const submitAssess = async () => {
    if (!assessTarget) return;
    const score = Number(assessForm.managerScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) { toast.error(t("Skor atasan harus angka 0–100", "Manager score must be 0–100")); return; }
    if (assessForm.criteria.length < 3 || assessForm.criteria.length > 6) { toast.error(t("Kriteria harus 3–6 item", "Criteria must be 3–6 items")); return; }
    const sum = weightSum(assessForm.criteria);
    if (Math.abs(sum - 100) > 0.01) { toast.error(t("Jumlah bobot harus 100 (sekarang {w}).", "Weights must total 100 (now {w}).", { w: String(Math.round(sum)) })); return; }
    const res = await probAction({
      action: "assess", id: assessTarget.id,
      criteria: assessForm.criteria, managerScore: score,
      note: assessForm.note || undefined,
    }, t("Penilaian atasan tersimpan", "Manager assessment saved"));
    if (res) setAssessTarget(null);
  };

  const submitRecommend = async () => {
    if (!recTarget) return;
    if ((recForm.recommendation === "Extend" || recForm.recommendation === "Terminate") && recForm.hrNote.trim().length < 10) {
      toast.error(t("Catatan HR wajib ≥10 karakter untuk rekomendasi Extend/Terminate (bobot hukum).", "HR note of ≥10 characters is required for Extend/Terminate (legal gravity)."));
      return;
    }
    const res = await probAction({
      action: "recommend", id: recTarget.id,
      recommendation: recForm.recommendation, hrNote: recForm.hrNote || undefined,
    }, t("Rekomendasi tersimpan", "Recommendation saved"));
    if (res) setRecTarget(null);
  };

  const submitCreate = async () => {
    if (!createForm.employeeId) { toast.error(t("Pilih karyawan", "Pick an employee")); return; }
    if (!createForm.joinDate) { toast.error(t("Tanggal masuk wajib diisi", "Join date is required")); return; }
    if (createForm.criteria.length < 3 || createForm.criteria.length > 6) { toast.error(t("Kriteria harus 3–6 item", "Criteria must be 3–6 items")); return; }
    const sum = weightSum(createForm.criteria);
    if (Math.abs(sum - 100) > 0.01) { toast.error(t("Jumlah bobot harus 100 (sekarang {w}).", "Weights must total 100 (now {w}).", { w: String(Math.round(sum)) })); return; }
    const res = await probAction({
      action: "create",
      employeeId: createForm.employeeId, joinDate: createForm.joinDate, criteria: createForm.criteria,
    }, t("Evaluasi percobaan dibuat", "Probation evaluation created"));
    if (res) setCreateOpen(false);
  };

  // ---- sub-render: aksi per baris (dipakai tabel & kartu mobile) ----
  const rowActions = (r: ProbRow) => (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDetailId(r.id)}>{t("Detail", "Detail")}</Button>
      {(r.status === "Open" || r.status === "Assessed") && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => openAssess(r)}>{t("Nilai", "Assess")}</Button>
      )}
      {(r.status === "Assessed" || (r.status === "Recommended" && r.chain?.status !== "InProgress")) && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => { setRecTarget(r); setRecForm({ recommendation: r.recommendation ?? "Confirm", hrNote: "" }); }}>
          <Scale className="h-3 w-3" aria-hidden /> {t("Rekomendasi", "Recommend")}
        </Button>
      )}
      {r.status === "Recommended" && r.chain?.status !== "InProgress" && (
        <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => probAction({ action: "submit", id: r.id }, t("Diajukan ke persetujuan", "Submitted for approval"))}>
          <Send className="h-3 w-3" aria-hidden /> {t("Ajukan", "Submit")}
        </Button>
      )}
      {r.status === "Recommended" && r.chain?.status === "InProgress" && (
        <>
          <Button size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => probAction({ action: "decide", id: r.id, decision: "approve" }, t("Jenjang disetujui", "Level approved"))}>
            {t("Setujui", "Approve")}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => {
            const note = window.prompt(t("Alasan penolakan (opsional):", "Rejection reason (optional):")) ?? "";
            probAction({ action: "decide", id: r.id, decision: "reject", note }, t("Ditolak di jenjang", "Rejected at level"));
          }}>
            {t("Tolak", "Reject")}
          </Button>
        </>
      )}
      {r.status === "Decided" && !r.personnelActionId && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => probAction({ action: "toPersonnelAction", id: r.id }, t("PA digulirkan", "PA created"))}>
          <ArrowRightLeft className="h-3 w-3" aria-hidden /> PA
        </Button>
      )}
      {r.status === "Decided" && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => probAction({ action: "toLetter", id: r.id }, t("Surat terbit", "Letter issued"))}>
          <FileText className="h-3 w-3" aria-hidden /> {t("Surat", "Letter")}
        </Button>
      )}
      {probOpen(r.status) && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-rose-600" disabled={busy} aria-label={t("Batalkan", "Cancel")} onClick={() => { setCancelTarget(r); setCancelReason(""); }}>
          <Ban className="h-3 w-3" aria-hidden />
        </Button>
      )}
    </div>
  );

  if (!api.data && api.loading) return <LoadingRows />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Evaluasi Masa Percobaan", "Probation Evaluation")}
        description={t(
          "Alur 4 (§7.1 UU 13/2003 Ps.60 — maks 3 bulan): evaluasi otomatis dari onboarding atau manual HR → penilaian atasan (skor 0–100) → rekomendasi Confirm / Extend (perjanjian kerja BARU) / Terminate → approval atasan → HR (+ Direktur utk Terminate) → PA + surat.",
          "Flow 4 (§7.1 Law 13/2003 Art. 60 — max 3 months): auto evaluation from onboarding or manual HR → manager assessment (0–100) → Confirm / Extend (a NEW employment agreement) / Terminate recommendation → manager → HR approval (+ Director for Terminate) → PA + letter.",
        )}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" aria-label={t("Filter status", "Status filter")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua status", "All statuses")}</SelectItem>
                <SelectItem value="Open">{t("Open", "Open")}</SelectItem>
                <SelectItem value="Assessed">{t("Assessed", "Assessed")}</SelectItem>
                <SelectItem value="Recommended">{t("Recommended", "Recommended")}</SelectItem>
                <SelectItem value="Decided">{t("Decided", "Decided")}</SelectItem>
                <SelectItem value="Cancelled">{t("Cancelled", "Cancelled")}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant={dueSoon ? "default" : "outline"} onClick={() => setDueSoon((v) => !v)} aria-pressed={dueSoon}>
              <Hourglass className="h-4 w-4" aria-hidden /> {t("Jatuh tempo ≤14 hari", "Due ≤14 days")}
            </Button>
            <Button onClick={openCreate}><Plus className="h-4 w-4" aria-hidden /> {t("Buat evaluasi", "Create evaluation")}</Button>
          </div>
        )}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={t("Belum ada evaluasi masa percobaan", "No probation evaluations yet")}
          description={t(
            "Evaluasi dibuat otomatis saat karyawan baru selesai onboarding (jatuh tempo = tanggal masuk + 3 bulan). Klik \u201cBuat evaluasi\u201d untuk menyusun evaluasi manual.",
            "Evaluations are created automatically when a new hire completes onboarding (due = join date + 3 months). Click \u201cCreate evaluation\u201d to draft one manually.",
          )}
        />
      ) : (
        <Card className="min-w-0">
          <CardContent className="p-4">
            {/* ---- tabel (≥640px) ---- */}
            <div className="hidden overflow-x-auto sm:block">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{t("Dokumen", "Document")}</TableHead>
                  <TableHead>{t("Karyawan", "Employee")}</TableHead>
                  <TableHead>{t("Masuk", "Joined")}</TableHead>
                  <TableHead>{t("Jatuh tempo", "Due")}</TableHead>
                  <TableHead>{t("Skor", "Score")}</TableHead>
                  <TableHead>{t("Rekomendasi", "Recommendation")}</TableHead>
                  <TableHead>{t("Status", "Status")}</TableHead>
                  <TableHead className="w-56"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        <button type="button" className="font-semibold text-fuchsia-600 hover:underline dark:text-fuchsia-400" onClick={() => setDetailId(r.id)}>{r.docNo}</button>
                        {r.onboardingId && <p className="text-[10px] text-slate-500">{t("dari onboarding", "from onboarding")}{r.onboardingStatus ? ` · ${r.onboardingStatus}` : ""}</p>}
                        {r.personnelActionDocNo && <p className="text-[10px] text-slate-500">→ PA {r.personnelActionDocNo}</p>}
                        {r.letterRefNos.length > 0 && (
                          <p className="text-[10px] text-slate-500">✉ {r.letterRefNos.map((l) => l.refNo).join(" · ")}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <p className="font-medium">{r.employeeName}</p>
                        <p className="text-xs text-slate-500">{r.employeeNo} · {r.unit ?? "—"}</p>
                        <p className="text-xs text-slate-500">{r.position ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-xs">{fmtD(r.joinDate)}</TableCell>
                      <TableCell className="text-xs">
                        <p>{fmtD(r.dueDate)}</p>
                        {dueBadge(r)}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {r.managerScore != null ? <span className="font-semibold">{Math.round(r.managerScore)}/100</span> : <span className="text-xs text-slate-400">—</span>}
                      </TableCell>
                      <TableCell>{recPill(r.recommendation)}</TableCell>
                      <TableCell>
                        <StatusPill status={r.status} />
                        {r.status === "Recommended" && r.chain?.status === "InProgress" && (
                          <p className="mt-0.5 text-[10px] text-slate-500">L{r.chain.currentLevel}/{r.chain.totalLevels} · {r.chain.currentApprover?.slice(0, 24)}</p>
                        )}
                      </TableCell>
                      <TableCell>{rowActions(r)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* ---- kartu (mobile <640px — pola collapse PIP) ---- */}
            <div className="space-y-3 sm:hidden">
              {rows.map((r) => (
                <Card key={r.id} className="min-w-0"><CardContent className="p-4">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <button type="button" className="font-mono text-sm font-bold text-fuchsia-600 dark:text-fuchsia-400" onClick={() => setDetailId(r.id)}>{r.docNo}</button>
                      {r.onboardingId && <p className="text-[10px] text-slate-500">{t("dari onboarding", "from onboarding")}</p>}
                      {r.personnelActionDocNo && <p className="text-[10px] text-slate-500">→ PA {r.personnelActionDocNo}</p>}
                      {r.letterRefNos.length > 0 && <p className="text-[10px] text-slate-500">✉ {r.letterRefNos.map((l) => l.refNo).join(" · ")}</p>}
                    </div>
                    <div className="text-right">
                      <StatusPill status={r.status} />
                      {r.status === "Recommended" && r.chain?.status === "InProgress" && (
                        <p className="mt-0.5 text-[10px] text-slate-500">L{r.chain.currentLevel}/{r.chain.totalLevels}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-medium">{r.employeeName}</p>
                  <p className="text-xs text-slate-500">{r.employeeNo} · {r.unit ?? "—"} · {r.position ?? "—"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{t("Masuk", "Joined")}: {fmtD(r.joinDate)}</span>
                    <span>{t("Jatuh tempo", "Due")}: {fmtD(r.dueDate)}</span>
                    <span>{t("Skor", "Score")}: {r.managerScore != null ? `${Math.round(r.managerScore)}/100` : "—"}</span>
                    <span>{t("Rekomendasi", "Recommendation")}: {recPill(r.recommendation)}</span>
                  </div>
                  {dueBadge(r) && <p className="mt-1 text-xs">{dueBadge(r)}</p>}
                  <div className="mt-2">{rowActions(r)}</div>
                </CardContent></Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- dialog: create manual ---- */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Buat Evaluasi Masa Percobaan", "Create Probation Evaluation")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("Karyawan", "Employee")}</Label>
              {createForm.employeeId && selectedEmp ? (
                <div className="flex items-center justify-between rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 px-3 py-2 text-sm dark:border-fuchsia-900 dark:bg-fuchsia-950/20">
                  <span className="min-w-0"><strong>{selectedEmp.fullName}</strong> · {selectedEmp.employeeNo} · {selectedEmp.position ?? "—"} · {selectedEmp.orgUnit ?? "—"}</span>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setCreateForm((f) => ({ ...f, employeeId: "" }))}>{t("Ganti", "Change")}</Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                    <Input value={empQ} onChange={(e) => setEmpQ(e.target.value)} placeholder={t("Cari karyawan aktif tanpa evaluasi terbuka…", "Search active employees without an open evaluation…")} className="pl-8" />
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    {(empApi.data?.employees ?? []).length === 0 && (
                      <p className="px-3 py-3 text-xs text-slate-500">{t("Tidak ada karyawan cocok.", "No matching employees.")}</p>
                    )}
                    {(empApi.data?.employees ?? []).map((e) => (
                      <button key={e.id} type="button" className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                        onClick={() => setCreateForm((f) => ({ ...f, employeeId: e.id, joinDate: e.joinDate?.slice(0, 10) ?? f.joinDate }))}>
                        <span className="font-medium">{e.fullName}</span>
                        <span className="ml-2 text-xs text-slate-500">{e.employeeNo} · {e.position ?? "—"} · {e.orgUnit ?? "—"}{e.employmentStatus ? ` · ${e.employmentStatus}` : ""}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400">
              {t(
                "Tenggat otomatis = tanggal masuk + 3 bulan (maks — UU 13/2003 Pasal 60 §7.1). Server menolak tanggal masuk yang tenggatnya sudah lewat.",
                "Due date is automatic = join date + 3 months (maximum — Law 13/2003 Art. 60 §7.1). The server rejects join dates whose deadline has passed.",
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("Tanggal masuk", "Join date")}</Label>
                <Input type="date" value={createForm.joinDate} onChange={(e) => setCreateForm((f) => ({ ...f, joinDate: e.target.value }))} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>{t("Tenggat (otomatis)", "Deadline (automatic)")}</Label>
                <p className="rounded-md border border-slate-200 px-3 py-1.5 text-sm tabular-nums dark:border-slate-800">{fmtD(addDaysISO(createForm.joinDate, 90))}</p>
              </div>
            </div>
            <CriteriaEditor
              items={createForm.criteria}
              onChange={(items) => setCreateForm((f) => ({ ...f, criteria: items }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitCreate} disabled={busy}>{t("Buat evaluasi", "Create evaluation")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: detail (fetch ?id= — jenjang approval lengkap) ---- */}
      <Dialog open={detailId !== null} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("Evaluasi {doc}", "Evaluation {doc}", { doc: detail?.docNo ?? detailId?.slice(0, 8) ?? "" })}</DialogTitle>
          </DialogHeader>
          {detailApi.loading && !detail ? <p className="py-6 text-center text-sm text-slate-500">{t("Memuat…", "Loading…")}</p> : detail && (() => {
            const d = detailApi.data;
            return (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <p><span className="text-slate-500">{t("Karyawan", "Employee")}:</span> <strong>{detail.employeeName}</strong> · {detail.employeeNo}</p>
                  <p><span className="text-slate-500">{t("Unit / jabatan", "Unit / position")}:</span> {detail.unit ?? "—"} · {detail.position ?? "—"}</p>
                  <p><span className="text-slate-500">{t("Tanggal masuk", "Join date")}:</span> {fmtD(detail.joinDate)}</p>
                  <p><span className="text-slate-500">{t("Jatuh tempo", "Due")}:</span> {fmtD(detail.dueDate)} {dueBadge(detail)}</p>
                  <p><span className="text-slate-500">{t("Skor atasan", "Manager score")}:</span> {detail.managerScore != null ? `${Math.round(detail.managerScore)}/100` : "—"}</p>
                  <p><span className="text-slate-500">{t("Rekomendasi", "Recommendation")}:</span> {recPill(detail.recommendation)}</p>
                  <p><span className="text-slate-500">{t("Tanggal keputusan", "Decision date")}:</span> {fmtD(detail.decisionDate)}</p>
                  <p><span className="text-slate-500">PA:</span> {detail.personnelActionDocNo ?? "—"}</p>
                </div>
                {detail.onboardingId && (
                  <p className="text-xs text-slate-500">{t("Dibuat otomatis dari onboarding rekrutmen (D9)", "Auto-created from recruitment onboarding (D9)")}{detail.onboardingStatus ? ` · ${detail.onboardingStatus}` : ""}</p>
                )}
                {detail.hrNote && (
                  <div className="rounded-md bg-slate-50 p-2 text-xs dark:bg-slate-900">
                    <p className="font-semibold text-slate-600 dark:text-slate-400">{t("Catatan HR", "HR note")}</p>
                    <p>{detail.hrNote}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <p className="font-semibold">{t("Kriteria (bobot)", "Criteria (weights)")}</p>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="h-8">{t("Kriteria", "Criterion")}</TableHead>
                      <TableHead className="h-8 w-20">{t("Bobot", "Weight")}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {detail.criteria.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="py-1.5 text-xs">{c.title}</TableCell>
                          <TableCell className="py-1.5 text-xs tabular-nums">{Number(c.weight)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {d?.chainSteps && d.chainSteps.length > 0 && (
                  <div className="space-y-1">
                    <p className="font-semibold">{t("Jenjang persetujuan (AS-PROB-STD)", "Approval levels (AS-PROB-STD)")}</p>
                    <div className="space-y-1">
                      {d.chainSteps.map((s) => (
                        <div key={s.levelNo} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
                          <span className="min-w-0"><span className="font-mono">L{s.levelNo}</span> · {s.approverLabel}</span>
                          <StatusPill status={s.status === "Current" ? "InProgress" : s.status} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail.letterRefNos.length > 0 && (
                  <p className="text-xs text-slate-500">✉ {detail.letterRefNos.map((l) => `${l.key} ${l.refNo}`).join(" · ")}</p>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            {(detail?.status === "Open" || detail?.status === "Assessed") && (
              <Button onClick={() => { if (detail) { openAssess(detail); setDetailId(null); } }}>{t("Nilai sekarang", "Assess now")}</Button>
            )}
            <Button variant="outline" onClick={() => setDetailId(null)}>{t("Tutup", "Close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: assess (penilaian atasan) ---- */}
      <Dialog open={!!assessTarget} onOpenChange={(o) => { if (!o) setAssessTarget(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Penilaian Atasan — {doc}", "Manager Assessment — {doc}", { doc: assessTarget?.docNo ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {assessTarget && (
              <p className="rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-900">
                <strong>{assessTarget.employeeName}</strong> · {assessTarget.employeeNo} · {t("jatuh tempo", "due")} {fmtD(assessTarget.dueDate)}
              </p>
            )}
            <div className="space-y-1">
              <Label>{t("Skor keseluruhan (0–100)", "Overall score (0–100)")}</Label>
              <Input
                type="number" min={0} max={100} value={assessForm.managerScore}
                onChange={(e) => setAssessForm((f) => ({ ...f, managerScore: e.target.value }))}
                aria-label={t("Skor atasan", "Manager score")}
              />
              <p className="text-xs text-slate-500">{t("Panduan: ≥70 lulus percobaan; 60–69 perlu pertimbangan; <60 tidak lulus.", "Guideline: ≥70 pass; 60–69 needs consideration; <60 fail.")}</p>
            </div>
            <CriteriaEditor
              items={assessForm.criteria}
              onChange={(items) => setAssessForm((f) => ({ ...f, criteria: items }))}
            />
            <div className="space-y-1">
              <Label>{t("Catatan penilaian (opsional)", "Assessment note (optional)")}</Label>
              <Textarea
                rows={3} value={assessForm.note}
                onChange={(e) => setAssessForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={t("Uraian singkat capaian/kekurangan selama percobaan…", "Brief description of achievements/gaps during probation…")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssessTarget(null)} disabled={busy}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitAssess} disabled={busy}><CheckCircle2 className="h-4 w-4" aria-hidden /> {t("Simpan penilaian", "Save assessment")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: recommend (rekomendasi HR — 3 arah) ---- */}
      <Dialog open={!!recTarget} onOpenChange={(o) => { if (!o) setRecTarget(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Rekomendasi HR — {doc}", "HR Recommendation — {doc}", { doc: recTarget?.docNo ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {recTarget && (
              <p className="rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-900">
                <strong>{recTarget.employeeName}</strong> · {t("skor atasan", "manager score")}: {recTarget.managerScore != null ? `${Math.round(recTarget.managerScore)}/100` : "—"}
              </p>
            )}
            <div className="space-y-2">
              {(["Confirm", "Extend", "Terminate"] as const).map((rec) => (
                <label key={rec} className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm",
                  recForm.recommendation === rec ? "border-fuchsia-300 bg-fuchsia-50/60 dark:border-fuchsia-700 dark:bg-fuchsia-950/20" : "border-slate-200 dark:border-slate-800",
                )}>
                  <input
                    type="radio" name="prob-rec" className="mt-0.5" checked={recForm.recommendation === rec}
                    onChange={() => setRecForm((f) => ({ ...f, recommendation: rec }))}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">
                      {rec === "Confirm" ? t("Confirm — konfirmasi karyawan tetap", "Confirm — pass as permanent employee")
                        : rec === "Extend" ? t("Extend — perjanjian kerja baru (percobaan ke-2)", "Extend — new employment agreement (2nd probation)")
                          : t("Terminate — PhK masa percobaan", "Terminate — probation termination")}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {rec === "Confirm"
                        ? t("Lulus percobaan → PA ChangeStatus (Probation → Permanent/PKWTT).", "Passes probation → ChangeStatus PA (Probation → Permanent).")
                        : rec === "Terminate"
                          ? t("Tidak lulus → PA Termination + surat hasil (approval +L3 Direktur).", "Fails → Termination PA + result letter (approval adds Director L3).")
                          : t("Percobaan ke-2 di atas perjanjian baru → PA ExtendProbation + surat perjanjian.", "2nd probation on a new agreement → ExtendProbation PA + agreement letter.")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {recForm.recommendation === "Extend" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <p className="font-bold">{t("PERINGATAN HUKUM §7.1", "LEGAL WARNING §7.1")}</p>
                <p>{t(
                  "Perpanjangan masa percobaan tidak dikenal UU 13/2003 Pasal 60 — jalur yang benar adalah perjanjian kerja baru (PA ExtendProbation + surat perjanjian); penilaian percobaan ke-2 harus berdiri di atas perjanjian yang sah.",
                  "Probation extension is not recognized under Law 13/2003 Art. 60 — the correct path is a new employment agreement (ExtendProbation PA + agreement letter); the 2nd probation assessment must stand on a valid agreement.",
                )}</p>
              </div>
            )}
            <div className="space-y-1">
              <Label>{t("Catatan HR", "HR note")}{recForm.recommendation !== "Confirm" ? t(" (wajib ≥10 karakter)", " (required ≥10 chars)") : t(" (opsional)", " (optional)")}</Label>
              <Textarea
                rows={4} value={recForm.hrNote}
                onChange={(e) => setRecForm((f) => ({ ...f, hrNote: e.target.value }))}
                placeholder={t("Dasar rekomendasi, pertimbangan hukum, catatan diskusi dgn atasan…", "Basis of recommendation, legal considerations, notes from manager discussion…")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecTarget(null)} disabled={busy}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitRecommend} disabled={busy}><CheckCircle2 className="h-4 w-4" aria-hidden /> {t("Simpan rekomendasi", "Save recommendation")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog: cancel ---- */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Batalkan evaluasi {doc}?", "Cancel evaluation {doc}?", { doc: cancelTarget?.docNo ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t("Evaluasi dibatalkan (mis. salah karyawan / data ganda). Alasan ter-audit dan tidak dapat dihapus.", "The evaluation is cancelled (e.g. wrong employee / duplicate). The reason is audited and cannot be removed.")}
            </p>
            <Textarea
              rows={3} value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={t("Alasan pembatalan (≥10 karakter)…", "Cancellation reason (≥10 characters)…")}
              aria-label={t("Alasan pembatalan", "Cancellation reason")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={busy}>{t("Batal", "Cancel")}</Button>
            <Button
              variant="destructive" disabled={busy || cancelReason.trim().length < 10}
              onClick={async () => {
                if (!cancelTarget) return;
                const res = await probAction({ action: "cancel", id: cancelTarget.id, reason: cancelReason }, t("Evaluasi dibatalkan", "Evaluation cancelled"));
                if (res) setCancelTarget(null);
              }}
            >
              <Ban className="h-4 w-4" aria-hidden /> {t("Batalkan evaluasi", "Cancel evaluation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- editor kriteria bersama (create + assess) — 3–6 item Σbobot 100 ----
function CriteriaEditor({ items, onChange }: { items: ProbCriteria[]; onChange: (items: ProbCriteria[]) => void }) {
  const { t } = useI18n();
  const sum = items.reduce((s, x) => s + (Number(x.weight) || 0), 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t("Kriteria evaluasi (3–6 item, Σbobot 100)", "Evaluation criteria (3–6 items, Σweight 100)")}</Label>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={items.length >= 6} onClick={() => onChange([...items, emptyCriteria()])}>
          <Plus className="h-3 w-3" aria-hidden /> {t("Kriteria", "Criterion")}
        </Button>
      </div>
      <div className="space-y-2">
        {items.map((c, i) => (
          <div key={i} className="grid grid-cols-1 gap-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800 sm:grid-cols-[1fr_96px_36px]">
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">{t("Judul kriteria", "Criterion title")}</Label>
              <Input className="h-8 text-xs" value={c.title} onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-500">{t("Bobot %", "Weight %")}</Label>
              <Input type="number" min={0} max={100} className="h-8 text-xs" value={c.weight || ""} onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) || 0 } : x))} />
            </div>
            <div className="flex items-end pb-0.5">
              <Button size="sm" variant="ghost" className="h-8 w-9 px-0 text-slate-400" disabled={items.length <= 3} aria-label={t("Hapus kriteria", "Remove criterion")} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {/* meter Σbobot (pola goals/PIP builder) */}
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className={cn("h-full rounded-full transition-all", Math.abs(sum - 100) < 0.01 ? "bg-emerald-500" : sum > 100 ? "bg-rose-500" : "bg-amber-400")} style={{ width: `${Math.min(100, sum)}%` }} />
        </div>
        <span className={cn("text-sm font-bold tabular-nums", Math.abs(sum - 100) < 0.01 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>Σ {Math.round(sum)}%</span>
        {Math.abs(sum - 100) > 0.01 && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onChange(items.map((x, j, arr) => ({ ...x, weight: j === arr.length - 1 ? 100 - Math.floor(100 / arr.length) * (arr.length - 1) : Math.floor(100 / arr.length) })))}>
            <Hourglass className="h-3 w-3" aria-hidden /> {t("Bagi rata", "Split evenly")}
          </Button>
        )}
      </div>
    </div>
  );
}
