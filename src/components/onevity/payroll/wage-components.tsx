"use client";
// OneVity Payroll — Komponen Upah: master komponen dgn klasifikasi oranHR-grade
// (wageType 13-way, incomeTaxMethod, formula, prorata, iuran perusahaan)
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/lib/onevity/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Coins, Plus, Pencil, Search, TrendingUp, TrendingDown, Info, Trash2 } from "lucide-react";
import { WageCompFull, WAGE_TYPE_LABEL, TAX_METHOD_LABEL, FORMULA_VARIABLES } from "@/components/onevity/payroll/payroll-types";
import { cn } from "@/lib/utils";

const WAGE_TYPE_OPTIONS = Object.entries(WAGE_TYPE_LABEL);
const TAX_METHOD_OPTIONS = Object.entries(TAX_METHOD_LABEL);

export function WageComponentsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [q, setQ] = useState("");
  const url = `/api/onevity/wage-components${typeFilter !== "all" || q ? `?${new URLSearchParams({ ...(typeFilter !== "all" ? { type: typeFilter } : {}), ...(q ? { q } : {}) }).toString()}` : ""}`;
  const { data, loading, refresh } = useApi<{ components: WageCompFull[]; typeCounts: Record<string, number> }>(url);
  const [dialog, setDialog] = useState<{ open: boolean; comp: WageCompFull | null }>({ open: false, comp: null });

  const counts = data?.typeCounts ?? {};

  const toggleActive = async (c: WageCompFull) => {
    try {
      await apiSend("/api/onevity/wage-components", "PATCH", { id: c.id, active: !c.active });
      toast.success(`${c.name} ${c.active ? "dinon-aktifkan" : "diaktifkan"}`);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const remove = async (c: WageCompFull) => {
    if (!window.confirm(`Hapus komponen ${c.name}?`)) return;
    try {
      await apiSend(`/api/onevity/wage-components?id=${c.id}`, "DELETE");
      toast.success(`${c.name} dihapus`);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Komponen Upah"
        description="Master komponen dengan klasifikasi upah, metode pajak, formula, dan aturan iuran — jantung perhitungan payroll"
        actions={
          <Button onClick={() => setDialog({ open: true, comp: null })} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Komponen Baru
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <TypeCard label="Earning" value={counts.Earning ?? 0} icon={TrendingUp} tone="emerald" active={typeFilter === "Earning"} onClick={() => setTypeFilter(typeFilter === "Earning" ? "all" : "Earning")} />
        <TypeCard label="Deduction" value={counts.Deduction ?? 0} icon={TrendingDown} tone="rose" active={typeFilter === "Deduction"} onClick={() => setTypeFilter(typeFilter === "Deduction" ? "all" : "Deduction")} />
        <TypeCard label="Informational" value={counts.Informational ?? 0} icon={Info} tone="stone" active={typeFilter === "Informational"} onClick={() => setTypeFilter(typeFilter === "Informational" ? "all" : "Informational")} />
      </div>

      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-3.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari komponen upah…" className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : data && data.components.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[11px] font-bold">Kode</TableHead>
                    <TableHead className="text-[11px] font-bold">Nama Komponen</TableHead>
                    <TableHead className="text-[11px] font-bold">Klasifikasi</TableHead>
                    <TableHead className="text-[11px] font-bold">Nilai / Formula</TableHead>
                    <TableHead className="text-[11px] font-bold">Metode Pajak</TableHead>
                    <TableHead className="text-[11px] font-bold">THP</TableHead>
                    <TableHead className="text-[11px] font-bold">Aktif</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.components.map((c) => (
                    <TableRow key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell className="font-mono text-[11px] font-bold text-slate-500">{c.code}</TableCell>
                      <TableCell className="text-[13px] font-bold">{c.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusPill status={c.type} />
                          <Badge variant="outline" className="text-[9px] font-semibold">{WAGE_TYPE_LABEL[c.wageType] ?? c.wageType}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-52">
                        {c.calcMethod === "Fixed" && c.amount > 0 && <span className="text-xs font-semibold">{fmtIDR(c.amount)}</span>}
                        {c.calcMethod === "Formula" && c.formula && (
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-700 dark:bg-slate-800 dark:text-emerald-400">{c.formula}</code>
                        )}
                        {c.calcMethod === "Tax" && <Badge variant="outline" className="text-[9px]">dihitung engine</Badge>}
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-[11px] font-bold", c.incomeTaxMethod === "Regular" ? "text-amber-600 dark:text-amber-400" : "text-slate-400")}>
                          {TAX_METHOD_LABEL[c.incomeTaxMethod] ?? c.incomeTaxMethod}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-[11px] font-bold", c.includeInTHP ? "text-emerald-600 dark:text-emerald-400" : "text-slate-300")}>{c.includeInTHP ? "Ya" : "Tidak"}</span>
                      </TableCell>
                      <TableCell>
                        <Switch checked={c.active} onCheckedChange={() => toggleActive(c)} aria-label={`Toggle ${c.name}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <button onClick={() => setDialog({ open: true, comp: c })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => remove(c)} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label="Hapus">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4"><EmptyState title="Tidak ada komponen" description="Buat komponen upah baru untuk mulai menghitung payroll." icon={<Coins className="h-6 w-6" />} /></div>
          )}
        </CardContent>
      </Card>

      <WageDialog open={dialog.open} comp={dialog.comp} onClose={() => { setDialog({ open: false, comp: null }); refresh(); }} />
    </div>
  );
}

function TypeCard({ label, value, icon: Icon, tone, active, onClick }: { label: string; value: number; icon: React.ElementType; tone: string; active: boolean; onClick: () => void }) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    stone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return (
    <button onClick={onClick} className={cn(
      "flex items-center gap-3 rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
      active ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10" : "border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    )}>
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", tones[tone])}><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-xl font-extrabold text-slate-900 dark:text-slate-50">{value}</p>
      </div>
    </button>
  );
}

function WageDialog({ open, comp, onClose }: { open: boolean; comp: WageCompFull | null; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("Earning");
  const [wageType, setWageType] = useState("Compensation");
  const [calcMethod, setCalcMethod] = useState("Fixed");
  const [amount, setAmount] = useState("0");
  const [formula, setFormula] = useState("");
  const [incomeTaxMethod, setIncomeTaxMethod] = useState("Regular");
  const [prorated, setProrated] = useState(false);
  const [includeInTHP, setIncludeInTHP] = useState(true);
  const [displayInPaySlip, setDisplayInPaySlip] = useState(true);
  const [accountDebitCode, setAccountDebitCode] = useState("");
  const [accountCreditCode, setAccountCreditCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const compKey = comp?.id ?? "new";
  if (key !== compKey) {
    setKey(compKey);
    setCode(comp?.code ?? "");
    setName(comp?.name ?? "");
    setType(comp?.type ?? "Earning");
    setWageType(comp?.wageType ?? "Compensation");
    setCalcMethod(comp?.calcMethod ?? "Fixed");
    setAmount(String(comp?.amount ?? 0));
    setFormula(comp?.formula ?? "");
    setIncomeTaxMethod(comp?.incomeTaxMethod ?? "Regular");
    setProrated(comp?.prorated ?? false);
    setIncludeInTHP(comp?.includeInTHP ?? true);
    setDisplayInPaySlip(comp?.displayInPaySlip ?? true);
    setAccountDebitCode(comp?.accountDebitCode ?? "");
    setAccountCreditCode(comp?.accountCreditCode ?? "");
  }

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast.error("Kode & nama wajib diisi"); return; }
    if (calcMethod === "Formula" && !formula.trim()) { toast.error("Formula wajib diisi"); return; }
    setBusy(true);
    const payload = {
      name, type, wageType, calcMethod,
      amount: Number(amount) || 0,
      formula: calcMethod === "Formula" ? formula.trim().toUpperCase() : null,
      incomeTaxMethod, prorated, includeInTHP, displayInPaySlip,
      accountDebitCode: accountDebitCode.trim() || null,
      accountCreditCode: accountCreditCode.trim() || null,
    };
    try {
      if (comp) {
        await apiSend("/api/onevity/wage-components", "PATCH", { id: comp.id, ...payload });
        toast.success("Komponen diperbarui");
      } else {
        await apiSend("/api/onevity/wage-components", "POST", { code: code.trim().toUpperCase(), ...payload });
        toast.success("Komponen dibuat");
      }
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Coins className="h-4 w-4 text-emerald-600" /> {comp ? "Edit Komponen" : "Komponen Baru"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {!comp && (
            <div>
              <Label className="text-xs">Kode *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="cth: TLAHAN" className="mt-1.5 font-mono uppercase" />
            </div>
          )}
          <div className={comp ? "sm:col-span-2" : ""}>
            <Label className="text-xs">Nama *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth: Tunjangan Hari Raya" className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Kategori</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Earning">Earning</SelectItem>
                <SelectItem value="Deduction">Deduction</SelectItem>
                <SelectItem value="Informational">Informational</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Jenis Upah (13-way)</Label>
            <Select value={wageType} onValueChange={setWageType}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WAGE_TYPE_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Metode Kalkulasi</Label>
            <Select value={calcMethod} onValueChange={setCalcMethod}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Fixed">Fixed (nilai tetap)</SelectItem>
                <SelectItem value="Formula">Formula (ekspresi)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Metode Pajak</Label>
            <Select value={incomeTaxMethod} onValueChange={setIncomeTaxMethod}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAX_METHOD_OPTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {calcMethod === "Fixed" && (
            <div className="sm:col-span-2">
              <Label className="text-xs">Jumlah (Rp)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5 font-mono" />
              {Number(amount) > 0 && <p className="mt-1 text-[11px] font-bold text-slate-500">{fmtIDR(Number(amount))}</p>}
            </div>
          )}
          {calcMethod === "Formula" && (
            <div className="sm:col-span-2">
              <Label className="text-xs">Formula *</Label>
              <Input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="cth: BASE_SALARY*0.1" className="mt-1.5 font-mono uppercase" />
              <div className="mt-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/60">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Variabel tersedia</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {FORMULA_VARIABLES.map((v) => (
                    <p key={v.name} className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                      <code className="font-bold text-emerald-700 dark:text-emerald-400">{v.name}</code> — {v.desc}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
          {type === "Earning" && (
            <div>
              <Label className="text-xs">Akun Beban (D)</Label>
              <Input value={accountDebitCode} onChange={(e) => setAccountDebitCode(e.target.value)} placeholder="default 5101/5102/5103" className="mt-1.5 font-mono" />
            </div>
          )}
          {type === "Deduction" && (
            <div>
              <Label className="text-xs">Akun Kewajiban (C)</Label>
              <Input value={accountCreditCode} onChange={(e) => setAccountCreditCode(e.target.value)} placeholder="default 2102/2103/2104" className="mt-1.5 font-mono" />
            </div>
          )}
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div>
              <p className="text-xs font-bold">Prorata</p>
              <p className="text-[10px] text-slate-400">Proporsional masa kerja period</p>
            </div>
            <Switch checked={prorated} onCheckedChange={setProrated} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div>
              <p className="text-xs font-bold">Masuk THP</p>
              <p className="text-[10px] text-slate-400">Iuran perusahaan = non-THP</p>
            </div>
            <Switch checked={includeInTHP} onCheckedChange={setIncludeInTHP} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 sm:col-span-2 dark:border-slate-700">
            <div>
              <p className="text-xs font-bold">Tampilkan di Payslip</p>
              <p className="text-[10px] text-slate-400">Komponen muncul pada slip gaji karyawan</p>
            </div>
            <Switch checked={displayInPaySlip} onCheckedChange={setDisplayInPaySlip} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
