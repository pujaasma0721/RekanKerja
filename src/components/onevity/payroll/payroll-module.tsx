"use client";
// OneVity — Modul Payroll Rules: komponen upah + akuntansi & posting
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/lib/onevity/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Coins, Landmark, Plus, Pencil, Search, TrendingUp, TrendingDown, Info, ArrowLeftRight, BookOpen, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function PayrollModule({ view }: { view: string }) {
  if (view === "accounting") return <AccountingPage />;
  return <WageComponentsPage />;
}

// ================= WAGE COMPONENTS =================
interface WageComp {
  id: string; code: string; name: string; type: string; calcMethod: string;
  amount: number; prorated: boolean; taxable: boolean; active: boolean;
}

function WageComponentsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [q, setQ] = useState("");
  const url = `/api/onevity/wage-components${typeFilter !== "all" || q ? `?${new URLSearchParams({ ...(typeFilter !== "all" ? { type: typeFilter } : {}), ...(q ? { q } : {}) }).toString()}` : ""}`;
  const { data, loading, refresh } = useApi<{ components: WageComp[]; typeCounts: Record<string, number> }>(url);
  const [dialog, setDialog] = useState<{ open: boolean; comp: WageComp | null }>({ open: false, comp: null });

  const counts = data?.typeCounts ?? {};

  const toggleActive = async (c: WageComp) => {
    try {
      await apiSend("/api/onevity/wage-components", "PATCH", { id: c.id, active: !c.active });
      toast.success(`${c.name} ${c.active ? "dinon-aktifkan" : "diaktifkan"}`);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const remove = async (c: WageComp) => {
    try {
      await apiSend(`/api/onevity/wage-components?id=${c.id}`, "DELETE");
      toast.success(`${c.name} dihapus`);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="PAYROLL & AKUNTANSI"
        title="Komponen Upah"
        description="Master komponen earning, deduction, dan informational untuk perhitungan payroll"
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

      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-3.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari komponen upah…" className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : data && data.components.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Kode</TableHead>
                    <TableHead className="text-[11px] font-bold">Nama Komponen</TableHead>
                    <TableHead className="text-[11px] font-bold">Tipe</TableHead>
                    <TableHead className="text-[11px] font-bold">Metode</TableHead>
                    <TableHead className="text-[11px] font-bold">Jumlah</TableHead>
                    <TableHead className="text-[11px] font-bold">Prorata</TableHead>
                    <TableHead className="text-[11px] font-bold">Pajak</TableHead>
                    <TableHead className="text-[11px] font-bold">Aktif</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.components.map((c) => (
                    <TableRow key={c.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell className="font-mono text-[11px] font-bold text-stone-500">{c.code}</TableCell>
                      <TableCell className="text-[13px] font-bold">{c.name}</TableCell>
                      <TableCell><StatusPill status={c.type} /></TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{c.calcMethod}</Badge></TableCell>
                      <TableCell className="text-xs font-semibold">{c.calcMethod === "Fixed" && c.amount > 0 ? fmtIDR(c.amount) : c.calcMethod}</TableCell>
                      <TableCell>
                        <span className={cn("text-[11px] font-bold", c.prorated ? "text-emerald-600 dark:text-emerald-400" : "text-stone-300")}>{c.prorated ? "Ya" : "Tidak"}</span>
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-[11px] font-bold", c.taxable ? "text-amber-600 dark:text-amber-400" : "text-stone-300")}>{c.taxable ? "Dikenakan" : "Non-pajak"}</span>
                      </TableCell>
                      <TableCell>
                        <Switch checked={c.active} onCheckedChange={() => toggleActive(c)} aria-label={`Toggle ${c.name}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <button onClick={() => setDialog({ open: true, comp: c })} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800" aria-label="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => remove(c)} className="rounded-lg p-1.5 text-stone-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label="Hapus">
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
    stone: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400",
  };
  return (
    <button onClick={onClick} className={cn(
      "flex items-center gap-3 rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
      active ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10" : "border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
    )}>
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", tones[tone])}><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
        <p className="text-xl font-extrabold text-stone-900 dark:text-stone-50">{value}</p>
      </div>
    </button>
  );
}

function WageDialog({ open, comp, onClose }: { open: boolean; comp: WageComp | null; onClose: () => void }) {
  const [code, setCode] = useState(comp?.code ?? "");
  const [name, setName] = useState(comp?.name ?? "");
  const [type, setType] = useState(comp?.type ?? "Earning");
  const [calcMethod, setCalcMethod] = useState(comp?.calcMethod ?? "Fixed");
  const [amount, setAmount] = useState(String(comp?.amount ?? 0));
  const [prorated, setProrated] = useState(comp?.prorated ?? false);
  const [taxable, setTaxable] = useState(comp?.taxable ?? true);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const compKey = comp?.id ?? "new";
  if (key !== compKey) {
    setKey(compKey);
    setCode(comp?.code ?? ""); setName(comp?.name ?? ""); setType(comp?.type ?? "Earning");
    setCalcMethod(comp?.calcMethod ?? "Fixed"); setAmount(String(comp?.amount ?? 0));
    setProrated(comp?.prorated ?? false); setTaxable(comp?.taxable ?? true);
  }

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast.error("Kode & nama wajib diisi"); return; }
    setBusy(true);
    try {
      if (comp) {
        await apiSend("/api/onevity/wage-components", "PATCH", { id: comp.id, name, type, calcMethod, amount: Number(amount), prorated, taxable });
        toast.success("Komponen diperbarui");
      } else {
        await apiSend("/api/onevity/wage-components", "POST", { code: code.trim().toUpperCase(), name, type, calcMethod, amount: Number(amount), prorated, taxable });
        toast.success("Komponen dibuat");
      }
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Coins className="h-4 w-4 text-emerald-600" /> {comp ? "Edit Komponen" : "Komponen Baru"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {!comp && (
            <div>
              <Label className="text-xs">Kode *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WC-016" className="mt-1.5 font-mono uppercase" />
            </div>
          )}
          <div className={comp ? "sm:col-span-2" : ""}>
            <Label className="text-xs">Nama *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth: Tunjangan Hari Raya" className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Tipe</Label>
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
            <Label className="text-xs">Metode Kalkulasi</Label>
            <Select value={calcMethod} onValueChange={setCalcMethod}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Fixed">Fixed (nilai tetap)</SelectItem>
                <SelectItem value="Formula">Formula</SelectItem>
                <SelectItem value="Percentage">Percentage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {calcMethod === "Fixed" && (
            <div className="sm:col-span-2">
              <Label className="text-xs">Jumlah (Rp)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5 font-mono" />
              {Number(amount) > 0 && <p className="mt-1 text-[11px] font-bold text-stone-500">{fmtIDR(Number(amount))}</p>}
            </div>
          )}
          <div className="flex items-center justify-between rounded-xl border border-stone-200 p-3 dark:border-stone-700">
            <div>
              <p className="text-xs font-bold">Prorata</p>
              <p className="text-[10px] text-stone-400">Dihitung proporsional hari kerja</p>
            </div>
            <Switch checked={prorated} onCheckedChange={setProrated} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-stone-200 p-3 dark:border-stone-700">
            <div>
              <p className="text-xs font-bold">Kena Pajak</p>
              <p className="text-[10px] text-stone-400">Diperhitungkan PPh 21</p>
            </div>
            <Switch checked={taxable} onCheckedChange={setTaxable} />
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

// ================= ACCOUNTING =================
interface AccountData {
  groups: { id: string; code: string; name: string; accountType: string; accountCount: number }[];
  accounts: { id: string; code: string; name: string; accountGroupId: string | null; accountGroup: { name: string; code: string } | null }[];
  postings: { id: string; code: string; name: string; trigger: string; active: boolean }[];
}

function AccountingPage() {
  const { data, loading, refresh } = useApi<AccountData>("/api/onevity/accounts");
  const [tab, setTab] = useState("accounts");

  return (
    <div>
      <PageHeader
        eyebrow="PAYROLL & AKUNTANSI"
        title="Akun & Posting"
        description="Integrasi akun buku besar dan event posting payroll ke sistem akuntansi"
      />
      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4 h-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
              <TabsTrigger value="accounts" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
                <Landmark className="h-3.5 w-3.5" /> Akun ({data?.accounts.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="postings" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
                <ArrowLeftRight className="h-3.5 w-3.5" /> Event Posting ({data?.postings.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="journal" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
                <BookOpen className="h-3.5 w-3.5" /> Preview Jurnal
              </TabsTrigger>
            </TabsList>

            <TabsContent value="accounts">
              <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
                <div className="space-y-3">
                  {(data?.groups ?? []).map((g) => (
                    <Card key={g.id} className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="font-mono text-[10px]">{g.code}</Badge>
                          <Badge variant="secondary" className="text-[9px]">{g.accountType}</Badge>
                        </div>
                        <p className="mt-1.5 text-[13px] font-bold">{g.name}</p>
                        <p className="mt-1 text-[11px] text-stone-400">{g.accountCount} akun</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                            <TableHead className="text-[11px] font-bold">Kode</TableHead>
                            <TableHead className="text-[11px] font-bold">Nama Akun</TableHead>
                            <TableHead className="text-[11px] font-bold">Grup</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(data?.accounts ?? []).map((a) => (
                            <TableRow key={a.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                              <TableCell className="font-mono text-[11px] font-bold text-stone-500">{a.code}</TableCell>
                              <TableCell className="text-[13px] font-semibold">{a.name}</TableCell>
                              <TableCell className="text-xs text-stone-500">{a.accountGroup?.name ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="postings">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(data?.postings ?? []).map((p) => (
                  <Card key={p.id} className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-md">
                          <ArrowLeftRight className="h-5 w-5" />
                        </div>
                        <StatusPill status={p.active ? "Active" : "Cancelled"} />
                      </div>
                      <p className="mt-3 text-[14px] font-bold">{p.name}</p>
                      <p className="font-mono text-[10px] text-stone-400">{p.code}</p>
                      <div className="mt-3 border-t border-dashed border-stone-100 pt-3 dark:border-stone-800">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Trigger</p>
                        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{p.trigger}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="journal">
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold"><BookOpen className="h-4 w-4 text-emerald-600" /> Preview Jurnal — Post Monthly Payroll (Ilustrasi)</CardTitle>
                  <p className="text-[11px] text-stone-400">Struktur jurnal gaji bulanan berdasarkan master akun</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                          <TableHead className="text-[11px] font-bold">Akun</TableHead>
                          <TableHead className="text-[11px] font-bold">Nama</TableHead>
                          <TableHead className="text-right text-[11px] font-bold">Debit</TableHead>
                          <TableHead className="text-right text-[11px] font-bold">Kredit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <JournalRow code="5101" name="Gaji & Upah" debit="Rp 462.000.000" />
                        <JournalRow code="5102" name="Tunjangan Karyawan" debit="Rp 85.500.000" />
                        <JournalRow code="5103" name="BPJS Perusahaan" debit="Rp 52.000.000" />
                        <JournalRow code="2101" name="Hutang Gaji" credit="Rp 462.000.000" />
                        <JournalRow code="2102" name="Hutang PPh 21" credit="Rp 38.500.000" />
                        <JournalRow code="2103" name="Hutang BPJS" credit="Rp 99.000.000" />
                        <TableRow className="border-t-2 border-stone-200 bg-stone-50/80 font-bold dark:border-stone-700 dark:bg-stone-900/50">
                          <TableCell colSpan={2} className="text-xs font-bold uppercase tracking-wide text-stone-500">Total (Balance ✓)</TableCell>
                          <TableCell className="text-right text-xs font-extrabold">Rp 599.500.000</TableCell>
                          <TableCell className="text-right text-xs font-extrabold">Rp 599.500.000</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function JournalRow({ code, name, debit, credit }: { code: string; name: string; debit?: string; credit?: string }) {
  return (
    <TableRow className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
      <TableCell className="font-mono text-[11px] font-bold text-stone-500">{code}</TableCell>
      <TableCell className="text-[13px]">{name}</TableCell>
      <TableCell className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-400">{debit ?? ""}</TableCell>
      <TableCell className="text-right text-xs font-semibold text-rose-600 dark:text-rose-400">{credit ?? ""}</TableCell>
    </TableRow>
  );
}
