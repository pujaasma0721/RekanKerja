"use client";
// OneVity Payroll — Jurnal Payroll (P4): posting otomatis dari run confirmed,
// detail baris D/C, ekspor CSV, backfill run lama yang belum diposting.
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort, fmtDateTime } from "@/lib/onevity/api";
import { useNav } from "@/lib/onevity/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { BookOpen, FileDown, Sparkles, ChevronRight, Scale, Landmark } from "lucide-react";
import { JournalRow, JournalLine, MissingRunRow } from "@/components/onevity/payroll/payroll-types";
import { cn } from "@/lib/utils";

interface JournalsData {
  journals: JournalRow[];
  missingRuns: MissingRunRow[];
}

export function PayrollJournalsPage() {
  const { navigate } = useNav();
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
      toast.success(`Jurnal ${res.journal.journalNo} dibuat dari ${r.runNo} (D = C = ${fmtIDRShort(res.journal.totalDebit)})`);
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusyId(null); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Jurnal Payroll"
        description="Posting jurnal otomatis saat run dikonfirmasi — beban dibebankan, hutang gaji/PPh21/BPJS dicatat, pembayaran ke kas & bank"
      />

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="space-y-4">
          {/* Backfill */}
          {missing.length > 0 && (
            <Card className="rounded-2xl border-amber-200 bg-amber-50/60 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-600" />
                  <p className="text-[13px] font-bold text-amber-800 dark:text-amber-300">
                    {missing.length} run selesai belum diposting ke jurnal
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {missing.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => generate(r)}
                      disabled={busyId === r.id}
                      className="inline-flex h-8 items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 text-[11px] font-bold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100/60 disabled:opacity-50 dark:border-amber-500/40 dark:bg-stone-900 dark:text-amber-300"
                    >
                      <BookOpen className="h-3 w-3" />
                      {busyId === r.id ? "Memposting…" : `Post ${r.runNo}`}
                      <span className="text-amber-500/80">· {r.periodName}</span>
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
                    title="Belum ada jurnal payroll"
                    description="Jurnal dibuat otomatis saat run payroll dikonfirmasi. Konfirmasi run di menu Proses & Hasil, atau post manual run lama di atas."
                    icon={<BookOpen className="h-6 w-6" />}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                        <TableHead className="text-[11px] font-bold">Jurnal</TableHead>
                        <TableHead className="text-[11px] font-bold">Sumber Run</TableHead>
                        <TableHead className="text-[11px] font-bold">Deskripsi</TableHead>
                        <TableHead className="text-center text-[11px] font-bold">Baris</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Debit</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Kredit</TableHead>
                        <TableHead className="text-[11px] font-bold">Status</TableHead>
                        <TableHead className="w-[150px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {journals.map((j) => (
                        <TableRow key={j.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60" onClick={() => openDetail(j)}>
                          <TableCell>
                            <p className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{j.journalNo}</p>
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
                              <Badge variant="outline" className="gap-0.5 border-emerald-200 text-[9px] text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400">
                                <Scale className="h-2.5 w-2.5" /> balance
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1">
                              <a href={`/api/onevity/payroll-journals?export=csv&id=${j.id}`} className="inline-flex h-7 items-center gap-1 rounded-lg border border-stone-200 px-2.5 text-[11px] font-bold text-stone-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-stone-700 dark:text-stone-300">
                                <FileDown className="h-3 w-3" /> CSV
                              </a>
                              <button
                                onClick={() => j.runId ? navigate("payroll", "run", { id: j.runId }) : openDetail(j)}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-stone-200 px-2.5 text-[11px] font-bold text-stone-500 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800"
                                aria-label="buka run"
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
              <p className="flex items-center gap-2 text-[13px] font-bold"><Landmark className="h-4 w-4 text-emerald-600" /> Struktur posting (pattern oranHR "Transfer to Accounting")</p>
              <div className="mt-3 grid gap-2 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400 sm:grid-cols-3">
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                  <p className="font-bold text-stone-700 dark:text-stone-300">1 · Beban</p>
                  <p>D komponen THP → 5101/5102 · D iuran BPJS perusahaan → 5103 / C hutang BPJS 2103</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                  <p className="font-bold text-stone-700 dark:text-stone-300">2 · Kewajiban</p>
                  <p>D hutang gaji 2101 → C PPh21 2102 / BPJS 2103 / pinjaman 2104 / lain-lain 2105</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                  <p className="font-bold text-stone-700 dark:text-stone-300">3 · Pembayaran</p>
                  <p>D hutang gaji 2101 (net + pembulatan) → C kas &amp; bank 1101 — D selalu = C</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-stone-400">
                Mapping akun per komponen dapat ditimpa lewat kolom "Akun Debit/Kredit" di menu Komponen Upah (Salary Chart of Account).
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
  return (
    <Dialog open={!!journal} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-emerald-600" />
            <span className="font-mono">{journal?.journalNo}</span>
            {journal?.runNo && <Badge variant="secondary" className="font-mono text-[10px]">{journal.runNo}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {journal && (
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-stone-50 dark:bg-stone-900">
                <TableRow>
                  <TableHead className="text-[10px] font-bold">Akun</TableHead>
                  <TableHead className="text-[10px] font-bold">Memo</TableHead>
                  <TableHead className="text-right text-[10px] font-bold">Debit</TableHead>
                  <TableHead className="text-right text-[10px] font-bold">Kredit</TableHead>
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
                    <TableCell className={cn("text-right text-[11px] font-semibold", l.position === "Debit" ? "text-emerald-700 dark:text-emerald-400" : "text-stone-300 dark:text-stone-600")}>
                      {l.position === "Debit" ? fmtIDR(l.amount) : ""}
                    </TableCell>
                    <TableCell className={cn("text-right text-[11px] font-semibold", l.position === "Credit" ? "text-rose-600 dark:text-rose-400" : "text-stone-300 dark:text-stone-600")}>
                      {l.position === "Credit" ? fmtIDR(l.amount) : ""}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-stone-200 bg-stone-50/80 font-bold dark:border-stone-700 dark:bg-stone-900/50">
                  <TableCell colSpan={2} className="text-[11px] font-bold uppercase tracking-wide text-stone-500">Total — balance ✓</TableCell>
                  <TableCell className="text-right text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400">{fmtIDR(journal.totalDebit)}</TableCell>
                  <TableCell className="text-right text-[11px] font-extrabold text-rose-600 dark:text-rose-400">{fmtIDR(journal.totalCredit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
        <Button variant="outline" onClick={onClose}>Tutup</Button>
      </DialogContent>
    </Dialog>
  );
}
