"use client";
// ============================================================================
// PERFORMANCE — Merit & Tindak Lanjut (P5 — §32 Alur 8 + §32-5 usul PIP):
//   TAB di halaman Hasil & 9-Box (performance:results) — jangan pecah tab lama.
//   1. Tile statistik per status + total nominal bonus/raise (vault-gate).
//   2. Section USULAN MERIT — tabel kartu: rating chip · bonus bln/nominal ·
//      raise %/nominal · status + aksi per status:
//        Draft → Edit (patch + pratinjau live) / Ajukan / Batalkan;
//        Submitted → kotak approval chain (jenjang+status) + Setujui/Tolak;
//        Approved → Terapkan ke Payroll (centang bonus/raise + run target) /
//                   Buat PA (SalaryAdjustment/Promotion + pratinjau gaji) /
//                   Surat Hasil (+unduh PDF);
//        Applied → info run+PA (read-only).
//   3. Toolbar: Buat Usulan Massal (pilih matrix + ringkasan) + Terbitkan
//      Surat Massal.
//   4. Section USUL PIP (rating ≤2): kartu + 3 KPI terendah + dialog Jalankan
//      PIP (durasi 1–3 bln D7 · pembina · target prefill) / Tidak Dijalankan
//      (alasan wajib).
//   5. Section SURAT KINERJA — daftar PERF_RESULT/PERF_PIP + unduh PDF.
// Dwibahasa t() semua; mobile 375 tanpa h-scroll; loading/error state; a11y.
// ============================================================================
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Award, CheckCircle2, CircleDollarSign, FileDown, FileText, Layers, Loader2,
  Pencil, Plus, Search, Send, TrendingUp, XCircle, ClipboardList, CalendarClock,
} from "lucide-react";

// ---------- tipe (kontrak API §17 merit) ----------

interface MeritRow {
  id: string; docNo: string; status: string;
  appraisalId: string; appraisalNo: string;
  employeeId: string; employeeNo: string; fullName: string;
  unitName: string | null; managerName: string | null; positionName: string | null;
  finalScore: number | null; finalRating: number | null; potentialBand: number | null;
  ratingLabel: string | null; ratingLabelEn: string | null;
  bonusMonths: number | null; bonusAmount: number;
  raisePct: number | null; raiseAmount: number; baseSalary: number;
  totalAmount: number; note: string | null; matrixCode: string | null;
  personnelActionId: string | null; appliedRunNo: string | null;
  approval: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
  approvalSteps: { levelNo: number; approverLabel: string; status: string; note: string | null; decidedBy: string | null }[];
}
interface PipRow {
  appraisalId: string; docNo: string; finalScore: number | null; finalRating: number | null;
  ratingLabel: string | null; ratingLabelEn: string | null;
  employeeId: string; employeeNo: string; fullName: string; positionName: string | null; unitName: string | null;
  managerId: string | null; managerName: string | null;
  lowestKpis: { title: string; unit: string; target: number; finalActual: number | null; score: number; weight: number }[];
  activePip: boolean;
  /** keputusan "tidak dijalankan" terakhir (§32-5 — dari ActivityLog; boleh diputuskan ulang). */
  pipRejectedAt: string | null;
  pipRejectReason: string | null;
}
interface LetterRow {
  id: string; refNo: string; templateKey: string; subject: string | null; issuedAt: string;
  appraisalNo: string | null; pipDocNo: string | null; cycleId: string | null;
  employeeName: string; employeeNo: string;
}
interface BoardData {
  cycle: { id: string; code: string; name: string; status: string };
  structure: { code: string; levels: number };
  matrix: { id: string; code: string; name: string; grid: Record<string, { bonusMonths?: number; raisePct?: [number, number]; note?: string }> } | null;
  recommendations: MeritRow[];
  stats: { byStatus: Record<string, number>; totalBonus: number; totalRaise: number; totalAmount: number };
  candidates: { appraisalId: string; docNo: string; employeeNo: string; fullName: string; finalRating: number | null }[];
  pipCandidates: PipRow[];
  letters: LetterRow[];
  openRuns: { id: string; runNo: string; status: string; periodCode: string; periodName: string; processTypeCode: string; processTypeName: string }[];
  money: { canSee: boolean };
}

/** Tile status merit — triple [statusKey, labelID, labelEN] (konvensi R2 audit, dirender t(x[1], x[2])). */
const MERIT_STATUS_TILES: [string, string, string][] = [
  ["Draft", "Draf", "Draft"],
  ["Submitted", "Menunggu Persetujuan", "Awaiting Approval"],
  ["Approved", "Disetujui", "Approved"],
  ["Applied", "Diterapkan", "Applied"],
];

const RATING_COLORS: Record<number, string> = { 1: "#f43f5e", 2: "#f97316", 3: "#f59e0b", 4: "#14b8a6", 5: "#10b981" };
const MERIT_STATUS_TONE: Record<string, string> = {
  Draft: "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300",
  Submitted: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400",
  Approved: "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300",
  Applying: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300",
  Applied: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400",
  Rejected: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400",
  Cancelled: "border-slate-300 bg-slate-50 text-slate-400 line-through dark:border-slate-700 dark:bg-slate-900/60",
};

// ============================================================================
// HALAMAN (TAB — dipasang di performance-results.tsx)
// ============================================================================

