"use client";
// RekanKerja ESS — Slip Gaji: daftar slip (periode, gross, net, status) → klik
// membuka detail kartu slip: pendapatan & potongan terpisah, gross, total
// potongan, dan NET besar di bawah + status run. Intent "line:{id}" dari
// dashboard membuka detail langsung.
import { useState } from "react";
import { ArrowLeft, ReceiptText, Loader2, AlertTriangle, TrendingUp, TrendingDown, Wallet, Info, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, fmtIDR, fmtDate } from "@/rekankerja/shared/lib/api";
import { useI18n, loc } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ESS_BASE } from "./ess-api";
import type { EssPayslipDetail, EssPayslipItem, EssPayslipLine } from "./ess-types";

interface EssPayslipsProps { intent: string | null }

const isDeductionKind = (kind: string) => /deduc|potong/i.test(kind);
const isInfoKind = (kind: string) => /info/i.test(kind);

function SlipRow({ label, amount, tone }: { label: string; amount: number; tone: "earn" | "deduct" | "info" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-slate-200/70 py-2 last:border-b-0 dark:border-slate-800/70">
      <span className="min-w-0 break-words text-[12.5px] font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <span className={cn(
        "shrink-0 text-[13px] font-bold tabular-nums",
        tone === "earn" && "text-brand-deep dark:text-brand/85",
        tone === "deduct" && "text-rose-600 dark:text-rose-400",
        tone === "info" && "text-slate-500 dark:text-slate-400",
      )}>
        {tone === "deduct" ? "−" : ""}{fmtIDR(amount)}
      </span>
    </div>
  );
}

function ItemList({ title, icon: Icon, items, tone, empty }: {
  title: string; icon: React.ElementType; items: EssPayslipItem[]; tone: "earn" | "deduct" | "info"; empty: string;
}) {
  const { t } = useI18n();
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <Icon className={cn("h-4 w-4", tone === "earn" && "text-brand dark:text-brand/85", tone === "deduct" && "text-rose-600 dark:text-rose-400", tone === "info" && "text-slate-400")} aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-1">
        {items.length === 0 ? (
          <p className="py-3 text-center text-[12px] text-slate-400">{empty}</p>
        ) : items.map((it, i) => (
          <SlipRow key={`${it.name}-${i}`} label={it.name} amount={it.amount} tone={tone} />
        ))}
      </CardContent>
    </Card>
  );
}

