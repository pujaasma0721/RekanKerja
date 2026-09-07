"use client";
// Slip Gaji Saya — daftar slip (run Confirmed/Paid) + detail slip lengkap:
// pendapatan, potongan, informasi, PPh21, THP. Tombol Cetak (window.print
// dengan area cetak terbatas slip) + estimasi YTD sederhana.
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ReceiptText, ChevronRight, Printer, Wallet, Banknote, CalendarRange, FileCheck2, Landmark,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useApi, fmtIDR, fmtDate } from "@/onevity/shared/lib/api";
import { StatusPill, EmptyState } from "@/onevity/shared/components/ui-kit";
import { PageSkeleton } from "@/onevity/ess/components/ess-ui";
import { useEssSession } from "@/onevity/ess/components/ess-session";
import { cn } from "@/lib/utils";

/** fmtIDR alias lokal agar slip mudah dibaca */
const fmtIDRLocal = fmtIDR;

interface SlipItem { code: string; name: string; type: string; wageType: string; amount: number; note: string | null; sortOrder: number }
interface Slip {
  id: string; runNo: string; periodName: string; payType: string; processTypeName: string; status: string;
  paidAt: string | null; confirmedAt: string | null; bruto: number; deduction: number;
  taxRegular: number; taxIrregular: number; net: number; items: SlipItem[];
}
interface PayslipData {
  slips: Slip[];
  employee: {
    employeeNo: string; fullName: string; position: string | null; orgUnit: string | null;
    employmentStatus: string | null; taxId: string | null; ptkpStatus: string | null; ptkpValue: number | null; company: string | null;
  } | null;
}