export function PerformanceMeritPage({ cycleId }: { cycleId: string }) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const canMerit = perms.canOp("performance", "results", "merit");
  const canPip = perms.canOp("performance", "results", "pip");
  const api = useApi<BoardData>(`/api/rekankerja/performance/merit?cycleId=${cycleId}`, [cycleId]);

  const [massOpen, setMassOpen] = useState(false);
  const [massBusy, setMassBusy] = useState(false);
  const [lettersBusy, setLettersBusy] = useState(false);
  const [editing, setEditing] = useState<MeritRow | null>(null);
  const [deciding, setDeciding] = useState<MeritRow | null>(null);
  const [applying, setApplying] = useState<MeritRow | null>(null);
  const [paTarget, setPaTarget] = useState<MeritRow | null>(null);
  const [pipTarget, setPipTarget] = useState<PipRow | null>(null);
  const [noPipTarget, setNoPipTarget] = useState<PipRow | null>(null);
  const [issuing, setIssuing] = useState<string | null>(null);

  const board = api.data;

  const doRecommend = async () => {
    setMassBusy(true);
    try {
      const res = await apiSend<{ created: { docNo: string }[]; skippedExisting: unknown[]; skippedNoRating: unknown[]; noSalary: unknown[]; matrixCode: string }>(
        "/api/rekankerja/performance/merit", "POST", { action: "recommend", cycleId },
      );
      toast.success(t(
        `${res.created.length} usulan dibuat (matrix ${res.matrixCode}) — ${res.skippedExisting.length} sudah ada · ${res.skippedNoRating.length} tanpa rating · ${res.noSalary.length} tanpa gaji pokok`,
        `${res.created.length} recommendations created (matrix ${res.matrixCode}) — ${res.skippedExisting.length} already exist · ${res.skippedNoRating.length} unrated · ${res.noSalary.length} without base salary`,
      ));
      setMassOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setMassBusy(false); }
  };

  const doIssueLetters = async () => {
    setLettersBusy(true);
    try {
      const res = await apiSend<{ issued: unknown[]; skippedExisting: unknown[]; skippedNotClosed: unknown[] }>(
        "/api/rekankerja/performance/merit", "POST", { action: "issueLetters", cycleId },
      );
      toast.success(t(
        `Surat hasil: ${res.issued.length} terbit · ${res.skippedExisting.length} sudah ada · ${res.skippedNotClosed.length} belum Closed`,
        `Result letters: ${res.issued.length} issued · ${res.skippedExisting.length} already exist · ${res.skippedNotClosed.length} not closed yet`,
      ));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setLettersBusy(false); }
  };

  const doIssueOne = async (row: MeritRow) => {
    setIssuing(row.id);
    try {
      const res = await apiSend<{ issued: boolean; letter: { refNo: string } }>(
        "/api/rekankerja/performance/merit", "POST", { action: "issueLetter", appraisalId: row.appraisalId },
      );
      toast.success(t(
        `Surat hasil ${res.letter.refNo} ${res.issued ? "diterbitkan" : "sudah ada"} untuk ${row.fullName}`,
        `Result letter ${res.letter.refNo} ${res.issued ? "issued" : "already exists"} for ${row.fullName}`,
      ));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setIssuing(null); }
  };

  const doCancel = async (row: MeritRow) => {
    // PERF-AUD F-09 — pembatalan usulan yang SUDAH DISETUJUI wajib beralasan (≥10 kar).
    let reason: string | undefined;
    if (row.status === "Approved") {
      const input = window.prompt(t(
        "Alasan pembatalan usulan yang sudah disetujui (min. 10 karakter):",
        "Reason for cancelling the approved recommendation (min. 10 characters):",
      ));
      if (input == null) return; // batal dialog
      if (input.trim().length < 10) {
        toast.error(t("Alasan pembatalan minimal 10 karakter.", "Cancellation reason must be at least 10 characters."));
        return;
      }
      reason = input.trim();
    }
    try {
      await apiSend("/api/rekankerja/performance/merit", "POST", { action: "cancel", id: row.id, ...(reason ? { reason } : {}) });
      toast.success(t(`Usulan ${row.docNo} dibatalkan`, `Recommendation ${row.docNo} cancelled`));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  };

  const doSubmit = async (row: MeritRow) => {
    try {
      const res = await apiSend<{ levels: number; firstApprover: string | null; amount: number; needL2: boolean }>(
        "/api/rekankerja/performance/merit", "POST", { action: "submit", id: row.id },
      );
      toast.success(t(
        `${row.docNo} diajukan — ${res.levels} jenjang${res.needL2 ? " (Direktur aktif — nominal ≥ Rp 10 jt)" : ""}, menunggu ${res.firstApprover ?? "-"}`,
        `${row.docNo} submitted — ${res.levels} level(s)${res.needL2 ? " (Director active — amount ≥ Rp 10M)" : ""}, awaiting ${res.firstApprover ?? "-"}`,
      ));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  };

  return (
    <div className="space-y-5">
      {api.loading && !api.data && <LoadingRows rows={5} />}
      {api.error && !api.data && (
        <EmptyState title={t("Gagal memuat papan merit", "Failed to load merit board")} description={api.error} icon={AlertTriangle} />
      )}

      {board && (
        <>
          {/* ===== tile statistik ===== */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {MERIT_STATUS_TILES.map(([s, labelId, labelEn]) => (
              <div key={s} className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t(labelId, labelEn)}</p>
                <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">{board.stats.byStatus[s] ?? 0}</p>
              </div>
            ))}
            <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-500/30 dark:bg-teal-500/10">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-300"><CircleDollarSign className="h-3 w-3" /> {t("Total bonus", "Total bonus")}</p>
              <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-teal-700 dark:text-teal-200">{fmtIDR(board.stats.totalBonus)}</p>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300"><TrendingUp className="h-3 w-3" /> {t("Total kenaikan", "Total raise")}</p>
              <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-violet-700 dark:text-violet-200">{fmtIDR(board.stats.totalRaise)}</p>
            </div>
          </div>
          {!board.money.canSee && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              {t("Vault uang tertutup — nominal tampil Rp 0. Buka vault (kata sandi enkripsi) untuk melihat angka.", "Money vault is closed — amounts show Rp 0. Open the vault (encryption passphrase) to see figures.")}
            </p>
          )}

          {/* ===== SECTION: USULAN MERIT ===== */}
          <section aria-label={t("Usulan Merit", "Merit Recommendations")} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <Award className="h-3.5 w-3.5" /> {t("Usulan Merit", "Merit Recommendations")}
                <Badge variant="outline" className="rounded-full px-2 text-[10px]">{board.recommendations.length}</Badge>
              </h3>
              {board.matrix && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{board.matrix.code}</Badge>
              )}
              <div className="ml-auto flex flex-wrap gap-1.5">
                {canMerit && (board.candidates.length > 0 || board.recommendations.length === 0) && (
                  <Button size="sm" className="h-8 gap-1.5" onClick={() => setMassOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> {t("Buat Usulan Massal", "Bulk Create")}
                  </Button>
                )}
                {canMerit && (
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={lettersBusy} onClick={doIssueLetters}>
                    {lettersBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                    {t("Terbitkan Surat Massal", "Bulk Issue Letters")}
                  </Button>
                )}
              </div>
            </div>

            {board.recommendations.length === 0 ? (
              <EmptyState icon={Award}
                title={t("Belum ada usulan merit", "No merit recommendations yet")}
                description={board.matrix
                  ? t(
                    `Klik "Buat Usulan Massal" — draf otomatis dibuat untuk peserta Closed dari matrix ${board.matrix.code} (nominal = matrix × gaji pokok, tersimpan terenkripsi §32-1).`,
                    `Click "Bulk Create" — drafts are generated automatically for Closed participants from matrix ${board.matrix.code} (amount = matrix × base salary, stored encrypted §32-1).`,
                  )
                  : t("Aktifkan matrix merit di menu Master Kinerja dahulu (§35-17).", "Activate a merit matrix in the Masters menu first (§35-17).")} />
            ) : (
              <div className="space-y-1.5">
                {board.recommendations.map((r) => (
                  <MeritCard key={r.id} row={r} canMerit={canMerit}
                    onEdit={() => setEditing(r)} onDecide={() => setDeciding(r)} onApply={() => setApplying(r)} onPa={() => setPaTarget(r)}
                    onCancel={() => doCancel(r)} onSubmit={() => doSubmit(r)}
                    onIssue={() => doIssueOne(r)} issuing={issuing === r.id} />
                ))}
              </div>
            )}
          </section>

          {/* ===== SECTION: USUL PIP ===== */}
          <section aria-label={t("Usul PIP", "PIP Proposals")} className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <ClipboardList className="h-3.5 w-3.5" /> {t("Usul PIP (rating ≤ 2)", "PIP Proposals (rating ≤ 2)")}
              <Badge variant="outline" className="rounded-full px-2 text-[10px]">{board.pipCandidates.length}</Badge>
            </h3>
            {board.pipCandidates.length === 0 ? (
              <EmptyState icon={ClipboardList}
                title={t("Tidak ada kandidat PIP", "No PIP candidates")}
                description={t("Kandidat = peserta Closed dengan rating ≤ 2 tanpa PIP aktif (§35-20).", "Candidates = Closed participants rated ≤ 2 without an active PIP (§35-20).")} />
            ) : (
              <div className="space-y-1.5">
                {board.pipCandidates.map((p) => (
                  <PipCard key={p.appraisalId} row={p} canPip={canPip}
                    onRun={() => setPipTarget(p)} onDecline={() => setNoPipTarget(p)} />
                ))}
              </div>
            )}
          </section>

          {/* ===== SECTION: SURAT KINERJA ===== */}
          <section aria-label={t("Surat Kinerja", "Performance Letters")} className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <FileText className="h-3.5 w-3.5" /> {t("Surat Kinerja", "Performance Letters")}
              <Badge variant="outline" className="rounded-full px-2 text-[10px]">{board.letters.length}</Badge>
            </h3>
            {board.letters.length === 0 ? (
              <EmptyState icon={FileText}
                title={t("Belum ada surat", "No letters yet")}
                description={t("Surat Hasil Penilaian (PERF_RESULT) & SK PIP (PERF_PIP) yang diterbitkan tampil di sini.", "Issued Result Letters (PERF_RESULT) & PIP Decrees (PERF_PIP) appear here.")} />
            ) : (
              <div className="space-y-1.5">
                {board.letters.map((l) => (
                  <Card key={l.id} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
                    <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3">
                      <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]",
                        l.templateKey === "PERF_PIP" && "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400")}>
                        {l.templateKey === "PERF_PIP" ? t("SK PIP", "PIP Decree") : t("Surat Hasil", "Result Letter")}
                      </Badge>
                      <span className="font-mono text-[10px] text-slate-400">{l.refNo}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.employeeName} <span className="font-mono text-[10px] text-slate-400">{l.employeeNo}</span></p>
                        <p className="truncate text-[11px] text-slate-400">
                          {l.appraisalNo ? `${l.appraisalNo} · ` : ""}{l.pipDocNo ? `${l.pipDocNo} · ` : ""}{l.issuedAt.slice(0, 10)}
                        </p>
                      </div>
                      <a href={`/api/rekankerja/letters/${l.id}/pdf?download=1`} download>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]">
                          <FileDown className="h-3.5 w-3.5" /> PDF
                        </Button>
                      </a>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* ===== dialogs ===== */}
      {massOpen && board && (
        <MassRecommendDialog board={board} busy={massBusy} onClose={() => setMassOpen(false)} onDone={doRecommend} />
      )}
      {editing && (
        <PatchMeritDialog row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); api.refresh(); }} />
      )}
      {deciding && (
        <DecideMeritDialog row={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); api.refresh(); }} />
      )}
      {applying && board && (
        <ApplyMeritDialog row={applying} board={board} onClose={() => setApplying(null)} onDone={() => { setApplying(null); api.refresh(); }} />
      )}
      {paTarget && (
        <PaDialog row={paTarget} onClose={() => setPaTarget(null)} onDone={() => { setPaTarget(null); api.refresh(); }} />
      )}
      {pipTarget && (
        <RunPipDialog row={pipTarget} onClose={() => setPipTarget(null)} onDone={() => { setPipTarget(null); api.refresh(); }} />
      )}
      {noPipTarget && (
        <NoPipDialog row={noPipTarget} onClose={() => setNoPipTarget(null)} onDone={() => { setNoPipTarget(null); api.refresh(); }} />
      )}
    </div>
  );
}

