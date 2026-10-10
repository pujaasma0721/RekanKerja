"use client";
// RekanKerja Payroll — Parameter Pajak: bracket progresif, TER (PP 58/2023), regulasi BPJS
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/rekankerja/shared/lib/api";
import { PageHeader, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Percent, Scale, Landmark, Save, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { MinimumWageTab } from "@/rekankerja/payroll/components/minimum-wage-tab";

interface TaxData {
  brackets: { id: string; lowerLimit: number; upperLimit: number | null; rateNpwp: number; rateNonNpwp: number }[];
  ter: { id: string; category: string; lowerLimit: number; upperLimit: number | null; rate: number }[];
  regulation: {
    id: string; code: string; name: string;
    biayaJabatanRate: number; biayaJabatanCapMonthly: number;
    jhtEmployeeRate: number; jhtCompanyRate: number;
    jpEmployeeRate: number; jpCompanyRate: number; jpSalaryCap: number;
    jkkRate: number; jkmRate: number;
    jpkCompanyRate: number; jpkEmployeeRate: number; jpkSalaryCap: number;
    jkpCompanyRate: number; jkpEmployeeRate: number; jkpSalaryCap: number;
    nonNpwpSurcharge: number; useTer: boolean;
  } | null;
  ptkp: Record<string, number>;
}

export function PayrollParametersPage() {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<TaxData>("/api/rekankerja/tax-parameters");
  const [tab, setTab] = useState("regulation");
  const [reg, setReg] = useState<TaxData["regulation"]>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  // sinkron lokal saat data dimuat
  const dataKey = data?.regulation?.id ?? "none";
  if (key !== dataKey) {
    setKey(dataKey);
    setReg(data?.regulation ?? null);
  }

  const save = async () => {
    if (!reg) return;
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/tax-parameters", "PATCH", reg);
      toast.success(t("Parameter regulasi disimpan — run berikutnya memakai nilai baru", "Regulation parameters saved — the next run uses the new values"));
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const num = (v: string) => Number(v) || 0;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Parameter Pajak & Regulasi", "Tax Parameters & Regulations")}
        description={t("Bracket PPh21 progresif (UU HPP), TER PP 58/2023, biaya jabatan, PTKP, tarif/cap BPJS, dan UMP/UMK per kantor — dipakai engine perhitungan", "Progressive PPh21 brackets (HPP Law), TER PP 58/2023, employment expense, PTKP, BPJS rates/caps, and UMP/UMK per office — used by the calculation engine")}
      />

      {loading && !data ? (
        <LoadingRows rows={6} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 h-auto rounded-2xl ov-tile p-1.5">
            <TabsTrigger value="regulation" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
              <Landmark className="h-3.5 w-3.5" /> {t("Regulasi & BPJS", "Regulation & BPJS")}
            </TabsTrigger>
            <TabsTrigger value="brackets" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
              <Scale className="h-3.5 w-3.5" /> {t("Bracket Progresif", "Progressive Brackets")}
            </TabsTrigger>
            <TabsTrigger value="ter" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
              <Percent className="h-3.5 w-3.5" /> {t("TER (PP 58/2023)")}
            </TabsTrigger>
            <TabsTrigger value="ptkp" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
              {t("PTKP")}
            </TabsTrigger>
            <TabsTrigger value="umk" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
              <Coins className="h-3.5 w-3.5" /> {t("UMP/UMK", "Min. Wage")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="regulation">
            {reg && (
              <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-bold">
                    <span className="flex items-center gap-2"><Landmark className="h-4 w-4 ov-text-accent" /> {reg.name} <Badge variant="outline" className="font-mono text-[10px]">{reg.code}</Badge></span>
                    <Button onClick={save} disabled={busy} className="gap-2 font-bold">
                      <Save className="h-4 w-4" /> {busy ? t("Menyimpan…") : t("Simpan Parameter", "Save Parameters")}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="mb-4 flex items-center justify-between rounded-xl border border-brand/25 bg-brand/10 p-3.5 dark:border-brand/30 dark:bg-brand/10">
                    <div>
                      <p className="text-xs font-bold">{t("Gunakan Metode TER", "Use TER Method")}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">{t("Tarif efektif bulanan (PP 58/2023) sebagai pengganti progresif annualized — khusus WNI ber-NPWP", "Monthly effective rate (PP 58/2023) replacing annualized progressive — for Indonesian citizens with NPWP")}</p>
                    </div>
                    <Switch checked={reg.useTer} onCheckedChange={(v) => setReg({ ...reg, useTer: v })} />
                  </div>

                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("PPh21")}</p>
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <NumField label={t("Biaya Jabatan (%)", "Employment Expense (%)")} value={String(reg.biayaJabatanRate * 100)} onChange={(v) => setReg({ ...reg, biayaJabatanRate: num(v) / 100 })} suffix="%" />
                    <NumField label={t("Cap Biaya Jabatan / bulan", "Employment Expense Cap / month")} value={String(reg.biayaJabatanCapMonthly)} onChange={(v) => setReg({ ...reg, biayaJabatanCapMonthly: num(v) })} money />
                    <NumField label={t("Penalti Non-NPWP (informatif)", "Non-NPWP Surcharge (informative)")} value={String(reg.nonNpwpSurcharge * 100)} onChange={(v) => setReg({ ...reg, nonNpwpSurcharge: num(v) / 100 })} suffix="%" />
                  </div>
                  {/* Task 82-b: nonNpwpSurcharge dorman di engine — penalti aktual via
                      bracket rateNonPpwp (seed rate×1,2) → label informatif. */}
                  <p className="mb-2 text-[10px] leading-relaxed text-slate-400">
                    {t("Penalti Non-NPWP: field ini informatif — penalti aktual non-NPWP mengikuti bracket Pasal 17 (kolom rate non-NPWP)", "Non-NPWP surcharge: this field is informative — the actual non-NPWP penalty follows the Article 17 brackets (non-NPWP rate column)")}
                  </p>

                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("BPJS / JSTK")}</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <NumField label={t("JHT Pegawai", "JHT Employee")} value={String(reg.jhtEmployeeRate * 100)} onChange={(v) => setReg({ ...reg, jhtEmployeeRate: num(v) / 100 })} suffix="%" />
                    <NumField label={t("JHT Perusahaan", "JHT Company")} value={String(reg.jhtCompanyRate * 100)} onChange={(v) => setReg({ ...reg, jhtCompanyRate: num(v) / 100 })} suffix="%" />
                    <div />
                    <NumField label={t("JP Pegawai", "JP Employee")} value={String(reg.jpEmployeeRate * 100)} onChange={(v) => setReg({ ...reg, jpEmployeeRate: num(v) / 100 })} suffix="%" />
                    <NumField label={t("JP Perusahaan", "JP Company")} value={String(reg.jpCompanyRate * 100)} onChange={(v) => setReg({ ...reg, jpCompanyRate: num(v) / 100 })} suffix="%" />
                    <NumField label={t("Cap Gaji JP", "JP Salary Cap")} value={String(reg.jpSalaryCap)} onChange={(v) => setReg({ ...reg, jpSalaryCap: num(v) })} money />
                    <NumField label={t("JPK Pegawai", "JPK Employee")} value={String(reg.jpkEmployeeRate * 100)} onChange={(v) => setReg({ ...reg, jpkEmployeeRate: num(v) / 100 })} suffix="%" />
                    <NumField label={t("JPK Perusahaan", "JPK Company")} value={String(reg.jpkCompanyRate * 100)} onChange={(v) => setReg({ ...reg, jpkCompanyRate: num(v) / 100 })} suffix="%" />
                    <NumField label={t("Cap Gaji JPK", "JPK Salary Cap")} value={String(reg.jpkSalaryCap)} onChange={(v) => setReg({ ...reg, jpkSalaryCap: num(v) })} money />
                    <NumField label={t("JKK")} value={String(reg.jkkRate * 100)} onChange={(v) => setReg({ ...reg, jkkRate: num(v) / 100 })} suffix="%" />
                    <NumField label={t("JKM")} value={String(reg.jkmRate * 100)} onChange={(v) => setReg({ ...reg, jkmRate: num(v) / 100 })} suffix="%" />
                    <div />
                    <NumField label={t("JKP Pegawai (0% — PP 6/2025)", "JKP Employee (0% — GR 6/2025)")} value={String((reg.jkpEmployeeRate ?? 0) * 100)} onChange={(v) => setReg({ ...reg, jkpEmployeeRate: num(v) / 100 })} suffix="%" />
                    <NumField label={t("JKP Rekomposisi JKK (informatif)", "JKP JKK Reallocation (informative)")} value={String((reg.jkpCompanyRate ?? 0) * 100)} onChange={(v) => setReg({ ...reg, jkpCompanyRate: num(v) / 100 })} suffix="%" />
                    <NumField label={t("Cap Upah JKP", "JKP Salary Cap")} value={String(reg.jkpSalaryCap ?? 0)} onChange={(v) => setReg({ ...reg, jkpSalaryCap: num(v) })} money />
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                    {t(
                      "Jaminan Kehilangan Pekerjaan (PP 6/2025 Ps.11): iuran 0,36% dari upah s.d. plafon = 0,22% ditanggung APBN + 0,14% REKOMPOSISI iuran JKK yang sudah dibayar perusahaan. TIDAK ADA potongan pekerja (0%) dan TIDAK ADA beban iuran baru perusahaan — nilai 0,14% di sini informatif utk rekap BPJS. Manfaat diklaim pekerja saat PHK.",
                      "Unemployment insurance (GR 6/2025 Art.11): 0.36% of capped wage = 0.22% government (APBN) + 0.14% reallocated from the already-paid JKK premium. NO employee deduction (0%) and NO new employer cost — the 0.14% here is informative for the BPJS recap. Claimed by the worker on termination.",
                    )}
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="brackets">
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">{t("Bracket PPh21 Progresif — UU HPP (Pasal 17)", "Progressive PPh21 Brackets — HPP Law (Article 17)")}</CardTitle>
                <p className="text-[11px] text-slate-400">{t("PKP tahunan; non-NPWP dikenai tarif +{n}%", "Annual PKP; non-NPWP charged rate +{n}%", { n: ((data?.regulation?.nonNpwpSurcharge ?? 0.2) * 100).toFixed(0) })}</p>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableHead className="text-[11px] font-bold">{t("PKP Dari", "PKP From")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("PKP Sampai", "PKP Up To")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("Tarif NPWP", "NPWP Rate")}</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">{t("Tarif Non-NPWP", "Non-NPWP Rate")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.brackets ?? []).map((b) => (
                      <TableRow key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <TableCell className="text-xs font-semibold">{fmtIDR(b.lowerLimit)}</TableCell>
                        <TableCell className="text-xs">{b.upperLimit ? fmtIDR(b.upperLimit) : <Badge variant="outline" className="text-[10px]">{t("∞ tanpa batas", "∞ unlimited")}</Badge>}</TableCell>
                        <TableCell className="text-right text-xs font-extrabold ov-text-accent">{(b.rateNpwp * 100).toFixed(0)}%</TableCell>
                        <TableCell className="text-right text-xs font-bold text-rose-600 dark:text-rose-400">{(b.rateNonNpwp * 100).toFixed(0)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ter">
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold"><Percent className="h-4 w-4 ov-text-accent" /> {t("Tarif Efektif Rata-rata (TER) — PP 58/2023", "Average Effective Rate (TER) — PP 58/2023")}</CardTitle>
                <p className="text-[11px] text-slate-400">
                  {t("Tarif bulanan atas bruto. Kategori A: TK/0–1 & K/0–1 · B: TK/2–3, K/2–3, K/I/0–1 · C: K/I/2–3. Aktif jika switch TER dihidupkan (", "Monthly rate on gross. Category A: TK/0–1 & K/0–1 · B: TK/2–3, K/2–3, K/I/0–1 · C: K/I/2–3. Active when the TER switch is on (")}
                  {data?.regulation?.useTer ? <span className="font-bold text-brand">{t("aktif", "active")}</span> : <span className="font-bold text-slate-500">{t("non-aktif — progresif", "inactive — progressive")}</span>}{t(").", ").")}
                </p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-4 lg:grid-cols-3">
                  {["A", "B", "C"].map((cat) => (
                    <div key={cat}>
                      <p className={cn("mb-1.5 text-[11px] font-bold uppercase tracking-wider", cat === "A" ? "text-brand dark:text-brand/85" : cat === "B" ? "text-brand dark:text-brand/85" : "text-rose-600 dark:text-rose-400")}>
                        {t("Kategori {c} ({n} rentang)", "Category {c} ({n} ranges)", { c: cat, n: (data?.ter ?? []).filter((ter) => ter.category === cat).length })}
                      </p>
                      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                              <TableHead className="text-[10px] font-bold">{t("Bruto/Bulan", "Gross/Month")}</TableHead>
                              <TableHead className="text-right text-[10px] font-bold">{t("Tarif", "Rate")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(data?.ter ?? []).filter((ter) => ter.category === cat).map((ter) => (
                              <TableRow key={ter.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                                <TableCell className="text-[10px]">
                                  {fmtIDR(ter.lowerLimit)}{ter.upperLimit ? ` – ${fmtIDR(ter.upperLimit)}` : "+"}
                                </TableCell>
                                <TableCell className="text-right text-[10px] font-bold">{(ter.rate * 100).toFixed(2)}%</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ptkp">
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">{t("Penghasilan Tidak Kena Pajak (PTKP) — Tahunan", "Non-Taxable Income (PTKP) — Annual")}</CardTitle>
                <p className="text-[11px] text-slate-400">{t("TK = tidak menikah · K = menikah (pasangan tidak bekerja) · K/I = menikah, pasangan bekerja · angka = tanggungan", "TK = single · K = married (non-working spouse) · K/I = married, working spouse · number = dependents")}</p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
                  {Object.entries(data?.ptkp ?? {}).map(([status, value]) => (
                    <div key={status} className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-center dark:border-slate-800 dark:bg-slate-900/40">
                      <p className="text-xs font-extrabold ov-text-accent">{status.replace(/(\d+)$/, "/$1").replace(/^KI/, "K/I/")}</p>
                      <p className="mt-0.5 text-[11px] font-bold">{fmtIDR(value)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 26-b P0 — UMP/UMK per kantor (PP 36/2021): CRUD + filter tahun */}
          <TabsContent value="umk">
            <MinimumWageTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function NumField({ label, value, onChange, suffix, money }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; money?: boolean }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="relative mt-1.5">
        <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={cn("font-mono", (suffix || money) && "pr-10")} />
        {(suffix || money) && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">{suffix ?? "Rp"}</span>}
      </div>
    </div>
  );
}