export function EssPayslips() {
  const { data: ess } = useEssSession();
  const { data, loading, error } = useApi<PayslipData>("/api/ess/payslips");
  const [openId, setOpenId] = useState<string | null>(null);

  const openSlip = useMemo(() => data?.slips.find((s) => s.id === openId) ?? null, [data, openId]);

  const ytdNet = useMemo(() => (data?.slips ?? []).filter((s) => s.status === "Paid").reduce((sum, s) => sum + s.net, 0), [data]);

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <EmptyState title="Gagal memuat slip gaji" description={error} icon={<ReceiptText className="h-6 w-6" />} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">Slip Gaji</h1>
          <p className="mt-0.5 text-[13px] text-stone-500 dark:text-stone-400">Take-home pay & rincian komponen gaji Anda</p>
        </div>
        {ytdNet > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2 dark:border-emerald-500/25 dark:bg-emerald-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Total Diterima (slip terdaftar)</p>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{fmtIDRLocal(ytdNet)}</p>
          </div>
        )}
      </div>

      {!data || data.slips.length === 0 ? (
        <EmptyState
          title="Belum ada slip gaji"
          description="Slip muncul setelah run payroll Anda dikonfirmasi / ditandai dibayar oleh HR."
          icon={<ReceiptText className="h-6 w-6" />}
        />
      ) : (
        <div className="space-y-3">
          {data.slips.map((s, i) => (
            <motion.button
              key={s.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => setOpenId(openId === s.id ? null : s.id)}
              className={cn(
                "flex w-full items-center gap-4 rounded-2xl border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:hover:border-emerald-500/40",
                openId === s.id ? "border-emerald-400 dark:border-emerald-500/50" : "border-stone-200/80 dark:border-stone-800",
              )}
            >
              <span className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                s.status === "Paid"
                  ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-600/20"
                  : "bg-stone-100 text-stone-500 dark:bg-stone-800",
              )}>
                <Wallet className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-stone-900 dark:text-stone-50">{s.periodName}</p>
                <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                  {s.processTypeName} · {s.runNo}
                  {s.paidAt ? ` · dibayar ${fmtDate(s.paidAt)}` : s.confirmedAt ? ` · dikonfirmasi ${fmtDate(s.confirmedAt)}` : ""}
                </p>
              </div>
              <div className="hidden text-right sm:block">
                <p className="font-mono text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{fmtIDRLocal(s.net)}</p>
                <StatusPill status={s.status} className="mt-0.5" />
              </div>
              <ChevronRight className={cn("h-5 w-5 shrink-0 text-stone-300 transition-transform dark:text-stone-600", openId === s.id && "rotate-90")} />
            </motion.button>
          ))}
        </div>
      )}

      {/* ===== detail slip (ekspansi) ===== */}
      <AnimatePresence mode="wait">
        {openSlip && (
          <motion.div
            key={openSlip.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            <SlipDetail slip={openSlip} employee={data?.employee ?? null} photoUrl={ess?.employee?.photoUrl ?? null} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ detail slip (siap cetak) ============

function SlipDetail({ slip, employee, photoUrl }: { slip: Slip; employee: PayslipData["employee"]; photoUrl: string | null }) {
  const earnings = slip.items.filter((i) => i.type === "Earning");
  const deductions = slip.items.filter((i) => i.type === "Deduction");
  const informational = slip.items.filter((i) => i.type === "Informational");
  const totalEarnings = earnings.reduce((s, i) => s + i.amount, 0);
  const totalDeductions = deductions.reduce((s, i) => s + i.amount, 0);

  const doPrint = () => {
    toast.info("Membuka dialog cetak…");
    setTimeout(() => window.print(), 350);
  };

  return (
    <Card className="ess-slip-print-area overflow-hidden border-stone-200/80 shadow-md dark:border-stone-800">
      {/* kop */}
      <div className="relative bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-6 py-6 text-white print:bg-white print:text-stone-900">
        <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-white/10 blur-2xl print:hidden" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-emerald-200 print:text-stone-500">
              <Landmark className="h-3.5 w-3.5" /> {employee?.company ?? "Perusahaan"}
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight print:text-stone-900">Slip Gaji — {slip.periodName}</h2>
            <p className="mt-0.5 text-xs text-emerald-50/85 print:text-stone-500">
              {slip.processTypeName} · No. Run {slip.runNo} · {slip.payType}
            </p>
          </div>
          <div className="text-right print:text-left">
            <StatusPill status={slip.status} />
            <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-white print:text-stone-900">{fmtIDRLocal(slip.net)}</p>
            <p className="text-[10px] uppercase tracking-wide text-emerald-200 print:text-stone-500">Take-Home Pay</p>
          </div>
        </div>
      </div>

      <CardContent className="space-y-6 p-6">
        {/* identitas */}
        <div className="grid gap-3 rounded-xl border border-stone-200/80 p-4 dark:border-stone-800 sm:grid-cols-2 print:border-stone-300">
          {[
            { l: "Karyawan", v: `${employee?.fullName ?? "—"} (${employee?.employeeNo ?? "—"})` },
            { l: "Posisi", v: employee?.position ?? "—" },
            { l: "Unit Organisasi", v: employee?.orgUnit ?? "—" },
            { l: "Status Kerja", v: employee?.employmentStatus ?? "—" },
            { l: "NPWP", v: employee?.taxId ?? "—" },
            { l: "PTKP", v: employee?.ptkpStatus ? `${employee.ptkpStatus} (${fmtIDRLocal(employee.ptkpValue ?? 0)})` : "—" },
          ].map((x) => (
            <div key={x.l} className="flex items-baseline justify-between gap-3 border-b border-stone-100 pb-1.5 last:border-0 dark:border-stone-800/70 print:border-stone-200">
              <span className="text-xs text-stone-400">{x.l}</span>
              <span className="text-[13px] font-medium text-stone-800 dark:text-stone-100">{x.v}</span>
            </div>
          ))}
        </div>

        {/* pendapatan & potongan */}
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              <Banknote className="h-3.5 w-3.5" /> Pendapatan
            </p>
            <div className="space-y-0">
              {earnings.map((it) => (
                <div key={it.code} className="flex items-baseline justify-between gap-3 border-b border-dashed border-stone-200/70 py-1.5 dark:border-stone-800/60 print:border-stone-200">
                  <span className="text-[13px] text-stone-600 dark:text-stone-300">{it.name}</span>
                  <span className="font-mono text-[13px] font-semibold tabular-nums text-stone-800 dark:text-stone-100">{fmtIDRLocal(it.amount)}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 pt-2">
                <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400">Total Pendapatan</span>
                <span className="font-mono text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{fmtIDRLocal(totalEarnings)}</span>
              </div>
            </div>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
              <ReceiptText className="h-3.5 w-3.5" /> Potongan
            </p>
            <div className="space-y-0">
              {deductions.map((it) => (
                <div key={it.code} className="flex items-baseline justify-between gap-3 border-b border-dashed border-stone-200/70 py-1.5 dark:border-stone-800/60 print:border-stone-200">
                  <span className="text-[13px] text-stone-600 dark:text-stone-300">{it.name}</span>
                  <span className="font-mono text-[13px] font-semibold tabular-nums text-stone-800 dark:text-stone-100">{fmtIDRLocal(it.amount)}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 pt-2">
                <span className="text-[13px] font-bold text-rose-600 dark:text-rose-400">Total Potongan</span>
                <span className="font-mono text-[13px] font-bold tabular-nums text-rose-600 dark:text-rose-400">{fmtIDRLocal(totalDeductions)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ringkasan */}
        <div className="rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50/70 p-4 dark:from-emerald-500/10 dark:to-teal-500/10 print:bg-stone-50">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Gaji Bruto</p>
              <p className="font-mono text-sm font-bold tabular-nums text-stone-800 dark:text-stone-100">{fmtIDRLocal(slip.bruto)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">PPh 21 {slip.taxIrregular > 0 ? "(reguler + ireguler)" : "(reguler)"}</p>
              <p className="font-mono text-sm font-bold tabular-nums text-stone-800 dark:text-stone-100">{fmtIDRLocal(slip.taxRegular + slip.taxIrregular)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Diterima (THP)</p>
              <p className="font-mono text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{fmtIDRLocal(slip.net)}</p>
            </div>
          </div>
        </div>

        {/* informasional */}
        {informational.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">
              <FileCheck2 className="h-3.5 w-3.5" /> Informasi
            </p>
            <div className="flex flex-wrap gap-2">
              {informational.map((it) => (
                <Badge key={it.code} variant="outline" className="rounded-lg border-stone-300 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400">
                  {it.name}: {it.amount.toLocaleString("id-ID")}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <Separator className="print:hidden" />

        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="max-w-md text-[11px] leading-relaxed text-stone-400">
            Slip ini adalah dokumen resmi yang dihasilkan sistem OneVity. Rincian dapat berbeda bila terdapat penyesuaian retroaktif — hubungi HR untuk penjelasan.
          </p>
          <Button onClick={doPrint} variant="outline" className="rounded-xl">
            <Printer className="h-4 w-4" /> Cetak / Simpan PDF
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
