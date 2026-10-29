"use client";
// OneVity — Dialog Preview Final Settlement PHK (T19)
// =====================================================================
// Tombol kecil di detail PA Termination: estimasi breakdown UU 13/2003
// (pesangon UPMK × multiplier, uang pisah, cuti, THR prorata, pinjaman,
// PPh21 final) SEBELUM dokumen diproses. Penerapan otomatis terjadi saat
// PA Termination diproses (personnel-actions-detail → settlement-service).
// Param dapat diubah-ubah di dialog utk eksplorasi skenario — hanya preview
// (tanpa mutasi); nilai yang dipakai proses PA berasal dari detail dokumen.
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiSend, fmtIDR, fmtDate } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { toast } from "sonner";
import { Calculator, Landmark, Loader2, Plus, Minus, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettlementRow {
  code: string;
  label: string;
  kind: "Earning" | "Deduction";
  amount: number;
  note: string;
}

interface SettlementResult {
  employee: { employeeNo: string; fullName: string; joinDate: string };
  effectiveDate: string;
  masaKerja: { years: number; months: number; totalMonths: number; label: string };
  upah: { baseSalary: number; fixedAllowances: number; total: number; note: string };
  rows: SettlementRow[];
  gross: number;
  taxBase: number;
  taxBrackets: { lowerLimit: number; upperLimit: number | null; rate: number; taxable: number; tax: number }[];
  tax: number;
  deductions: number;
  net: number;
  notes: string[];
}

export function SettlementPreviewDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  effectiveDate,
  initialParams,
  reason,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string;
  employeeName: string;
  effectiveDate: string;
  initialParams?: { pesangonMultiplier?: string | number | null; uangPisahPct?: string | number | null; includeBonusProRata?: boolean | string | null };
  reason?: string | null;
}) {
  const { t } = useI18n();
  const [multiplier, setMultiplier] = useState<string>(String(initialParams?.pesangonMultiplier ?? 1));
  const [uangPisah, setUangPisah] = useState(Boolean(Number(initialParams?.uangPisahPct ?? 0) > 0));
  const [bonusProRata, setBonusProRata] = useState(initialParams?.includeBonusProRata === true || initialParams?.includeBonusProRata === "true");
  const [result, setResult] = useState<SettlementResult | null>(null);
  const [busy, setBusy] = useState(false);

  const compute = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ settlement: SettlementResult }>("/api/onevity/settlement-preview", "POST", {
        employeeId,
        effectiveDate,
        pesangonMultiplier: Number(multiplier),
        uangPisahPct: uangPisah ? 15 : 0,
        includeBonusProRata: bonusProRata,
        reason: reason ?? null,
      });
      setResult(res.settlement);
    } catch (e) {
      toast.error(t("Gagal menghitung settlement", "Failed to compute settlement"), { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const earnings = result?.rows.filter((r) => r.kind === "Earning") ?? [];
  const cuts = result?.rows.filter((r) => r.kind === "Deduction") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
              <Landmark className="h-5 w-5" />
            </span>
            {t("Estimasi Final Settlement PHK", "Final Termination Settlement Estimate")}
          </DialogTitle>
          <DialogDescription>
            {employeeName} · {t("efektif", "effective")} {fmtDate(effectiveDate)} —{" "}
            {t(
              "pesangon & penggantian hak dihitung otomatis saat dokumen diproses (UU 13/2003 + PPh21 final).",
              "severance & replacement entitlements are computed automatically when the document is processed (Law 13/2003 + final income tax).",
            )}
          </DialogDescription>
        </DialogHeader>

        {/* parameter skenario */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("Faktor UPMK Pesangon", "UPMK Severance Factor")}</Label>
            <Select value={multiplier} onValueChange={setMultiplier}>
              <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">×0 — {t("jangka waktu PKWT berakhir (tanpa pesangon — kompensasi PP 35/2021 Ps.15)", "fixed-term contract expired (no severance — compensation PP 35/2021 Art.15)")}</SelectItem>
                <SelectItem value="0.5">×0,5 — {t("pengurangan hak (pengunduran)", "waiver (resignation)")}</SelectItem>
                <SelectItem value="1">×1 — {t("PHK efisiensi", "efficiency termination")}</SelectItem>
                <SelectItem value="1.5">×1,5 — {t("tanpa alasan (PHK murah)", "no cause (cheap termination)")}</SelectItem>
                <SelectItem value="2">×2 — {t("tanpa alasan", "no cause")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <Checkbox checked={uangPisah} onCheckedChange={(v) => setUangPisah(v === true)} className="mt-0.5 h-4 w-4" />
            <span className="text-xs leading-relaxed">
              <span className="font-bold">{t("Uang pisah (15%)", "Separation pay (15%)")}</span>
              <span className="block text-[10px] text-slate-400">{t("PHK efisiensi — Pasal 156(4)", "Efficiency termination — Art. 156(4)")}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <Checkbox checked={bonusProRata} onCheckedChange={(v) => setBonusProRata(v === true)} className="mt-0.5 h-4 w-4" />
            <span className="text-xs leading-relaxed">
              <span className="font-bold">{t("Bonus pro-rata", "Pro-rata bonus")}</span>
              <span className="block text-[10px] text-slate-400">{t("penggantian hak — bulan kerja/12 × upah", "replacement entitlement — months/12 × wage")}</span>
            </span>
          </label>
        </div>

        <Button onClick={() => void compute()} disabled={busy} className="h-11 w-full gap-2 font-bold">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
          {t("Hitung Estimasi Settlement", "Compute Settlement Estimate")}
        </Button>

        {result && (
          <div className="space-y-3">
            {/* ringkasan masa kerja + upah */}
            <div className="grid gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900/40 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Masa Kerja", "Tenure")}</p>
                <p className="mt-0.5 font-bold text-slate-800 dark:text-slate-100">{result.masaKerja.label}</p>
                <p className="text-[10px] text-slate-400">{t("bergabung {d}", "joined {d}", { d: fmtDate(result.employee.joinDate) })}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Upah PHK", "Termination Wage")}</p>
                <p className="mt-0.5 font-bold text-slate-800 dark:text-slate-100">{fmtIDR(result.upah.total)}</p>
                <p className="text-[10px] leading-snug text-slate-400">{result.upah.note}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("PPh21 Final", "Final Income Tax")}</p>
                <p className="mt-0.5 font-bold text-amber-600 dark:text-amber-400">{fmtIDR(result.tax)}</p>
                <p className="text-[10px] text-slate-400">{t("atas kelompok pesangon", "on severance group")}</p>
              </div>
            </div>

            {/* breakdown */}
            <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[10px] font-bold">{t("Komponen", "Component")}</TableHead>
                    <TableHead className="text-[10px] font-bold">{t("Dasar Perhitungan", "Computation Basis")}</TableHead>
                    <TableHead className="text-right text-[10px] font-bold">{t("Jumlah", "Amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {earnings.map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="py-2 text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <Plus className="h-3 w-3 text-brand" /> {r.label}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-[11px] leading-snug text-slate-500">{r.note}</TableCell>
                      <TableCell className="py-2 text-right text-xs font-bold tabular-nums text-brand dark:text-brand/85">{fmtIDR(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {cuts.map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="py-2 text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <Minus className="h-3 w-3 text-rose-500" /> {r.label}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-[11px] leading-snug text-slate-500">{r.note}</TableCell>
                      <TableCell className="py-2 text-right text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400">−{fmtIDR(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableCell className="py-2.5 text-xs font-extrabold" colSpan={2}>{t("Bruto (sebelum potongan)", "Gross (before deductions)")}</TableCell>
                    <TableCell className="py-2.5 text-right text-xs font-extrabold tabular-nums">{fmtIDR(result.gross)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="py-2.5 text-sm font-extrabold dark:bg-slate-900/60" colSpan={2}>
                      {t("NET DITERIMA KARYAWAN", "NET PAYABLE TO EMPLOYEE")}
                    </TableCell>
                    <TableCell className="py-2.5 text-right text-base font-extrabold tabular-nums ov-text-accent dark:bg-slate-900/60">{fmtIDR(result.net)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* detail pajak final */}
            <details className="rounded-xl border border-slate-200/80 px-3.5 py-2.5 text-[11px] dark:border-slate-800">
              <summary className="cursor-pointer font-bold text-slate-500">
                <Receipt className="mr-1.5 inline h-3.5 w-3.5" />
                {t("PPh21 final atas {base} — 0-50jt 0% · 50-100jt 10% · 100-500jt 20% · >500jt 25%", "Final income tax on {base} — 0-50M 0% · 50-100M 10% · 100-500M 20% · >500M 25%", { base: fmtIDR(result.taxBase) })}
              </summary>
              <ul className="mt-2 space-y-1 pl-1 text-slate-500">
                {result.taxBrackets.map((b, i) => (
                  <li key={i} className={cn("flex justify-between tabular-nums", b.taxable === 0 && "opacity-50")}>
                    <span>{fmtIDR(b.lowerLimit)} – {b.upperLimit ? fmtIDR(b.upperLimit) : "∞"} · {(b.rate * 100).toFixed(0)}%</span>
                    <span>{b.taxable > 0 ? `${fmtIDR(b.taxable)} → ${fmtIDR(b.tax)}` : "—"}</span>
                  </li>
                ))}
              </ul>
            </details>

            {result.notes.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-dashed border-slate-300 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-400 dark:border-slate-700">
                {result.notes.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            )}

            <p className="flex items-start gap-2 text-[10px] leading-relaxed text-slate-400">
              <Badge variant="outline" className="h-4 shrink-0 rounded px-1.5 text-[9px] font-bold text-slate-400">i18n · UU 13/2003</Badge>
              {t(
                "Pesangon UPMK: <1th 1 bln · 1-2th 2 · 2-3th 3 · 3-6th 4 · 6-9th 6 · 9-12th 8 · ≥12th 9 bln upah. Uang pengganti cuti = hari × upah/25. Pajak final PP 68/2009 atas kelompok pesangon (tanpa PTKP). Angka final mengikuti data saat PA diproses.",
                "UPMK severance: <1y 1 mo · 1-2y 2 · 2-3y 3 · 3-6y 4 · 6-9y 6 · 9-12y 8 · ≥12y 9 months' wage. Unused leave pay = days × wage/25. Final tax per PP 68/2009 on the severance group (no PTKP). Final figures follow the data at the time the PA is processed.",
              )}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11 px-6">{t("Tutup", "Close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SettlementPreviewDialog;
