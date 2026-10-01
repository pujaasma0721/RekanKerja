"use client";
// RekanKerja Payroll — Parameter Pajak: bracket progresif, TER (PP 58/2023), regulasi BPJS
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/lib/rekankerja/api";
import { PageHeader, LoadingRows } from "@/components/rekankerja/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Percent, Scale, Landmark, Save } from "lucide-react";
import { cn } from "@/lib/utils";

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
    nonNpwpSurcharge: number; useTer: boolean;
  } | null;
  ptkp: Record<string, number>;
}

export function PayrollParametersPage() {
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
      toast.success("Parameter regulasi disimpan — run berikutnya memakai nilai baru");
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const num = (v: string) => Number(v) || 0;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Parameter Pajak & Regulasi"
        description="Bracket PPh21 progresif (UU HPP), TER PP 58/2023, biaya jabatan, PTKP, dan tarif/cap BPJS — dipakai engine perhitungan"
      />

      {loading && !data ? (
        <LoadingRows rows={6} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 h-auto rounded-2xl bg-slate-100 p-1.5 dark:bg-slate-900">
            <TabsTrigger value="regulation" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-emerald-400">
              <Landmark className="h-3.5 w-3.5" /> Regulasi & BPJS
            </TabsTrigger>
            <TabsTrigger value="brackets" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-emerald-400">
              <Scale className="h-3.5 w-3.5" /> Bracket Progresif
            </TabsTrigger>
            <TabsTrigger value="ter" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-emerald-400">
              <Percent className="h-3.5 w-3.5" /> TER (PP 58/2023)
            </TabsTrigger>
            <TabsTrigger value="ptkp" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-emerald-400">
              PTKP
            </TabsTrigger>
          </TabsList>

          <TabsContent value="regulation">
            {reg && (
              <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-bold">
                    <span className="flex items-center gap-2"><Landmark className="h-4 w-4 text-emerald-600" /> {reg.name} <Badge variant="outline" className="font-mono text-[10px]">{reg.code}</Badge></span>
                    <Button onClick={save} disabled={busy} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
                      <Save className="h-4 w-4" /> {busy ? "Menyimpan…" : "Simpan Parameter"}
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <div>
                      <p className="text-xs font-bold">Gunakan Metode TER</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Tarif efektif bulanan (PP 58/2023) sebagai pengganti progresif annualized — khusus WNI ber-NPWP</p>
                    </div>
                    <Switch checked={reg.useTer} onCheckedChange={(v) => setReg({ ...reg, useTer: v })} />
                  </div>

                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">PPh21</p>
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <NumField label="Biaya Jabatan (%)" value={String(reg.biayaJabatanRate * 100)} onChange={(v) => setReg({ ...reg, biayaJabatanRate: num(v) / 100 })} suffix="%" />
                    <NumField label="Cap Biaya Jabatan / bulan" value={String(reg.biayaJabatanCapMonthly)} onChange={(v) => setReg({ ...reg, biayaJabatanCapMonthly: num(v) })} money />
                    <NumField label="Penalti Non-NPWP" value={String(reg.nonNpwpSurcharge * 100)} onChange={(v) => setReg({ ...reg, nonNpwpSurcharge: num(v) / 100 })} suffix="%" />
                  </div>

                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">BPJS / JSTK</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <NumField label="JHT Pegawai" value={String(reg.jhtEmployeeRate * 100)} onChange={(v) => setReg({ ...reg, jhtEmployeeRate: num(v) / 100 })} suffix="%" />
                    <NumField label="JHT Perusahaan" value={String(reg.jhtCompanyRate * 100)} onChange={(v) => setReg({ ...reg, jhtCompanyRate: num(v) / 100 })} suffix="%" />
                    <div />
                    <NumField label="JP Pegawai" value={String(reg.jpEmployeeRate * 100)} onChange={(v) => setReg({ ...reg, jpEmployeeRate: num(v) / 100 })} suffix="%" />
                    <NumField label="JP Perusahaan" value={String(reg.jpCompanyRate * 100)} onChange={(v) => setReg({ ...reg, jpCompanyRate: num(v) / 100 })} suffix="%" />
                    <NumField label="Cap Gaji JP" value={String(reg.jpSalaryCap)} onChange={(v) => setReg({ ...reg, jpSalaryCap: num(v) })} money />
                    <NumField label="JPK Pegawai" value={String(reg.jpkEmployeeRate * 100)} onChange={(v) => setReg({ ...reg, jpkEmployeeRate: num(v) / 100 })} suffix="%" />
                    <NumField label="JPK Perusahaan" value={String(reg.jpkCompanyRate * 100)} onChange={(v) => setReg({ ...reg, jpkCompanyRate: num(v) / 100 })} suffix="%" />
                    <NumField label="Cap Gaji JPK" value={String(reg.jpkSalaryCap)} onChange={(v) => setReg({ ...reg, jpkSalaryCap: num(v) })} money />
                    <NumField label="JKK" value={String(reg.jkkRate * 100)} onChange={(v) => setReg({ ...reg, jkkRate: num(v) / 100 })} suffix="%" />
                    <NumField label="JKM" value={String(reg.jkmRate * 100)} onChange={(v) => setReg({ ...reg, jkmRate: num(v) / 100 })} suffix="%" />
                    <div />
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="brackets">
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">Bracket PPh21 Progresif — UU HPP (Pasal 17)</CardTitle>
                <p className="text-[11px] text-slate-400">PKP tahunan; non-NPWP dikenai tarif +{((data?.regulation?.nonNpwpSurcharge ?? 0.2) * 100).toFixed(0)}%</p>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableHead className="text-[11px] font-bold">PKP Dari</TableHead>
                      <TableHead className="text-[11px] font-bold">PKP Sampai</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">Tarif NPWP</TableHead>
                      <TableHead className="text-right text-[11px] font-bold">Tarif Non-NPWP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.brackets ?? []).map((b) => (
                      <TableRow key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <TableCell className="text-xs font-semibold">{fmtIDR(b.lowerLimit)}</TableCell>
                        <TableCell className="text-xs">{b.upperLimit ? fmtIDR(b.upperLimit) : <Badge variant="outline" className="text-[10px]">∞ tanpa batas</Badge>}</TableCell>
                        <TableCell className="text-right text-xs font-extrabold text-emerald-700 dark:text-emerald-400">{(b.rateNpwp * 100).toFixed(0)}%</TableCell>
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
                <CardTitle className="flex items-center gap-2 text-sm font-bold"><Percent className="h-4 w-4 text-emerald-600" /> Tarif Efektif Rata-rata (TER) — PP 58/2023</CardTitle>
                <p className="text-[11px] text-slate-400">
                  Tarif bulanan atas bruto. Kategori A: TK/0–1 & K/0–1 · B: TK/2–3, K/2–3, K/I/0–1 · C: K/I/2–3.
                  Aktif jika switch TER dihidupkan ({data?.regulation?.useTer ? <span className="font-bold text-emerald-600">aktif</span> : <span className="font-bold text-slate-500">non-aktif — progresif</span>}).
                </p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-4 lg:grid-cols-3">
                  {["A", "B", "C"].map((cat) => (
                    <div key={cat}>
                      <p className={cn("mb-1.5 text-[11px] font-bold uppercase tracking-wider", cat === "A" ? "text-emerald-600 dark:text-emerald-400" : cat === "B" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400")}>
                        Kategori {cat} ({(data?.ter ?? []).filter((t) => t.category === cat).length} rentang)
                      </p>
                      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                              <TableHead className="text-[10px] font-bold">Bruto/Bulan</TableHead>
                              <TableHead className="text-right text-[10px] font-bold">Tarif</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(data?.ter ?? []).filter((t) => t.category === cat).map((t) => (
                              <TableRow key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                                <TableCell className="text-[10px]">
                                  {fmtIDR(t.lowerLimit)}{t.upperLimit ? ` – ${fmtIDR(t.upperLimit)}` : "+"}
                                </TableCell>
                                <TableCell className="text-right text-[10px] font-bold">{(t.rate * 100).toFixed(2)}%</TableCell>
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
                <CardTitle className="text-sm font-bold">Penghasilan Tidak Kena Pajak (PTKP) — Tahunan</CardTitle>
                <p className="text-[11px] text-slate-400">TK = tidak menikah · K = menikah (pasangan tidak bekerja) · K/I = menikah, pasangan bekerja · angka = tanggungan</p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
                  {Object.entries(data?.ptkp ?? {}).map(([status, value]) => (
                    <div key={status} className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-center dark:border-slate-800 dark:bg-slate-900/40">
                      <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400">{status.replace(/(\d+)$/, "/$1").replace(/^KI/, "K/I/")}</p>
                      <p className="mt-0.5 text-[11px] font-bold">{fmtIDR(value)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
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
