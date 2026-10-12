"use client";
// RekanKerja ESS F3 — Seleksi Saya (padanan RekanKerja MySelectionProcess §2.10):
// tahapan seleksi yang sedang/akan dijalani karyawan sebagai kandidat INTERNAL
// modul Rekrutmen. Tiap proses = kartu PR: header (prNo + posisi + badge status
// kandidat) + blok "Tahap Aktif" (jadwal, SLA overdue, evaluator, tipe hasil,
// nomor surat undangan, tombol ack jadwal sendiri) + timeline vertikal semua
// tahap (status pill, tanggal, skor/hasil, komentar evaluator, badge ack).
import { useState } from "react";
import { toast } from "sonner";
import {
  ListChecks, AlarmClock, CalendarClock, UserRound, ClipboardCheck, MailCheck,
  CheckCircle2, Loader2, CircleDot, Gauge,
} from "lucide-react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ESS_BASE } from "./ess-api";

// ---------- tipe lokal (mirror kontrak GET /ess/my-selection — pola F2 UI) ----------

interface SelStep {
  id: string;
  stageName: string;
  planDate: string | null;
  performedAt: string | null;
  status: "Planned" | "Acknowledged" | "Performed" | "Passed" | "Failed" | "Cancelled";
  score: number | null;
  result: string | null;
  comment: string | null;
  needAck: boolean;
  acknowledgedAt: string | null;
  evaluatorName: string | null;
  invitationLetterNo: string | null;
}

interface SelCurrentStep extends SelStep {
  dueDate: string | null;
  overdue: boolean;
  resultType: string | null;
  minResultPass: number | null;
}

interface SelProcess {
  id: string;
  status: "Nominated" | "InProcess" | "Passed" | "Failed" | "Withdrawn";
  source: string;
  prNo: string;
  positionTitle: string | null;
  nominatedAt: string;
  note: string | null;
  currentStep: SelCurrentStep | null;
  steps: SelStep[];
}

interface MySelectionResp { processes: SelProcess[] }

// ---------- label & warna (tanpa indigo/blue — pola warna ess-pr) ----------

/** Badge status kandidat: Nominated slate, InProcess amber, Passed emerald, Failed rose, Withdrawn abu. */
const CAND_STATUS: Record<string, { id: string; en: string; cls: string; dot: string }> = {
  Nominated: {
    id: "Dinominasikan", en: "Nominated",
    cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
    dot: "bg-slate-400",
  },
  InProcess: {
    id: "Proses Seleksi", en: "In Process",
    cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
    dot: "bg-amber-500",
  },
  Passed: {
    id: "Lulus Seleksi", en: "Passed",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
    dot: "bg-emerald-500",
  },
  Failed: {
    id: "Tidak Lulus", en: "Failed",
    cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
    dot: "bg-rose-500",
  },
  Withdrawn: {
    id: "Ditarik", en: "Withdrawn",
    cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-500 dark:border-slate-500/25",
    dot: "bg-slate-400",
  },
};

/** Pill status tahap: terminal Passed emerald / Failed rose / Cancelled abu (nama coret). */
const STEP_STATUS: Record<string, { id: string; en: string; cls: string; dot: string }> = {
  Planned: {
    id: "Direncanakan", en: "Planned",
    cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
    dot: "bg-slate-400",
  },
  Acknowledged: {
    id: "Dikonfirmasi", en: "Acknowledged",
    cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
    dot: "bg-amber-500",
  },
  Performed: {
    id: "Dilaksanakan", en: "Performed",
    cls: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/25",
    dot: "bg-violet-500",
  },
  Passed: {
    id: "Lulus", en: "Passed",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
    dot: "bg-emerald-500",
  },
  Failed: {
    id: "Gagal", en: "Failed",
    cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
    dot: "bg-rose-500",
  },
  Cancelled: {
    id: "Dibatalkan", en: "Cancelled",
    cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-500 dark:border-slate-500/25",
    dot: "bg-slate-400",
  },
};

function candStatusOf(s: string) {
  return CAND_STATUS[s] ?? { id: s, en: s, cls: CAND_STATUS.Nominated.cls, dot: "bg-slate-400" };
}
function stepStatusOf(s: string) {
  return STEP_STATUS[s] ?? { id: s, en: s, cls: STEP_STATUS.Planned.cls, dot: "bg-slate-400" };
}

// ---------- helper format ----------

/** Tanggal panjang + jam sesuai locale aktif ("Minggu, 12 Oktober 2026 · 08.00"). */
function fmtLongDateTime(v: string | null, locale: "id-ID" | "en-US"): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return `${new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d)} · ${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d)}`;
}

function fmtShortDate(v: string | null, locale: "id-ID" | "en-US"): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

