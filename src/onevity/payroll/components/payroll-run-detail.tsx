"use client";
// OneVity Payroll — Detail Run: hasil per karyawan + payslip interaktif + aksi run
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDate, fmtDateTime } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, Calculator, CheckCircle2, Wallet, Search, Receipt, BanknoteArrowDown, Users, BookOpen, Download, Mail, TriangleAlert } from "lucide-react";
import { RunDetail, RunLine, UmkLineWarning, TAX_STATUS_LABEL, WAGE_TYPE_LABEL } from "@/onevity/payroll/components/payroll-types";
import { BankExportMenu } from "@/onevity/payroll/components/bank-export-menu";
import { BpjsExportButton, PayrollRegisterExportButton } from "@/onevity/payroll/components/payroll-report-buttons";
import { cn } from "@/lib/utils";
import { useI18n, loc } from "@/onevity/shared/lib/i18n";

export function PayrollRunDetailPage() {
  const { params, navigate, setParams } = useNav();
  const perms = useMenuPerms();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [slipLine, setSlipLine] = useState<RunLine | null>(null);
  const [umkOpen, setUmkOpen] = useState(false);
  // 26-b P0 — dialog kirim slip + pilihan proteksi password (sandi NIK)
  const [sendOpen, setSendOpen] = useState(false);
  const [sendPwd, setSendPwd] = useState(false);

  const { data, loading, error, refresh } = useApi<RunDetail>(params.id ? `/api/onevity/payroll-run?id=${params.id}` : null);

  const act = async (action: "calculate" | "confirm" | "markPaid") => {
    if (!data) return;
    const msgs: Record<string, string> = {
      confirm: t("Konfirmasi run {no}? Hasil dikunci & angsuran pinjaman dipotong.", "Confirm run {no}? Results are locked & loan installments deducted.", { no: data.run.runNo }),
      markPaid: t("Tandai {no} sebagai DIBAYAR?", "Mark {no} as PAID?", { no: data.run.runNo }),
    };
    if (msgs[action] && !window.confirm(msgs[action])) return;
    setBusy(true);
    try {
      await apiSend("/api/onevity/payroll-runs", "PATCH", { id: data.run.id, action });
      toast.success(action === "calculate" ? t("Perhitungan selesai", "Calculation completed") : action === "confirm" ? t("Run dikonfirmasi", "Run confirmed") : t("Run ditandai dibayar", "Run marked as paid"));
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  // T10 — kirim slip gaji PDF massal via email ke seluruh karyawan run.
  // 26-b P0 — dialog konfirmasi berisi saklar "slip berpassword" (sandi NIK);
  // preferensi dipersist di run (slipPassword) utk pengiriman berikutnya.
  const openSendDialog = () => {
    if (!data) return;
    setSendPwd(Boolean(data.run.slipPassword));
    setSendOpen(true);
  };

  const sendSlips = async () => {
    if (!data) return;
    setSending(true);
    try {
      const res = await apiSend<{ ok: boolean; total: number; sent: number; skipped: number; failed: number; disabled: number; protected: boolean }>(
        "/api/onevity/payroll-runs", "PATCH", { id: data.run.id, action: "send-slips", slipPassword: sendPwd }
      );
      const parts = [
        t("{n} terkirim", "{n} sent", { n: String(res.sent) }),
        res.skipped > 0 ? t("{n} dilewati", "{n} skipped", { n: String(res.skipped) }) : "",
        res.failed > 0 ? t("{n} gagal", "{n} failed", { n: String(res.failed) }) : "",
        res.protected ? t("berpassword", "password-protected") : "",
      ].filter(Boolean).join(" · ");
      if (res.sent > 0) toast.success(t("Slip terkirim — {parts}", "Slips sent — {parts}", { parts }));
      else if (res.disabled > 0) toast.info(t("Template email slip gaji dinonaktifkan — tidak ada yang dikirim", "Payslip email template is disabled — nothing sent"));
      else toast.warning(t("Tidak ada slip terkirim — {parts}", "No slips sent — {parts}", { parts }));
      setSendOpen(false);
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setSending(false); }
  };

  if (!params.id) {
    return <EmptyState title={t("Run tidak dipilih", "No run selected")} description={t("Buka daftar Proses & Hasil lalu pilih salah satu run.", "Open the Runs & Results list and pick a run.")} icon={<Receipt className="h-6 w-6" />} />;
  }

  if (loading && !data) return <LoadingRows rows={8} />;
  if (error || !data) {
    return (
      <div>
        <Button variant="ghost" size="sm" className="mb-3 gap-1.5" onClick={() => navigate("payroll", "runs")}><ArrowLeft className="h-4 w-4" /> {t("Kembali")}</Button>
        <EmptyState title={t("Run tidak ditemukan", "Run not found")} description={error ?? t("Run payroll tidak tersedia.", "Payroll run not available.")} icon={<Receipt className="h-6 w-6" />} />
      </div>
    );
  }

  const run = data.run;
  const lines = run.lines.filter((l) =>
    !q || l.employeeNo.toLowerCase().includes(q.toLowerCase()) || l.employeeName.toLowerCase().includes(q.toLowerCase())
  );
  const earnings = data.componentTotals.filter((c) => c.type === "Earning");
  const deductions = data.componentTotals.filter((c) => c.type === "Deduction");
  // 26-b P0 — warning UMP/UMK (PP 36/2021): snapshot per line di bawah upah minimum
  const umkWarnings: UmkLineWarning[] = run.lines
    .filter((l) => l.umkWarning && l.umkJson)
    .map((l) => JSON.parse(l.umkJson!) as UmkLineWarning);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate("payroll", "runs")}><ArrowLeft className="h-4 w-4" /> {t("Semua Run", "All Runs")}</Button>
        <span className="text-[11px] text-stone-400">/</span>
        <span className="font-mono text-xs font-bold text-stone-500">{run.runNo}</span>
      </div>

      <PageHeader
        eyebrow={t("PROSES PAYROLL · {p}", "PAYROLL RUN · {p}", { p: run.period.name })}
        title={run.runNo}
        description={`${run.processType.name} · ${t("dibuat", "created")} ${fmtDateTime(run.createdAt)}${run.calculatedAt ? ` · ${t("dihitung", "calculated")} ${fmtDateTime(run.calculatedAt)}` : ""}${run.status === "Confirmed" || run.status === "Paid" ? ` · ${t("jurnal terposting otomatis", "journal posted automatically")}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {(run.status === "Draft" || run.status === "Calculated") && perms.canOp("payroll", "runs", "calculate") && (
              <Button onClick={() => act("calculate")} disabled={busy} className="gap-2 bg-sky-600 font-bold hover:bg-sky-700">
                <Calculator className="h-4 w-4" /> {run.status === "Draft" ? t("Hitung Payroll", "Calculate Payroll") : t("Hitung Ulang", "Recalculate")}
              </Button>
            )}
            {run.status === "Calculated" && perms.canOp("payroll", "runs", "confirm") && (
              <Button onClick={() => act("confirm")} disabled={busy} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> {t("Konfirmasi")}
              </Button>
            )}
            {run.status === "Confirmed" && (
              <>
                {perms.canOp("payroll", "runs", "markPaid") && (
                  <Button onClick={() => act("markPaid")} disabled={busy} className="gap-2 bg-teal-600 font-bold hover:bg-teal-700">
                    <Wallet className="h-4 w-4" /> {t("Tandai Dibayar", "Mark as Paid")}
                  </Button>
                )}
                {perms.canOp("payroll", "runs", "export") && (
                  <BankExportMenu runId={run.id} runNo={run.runNo} />
                )}
                {perms.canOp("payroll", "runs", "export") && (
                  <BpjsExportButton runId={run.id} />
                )}
                {perms.canOp("payroll", "runs", "export") && (
                  <PayrollRegisterExportButton runId={run.id} />
                )}
              </>
            )}
            {(run.status === "Confirmed" || run.status === "Paid") && (
              <>
                {perms.canOp("payroll", "runs", "export") && (
                  <button
                    onClick={openSendDialog}
                    disabled={sending || busy}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-stone-200 px-4 text-[13px] font-bold text-stone-600 transition hover:ov-border-accent hover:ov-text-accent disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:text-stone-300"
                  >
                    <Mail className={cn("h-4 w-4", sending && "animate-pulse")} /> {sending ? t("Mengirim slip…", "Sending slips…") : t("Kirim Semua Slip", "Email All Slips")}
                  </button>
                )}
                <button
                  onClick={() => navigate("payroll", "journals")}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-stone-200 px-4 text-[13px] font-bold text-stone-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-stone-700 dark:text-stone-300"
                >
                  <BookOpen className="h-4 w-4" /> {t("Jurnal", "Journal")}
                </button>
              </>
            )}
            <StatusPill status={run.status} />
          </div>
        }
      />

      {/* ringkasan */}
      {run.status !== "Draft" && (
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
          <SummaryCard icon={Users} label={t("Karyawan")} value={String(run.employeeCount)} tone="text-stone-700 dark:text-stone-200" />
          <SummaryCard icon={Receipt} label={t("Bruto", "Gross")} value={fmtIDR(run.totalBruto)} tone="text-emerald-700 dark:text-emerald-400" />
          <SummaryCard icon={BanknoteArrowDown} label={t("Potongan", "Deductions")} value={fmtIDR(run.totalDeduction)} tone="text-rose-600 dark:text-rose-400" />
          <SummaryCard icon={Receipt} label={t("PPh21")} value={fmtIDR(run.totalTax)} tone="text-amber-600 dark:text-amber-400" />
          <SummaryCard icon={Wallet} label={t("Take Home Pay")} value={fmtIDR(run.totalNet)} tone="text-teal-600 dark:text-teal-400" />
        </div>
      )}

      {/* 26-b P0 — banner warning UMP/UMK (amber, edukatif non-bloking) */}
      {run.status !== "Draft" && umkWarnings.length > 0 && (
        <Card className="mb-4 rounded-2xl border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/10">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                  <TriangleAlert className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-amber-800 dark:text-amber-300">
                    {t(
                      "{n} karyawan di bawah UMP/UMK kantor penempatan (PP 36/2021)",
                      "{n} employees below the minimum wage of their placement office (PP 36/2021)",
                      { n: String(umkWarnings.length) },
                    )}
                  </p>
                  <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                    {t("Warning edukatif — hitungan payroll tetap sah. Tinjau gaji pokok atau ubah penempatan sebelum konfirmasi.", "Educational warning — the payroll calculation remains valid. Review base salaries or placements before confirming.")}
                  </p>
                </div>
              </div>
              <Button
                size="sm" variant="outline"
                onClick={() => setUmkOpen((v) => !v)}
                className="gap-1.5 border-amber-300 bg-white font-bold text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-transparent dark:text-amber-400"
              >
                {umkOpen ? t("Sembunyikan Rincian", "Hide Details") : t("Lihat Rincian", "View Details")} ({umkWarnings.length})
              </Button>
            </div>
            {umkOpen && (
              <div className="mt-3 max-h-96 overflow-y-auto rounded-xl border border-amber-200/70 bg-white/80 [scrollbar-width:thin] dark:border-amber-500/20 dark:bg-stone-900/60 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-amber-300 dark:[&::-webkit-scrollbar-thumb]:bg-amber-500/40">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-amber-50/95 backdrop-blur dark:bg-stone-900/95">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-10 text-[10.5px] font-bold uppercase tracking-wider text-amber-700/80 dark:text-amber-400/80">{t("Karyawan")}</TableHead>
                      <TableHead className="h-10 text-[10.5px] font-bold uppercase tracking-wider text-amber-700/80 dark:text-amber-400/80">{t("Kantor", "Office")}</TableHead>
                      <TableHead className="h-10 text-right text-[10.5px] font-bold uppercase tracking-wider text-amber-700/80 dark:text-amber-400/80">{t("Gaji Pokok", "Base Salary")}</TableHead>
                      <TableHead className="h-10 text-[10.5px] font-bold uppercase tracking-wider text-amber-700/80 dark:text-amber-400/80">{t("UMP/UMK")}</TableHead>
                      <TableHead className="h-10 text-right text-[10.5px] font-bold uppercase tracking-wider text-amber-700/80 dark:text-amber-400/80">{t("Selisih", "Gap")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {umkWarnings.map((w) => (
                      <TableRow key={w.employeeNo} className="hover:bg-amber-50/60 dark:hover:bg-amber-500/5">
                        <TableCell>
                          <p className="text-[12.5px] font-bold text-stone-800 dark:text-stone-100">{w.employeeName}</p>
                          <p className="font-mono text-[10.5px] text-stone-400">{w.employeeNo}</p>
                        </TableCell>
                        <TableCell className="text-[12.5px] text-stone-600 dark:text-stone-300">{w.office ?? t("— tanpa kantor —", "— no office —")}</TableCell>
                        <TableCell className="text-right font-mono text-[12.5px] font-semibold text-amber-700 dark:text-amber-400">{fmtIDR(w.baseSalary)}</TableCell>
                        <TableCell>
                          <p className="font-mono text-[12.5px] font-bold text-stone-700 dark:text-stone-200">{fmtIDR(w.umk.amount)}</p>
                          <p className="text-[10px] text-stone-400">{w.umk.label}</p>
                        </TableCell>
                        <TableCell className="text-right font-mono text-[12.5px] font-extrabold text-rose-600 dark:text-rose-400">-{fmtIDR(w.gap)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {run.status === "Draft" && (
        <Card className="mb-4 rounded-2xl border-sky-200 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Calculator className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            <p className="flex-1 text-[13px] font-semibold text-sky-800 dark:text-sky-200">
              {t("Run masih Draft. Klik", "Run is still a Draft. Click")} <b>{t("Hitung Payroll", "Calculate Payroll")}</b> {t("untuk memproses seluruh karyawan aktif — komponen diambil dari template + transaksi (pinjaman, bonus period ini).", "to process all active employees — components come from the template + transactions (loans, this period's bonuses).")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* tabel hasil per karyawan */}
      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 dark:border-stone-800">
            <p className="text-[13px] font-bold">{t("Hasil per Karyawan", "Results per Employee")} {run.status !== "Draft" && `(${run.lines.length})`}</p>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cari karyawan…", "Search employees…")} className="h-9 pl-9 text-xs" />
            </div>
          </div>
          {run.status === "Draft" ? (
            <div className="p-5"><EmptyState title={t("Belum dihitung", "Not calculated yet")} description={t("Hasil akan muncul setelah run dihitung.", "Results appear after the run is calculated.")} icon={<Calculator className="h-6 w-6" />} /></div>
          ) : lines.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Tidak ada hasil", "No results")} description={t("Tidak ada karyawan yang cocok dengan pencarian.", "No employees match the search.")} icon={<Users className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Posisi")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("PTKP")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Bruto", "Gross")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Potongan", "Deductions")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("PPh21")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("THP", "Net Pay")}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60" onClick={() => setSlipLine(l)}>
                      <TableCell>
                        <p className="text-[13px] font-bold">{l.employeeName}</p>
                        <p className="font-mono text-[10px] text-stone-400">{l.employeeNo}{l.notes ? ` · ${l.notes}` : ""}</p>
                      </TableCell>
                      <TableCell className="text-xs text-stone-500">{l.positionName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-bold">{TAX_STATUS_LABEL[l.ptkpStatus] ?? l.ptkpStatus}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">{fmtIDR(l.bruto)}</TableCell>
                      <TableCell className="text-right text-xs text-rose-600 dark:text-rose-400">{fmtIDR(l.deduction)}</TableCell>
                      <TableCell className="text-right text-xs text-amber-700 dark:text-amber-400">{fmtIDR(l.taxRegular + l.taxIrregular)}</TableCell>
                      <TableCell className="text-right text-xs font-bold ov-text-accent">{fmtIDR(l.net)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px] font-bold" onClick={() => setSlipLine(l)}>
                          <Receipt className="h-3 w-3" /> {t("Slip")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableBody>
                  <TableRow className="border-t-2 border-stone-200 bg-stone-50/80 font-bold dark:border-stone-700 dark:bg-stone-900/50">
                    <TableCell colSpan={3} className="text-xs font-bold uppercase tracking-wide text-stone-500">{t("Total ({n} karyawan)", "Total ({n} employees)", { n: run.lines.length })}</TableCell>
                    <TableCell className="text-right text-xs font-extrabold">{fmtIDR(run.totalBruto)}</TableCell>
                    <TableCell className="text-right text-xs font-extrabold text-rose-600 dark:text-rose-400">{fmtIDR(run.totalDeduction)}</TableCell>
                    <TableCell className="text-right text-xs font-extrabold text-amber-700 dark:text-amber-400">{fmtIDR(run.totalTax)}</TableCell>
                    <TableCell className="text-right text-xs font-extrabold ov-text-accent">{fmtIDR(run.totalNet)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* agregat komponen */}
      {run.status !== "Draft" && (
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">{t("Agregat Komponen Run", "Run Component Totals")}</CardTitle>
            <p className="text-[11px] text-stone-400">{t("Total seluruh karyawan per komponen — termasuk iuran perusahaan (di luar THP)", "Totals across all employees per component — including company contributions (outside THP)")}</p>
          </CardHeader>
          <CardContent className="grid gap-4 pt-0 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">{t("Penghasilan & Iuran Perusahaan", "Earnings & Company Contributions")}</p>
              <div className="space-y-1.5">
                {earnings.map((c) => (
                  <div key={c.code} className="flex items-center justify-between rounded-xl bg-emerald-50/50 px-3 py-1.5 dark:bg-emerald-500/5">
                    <span className="text-xs font-semibold">{c.name}</span>
                    <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">{fmtIDR(c.total)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">{t("Potongan Karyawan", "Employee Deductions")}</p>
              <div className="space-y-1.5">
                {deductions.map((c) => (
                  <div key={c.code} className="flex items-center justify-between rounded-xl bg-rose-50/50 px-3 py-1.5 dark:bg-rose-500/5">
                    <span className="text-xs font-semibold">{c.name}</span>
                    <span className="font-mono text-xs font-bold text-rose-600 dark:text-rose-400">{fmtIDR(c.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 26-b P0 — dialog kirim slip (konfirmasi + saklar proteksi password NIK) */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4" /> {t("Kirim Slip Gaji via Email", "Email Payslips")}
            </DialogTitle>
            <DialogDescription className="pt-1 text-[13px] leading-relaxed">
              {t(
                "Slip PDF akan dikirim ke {n} karyawan run {no}.",
                "PDF payslips will be emailed to {n} employees of run {no}.",
                { n: String(run.lines.length), no: run.runNo }
              )}
            </DialogDescription>
          </DialogHeader>
          <label className="mt-1 flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/60 p-3.5 dark:border-stone-800 dark:bg-stone-900/60">
            <Switch checked={sendPwd} onCheckedChange={setSendPwd} className="mt-0.5" aria-label={t("Proteksi PDF dengan kata sandi", "Protect PDF with password")} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-bold">
                {t("Proteksi slip dengan kata sandi", "Protect slips with password")}
                <Badge variant="outline" className="h-4.5 px-1.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">AES-256</Badge>
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-stone-500 dark:text-stone-400">
                {t(
                  "Sandi = NIK karyawan (fallback: nomor karyawan). Karyawan membuka PDF dengan NIK-nya sendiri — slip tidak terbaca pihak lain di mailbox.",
                  "Password = employee NIK (fallback: employee number). Each employee opens their PDF with their own NIK — slips stay private in transit."
                )}
              </span>
            </span>
          </label>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>{t("Batal", "Cancel")}</Button>
            <Button onClick={sendSlips} disabled={sending} className="gap-1.5">
              <Mail className={cn("h-4 w-4", sending && "animate-pulse")} />
              {sending ? t("Mengirim…", "Sending…") : t("Kirim Sekarang", "Send Now")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* payslip dialog */}
      <PaySlipDialog line={slipLine} onClose={() => setSlipLine(null)} context={{ runNo: run.runNo, periodName: run.period.name, processName: run.processType.name, status: run.status }} />
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", tone)} />
        <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
      </div>
      <p className={cn("mt-1 truncate text-base font-extrabold", tone)}>{value}</p>
    </div>
  );
}

function PaySlipDialog({ line, onClose, context }: { line: RunLine | null; onClose: () => void; context: { runNo: string; periodName: string; processName: string; status: string } }) {
  const { t } = useI18n();
  if (!line) return null;
  const earnings = line.items.filter((i) => i.type === "Earning");
  const inThp = earnings.filter((i) => i.wageType !== "Jamsostek" || i.code.endsWith("_E") === false); // tampilkan semua earning, iuran perusahaan ditandai
  const deductions = line.items.filter((i) => i.type === "Deduction");
  const infos = line.items.filter((i) => i.type === "Informational");

  return (
    <Dialog open={!!line} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 ov-text-accent" />
            <span className="flex-1">{t("Slip Gaji — {name}", "Payslip — {name}", { name: line.employeeName })}</span>
            <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 text-[11px] font-bold">
              <a href={`/api/onevity/payslip/${line.id}?download=1`} download>
                <Download className="h-3 w-3" /> {t("Unduh PDF", "Download PDF")}
              </a>
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-xl bg-stone-50 p-4 dark:bg-stone-900/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("Karyawan")}</p>
              <p className="text-sm font-bold">{line.employeeName} <span className="font-mono text-[11px] font-medium text-stone-400">{line.employeeNo}</span></p>
              <p className="text-[11px] text-stone-500">{line.positionName ?? "—"} · {line.orgUnitName ?? "—"}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("Period · Run")}</p>
              <p className="text-sm font-bold">{loc(context.periodName)}</p>
              <p className="font-mono text-[10px] text-stone-400">{context.runNo} · {context.processName}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-dashed border-stone-200 pt-2 dark:border-stone-700">
            <Badge variant="outline" className="text-[10px] font-bold">{t("PTKP {s} · {v}/thn", "PTKP {s} · {v}/yr", { s: TAX_STATUS_LABEL[line.ptkpStatus] ?? line.ptkpStatus, v: fmtIDR(line.ptkpValue) })}</Badge>
            {line.actualNetTax != null && <Badge variant="outline" className="text-[10px] font-bold text-amber-600">{t("NetToGross — pajak ditanggung perusahaan", "NetToGross — tax borne by the company")}</Badge>}
            {line.notes && <Badge variant="outline" className="text-[10px] font-bold">{line.notes}</Badge>}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">{t("Penghasilan", "Earnings")}</p>
            <div className="space-y-1">
              {inThp.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-[13px]">
                  <span className={cn("text-stone-600 dark:text-stone-300", i.code.endsWith("_C") && "text-stone-400")}>
                    {i.name}
                    {i.code.endsWith("_C") && <span className="ml-1 text-[9px] font-bold uppercase text-stone-400">{t("(iuran perush.)", "(co. contribution)")}</span>}
                    {i.note && <span className="ml-1 text-[10px] text-stone-400">· {i.note}</span>}
                  </span>
                  <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">{fmtIDR(i.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">{t("Potongan", "Deductions")}</p>
            <div className="space-y-1">
              {deductions.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-[13px]">
                  <span className="text-stone-600 dark:text-stone-300">{i.name}{i.note && <span className="ml-1 text-[10px] text-stone-400">· {i.note}</span>}</span>
                  <span className="font-mono text-xs font-semibold text-rose-600 dark:text-rose-400">{fmtIDR(i.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          {infos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {infos.map((i) => (
                <Badge key={i.id} variant="secondary" className="text-[10px]">{i.name}: {i.amount}</Badge>
              ))}
            </div>
          )}

          <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <SlipRow label={t("Total Bruto", "Total Gross")} value={fmtIDR(line.bruto)} strong />
            <SlipRow label={t("Total Potongan", "Total Deductions")} value={`- ${fmtIDR(line.deduction)}`} tone="text-rose-600 dark:text-rose-400" />
            {line.taxRegular + line.taxIrregular > 0 && (
              <SlipRow label={t("PPh21 (termasuk dalam potongan)", "PPh21 (included in deductions)")} value={fmtIDR(line.taxRegular + line.taxIrregular)} tone="text-amber-600 dark:text-amber-400" />
            )}
            <div className="mt-1 flex items-center justify-between border-t border-emerald-300/50 pt-2 dark:border-emerald-500/30">
              <span className="text-xs font-extrabold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{t("Take Home Pay")}</span>
              <span className="font-mono text-lg font-extrabold text-emerald-700 dark:text-emerald-300">{fmtIDR(line.net)}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SlipRow({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-stone-500 dark:text-stone-400">{label}</span>
      <span className={cn("font-mono text-xs font-bold", strong ? "text-stone-800 dark:text-stone-200" : "", tone ?? "")}>{value}</span>
    </div>
  );
}
