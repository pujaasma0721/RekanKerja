"use client";
// OneVity Payroll — Detail Run: hasil per karyawan + payslip interaktif + aksi run
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDate, fmtDateTime } from "@/lib/onevity/api";
import { useNav } from "@/lib/onevity/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, Calculator, CheckCircle2, Wallet, Search, Receipt, BanknoteArrowDown, Users, BookOpen } from "lucide-react";
import { RunDetail, RunLine, TAX_STATUS_LABEL, WAGE_TYPE_LABEL } from "@/components/onevity/payroll/payroll-types";
import { BankExportMenu } from "@/components/onevity/payroll/bank-export-menu";
import { cn } from "@/lib/utils";

export function PayrollRunDetailPage() {
  const { params, navigate, setParams } = useNav();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [slipLine, setSlipLine] = useState<RunLine | null>(null);

  const { data, loading, error, refresh } = useApi<RunDetail>(params.id ? `/api/onevity/payroll-run?id=${params.id}` : null);

  const act = async (action: "calculate" | "confirm" | "markPaid") => {
    if (!data) return;
    const msgs: Record<string, string> = {
      confirm: `Konfirmasi run ${data.run.runNo}? Hasil dikunci & angsuran pinjaman dipotong.`,
      markPaid: `Tandai ${data.run.runNo} sebagai DIBAYAR?`,
    };
    if (msgs[action] && !window.confirm(msgs[action])) return;
    setBusy(true);
    try {
      await apiSend("/api/onevity/payroll-runs", "PATCH", { id: data.run.id, action });
      toast.success(action === "calculate" ? "Perhitungan selesai" : action === "confirm" ? "Run dikonfirmasi" : "Run ditandai dibayar");
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (!params.id) {
    return <EmptyState title="Run tidak dipilih" description="Buka daftar Proses & Hasil lalu pilih salah satu run." icon={<Receipt className="h-6 w-6" />} />;
  }

  if (loading && !data) return <LoadingRows rows={8} />;
  if (error || !data) {
    return (
      <div>
        <Button variant="ghost" size="sm" className="mb-3 gap-1.5" onClick={() => navigate("payroll", "runs")}><ArrowLeft className="h-4 w-4" /> Kembali</Button>
        <EmptyState title="Run tidak ditemukan" description={error ?? "Run payroll tidak tersedia."} icon={<Receipt className="h-6 w-6" />} />
      </div>
    );
  }

  const run = data.run;
  const lines = run.lines.filter((l) =>
    !q || l.employeeNo.toLowerCase().includes(q.toLowerCase()) || l.employeeName.toLowerCase().includes(q.toLowerCase())
  );
  const earnings = data.componentTotals.filter((c) => c.type === "Earning");
  const deductions = data.componentTotals.filter((c) => c.type === "Deduction");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate("payroll", "runs")}><ArrowLeft className="h-4 w-4" /> Semua Run</Button>
        <span className="text-[11px] text-stone-400">/</span>
        <span className="font-mono text-xs font-bold text-stone-500">{run.runNo}</span>
      </div>

      <PageHeader
        eyebrow={`PROSES PAYROLL · ${run.period.name}`}
        title={run.runNo}
        description={`${run.processType.name} · dibuat ${fmtDateTime(run.createdAt)}${run.calculatedAt ? ` · dihitung ${fmtDateTime(run.calculatedAt)}` : ""}${run.status === "Confirmed" || run.status === "Paid" ? " · jurnal terposting otomatis" : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {(run.status === "Draft" || run.status === "Calculated") && (
              <Button onClick={() => act("calculate")} disabled={busy} className="gap-2 bg-sky-600 font-bold hover:bg-sky-700">
                <Calculator className="h-4 w-4" /> {run.status === "Draft" ? "Hitung Payroll" : "Hitung Ulang"}
              </Button>
            )}
            {run.status === "Calculated" && (
              <Button onClick={() => act("confirm")} disabled={busy} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Konfirmasi
              </Button>
            )}
            {run.status === "Confirmed" && (
              <>
                <Button onClick={() => act("markPaid")} disabled={busy} className="gap-2 bg-teal-600 font-bold hover:bg-teal-700">
                  <Wallet className="h-4 w-4" /> Tandai Dibayar
                </Button>
                <BankExportMenu runId={run.id} runNo={run.runNo} />
              </>
            )}
            {(run.status === "Confirmed" || run.status === "Paid") && (
              <button
                onClick={() => navigate("payroll", "journals")}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-stone-200 px-4 text-[13px] font-bold text-stone-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-stone-700 dark:text-stone-300"
              >
                <BookOpen className="h-4 w-4" /> Jurnal
              </button>
            )}
            <StatusPill status={run.status} />
          </div>
        }
      />

      {/* ringkasan */}
      {run.status !== "Draft" && (
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
          <SummaryCard icon={Users} label="Karyawan" value={String(run.employeeCount)} tone="text-stone-700 dark:text-stone-200" />
          <SummaryCard icon={Receipt} label="Bruto" value={fmtIDR(run.totalBruto)} tone="text-emerald-700 dark:text-emerald-400" />
          <SummaryCard icon={BanknoteArrowDown} label="Potongan" value={fmtIDR(run.totalDeduction)} tone="text-rose-600 dark:text-rose-400" />
          <SummaryCard icon={Receipt} label="PPh21" value={fmtIDR(run.totalTax)} tone="text-amber-600 dark:text-amber-400" />
          <SummaryCard icon={Wallet} label="Take Home Pay" value={fmtIDR(run.totalNet)} tone="text-teal-600 dark:text-teal-400" />
        </div>
      )}

      {run.status === "Draft" && (
        <Card className="mb-4 rounded-2xl border-sky-200 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Calculator className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            <p className="flex-1 text-[13px] font-semibold text-sky-800 dark:text-sky-200">
              Run masih Draft. Klik <b>Hitung Payroll</b> untuk memproses seluruh karyawan aktif — komponen diambil dari template + transaksi (pinjaman, bonus period ini).
            </p>
          </CardContent>
        </Card>
      )}

      {/* tabel hasil per karyawan */}
      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 dark:border-stone-800">
            <p className="text-[13px] font-bold">Hasil per Karyawan {run.status !== "Draft" && `(${run.lines.length})`}</p>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari karyawan…" className="h-9 pl-9 text-xs" />
            </div>
          </div>
          {run.status === "Draft" ? (
            <div className="p-5"><EmptyState title="Belum dihitung" description="Hasil akan muncul setelah run dihitung." icon={<Calculator className="h-6 w-6" />} /></div>
          ) : lines.length === 0 ? (
            <div className="p-5"><EmptyState title="Tidak ada hasil" description="Tidak ada karyawan yang cocok dengan pencarian." icon={<Users className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Posisi</TableHead>
                    <TableHead className="text-[11px] font-bold">PTKP</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Bruto</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Potongan</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">PPh21</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">THP</TableHead>
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
                      <TableCell className="text-right text-xs font-bold text-emerald-700 dark:text-emerald-400">{fmtIDR(l.net)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px] font-bold" onClick={() => setSlipLine(l)}>
                          <Receipt className="h-3 w-3" /> Slip
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableBody>
                  <TableRow className="border-t-2 border-stone-200 bg-stone-50/80 font-bold dark:border-stone-700 dark:bg-stone-900/50">
                    <TableCell colSpan={3} className="text-xs font-bold uppercase tracking-wide text-stone-500">Total ({run.lines.length} karyawan)</TableCell>
                    <TableCell className="text-right text-xs font-extrabold">{fmtIDR(run.totalBruto)}</TableCell>
                    <TableCell className="text-right text-xs font-extrabold text-rose-600 dark:text-rose-400">{fmtIDR(run.totalDeduction)}</TableCell>
                    <TableCell className="text-right text-xs font-extrabold text-amber-700 dark:text-amber-400">{fmtIDR(run.totalTax)}</TableCell>
                    <TableCell className="text-right text-xs font-extrabold text-emerald-700 dark:text-emerald-400">{fmtIDR(run.totalNet)}</TableCell>
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
            <CardTitle className="text-sm font-bold">Agregat Komponen Run</CardTitle>
            <p className="text-[11px] text-stone-400">Total seluruh karyawan per komponen — termasuk iuran perusahaan (di luar THP)</p>
          </CardHeader>
          <CardContent className="grid gap-4 pt-0 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Penghasilan & Iuran Perusahaan</p>
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
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Potongan Karyawan</p>
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
  if (!line) return null;
  const earnings = line.items.filter((i) => i.type === "Earning");
  const inThp = earnings.filter((i) => i.wageType !== "Jamsostek" || i.code.endsWith("_E") === false); // tampilkan semua earning, iuran perusahaan ditandai
  const deductions = line.items.filter((i) => i.type === "Deduction");
  const infos = line.items.filter((i) => i.type === "Informational");

  return (
    <Dialog open={!!line} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 text-emerald-600" /> Slip Gaji — {line.employeeName}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-xl bg-stone-50 p-4 dark:bg-stone-900/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Karyawan</p>
              <p className="text-sm font-bold">{line.employeeName} <span className="font-mono text-[11px] font-medium text-stone-400">{line.employeeNo}</span></p>
              <p className="text-[11px] text-stone-500">{line.positionName ?? "—"} · {line.orgUnitName ?? "—"}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Period · Run</p>
              <p className="text-sm font-bold">{context.periodName}</p>
              <p className="font-mono text-[10px] text-stone-400">{context.runNo} · {context.processName}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-dashed border-stone-200 pt-2 dark:border-stone-700">
            <Badge variant="outline" className="text-[10px] font-bold">PTKP {TAX_STATUS_LABEL[line.ptkpStatus] ?? line.ptkpStatus} · {fmtIDR(line.ptkpValue)}/thn</Badge>
            {line.actualNetTax != null && <Badge variant="outline" className="text-[10px] font-bold text-amber-600">NetToGross — pajak ditanggung perusahaan</Badge>}
            {line.notes && <Badge variant="outline" className="text-[10px] font-bold">{line.notes}</Badge>}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Penghasilan</p>
            <div className="space-y-1">
              {inThp.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-[13px]">
                  <span className={cn("text-stone-600 dark:text-stone-300", i.code.endsWith("_C") && "text-stone-400")}>
                    {i.name}
                    {i.code.endsWith("_C") && <span className="ml-1 text-[9px] font-bold uppercase text-stone-400">(iuran perush.)</span>}
                    {i.note && <span className="ml-1 text-[10px] text-stone-400">· {i.note}</span>}
                  </span>
                  <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">{fmtIDR(i.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Potongan</p>
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
            <SlipRow label="Total Bruto" value={fmtIDR(line.bruto)} strong />
            <SlipRow label="Total Potongan" value={`- ${fmtIDR(line.deduction)}`} tone="text-rose-600 dark:text-rose-400" />
            {line.taxRegular + line.taxIrregular > 0 && (
              <SlipRow label="PPh21 (termasuk dalam potongan)" value={fmtIDR(line.taxRegular + line.taxIrregular)} tone="text-amber-600 dark:text-amber-400" />
            )}
            <div className="mt-1 flex items-center justify-between border-t border-emerald-300/50 pt-2 dark:border-emerald-500/30">
              <span className="text-xs font-extrabold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Take Home Pay</span>
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