/** Selisih hari keterlambatan SLA (min. 1 — overdue berarti sudah lewat). */
function overdueDays(due: string): number {
  const ms = Date.now() - new Date(due).getTime();
  return Math.max(1, Math.floor(ms / 86_400_000));
}

// ---------- sub-komponen kecil ----------

function Pill({ s }: { s: { id: string; en: string; cls: string; dot: string } }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {t(s.id, s.en)}
    </span>
  );
}

/** Badge hijau "Dikonfirmasi" — tahap sudah di-ack kandidat (client-side render). */
function AckBadge() {
  const { t } = useI18n();
  return (
    <span
      title={t("Anda telah mengonfirmasi jadwal tahap ini", "You confirmed this stage's schedule")}
      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
    >
      <CheckCircle2 className="h-3 w-3" aria-hidden /> {t("Ack", "Ack")}
    </span>
  );
}

// ---------- halaman utama ----------

export function EssMySelectionPage() {
  const { t, locale } = useI18n();
  const api = useApi<MySelectionResp>(`${ESS_BASE}/my-selection`, [ESS_BASE]);
  const [busy, setBusy] = useState(false);

  const processes = api.data?.processes ?? [];

  /** POST {stepId} — konfirmasi jadwal tahap sendiri (server guard status Planned). */
  const ack = async (stepId: string) => {
    setBusy(true);
    try {
      await apiSend(`${ESS_BASE}/my-selection`, "POST", { stepId });
      toast.success(t("Jadwal dikonfirmasi", "Schedule confirmed"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengonfirmasi jadwal", "Failed to confirm the schedule"));
      api.refresh(); // sinkronkan kondisi terbaru (mis. sudah pernah di-ack)
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={t("ESS · Rekrutmen")}
        title={t("Seleksi Saya", "My Selection")}
        description={t(
          "Tahapan seleksi yang sedang/akan Anda jalani sebagai kandidat internal — padanan My Selection Process RekanKerja.",
          "The selection stages you are currently/scheduled to go through as an internal candidate — the RekanKerja My Selection Process counterpart.",
        )}
      />

      {api.loading && !api.data ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-4"><LoadingRows rows={4} /></CardContent>
        </Card>
      ) : api.error ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-4">
            <EmptyState title={t("Gagal memuat proses seleksi Anda", "Failed to load your selection processes")} description={api.error} />
          </CardContent>
        </Card>
      ) : processes.length === 0 ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-4">
            <EmptyState
              icon={ListChecks}
              title={t("Belum ada proses seleksi", "No selection processes yet")}
              description={t(
                "Anda belum dinominasikan sebagai kandidat internal.",
                "You have not been nominated as an internal candidate yet.",
              )}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {processes.map((p) => {
            const cand = candStatusOf(p.status);
            const cur = p.currentStep;
            return (
              <Card key={p.id} className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardContent className="p-4 sm:p-5">
                  {/* ===== header proses ===== */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-xs font-semibold">{p.prNo}</span>
                      <Pill s={cand} />
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {t("Dinominasikan", "Nominated")} {fmtShortDate(p.nominatedAt, locale) ?? "—"}
                      {p.source === "Internal" ? ` · ${t("Kandidat Internal", "Internal Candidate")}` : ""}
                    </span>
                  </div>
                  <div className="mt-1.5 text-sm font-semibold">{p.positionTitle ?? "—"}</div>
                  {p.note && <p className="mt-1 text-[11.5px] italic text-slate-400">{p.note}</p>}

                  {/* ===== blok Tahap Aktif ===== */}
                  {cur ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        <CircleDot className="h-3 w-3" aria-hidden /> {t("Tahap Aktif", "Current Stage")}
                      </p>
                      <p className="mt-1.5 text-base font-bold text-slate-900 dark:text-slate-50">{cur.stageName}</p>
                      <div className="mt-2 space-y-1.5 text-[12px] text-slate-600 dark:text-slate-300">
                        {/* jadwal */}
                        <p className="flex flex-wrap items-center gap-1.5">
                          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                          <span className="font-semibold">{t("Jadwal", "Schedule")}:</span>
                          {fmtLongDateTime(cur.planDate, locale) ?? <span className="italic text-slate-400">{t("belum dijadwalkan", "not scheduled yet")}</span>}
                        </p>
                        {/* batas SLA */}
                        {cur.dueDate && (
                          <p className={cn("flex flex-wrap items-center gap-1.5 font-semibold", cur.overdue ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300")}>
                            <AlarmClock className={cn("h-3.5 w-3.5 shrink-0", cur.overdue ? "text-rose-500" : "text-slate-400")} aria-hidden />
                            <span>{t("Batas SLA", "SLA Deadline")}:</span> {fmtLongDateTime(cur.dueDate, locale)}
                            {cur.overdue && (
                              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400">
                                {t("terlambat {n} hari", "{n} days overdue", { n: overdueDays(cur.dueDate) })}
                              </span>
                            )}
                          </p>
                        )}
                        {/* evaluator */}
                        <p className="flex flex-wrap items-center gap-1.5">
                          <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                          <span className="font-semibold">{t("Evaluator", "Evaluator")}:</span> {cur.evaluatorName ?? t("belum ditentukan", "not assigned yet")}
                        </p>
                        {/* tipe hasil + kelulusan min */}
                        {cur.resultType && (
                          <p className="flex flex-wrap items-center gap-1.5">
                            <Gauge className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                            <span className="font-semibold">{t("Tipe hasil", "Result type")}:</span>
                            {cur.resultType === "Quantitative" ? t("Kuantitatif", "Quantitative") : cur.resultType === "Qualitative" ? t("Kualitatif", "Qualitative") : cur.resultType}
                            {cur.minResultPass != null ? ` · ${t("kelulusan min.", "min. pass")} ${cur.minResultPass}` : ""}
                          </p>
                        )}
                        {/* nomor surat undangan */}
                        {cur.invitationLetterNo && (
                          <p className="flex flex-wrap items-center gap-1.5">
                            <MailCheck
                              className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                              aria-hidden
                              aria-label={t("surat undangan seleksi", "selection invitation letter")}
                            />
                            <span className="font-semibold" title={t("surat undangan seleksi", "selection invitation letter")}>{t("Undangan", "Invitation")}:</span>
                            <span className="font-mono">{cur.invitationLetterNo}</span>
                          </p>
                        )}
                      </div>
                      {/* ack jadwal / badge dikonfirmasi */}
                      <div className="mt-3">
                        {cur.needAck && cur.status === "Planned" && !cur.acknowledgedAt ? (
                          <Button
                            size="sm"
                            onClick={() => void ack(cur.id)}
                            disabled={busy}
                            className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700"
                          >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ClipboardCheck className="h-4 w-4" aria-hidden />}
                            {busy ? t("Mengonfirmasi…", "Confirming…") : t("Konfirmasi Jadwal (Ack)", "Confirm Schedule (Ack)")}
                          </Button>
                        ) : cur.acknowledgedAt ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t("Dikonfirmasi", "Confirmed")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-[11.5px] text-slate-400">
                      {t("Tidak ada tahap aktif — proses seleksi ini telah berakhir.", "No active stage — this selection process has ended.")}
                    </p>
                  )}

                  {/* ===== timeline semua tahap ===== */}
                  <p className="mb-3 mt-4 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <ListChecks className="h-3 w-3" aria-hidden /> {t("Tahapan Seleksi", "Selection Stages")}
                  </p>
                  <ol className="relative ml-2 space-y-3.5 border-l border-slate-200 pl-6 dark:border-slate-700">
                    {p.steps.map((s, i) => {
                      const st = stepStatusOf(s.status);
                      const terminal = s.status === "Passed" || s.status === "Failed" || s.status === "Cancelled";
                      return (
                        <li key={s.id} className="relative">
                          <span
                            className={cn(
                              "absolute -left-[34px] top-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold text-white ring-2 ring-white dark:ring-slate-900",
                              s.status === "Passed" ? "bg-emerald-500"
                                : s.status === "Failed" ? "bg-rose-500"
                                : s.status === "Acknowledged" ? "bg-amber-500"
                                : s.status === "Performed" ? "bg-violet-500"
                                : "bg-slate-400",
                            )}
                            aria-hidden
                          >
                            {i + 1}
                          </span>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={cn("text-[13px] font-bold", s.status === "Cancelled" ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100")}>
                              {s.stageName}
                            </span>
                            <Pill s={st} />
                            {s.acknowledgedAt && <AckBadge />}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {s.performedAt ? (
                              <span>{t("Dilaksanakan", "Held")} {fmtShortDate(s.performedAt, locale)}</span>
                            ) : s.planDate ? (
                              <span>{t("Jadwal", "Scheduled")} {fmtShortDate(s.planDate, locale)}</span>
                            ) : null}
                            {s.score != null && <span className="font-semibold text-slate-600 dark:text-slate-300">{t("Skor", "Score")} {s.score}</span>}
                            {s.result && (
                              <span className={cn("font-semibold", terminal && s.status === "Passed" ? "text-emerald-600 dark:text-emerald-400" : terminal && s.status === "Failed" ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300")}>
                                {s.result}
                              </span>
                            )}
                            {s.evaluatorName && <span>· {s.evaluatorName}</span>}
                          </div>
                          {s.comment && (
                            <p className="mt-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] italic text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              “{s.comment}”
                            </p>
                          )}
                          {s.invitationLetterNo && (
                            <p className="mt-1 flex items-center gap-1.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-400">
                              <MailCheck className="h-3 w-3 shrink-0" aria-hidden /> {t("Undangan", "Invitation")} <span className="font-mono">{s.invitationLetterNo}</span>
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