export function EssPayslips({ intent }: EssPayslipsProps) {
  const { t } = useI18n();
  // intent "line:{lineId}" (dari dashboard) → buka detail langsung
  const [lineId, setLineId] = useState<string | null>(() => (intent && intent.startsWith("line:") ? intent.slice(5) : null));

  const list = useApi<{ slips: EssPayslipLine[] }>(`${ESS_BASE}/payslips`);
  const detail = useApi<EssPayslipDetail>(lineId ? `${ESS_BASE}/payslips/detail?lineId=${encodeURIComponent(lineId)}` : null, [lineId]);

  // ===== DETAIL =====
  if (lineId) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow={t("Employee Self Service", "Employee Self Service")}
          title={t("Detail Slip Gaji", "Payslip Detail")}
          description={detail.data ? `${loc(detail.data.periodName)} · ${detail.data.employeeName}` : t("Memuat detail slip…", "Loading slip detail…")}
          actions={
            <Button variant="outline" onClick={() => setLineId(null)} className="gap-2 rounded-xl font-bold">
              <ArrowLeft className="h-4 w-4" /> {t("Kembali ke Daftar", "Back to List")}
            </Button>
          }
        />

        {detail.loading && !detail.data ? (
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-2xl" />
            <LoadingRows rows={5} />
          </div>
        ) : detail.error || !detail.data ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/30">
            <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
            <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{t("Gagal memuat detail slip", "Failed to load payslip detail")}</p>
            <p className="max-w-sm break-words text-xs text-slate-500 dark:text-slate-400">{detail.error ?? t("Slip tidak ditemukan.", "Slip not found.")}</p>
            <Button onClick={detail.refresh} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
              <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
            </Button>
          </div>
        ) : (() => {
          const d = detail.data;
          const earnings = d.items.filter((it) => !isDeductionKind(it.kind) && !isInfoKind(it.kind));
          const deductions = d.items.filter((it) => isDeductionKind(it.kind));
          const informational = d.items.filter((it) => isInfoKind(it.kind));
          return (
            <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <div className="space-y-4">
                <ItemList title={t("Pendapatan", "Earnings")} icon={TrendingUp} items={earnings} tone="earn" empty={t("Tidak ada komponen pendapatan.", "No earning components.")} />
                <ItemList title={t("Potongan", "Deductions")} icon={TrendingDown} items={deductions} tone="deduct" empty={t("Tidak ada potongan.", "No deductions.")} />
                {informational.length > 0 && (
                  <ItemList title={t("Informasi", "Informational")} icon={Info} items={informational} tone="info" empty="" />
                )}
              </div>

              {/* ringkasan + NET */}
              <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
                <Card className="overflow-hidden rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5 dark:border-slate-800">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                          <ReceiptText className="h-5 w-5" aria-hidden />
                        </span>
                        <div>
                          <p className="text-[14px] font-extrabold text-slate-900 dark:text-slate-50">{loc(d.periodName)}</p>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className="text-[11px] text-slate-400">{t("Run", "Run")}</span>
                            <StatusPill status={d.runStatus} />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2.5 py-4">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">{t("Gaji Kotor (Gross)", "Gross Pay")}</span>
                        <span className="text-[14px] font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{fmtIDR(d.gross)}</span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">{t("Total Potongan", "Total Deductions")}</span>
                        <span className="text-[14px] font-extrabold tabular-nums text-rose-600 dark:text-rose-400">−{fmtIDR(d.totalDeductions)}</span>
                      </div>
                    </div>
                    <div className="rounded-2xl bg-gradient-to-br from-amber-500 via-amber-600 to-amber-800 p-4.5 text-white shadow-lg shadow-amber-500/25">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/80">
                        <Wallet className="h-3.5 w-3.5" aria-hidden /> {t("Diterima Bersih (Net)", "Net Take-Home Pay")}
                      </p>
                      <p className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums">{fmtIDR(d.net)}</p>
                    </div>
                  </CardContent>
                </Card>
                <p className="px-1 text-[11px] leading-relaxed text-slate-400">
                  {t("Slip ini bersifat rahasia. Nilai mengikuti hasil proses payroll periode terkait.", "This slip is confidential. Figures follow the payroll run result of the period.")}
                </p>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ===== DAFTAR =====
  const slips = list.data?.slips ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Slip Gaji", "Payslips")}
        description={t("Riwayat slip gaji periode Anda — klik untuk melihat rincian.", "Your payslip history by period — click for the breakdown.")}
      />
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {list.loading && !list.data ? (
            <div className="p-5"><LoadingRows rows={5} /></div>
          ) : list.error && !list.data ? (
            <div className="p-5">
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/30">
                <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
                <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{t("Gagal memuat daftar slip", "Failed to load payslip list")}</p>
                <Button onClick={list.refresh} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
                  <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
                </Button>
              </div>
            </div>
          ) : slips.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={t("Belum ada slip gaji", "No payslips yet")}
                description={t("Slip akan muncul setelah periode payroll Anda diproses & dikonfirmasi.", "Slips appear after your payroll period is processed & confirmed.")}
                icon={ReceiptText}
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {slips.map((s) => (
                <li key={s.lineId} className="flex items-center gap-1">
                  <button
                    onClick={() => setLineId(s.lineId)}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 text-left transition hover:bg-amber-50/50 sm:px-6 dark:hover:bg-amber-500/5"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      <ReceiptText className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{loc(s.periodName)}</p>
                      <p className="mt-0.5 text-[11.5px] text-slate-400">
                        {t("Gross {g}", "Gross {g}", { g: fmtIDR(s.gross) })}
                        {s.paidAt ? ` · ${t("dibayar {d}", "paid {d}", { d: fmtDate(s.paidAt) })}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Net", "Net")}</p>
                      <p className="text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-50">{fmtIDR(s.net)}</p>
                    </div>
                    <StatusPill status={s.status} />
                  </button>
                  {/* Task 82-c: unduh PDF slip — route /payslip/[lineId] sudah
                      mengotorisasi self (daftar ESS hanya run Confirmed/Paid).
                      Pola unduh sama dgn payroll-run-detail (a download). */}
                  <a
                    href={`/api/rekankerja/payslip/${s.lineId}?download=1`}
                    download
                    aria-label={t("Unduh PDF slip {p}", "Download payslip PDF {p}", { p: s.periodName })}
                    title={t("Unduh PDF", "Download PDF")}
                    className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:ov-border-accent hover:ov-text-accent dark:border-slate-800 dark:text-slate-400 sm:mr-4"
                  >
                    <FileDown className="h-4 w-4" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
