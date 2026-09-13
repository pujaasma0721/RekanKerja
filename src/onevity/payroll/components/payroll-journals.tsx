"use client";
// OneVity Payroll — Jurnal Payroll (P4): posting otomatis dari run confirmed,
// detail baris D/C, ekspor CSV, backfill run lama yang belum diposting.
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort, fmtDateTime } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { BookOpen, FileDown, Sparkles, ChevronRight, Scale, Landmark } from "lucide-react";
import { JournalRow, JournalLine, MissingRunRow } from "@/onevity/payroll/components/payroll-types";
import { cn } from "@/lib/utils";
import { useI18n, loc } from "@/onevity/shared/lib/i18n";

interface JournalsData {
  journals: JournalRow[];
  missingRuns: MissingRunRow[];
}

export function PayrollJournalsPage() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<JournalsData>("/api/onevity/payroll-journals");
  const [detail, setDetail] = useState<JournalRow & { lines: JournalLine[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const journals = data?.journals ?? [];
  const missing = data?.missingRuns ?? [];

  const openDetail = async (j: JournalRow) => {
    try {
      const res = await fetch(`/api/onevity/payroll-journals?id=${j.id}`).then((r) => r.json());
      if (res?.error) throw new Error(res.error);
      setDetail(res.journal ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const generate = async (r: MissingRunRow) => {
    setBusyId(r.id);
    try {
      const res = await apiSend<{ journal: JournalRow }>("/api/onevity/payroll-journals", "POST", { runId: r.id });
      toast.success(t("Jurnal {j} dibuat dari {r} (D = C = {v})", "Journal {j} created from {r} (D = C = {v})", { j: res.journal.journalNo, r: r.runNo, v: fmtIDRShort(res.journal.totalDebit) }));
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusyId(null); }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Jurnal Payroll")}
        description={t("Posting jurnal otomatis saat run dikonfirmasi — beban dibebankan, hutang gaji/PPh21/BPJS dicatat, pembayaran ke kas & bank", "Automatic journal posting when a run is confirmed — expenses charged, salary/PPh21/BPJS liabilities recorded, payments to cash & bank")}
      />

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="space-y-4">
          {/* Backfill */}
          {missing.length > 0 && (
            <Card className="rounded-2xl border-brand/25 bg-brand/10/60 shadow-sm dark:border-brand/30 dark:bg-brand/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand" />
                  <p className="text-[13px] font-bold text-brand-deep dark:text-brand/75">
                    {t("{n} run selesai belum diposting ke jurnal", "{n} completed runs not yet posted to journals", { n: missing.length })}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {missing.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => generate(r)}
                      disabled={busyId === r.id}
                      className="inline-flex h-8 items-center gap-2 rounded-xl border border-brand/40 bg-white px-3 text-[11px] font-bold text-brand-deep transition hover:border-brand/40 hover:bg-brand/15/60 disabled:opacity-50 dark:border-brand/40 dark:bg-stone-900 dark:text-brand/75"
                    >
                      <BookOpen className="h-3 w-3" />
                      {busyId === r.id ? t("Memposting…", "Posting…") : t("Post {no}", "Post {no}", { no: r.runNo })}
                      <span className="text-brand/80">· {loc(r.periodName)}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-0">
              {journals.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={t("Belum ada jurnal payroll", "No payroll journals yet")}
                    description={t("Jurnal dibuat otomatis saat run payroll dikonfirmasi. Konfirmasi run di menu Proses & Hasil, atau post manual run lama di atas.", "Journals are created automatically when a payroll run is confirmed. Confirm a run in the Runs & Results menu, or manually post an old run above.")}
                    icon={<BookOpen className="h-6 w-6" />}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                        <TableHead className="text-[11px] font-bold">{t("Jurnal", "Journal")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Sumber Run", "Source Run")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Deskripsi")}</TableHead>
                        <TableHead className="text-center text-[11px] font-bold">{t("Baris", "Lines")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Debit")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Kredit", "Credit")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                        <TableHead className="w-[150px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {journals.map((j) => (
                        <TableRow key={j.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60" onClick={() => openDetail(j)}>
                          <TableCell>
                            <p className="font-mono text-[11px] font-bold ov-text-accent">{j.journalNo}</p>
                            <p className="text-[10px] text-stone-400">{fmtDateTime(j.journalDate)}</p>
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-stone-500">{j.runNo ?? "—"}</TableCell>
                          <TableCell className="max-w-[320px] truncate text-xs text-stone-500" >{j.description ?? "—"}</TableCell>
                          <TableCell className="text-center text-xs font-semibold">{j._count.lines}</TableCell>
                          <TableCell className="text-right text-xs font-bold">{fmtIDR(j.totalDebit)}</TableCell>
                          <TableCell className="text-right text-xs font-bold">{fmtIDR(j.totalCredit)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <StatusPill status={j.status} />
                              <Badge variant="outline" className="gap-0.5 ov-soft text-[9px]">
                                <Scale className="h-2.5 w-2.5" /> balance
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1">
                              <a href={`/api/onevity/payroll-journals?export=csv&id=${j.id}`} className="inline-flex h-7 items-center gap-1 rounded-lg border border-stone-200 px-2.5 text-[11px] font-bold text-stone-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-stone-700 dark:text-stone-300">
                                <FileDown className="h-3 w-3" /> CSV
                              </a>
                              <button
                                onClick={() => j.runId ? navigate("payroll", "run", { id: j.runId }) : openDetail(j)}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-stone-200 px-2.5 text-[11px] font-bold text-stone-500 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800"
                                aria-label={t("buka run", "open run")}
                              >
                                <ChevronRight className="h-3 w-3" />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Penjelasan struktur jurnal */}
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-4">
              <p className="flex items-center gap-2 text-[13px] font-bold"><Landmark className="h-4 w-4 ov-text-accent" /> {t('Struktur posting (pattern "Transfer to Accounting")', 'Posting structure (pattern "Transfer to Accounting")')}</p>
              <div className="mt-3 grid gap-2 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400 sm:grid-cols-3">
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                  <p className="font-bold text-stone-700 dark:text-stone-300">{t("1 · Beban", "1 · Expenses")}</p>
                  <p>{t("D komponen THP → 5101/5102 · D iuran BPJS perusahaan → 5103 / C hutang BPJS 2103", "D THP components → 5101/5102 · D company BPJS contributions → 5103 / C BPJS payable 2103")}</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                  <p className="font-bold text-stone-700 dark:text-stone-300">{t("2 · Kewajiban", "2 · Liabilities")}</p>
                  <p>{t("D hutang gaji 2101 → C PPh21 2102 / BPJS 2103 / pinjaman 2104 / lain-lain 2105", "D salaries payable 2101 → C PPh21 2102 / BPJS 2103 / loans 2104 / others 2105")}</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                  <p className="font-bold text-stone-700 dark:text-stone-300">{t("3 · Pembayaran", "3 · Payment")}</p>
                  <p>{t("D hutang gaji 2101 (net + pembulatan) → C kas & bank 1101 — D selalu = C", "D salaries payable 2101 (net + rounding) → C cash & bank 1101 — D always equals C")}</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-stone-400">
                {t('Mapping akun per komponen dapat ditimpa lewat kolom "Akun Debit/Kredit" di menu Komponen Upah (Salary Chart of Account).', 'Per-component account mapping can be overridden via the "Debit/Credit Account" column in the Wage Components menu (Salary Chart of Account).')}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <JournalDetailDialog journal={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function JournalDetailDialog({ journal, onClose }: { journal: (JournalRow & { lines: JournalLine[] }) | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={!!journal} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 ov-text-accent" />
            <span className="font-mono">{journal?.journalNo}</span>
            {journal?.runNo && <Badge variant="secondary" className="font-mono text-[10px]">{journal.runNo}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {journal && (
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-stone-50 dark:bg-stone-900">
                <TableRow>
                  <TableHead className="text-[10px] font-bold">{t("Akun", "Account")}</TableHead>
                  <TableHead className="text-[10px] font-bold">{t("Memo")}</TableHead>
                  <TableHead className="text-right text-[10px] font-bold">{t("Debit")}</TableHead>
                  <TableHead className="text-right text-[10px] font-bold">{t("Kredit", "Credit")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journal.lines.map((l) => (
                  <TableRow key={l.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                    <TableCell>
                      <p className="font-mono text-[11px] font-bold text-stone-500">{l.accountCode}</p>
                      <p className="text-[11px]">{l.accountName}</p>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-[11px] text-stone-500">{l.memo ?? "—"}</TableCell>
                    <TableCell className={cn("text-right text-[11px] font-semibold", l.position === "Debit" ? "text-brand-deep dark:text-brand/85" : "text-stone-300 dark:text-stone-600")}>
                      {l.position === "Debit" ? fmtIDR(l.amount) : ""}
                    </TableCell>
                    <TableCell className={cn("text-right text-[11px] font-semibold", l.position === "Credit" ? "text-rose-600 dark:text-rose-400" : "text-stone-300 dark:text-stone-600")}>
                      {l.position === "Credit" ? fmtIDR(l.amount) : ""}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-stone-200 bg-stone-50/80 font-bold dark:border-stone-700 dark:bg-stone-900/50">
                  <TableCell colSpan={2} className="text-[11px] font-bold uppercase tracking-wide text-stone-500">{t("Total — balance ✓", "Total — balanced ✓")}</TableCell>
                  <TableCell className="text-right text-[11px] font-extrabold text-brand-deep dark:text-brand/85">{fmtIDR(journal.totalDebit)}</TableCell>
                  <TableCell className="text-right text-[11px] font-extrabold text-rose-600 dark:text-rose-400">{fmtIDR(journal.totalCredit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
        <Button variant="outline" onClick={onClose}>{t("Tutup")}</Button>
      </DialogContent>
    </Dialog>
  );
}
