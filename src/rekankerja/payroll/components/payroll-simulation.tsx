"use client";
// RekanKerja Payroll — Simulasi THP (P1.4-BM, D-BM9): estimasi take-home-pay
// stateless memakai engine TER + Pasal 17 yang SAMA dgn run nyata. Label
// "estimasi simulasi — bukan slip gaji" ditonjolkan (risiko D-BM9: simulasi
// jangan dianggap janji gaji). Komponen ESS `ThpSimulationForm` dipakai ulang
// di tab "Simulasi Gaji" ESS (input manual murni — kebijakan vault: TIDAK ada
// prefill gaji nyata).
import { useState } from "react";
import { Calculator, Plus, Trash2, Loader2, Info, BadgeAlert, TrendingUp, TrendingDown, ReceiptText, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { apiSend, fmtIDR } from "@/rekankerja/shared/lib/api";
import { PageHeader } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { TAX_STATUS_OPTIONS } from "@/rekankerja/payroll/components/payroll-types";

// ---- tipe hasil (mirror simulation-service) ----
interface SimResult {
  bruto: number;
  taxAllowance: number;
  grossTotal: number;
  deductions: { name: string; amount: number; kind: string }[];
  netBeforeTax: number;
  ptkp: number;
  pkpMonthly: number;
  taxMonthly: number;
  netAfterTax: number;
  terCategory: "A" | "B" | "C";
  terRate: number | null;
  biayaJabatan: number;
  ptkpAnnual: number;
  pkpAnnual: number;
  methodUsed: "TER" | "Pasal17";
  methodRequested: "TER" | "Pasal17";
  grossUpApplied: boolean;
  terFallback: boolean;
  breakdown: { key: string; name: string; amount: number; tone: "earn" | "deduct" | "info" }[];
}

interface Row { name: string; amount: string }

/** Label bilingual baris breakdown ber-kunci stabil (fallback: nama service). */
function breakdownLabel(key: string, name: string, t: (id: string, en?: string) => string): string {
  switch (key) {
    case "taxAllow": return t("Tunjangan PPh21 Ditanggung Perusahaan", "Company-Borne PPh21 Allowance");
    case "iuran": return t("Iuran Pensiun (JHT + JP + JKP pegawai)", "Pension Contribution (employee JHT + JP + JKP)");
    case "biayaJabatan": return t("Biaya jabatan (pengurang neto pajak)", "Occupational expense (net-income deduction)");
    case "pkp": return t("PKP setahun (dibulatkan ribuan)", "Annual taxable income (rounded to thousands)");
    case "tax": return name; // memuat metode aktual (TER / Pasal 17)
    case "ptkp": return name;
    default: return name; // komponen & potongan = nama yang dimasukkan user
  }
}

/**
 * Form simulasi THP (dipakai admin Payroll & ESS — tanpa prefill data nyata).
 * `ess` = true → tanpa PageHeader (ditempel sebagai tab ESS), badge tetap.
 */
export function ThpSimulationForm({ ess = false }: { ess?: boolean }) {
  const { t } = useI18n();
  const [comps, setComps] = useState<Row[]>([{ name: t("Gaji Pokok (hipotetis)", "Base Salary (hypothetical)"), amount: "10000000" }]);
  const [deds, setDeds] = useState<Row[]>([]);
  const [iuran, setIuran] = useState("");
  const [ptkp, setPtkp] = useState("TK0");
  const [npwp, setNpwp] = useState(true);
  const [month, setMonth] = useState<"regular" | "irregular">("regular");
  const [method, setMethod] = useState<"TER" | "Pasal17">("TER");
  const [grossUp, setGrossUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);

  const parseAmount = (v: string): number => {
    const n = Number(String(v).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const submit = async () => {
    const components = comps
      .filter((c) => c.name.trim() && parseAmount(c.amount) > 0)
      .map((c) => ({ name: c.name.trim(), amount: parseAmount(c.amount) }));
    if (components.length === 0) {
      toast.error(t("Isi minimal satu komponen bruto bernilai", "Fill at least one gross component with a value"));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await apiSend<{ result: SimResult }>(
        ess ? "/api/rekankerja/ess/simulation" : "/api/rekankerja/payroll/simulation",
        "POST",
        {
          components,
          deductionsNonTaxable: deds
            .filter((d) => d.name.trim() && parseAmount(d.amount) > 0)
            .map((d) => ({ name: d.name.trim(), amount: parseAmount(d.amount) })),
          iuranPensiun: parseAmount(iuran),
          ptkpCategory: ptkp,
          npwp,
          month,
          grossUp,
          method,
        },
      );
      setResult(res.result);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const rowEditor = (
    rows: Row[],
    setRows: (r: Row[]) => void,
    title: string,
    titleEn: string,
    IconCmp: React.ElementType,
    tone: "earn" | "deduct",
  ) => (
    <div>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600 dark:text-slate-300">
          <IconCmp className={cn("h-3.5 w-3.5", tone === "earn" ? "text-brand" : "text-rose-500")} aria-hidden /> {t(title, titleEn)}
        </p>
        <Button
          type="button" variant="outline" size="sm" className="h-7 gap-1 rounded-lg px-2 text-[11px] font-bold"
          onClick={() => setRows([...rows, { name: "", amount: "" }])}
        >
          <Plus className="h-3 w-3" /> {t("Tambah", "Add")}
        </Button>
      </div>
      <div className="mt-2 space-y-1.5">
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-400 dark:border-slate-700">
            {tone === "earn"
              ? t("Belum ada komponen — tambahkan baris pertama.", "No components yet — add the first row.")
              : t("Tidak ada potongan non-pajak (opsional).", "No non-taxable deductions (optional).")}
          </p>
        )}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={r.name}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              placeholder={tone === "earn" ? t("cth: Tunjangan Transport", "e.g. Transport Allowance") : t("cth: Angsuran Pinjaman", "e.g. Loan Installment")}
              className="h-8 flex-1 rounded-lg text-[12px]"
              aria-label={tone === "earn" ? t("Nama komponen #{n}", "Component name #{n}", { n: String(i + 1) }) : t("Nama potongan #{n}", "Deduction name #{n}", { n: String(i + 1) })}
            />
            <Input
              value={r.amount}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
              inputMode="numeric"
              placeholder="0"
              className="h-8 w-32 rounded-lg text-right text-[12px] tabular-nums"
              aria-label={t("Nominal #{n}", "Amount #{n}", { n: String(i + 1) })}
            />
            <button
              type="button"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:border-rose-200 hover:text-rose-500 dark:border-slate-700"
              aria-label={t("Hapus baris", "Delete row")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      {/* ===== FORM ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <Calculator className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Input Simulasi (hipotetis)", "Simulation Inputs (hypothetical)")}
            <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-[9px] font-bold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
              <BadgeAlert className="h-3 w-3" aria-hidden /> {t("estimasi simulasi — bukan slip gaji", "simulation estimate — not a payslip")}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rowEditor(comps, setComps, "Komponen Bruto (pendapatan)", "Gross Components (Earnings)", TrendingUp, "earn")}
          {rowEditor(deds, setDeds, "Potongan Non-Pajak", "Non-Taxable Deductions", TrendingDown, "deduct")}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">{t("Iuran Pensiun Pegawai (JHT+JP+JKP)", "Employee Pension Contribution (JHT+JP+JKP)")}</Label>
              <Input
                value={iuran} onChange={(e) => setIuran(e.target.value)} inputMode="numeric" placeholder="0"
                className="mt-1.5 h-9 rounded-xl text-right text-[12px] tabular-nums"
                aria-label={t("Iuran pensiun", "Pension contribution")}
              />
              <p className="mt-1 text-[10px] leading-snug text-slate-400">
                {t("Pengurang neto pajak (UU PPh 21(3)(a)) — masukkan jumlah bulanan.", "Net-income tax deduction (Income Tax Art. 21(3)(a)) — enter the monthly total.")}
              </p>
            </div>
            <div>
              <Label className="text-xs">{t("Status PTKP *", "PTKP Status *")}</Label>
              <Select value={ptkp} onValueChange={setPtkp}>
                <SelectTrigger className="mt-1.5 h-9 rounded-xl text-xs font-bold"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TAX_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10px] text-slate-400">{t("Kategori TER: A / B / C mengikuti PTKP.", "TER category: A / B / C follows PTKP.")}</p>
            </div>
            <div>
              <Label className="text-xs">{t("Jenis Bulan *", "Month Type *")}</Label>
              <Select value={month} onValueChange={(v) => setMonth(v === "irregular" ? "irregular" : "regular")}>
                <SelectTrigger className="mt-1.5 h-9 rounded-xl text-xs font-bold"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular" className="text-xs">{t("Reguler (gaji bulanan)", "Regular (monthly salary)")}</SelectItem>
                  <SelectItem value="irregular" className="text-xs">{t("Ireguler (THR/bonus — TER tidak boleh)", "Irregular (THR/bonus — TER not allowed)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("Metode PPh21 *", "PPh21 Method *")}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v === "Pasal17" ? "Pasal17" : "TER")} disabled={month === "irregular"}>
                <SelectTrigger className="mt-1.5 h-9 rounded-xl text-xs font-bold"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TER" className="text-xs" disabled={!npwp}>{t("TER (PMK 168/2023)", "TER (PMK 168/2023)")}</SelectItem>
                  <SelectItem value="Pasal17" className="text-xs">{t("Pasal 17 progresif", "Progressive Article 17")}</SelectItem>
                </SelectContent>
              </Select>
              {month === "irregular" && (
                <p className="mt-1 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                  {t("Bulan ireguler wajib Pasal 17 (PP 58/2023).", "Irregular months must use Article 17 (GR 58/2023).")}
                </p>
              )}
              {!npwp && month === "regular" && (
                <p className="mt-1 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                  {t("Non-NPWP memakai tarif Pasal 17 + 20% (UU HPP).", "Non-NPWP uses Article 17 rates + 20% surcharge (HPP Law).")}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="min-w-0 pr-2">
                <p className="text-[11.5px] font-bold">{t("Memiliki NPWP", "Has NPWP")}</p>
                <p className="text-[10px] text-slate-400">{t("TER hanya utk pemotong ber-NPWP.", "TER only for NPWP holders.")}</p>
              </div>
              <Switch checked={npwp} onCheckedChange={setNpwp} aria-label={t("Memiliki NPWP", "Has NPWP")} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="min-w-0 pr-2">
                <p className="text-[11.5px] font-bold">{t("Pajak Ditanggung Perusahaan (gross-up)", "Company-Borne Tax (gross-up)")}</p>
                <p className="text-[10px] text-slate-400">{t("Netto tetap — perusahaan menambah tunjangan pajak.", "Net stays — company adds a tax allowance.")}</p>
              </div>
              <Switch checked={grossUp} onCheckedChange={setGrossUp} aria-label={t("Pajak ditanggung perusahaan", "Company-borne tax")} />
            </div>
          </div>

          <Button onClick={submit} disabled={busy} className="w-full gap-2 rounded-xl bg-brand font-bold hover:bg-brand/70">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            {busy ? t("Menghitung estimasi…", "Computing estimate…") : t("Hitung Simulasi THP", "Compute THP Simulation")}
          </Button>
        </CardContent>
      </Card>

      {/* ===== HASIL ===== */}
      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        {result ? (
          <>
            <Card className="overflow-hidden rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand-deep dark:bg-brand/15 dark:text-brand/85">
                      <ReceiptText className="h-5 w-5" aria-hidden />
                    </span>
                    <div>
                      <p className="text-[13px] font-extrabold text-slate-900 dark:text-slate-50">{t("Estimasi Take-Home Pay", "Estimated Take-Home Pay")}</p>
                      <p className="text-[11px] text-slate-400">
                        {t("Metode {m} · TER kategori {c}", "Method {m} · TER category {c}", {
                          m: result.methodUsed === "TER" ? "TER" : "Pasal 17",
                          c: result.terCategory,
                        })}
                        {result.terRate != null && result.methodUsed === "TER" ? ` · ${(result.terRate * 100).toFixed(2)}%` : ""}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-[9px] font-bold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
                    <BadgeAlert className="h-3 w-3" aria-hidden /> {t("estimasi simulasi — bukan slip gaji", "simulation estimate — not a payslip")}
                  </Badge>
                </div>
                <div className="space-y-2.5 py-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">{t("Bruto (termasuk tunjangan pajak)", "Gross (incl. tax allowance)")}</span>
                    <span className="text-[14px] font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{fmtIDR(result.grossTotal)}</span>
                  </div>
                  {result.taxAllowance > 0 && (
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">{t("— di dalamnya tunjangan PPh21", "— of which PPh21 allowance")}</span>
                      <span className="text-[13px] font-bold tabular-nums text-slate-600 dark:text-slate-300">{fmtIDR(result.taxAllowance)}</span>
                    </div>
                  )}
                  {result.deductions.length > 0 && (
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">{t("Potongan (iuran + non-pajak)", "Deductions (contributions + non-tax)")}</span>
                      <span className="text-[13px] font-bold tabular-nums text-rose-600 dark:text-rose-400">
                        −{fmtIDR(result.deductions.reduce((s, d) => s + d.amount, 0))}
                      </span>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] font-semibold text-slate-500 dark:text-slate-400">{t("PPh21 (estimasi)", "PPh21 (estimate)")}</span>
                    <span className="text-[13px] font-bold tabular-nums text-rose-600 dark:text-rose-400">−{fmtIDR(result.taxMonthly)}</span>
                  </div>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-brand to-brand/70 p-4.5 text-white shadow-lg">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/80">
                    <Wallet className="h-3.5 w-3.5" aria-hidden /> {t("THP Setelah Pajak (estimasi)", "Net Take-Home Pay (estimate)")}
                  </p>
                  <p className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums">{fmtIDR(result.netAfterTax)}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">{t("Rincian Perhitungan", "Calculation Breakdown")}</CardTitle>
              </CardHeader>
              <CardContent className="px-5 py-1">
                {result.breakdown.map((b, i) => (
                  <div key={`${b.key}-${i}`} className="flex items-baseline justify-between gap-4 border-b border-dashed border-slate-200/70 py-2 last:border-b-0 dark:border-slate-800/70">
                    <span className={cn(
                      "min-w-0 break-words text-[12.5px]",
                      b.tone === "info" ? "font-medium text-slate-400" : "font-medium text-slate-600 dark:text-slate-300",
                    )}>
                      {breakdownLabel(b.key, b.name, t)}
                      {b.key === "tax" && result.terFallback ? (
                        <span className="ml-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                          ({t("fallback Pasal 17 — lapisan TER tidak ditemukan", "Article 17 fallback — TER layer not found")})
                        </span>
                      ) : null}
                    </span>
                    <span className={cn(
                      "shrink-0 text-[13px] font-bold tabular-nums",
                      b.tone === "earn" && "text-brand-deep dark:text-brand/85",
                      b.tone === "deduct" && "text-rose-600 dark:text-rose-400",
                      b.tone === "info" && "text-slate-400",
                    )}>
                      {b.tone === "deduct" ? "−" : ""}{fmtIDR(b.amount)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="rounded-2xl border-dashed border-slate-300 bg-slate-50/50 shadow-sm dark:border-slate-700 dark:bg-slate-900/30">
            <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Info className="h-5 w-5 text-slate-400" aria-hidden />
              <p className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">{t("Hasil simulasi muncul di sini", "Simulation results appear here")}</p>
              <p className="max-w-sm text-[11.5px] leading-relaxed text-slate-400">
                {t(
                  "Masukkan komponen hypothetical lalu tekan Hitung. Perhitungan memakai tabel TER resmi (PMK 168/2023) + Pasal 17 progresif + gross-up iteratif — fungsi yang sama dengan mesin payroll run nyata.",
                  "Enter hypothetical components then press Compute. The calculation uses the official TER tables (PMK 168/2023) + progressive Article 17 + iterative gross-up — the same functions as the real payroll run engine.",
                )}
              </p>
            </CardContent>
          </Card>
        )}
        <p className="px-1 text-[11px] leading-relaxed text-slate-400">
          {t(
            "Hasil ini adalah estimasi simulasi — bukan slip gaji dan bukan janji pembayaran. Nilai payroll aktual mengikuti profil, regulasi BPJS/PPh21 berlaku, dan hasil run yang dikonfirmasi.",
            "This result is a simulation estimate — not a payslip and not a payment promise. Actual payroll follows your profile, prevailing BPJS/tax regulations, and confirmed run results.",
          )}
        </p>
      </div>
    </div>
  );
}

/** Halaman admin modul Payroll — nav "simulation" (nav id terdaftar app-shell). */
export function PayrollSimulationPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Simulasi THP", "THP Simulation")}
        description={t(
          "Estimasi take-home-pay stateless dengan engine yang sama dengan run nyata (TER resmi + Pasal 17 + gross-up). Tidak menyimpan data payroll apa pun.",
          "Stateless take-home-pay estimation using the same engine as real runs (official TER + Article 17 + gross-up). No payroll data is stored.",
        )}
      />
      <ThpSimulationForm />
    </div>
  );
}