// ============================================================================
// KARTU USULAN MERIT
// ============================================================================

function MeritCard({
  row, canMerit, onEdit, onDecide, onApply, onPa, onCancel, onSubmit, onIssue, issuing,
}: {
  row: MeritRow; canMerit: boolean;
  onEdit: () => void; onDecide: () => void; onApply: () => void; onPa: () => void;
  onCancel: () => void; onSubmit: () => void; onIssue: () => void; issuing: boolean;
}) {
  const { t, lang } = useI18n();
  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-mono text-[10px] text-slate-400">{row.docNo}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{row.fullName} <span className="font-mono text-[10px] text-slate-400">{row.employeeNo}</span></p>
            <p className="truncate text-[11px] text-slate-400">
              {row.unitName ?? "—"} · {row.appraisalNo} · {t("matrix", "matrix")} {row.matrixCode ?? "—"}
            </p>
          </div>
          {row.finalRating != null && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]" style={{ color: RATING_COLORS[row.finalRating] }}>
              {row.finalRating} · {lang === "en" ? (row.ratingLabelEn ?? row.ratingLabel) : row.ratingLabel}
            </Badge>
          )}
          <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px] font-semibold", MERIT_STATUS_TONE[row.status] ?? "")}>{row.status}</Badge>
        </div>

        <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900/60">
            <p className="text-[10px] font-semibold uppercase text-slate-400">{t("Bonus", "Bonus")}</p>
            <p className="font-mono font-semibold tabular-nums">{row.bonusMonths ?? 0} {t("bln", "mo")}</p>
            <p className="font-mono tabular-nums text-slate-500 dark:text-slate-400">{fmtIDR(row.bonusAmount)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900/60">
            <p className="text-[10px] font-semibold uppercase text-slate-400">{t("Kenaikan", "Raise")}</p>
            <p className="font-mono font-semibold tabular-nums">{row.raisePct ?? 0}%</p>
            <p className="font-mono tabular-nums text-slate-500 dark:text-slate-400">{fmtIDR(row.raiseAmount)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-900/60">
            <p className="text-[10px] font-semibold uppercase text-slate-400">{t("Total", "Total")}</p>
            <p className="font-mono font-semibold tabular-nums">{fmtIDR(row.totalAmount)}</p>
            <p className="text-[10px] text-slate-400">
              {row.appliedRunNo ? `→ ${row.appliedRunNo}` : row.personnelActionId ? "→ PA" : ""}
            </p>
          </div>
        </div>
        {row.note && (
          <p className="mt-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] italic text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">{row.note}</p>
        )}

        {/* kotak approval chain (Submitted) */}
        {row.status === "Submitted" && row.approvalSteps.length > 0 && (
          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-500/25 dark:bg-amber-500/5">
            <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              <Layers className="h-3 w-3" /> {t("Jalur persetujuan (tier nominal D12)", "Approval chain (amount tier D12)")}
            </p>
            <ol className="space-y-1">
              {row.approvalSteps.map((s) => (
                <li key={s.levelNo} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                    s.status === "Approved" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
                    s.status === "Current" && "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
                    s.status === "Waiting" && "bg-slate-100 text-slate-400 dark:bg-slate-800",
                    s.status === "Rejected" && "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400")}>
                    {s.status === "Approved" ? <CheckCircle2 className="h-2.5 w-2.5" /> : s.status === "Rejected" ? <XCircle className="h-2.5 w-2.5" /> : s.levelNo}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.approverLabel}</span>
                  <span className={cn("text-[10px] font-semibold",
                    s.status === "Current" && "text-amber-600 dark:text-amber-400",
                    s.status === "Approved" && "text-emerald-600 dark:text-emerald-400",
                    s.status === "Waiting" && "text-slate-400")}>{s.status}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* aksi per status */}
        {canMerit && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {row.status === "Draft" && (
              <>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> {t("Edit", "Edit")}</Button>
                <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={onSubmit}><Send className="h-3.5 w-3.5" /> {t("Ajukan", "Submit")}</Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] text-rose-600 dark:text-rose-400" onClick={onCancel}><XCircle className="h-3.5 w-3.5" /> {t("Batalkan", "Cancel")}</Button>
              </>
            )}
            {row.status === "Submitted" && (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={onDecide}>
                <CheckCircle2 className="h-3.5 w-3.5" /> {t("Putuskan Approval", "Decide Approval")}
              </Button>
            )}
            {row.status === "Approved" && (
              <>
                <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={onApply}><CircleDollarSign className="h-3.5 w-3.5" /> {t("Terapkan ke Payroll", "Apply to Payroll")}</Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={onPa}><TrendingUp className="h-3.5 w-3.5" /> {t("Buat PA", "Create PA")}</Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] text-rose-600 dark:text-rose-400" onClick={onCancel}><XCircle className="h-3.5 w-3.5" /> {t("Batalkan", "Cancel")}</Button>
              </>
            )}
            {(row.status === "Approved" || row.status === "Applied") && (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={issuing} onClick={onIssue}>
                {issuing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {t("Surat Hasil", "Result Letter")}
              </Button>
            )}
            {row.status === "Applied" && (
              <p className="flex w-full items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t(`Diterapkan ke run ${row.appliedRunNo ?? "—"}${row.personnelActionId ? " · PA dibuat" : ""}`, `Applied to run ${row.appliedRunNo ?? "—"}${row.personnelActionId ? " · PA created" : ""}`)}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// DIALOG: buat usulan massal
// ============================================================================

function MassRecommendDialog({ board, busy, onClose, onDone }: { board: BoardData; busy: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const ratings = Object.keys(board.matrix?.grid ?? {}).map(Number).sort((a, b) => b - a);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Award className="h-5 w-5 text-brand" /> {t("Buat Usulan Massal", "Bulk Create Recommendations")}</DialogTitle>
          <DialogDescription>
            {t(
              "Draf otomatis untuk peserta Closed dari matrix aktif. Nominal = matrix × gaji pokok (tersimpan terenkripsi vault enc:v1).",
              "Automatic drafts for Closed participants from the active matrix. Amount = matrix × base salary (stored encrypted in the vault).",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {board.matrix ? (
            <>
              <div className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
                <p className="text-[11px] font-semibold">{t("Matrix aktif", "Active matrix")}: {board.matrix.code} — {board.matrix.name}</p>
                <div className="mt-1.5 space-y-0.5">
                  {ratings.map((r) => {
                    const cell = board.matrix?.grid[String(r)];
                    if (!cell) return null;
                    return (
                      <p key={r} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono font-semibold" style={{ color: RATING_COLORS[r] ?? undefined }}>rating {r}</span>
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          {t("bonus", "bonus")} {cell.bonusMonths ?? 0} {t("bln", "mo")} · {t("raise", "raise")} {cell.raisePct ? `${cell.raisePct[0]}–${cell.raisePct[1]}%` : "0%"}
                        </span>
                      </p>
                    );
                  })}
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t(
                  `${board.candidates.length} kandidat Closed ber-rating akan dibuat; peserta yang sudah punya usulan / tanpa rating / tanpa gaji pokok dilaporkan (§35-17).`,
                  `${board.candidates.length} rated Closed candidates will be created; participants with an existing recommendation / unrated / without base salary are reported (§35-17).`,
                )}
              </p>
            </>
          ) : (
            <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {t("Matrix merit aktif tidak ditemukan — aktifkan di Master Kinerja (§35-17).", "No active merit matrix — activate one in Masters (§35-17).")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button disabled={busy || !board.matrix} onClick={onDone}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("Buat {n} Usulan", "Create {n} Drafts", { n: String(board.candidates.length) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DIALOG: patch draf (pratinjau nominal live)
// ============================================================================

function PatchMeritDialog({ row, onClose, onDone }: { row: MeritRow; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [bonusMonths, setBonusMonths] = useState(String(row.bonusMonths ?? 0));
  const [raisePct, setRaisePct] = useState(String(row.raisePct ?? 0));
  const [note, setNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);

  const bm = Number(bonusMonths) || 0;
  const rp = Number(raisePct) || 0;
  const pBonus = Math.round(bm * row.baseSalary);
  const pRaise = Math.round((row.baseSalary * rp) / 100);

  const submit = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/merit", "POST", {
        action: "patch", id: row.id,
        patch: { bonusMonths: bm, raisePct: rp, note: note.trim() || null },
      });
      toast.success(t(`Usulan ${row.docNo} diperbarui`, `Recommendation ${row.docNo} updated`));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5 text-brand" /> {t("Edit Usulan {no}", "Edit Recommendation {no}", { no: row.docNo })}</DialogTitle>
          <DialogDescription>
            {t(`${row.fullName} · rating ${row.finalRating ?? "—"} · gaji pokok ${fmtIDR(row.baseSalary)} (dasar hitung nominal).`, `${row.fullName} · rating ${row.finalRating ?? "—"} · base salary ${fmtIDR(row.baseSalary)} (amount basis).`)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="pm-bonus">{t("Bonus (bulan)", "Bonus (months)")}</Label>
              <Input id="pm-bonus" type="number" min={0} max={24} step={0.5} inputMode="decimal" value={bonusMonths}
                onChange={(e) => setBonusMonths(e.target.value)} aria-label={t("Bonus bulan", "Bonus months")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="pm-raise">{t("Kenaikan (%)", "Raise (%)")}</Label>
              <Input id="pm-raise" type="number" min={0} max={100} step={0.5} inputMode="decimal" value={raisePct}
                onChange={(e) => setRaisePct(e.target.value)} aria-label={t("Kenaikan persen", "Raise percent")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="pm-note">{t("Catatan", "Note")}</Label>
            <Textarea id="pm-note" className="min-h-16 text-xs" value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("Catatan usulan", "Recommendation note")} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-[11px] dark:border-slate-800 dark:bg-slate-900/60">
            <p className="mb-1 font-semibold text-slate-500 dark:text-slate-400">{t("Pratinjau nominal (vault enc:v1 saat disimpan)", "Amount preview (stored vault enc:v1)")}</p>
            <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
              <span>{t("bonus", "bonus")}:<br /><b>{fmtIDR(pBonus)}</b></span>
              <span>{t("raise", "raise")}:<br /><b>{fmtIDR(pRaise)}</b></span>
              <span>{t("total", "total")}:<br /><b>{fmtIDR(pBonus + pRaise)}</b></span>
            </div>
            {pBonus + pRaise >= 10_000_000 && (
              <p className="mt-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                {t("Total ≥ Rp 10 jt — jenjang Direktur aktif saat diajukan (D12).", "Total ≥ Rp 10M — Director level activates on submit (D12).")}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t("Simpan", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DIALOG: keputusan approval (Setujui / Tolak)
// ============================================================================

function DecideMeritDialog({ row, onClose, onDone }: { row: MeritRow; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const decide = async (action: "approve" | "reject") => {
    setBusy(action);
    try {
      const res = await apiSend<{ status: string; final: boolean }>(
        "/api/rekankerja/performance/merit", "POST",
        { action, id: row.id, note: note.trim() || null },
      );
      toast.success(t(
        `${row.docNo}: ${res.status}${res.final ? (action === "approve" ? " — disetujui penuh" : " — kembali ke Draft") : " — lanjut jenjang berikutnya"}`,
        `${row.docNo}: ${res.status}${res.final ? (action === "approve" ? " — fully approved" : " — back to Draft") : " — next level"}`,
      ));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(null); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="h-5 w-5 text-brand" /> {t("Keputusan Usulan {no}", "Decision for {no}", { no: row.docNo })}</DialogTitle>
          <DialogDescription>
            {t(
              `${row.fullName} · total ${fmtIDR(row.totalAmount)} — keputusan jenjang divalidasi engine (approver berhak / OWNER-ADMIN-HR). Tolak → kembali ke Draft.`,
              `${row.fullName} · total ${fmtIDR(row.totalAmount)} — level decisions are validated by the engine (authorized approver / OWNER-ADMIN-HR). Reject → back to Draft.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ol className="space-y-1">
            {row.approvalSteps.map((s) => (
              <li key={s.levelNo} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] dark:border-slate-800">
                <Badge variant="outline" className="h-4 px-1 text-[9px]">L{s.levelNo}</Badge>
                <span className="min-w-0 flex-1 truncate">{s.approverLabel}</span>
                <StatusPill status={s.status === "Current" ? "Submitted" : s.status} />
              </li>
            ))}
          </ol>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="dc-note">{t("Catatan keputusan (wajib bila menolak)", "Decision note (required when rejecting)")}</Label>
            <Textarea id="dc-note" className="min-h-14 text-xs" value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("Catatan keputusan", "Decision note")} />
          </div>
        </div>
        <DialogFooter className="flex-row flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
          <Button variant="destructive" disabled={busy != null} onClick={() => decide("reject")}>
            {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} {t("Tolak", "Reject")}
          </Button>
          <Button disabled={busy != null} onClick={() => decide("approve")}>
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t("Setujui", "Approve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DIALOG: terapkan ke payroll (centang bonus/raise + run target)
// ============================================================================

function ApplyMeritDialog({ row, board, onClose, onDone }: { row: MeritRow; board: BoardData; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [includeBonus, setIncludeBonus] = useState(row.bonusAmount > 0);
  const [includeRaise, setIncludeRaise] = useState(row.raiseAmount > 0);
  const [busy, setBusy] = useState(false);
  const bonusRuns = board.openRuns.filter((r) => r.processTypeCode === "BONUS");
  const salaryRuns = board.openRuns.filter((r) => r.processTypeCode === "SALARY");
  const bonusRun = bonusRuns[0] ?? null;
  const salaryRun = salaryRuns[0] ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ period: { name: string }; bonusRun: { runNo: string } | null; raiseRun: { runNo: string } | null }>(
        "/api/rekankerja/performance/merit", "POST",
        { action: "apply", id: row.id, includeBonus, includeRaise },
      );
      toast.success(t(
        `${row.docNo} diterapkan ke ${res.period.name} — run ${res.bonusRun?.runNo ?? res.raiseRun?.runNo ?? "-"} menyerap usulan`,
        `${row.docNo} applied to ${res.period.name} — run ${res.bonusRun?.runNo ?? res.raiseRun?.runNo ?? "-"} absorbs the recommendation`,
      ));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-brand" /> {t("Terapkan ke Payroll — {no}", "Apply to Payroll — {no}", { no: row.docNo })}</DialogTitle>
          <DialogDescription>
            {t(
              "Nominal diinjeksikan sebagai komponen spesifik period terbuka (§35-18 — sekali saja). Bonus → run BONUS komponen BONUS; kenaikan → run SALARY komponen RAPEL (satu kali; kenaikan permanen = jalur PA).",
              "Amounts are injected as period-specific components (§35-18 — once only). Bonus → BONUS run, BONUS component; raise → SALARY run, RAPEL component (one-off; permanent increase goes through PA).",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-[12px] dark:border-slate-800">
            <Checkbox className="mt-0.5" checked={includeBonus} disabled={row.bonusAmount <= 0}
              onCheckedChange={(v) => setIncludeBonus(v === true)} aria-label={t("Terapkan bonus", "Apply bonus")} />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{t("Bonus", "Bonus")}</span> — <span className="font-mono">{row.bonusMonths ?? 0} {t("bln", "mo")} · {fmtIDR(row.bonusAmount)}</span>
              <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                {bonusRun
                  ? t(`→ run ${bonusRun.runNo} (${bonusRun.periodName} · ${bonusRun.status})`, `→ run ${bonusRun.runNo} (${bonusRun.periodName} · ${bonusRun.status})`)
                  : t("→ run BONUS akan dibuat + dihitung otomatis", "→ BONUS run will be created + calculated automatically")}
                {" "}· {t("komponen BONUS", "BONUS component")}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-[12px] dark:border-slate-800">
            <Checkbox className="mt-0.5" checked={includeRaise} disabled={row.raiseAmount <= 0}
              onCheckedChange={(v) => setIncludeRaise(v === true)} aria-label={t("Terapkan kenaikan", "Apply raise")} />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{t("Kenaikan", "Raise")}</span> — <span className="font-mono">{row.raisePct ?? 0}% · {fmtIDR(row.raiseAmount)}</span>
              <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                {salaryRun
                  ? t(`→ run ${salaryRun.runNo} (${salaryRun.periodName} · ${salaryRun.status})`, `→ run ${salaryRun.runNo} (${salaryRun.periodName} · ${salaryRun.status})`)
                  : t("→ run SALARY akan dibuat + dihitung otomatis", "→ SALARY run will be created + calculated automatically")}
                {" "}· {t("komponen RAPEL", "RAPEL component")}
              </span>
            </span>
          </label>
          {row.bonusAmount + row.raiseAmount >= 10_000_000 && (
            <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
              {t("Total ≥ Rp 10 jt — sudah melewati jenjang Direktur (D12) saat approval.", "Total ≥ Rp 10M — already past the Director level (D12) at approval.")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button disabled={busy || (!includeBonus && !includeRaise) || (row.bonusAmount <= 0 && row.raiseAmount <= 0)} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />} {t("Terapkan", "Apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DIALOG: buat Personnel Action (SalaryAdjustment / Promotion)
// ============================================================================

function PaDialog({ row, onClose, onDone }: { row: MeritRow; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [type, setType] = useState<"SalaryAdjustment" | "Promotion">("SalaryAdjustment");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const newSalary = Math.round(row.baseSalary * (1 + (row.raisePct ?? 0) / 100));
  const promoOk = (row.finalRating ?? 0) >= 4 && row.potentialBand === 3;
  const needForce = type === "Promotion" && !promoOk;

  const submit = async () => {
    if (needForce && !reason.trim()) {
      toast.error(t("Override direksi memerlukan alasan (§35-19)", "A director override requires a reason (§35-19)"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; override: boolean }>(
        "/api/rekankerja/performance/merit", "POST",
        { action: "toPersonnelAction", id: row.id, type, effectiveDate, force: needForce && force, reason: reason.trim() || null },
      );
      toast.success(t(
        `PA ${res.docNo} (${type}) dibuat — status Prepared${res.override ? " (override direksi ter-log)" : ""}`,
        `PA ${res.docNo} (${type}) created — Prepared${res.override ? " (director override logged)" : ""}`,
      ));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-brand" /> {t("Buat Personnel Action — {no}", "Create Personnel Action — {no}", { no: row.docNo })}</DialogTitle>
          <DialogDescription>
            {t(
              "Draft PA digulirkan dari usulan merit (§32-3b) — diproses lewat modul Personnel Action, bukan bypass. PA duplikat aktif ditolak (§35-19).",
              "A PA draft is raised from the merit recommendation (§32-3b) — processed through the Personnel Action module, not a bypass. Duplicate active PAs are rejected (§35-19).",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("Jenis PA", "PA type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v === "Promotion" ? "Promotion" : "SalaryAdjustment")}>
                <SelectTrigger className="text-xs" aria-label={t("Jenis PA", "PA type")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SalaryAdjustment">{t("Penyesuaian Gaji", "Salary Adjustment")}</SelectItem>
                  <SelectItem value="Promotion">{t("Promosi", "Promotion")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="pa-date">{t("Tanggal efektif", "Effective date")}</Label>
              <Input id="pa-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} aria-label={t("Tanggal efektif", "Effective date")} />
            </div>
          </div>

          {type === "SalaryAdjustment" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-[11px] dark:border-slate-800 dark:bg-slate-900/60">
              <p className="font-mono tabular-nums">
                {t("Gaji baru", "New salary")}: <b>{fmtIDR(newSalary)}</b> ({t("dari", "from")} {fmtIDR(row.baseSalary)} · +{row.raisePct ?? 0}%)
              </p>
              <p className="mt-0.5 text-slate-500 dark:text-slate-400">{t("Divalidasi terhadap rentang grade (M-05/M-06).", "Validated against the grade range (M-05/M-06).")}</p>
            </div>
          ) : (
            <div className={cn("rounded-xl border p-2.5 text-[11px]",
              promoOk
                ? "border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400")}>
              <p className="font-semibold">{t("Syarat promosi", "Promotion requirements")}</p>
              <p className="mt-0.5">
                {t(`Rating ${row.finalRating ?? "—"} (wajib ≥ 4) · potentialBand ${row.potentialBand ?? "—"} (wajib 3)`, `Rating ${row.finalRating ?? "—"} (requires ≥ 4) · potentialBand ${row.potentialBand ?? "—"} (requires 3)`)}
                {" — "}
                {promoOk
                  ? t("terpenuhi", "met")
                  : t("BELUM terpenuhi — hanya override direksi (superAdmin + alasan, ter-log §35-19)", "NOT met — director override only (superAdmin + reason, logged §35-19)")}
              </p>
              {!promoOk && (
                <label className="mt-1.5 flex items-center gap-2 font-medium">
                  <Checkbox checked={force} onCheckedChange={(v) => setForce(v === true)} aria-label={t("Override direksi", "Director override")} />
                  {t("Override direksi (alasan wajib)", "Director override (reason required)")}
                </label>
              )}
            </div>
          )}
          {needForce && (
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="pa-reason">{t("Alasan override (wajib)", "Override reason (required)")}</Label>
              <Textarea id="pa-reason" className="min-h-14 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("Alasan override", "Override reason")} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button disabled={busy || (needForce && !(force && reason.trim()))} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />} {t("Buat PA (Prepared)", "Create PA (Prepared)")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// KARTU + DIALOG USUL PIP
// ============================================================================

function PipCard({ row, canPip, onRun, onDecline }: { row: PipRow; canPip: boolean; onRun: () => void; onDecline: () => void }) {
  const { t, lang } = useI18n();
  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-mono text-[10px] text-slate-400">{row.docNo}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{row.fullName} <span className="font-mono text-[10px] text-slate-400">{row.employeeNo}</span></p>
            <p className="truncate text-[11px] text-slate-400">{row.positionName ?? "—"} · {row.unitName ?? "—"} · {t("atasan", "manager")}: {row.managerName ?? "—"}</p>
          </div>
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]" style={{ color: RATING_COLORS[row.finalRating ?? 1] }}>
            {row.finalRating ?? "—"} · {lang === "en" ? (row.ratingLabelEn ?? row.ratingLabel) : row.ratingLabel}
          </Badge>
          <div className="text-right">
            <p className="font-mono text-sm font-semibold tabular-nums">{row.finalScore ?? "—"}</p>
            <p className="text-[10px] text-slate-400">{t("final", "final")}</p>
          </div>
        </div>
        {row.lowestKpis.length > 0 && (
          <div className="mt-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("3 KPI terendah (prefill target PIP)", "3 lowest KPIs (PIP target prefill)")}</p>
            <ul className="space-y-0.5">
              {row.lowestKpis.map((k) => (
                <li key={k.title} className="flex flex-wrap items-center gap-x-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate">{k.title}</span>
                  <span className="font-mono text-slate-400">{t("target", "target")} {k.target}{k.unit ? ` ${k.unit}` : ""}</span>
                  <Badge variant="outline" className="h-4 px-1 text-[9px]" style={{ color: k.score < 60 ? "#f43f5e" : "#f59e0b" }}>{k.score}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
        {row.pipRejectedAt && (
          <div className="mt-1.5 rounded-lg border border-amber-300/60 bg-amber-50/80 px-2 py-1.5 dark:border-amber-500/30 dark:bg-amber-500/10" role="status">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              {t("PIP tidak dijalankan", "PIP not run")} · {new Date(row.pipRejectedAt).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID")}
            </p>
            {row.pipRejectReason && <p className="mt-0.5 text-[11px] leading-snug text-amber-800/90 dark:text-amber-300/90">{row.pipRejectReason}</p>}
            <p className="mt-0.5 text-[10px] text-amber-600/80 dark:text-amber-400/70">{t("Keputusan dapat diubah — jalankan bila kondisi berubah.", "Decision can be changed — run it if circumstances change.")}</p>
          </div>
        )}
        {canPip && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={onRun}>
              <CalendarClock className="h-3.5 w-3.5" /> {t("Jalankan PIP", "Run PIP")}
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] text-rose-600 dark:text-rose-400" onClick={onDecline}>
              <XCircle className="h-3.5 w-3.5" /> {t("Tidak Dijalankan", "Do Not Run")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TargetDraft { title: string; metric: string; target: string; weight: string }

function RunPipDialog({ row, onClose, onDone }: { row: PipRow; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [months, setMonths] = useState("2");
  const [reviewerId, setReviewerId] = useState(row.managerId ?? "");
  const [reviewerName, setReviewerName] = useState(row.managerName ?? "");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<TargetDraft[]>(
    row.lowestKpis.map((k) => ({ title: k.title, metric: k.unit, target: String(k.target), weight: "" })),
  );
  const results = useApi<{ employees: { id: string; employeeNo: string; fullName: string }[] }>(
    q.length >= 2 ? `/api/rekankerja/employees?q=${encodeURIComponent(q)}&limit=8&status=Active` : null, [q],
  );

  const endDatePreview = (() => {
    const d = new Date(startDate);
    const m = Number(months) || 2;
    d.setMonth(d.getMonth() + m);
    return isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
  })();

  const setTarget = (i: number, key: keyof TargetDraft, v: string) => {
    setTargets((ts) => ts.map((t, j) => (j === i ? { ...t, [key]: v } : t)));
  };

  const submit = async () => {
    const valid = targets.filter((x) => x.title.trim());
    if (valid.length < 3 || valid.length > 5) {
      toast.error(t("Target PIP harus 3–5 baris berjudul", "PIP targets must be 3–5 titled rows"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ pip: { docNo: string }; letter: { refNo: string } }>(
        "/api/rekankerja/performance/merit", "POST",
        {
          action: "pipDecide", appraisalId: row.appraisalId, run: true,
          input: {
            startDate, months: Number(months), reviewerId: reviewerId || undefined,
            targets: valid.map((x) => ({ title: x.title.trim(), metric: x.metric.trim(), target: x.target.trim(), weight: x.weight ? Number(x.weight) : undefined })),
          },
        },
      );
      toast.success(t(
        `PIP ${res.pip.docNo} dibuat (Draft 30/60/90 hari) + SK PIP ${res.letter.refNo} terbit — pembina dinotifikasi`,
        `PIP ${res.pip.docNo} created (Draft 30/60/90 days) + PIP decree ${res.letter.refNo} issued — reviewer notified`,
      ));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-brand" /> {t("Jalankan PIP — {name}", "Run PIP — {name}", { name: row.fullName })}</DialogTitle>
          <DialogDescription>
            {t(
              "PipPlan dibuat status Draft (aktivasi/approval = fase berikutnya) + checkpoint 30/60/90 hari + SK PIP terbit otomatis (§32-5).",
              "A Draft PipPlan is created (activation/approval = next phase) + 30/60/90-day checkpoints + the PIP decree is issued automatically (§32-5).",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="pip-start">{t("Mulai", "Start")}</Label>
              <Input id="pip-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label={t("Tanggal mulai", "Start date")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Durasi (D7)", "Duration (D7)")}</Label>
              <Select value={months} onValueChange={setMonths}>
                <SelectTrigger className="text-xs" aria-label={t("Durasi bulan", "Duration months")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3].map((m) => <SelectItem key={m} value={String(m)}>{t(`${m} bulan`, `${m} month${m > 1 ? "s" : ""}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Selesai (perkiraan)", "End (approx.)")}</Label>
              <p className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs dark:border-slate-800">{endDatePreview}</p>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t("Pembina (atasan penilai default)", "Reviewer (default: appraising manager)")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-8 text-xs" placeholder={t("Cari pembina lain (opsional)…", "Search another reviewer (optional)…")}
                value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Cari pembina", "Search reviewer")} />
            </div>
            {q.length >= 2 && (results.data?.employees ?? []).length > 0 && (
              <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5 dark:border-slate-800">
                {results.data?.employees.map((e) => (
                  <button key={e.id} onClick={() => { setReviewerId(e.id); setReviewerName(e.fullName); setQ(""); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <Plus className="h-3 w-3 shrink-0 text-brand" />
                    <span className="font-mono text-[10px] text-slate-400">{e.employeeNo}</span>
                    <span className="min-w-0 flex-1 truncate">{e.fullName}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {reviewerId ? t(`Pembina: ${reviewerName}`, `Reviewer: ${reviewerName}`) : t("Belum dipilih — atasan snapshot dipakai", "Not selected — the snapshot manager is used")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("Target PIP (3–5 baris — prefill 3 KPI terendah)", "PIP targets (3–5 rows — prefilled with 3 lowest KPIs)")}</Label>
            {targets.map((x, i) => (
              <div key={i} className="grid grid-cols-[1fr_84px_84px_56px] gap-1.5">
                <Input className="h-8 text-xs" placeholder={t("Sasaran", "Target title")} value={x.title}
                  onChange={(e) => setTarget(i, "title", e.target.value)} aria-label={t("Sasaran {n}", "Target title {n}", { n: String(i + 1) })} />
                <Input className="h-8 text-xs" placeholder={t("metrik", "metric")} value={x.metric}
                  onChange={(e) => setTarget(i, "metric", e.target.value)} aria-label={t("Metrik {n}", "Metric {n}", { n: String(i + 1) })} />
                <Input className="h-8 text-xs" placeholder={t("nilai", "value")} value={x.target}
                  onChange={(e) => setTarget(i, "target", e.target.value)} aria-label={t("Nilai target {n}", "Target value {n}", { n: String(i + 1) })} />
                <Input className="h-8 text-xs" placeholder="%" inputMode="decimal" value={x.weight}
                  onChange={(e) => setTarget(i, "weight", e.target.value)} aria-label={t("Bobot {n}", "Weight {n}", { n: String(i + 1) })} />
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {targets.length < 5 && (
                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setTargets([...targets, { title: "", metric: "", target: "", weight: "" }])}>
                  <Plus className="h-3.5 w-3.5" /> {t("Tambah baris", "Add row")}
                </Button>
              )}
              {targets.length > 3 && (
                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] text-rose-600 dark:text-rose-400" onClick={() => setTargets(targets.slice(0, -1))}>
                  <XCircle className="h-3.5 w-3.5" /> {t("Hapus baris", "Remove row")}
                </Button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} {t("Buat PIP + SK", "Create PIP + Decree")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoPipDialog({ row, onClose, onDone }: { row: PipRow; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      toast.error(t("Alasan wajib diisi (§32-5)", "A reason is required (§32-5)"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/merit", "POST",
        { action: "pipDecide", appraisalId: row.appraisalId, run: false, reason: reason.trim() });
      toast.success(t(`Usul PIP ${row.fullName} ditolak — alasan ter-catat`, `PIP proposal for ${row.fullName} declined — reason recorded`));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><XCircle className="h-5 w-5 text-rose-500" /> {t("Tidak Menjalankan PIP — {name}", "Do Not Run PIP — {name}", { name: row.fullName })}</DialogTitle>
          <DialogDescription>
            {t(
              "Keputusan TIDAK menjalankan Alur 9 untuk usulan ini. Alasan WAJIB dan ter-ActivityLog (§32-5).",
              "Decision NOT to run Flow 9 for this proposal. A reason is REQUIRED and is logged in the activity trail (§32-5).",
            )}
          </DialogDescription>
        </DialogHeader>
        <Textarea className="min-h-20 text-xs" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={t("mis. sedang program pengembangan lain; mutasi; kesepakatan lain dengan atasan…", "e.g. undergoing another development program; transfer; other agreement with the manager…")}
          aria-label={t("Alasan penolakan", "Decline reason")} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} {t("Catat Penolakan", "Record Decline")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
