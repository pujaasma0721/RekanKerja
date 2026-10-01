"use client";
// OneVity Payroll — Data Gaji Karyawan: NPWP, PTKP, metode proses, template upah per karyawan
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { IdCard, Pencil, Search, Wallet } from "lucide-react";
import { ProfileRow, TAX_STATUS_OPTIONS, TemplateRow } from "@/components/onevity/payroll/payroll-types";
import { cn } from "@/lib/utils";

export function PayrollProfilesPage() {
  const [q, setQ] = useState("");
  const { data, loading, refresh } = useApi<{ employees: ProfileRow[] }>(`/api/onevity/payroll-profiles${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const templatesApi = useApi<{ templates: TemplateRow[] }>("/api/onevity/wage-templates");
  const [editing, setEditing] = useState<ProfileRow | null>(null);

  const rows = data?.employees ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Data Gaji Karyawan"
        description="NPWP, status PTKP (penentu pajak), metode Gross-to-Net / Net-to-Gross, template upah, dan rekening bank per karyawan"
      />

      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-3.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau nomor karyawan…" className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={8} /></div>
          ) : rows.length === 0 ? (
            <div className="p-5"><EmptyState title="Tidak ada karyawan" description="Belum ada karyawan aktif dengan profil payroll." icon={<IdCard className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Gaji Pokok</TableHead>
                    <TableHead className="text-[11px] font-bold">NPWP</TableHead>
                    <TableHead className="text-[11px] font-bold">PTKP</TableHead>
                    <TableHead className="text-[11px] font-bold">Metode</TableHead>
                    <TableHead className="text-[11px] font-bold">Template</TableHead>
                    <TableHead className="text-[11px] font-bold">Bank</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.employeeId} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold">{r.fullName}</p>
                        <p className="font-mono text-[10px] text-slate-400">{r.employeeNo} · {r.positionName ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-xs font-bold">{fmtIDR(r.baseSalary)}</TableCell>
                      <TableCell>
                        {r.profile?.npwp ? (
                          <span className="font-mono text-[11px] font-semibold">{r.profile.npwp}</span>
                        ) : (
                          <Badge variant="outline" className="border-rose-300 bg-rose-50 text-[9px] font-bold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">Non-NPWP +20%</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold">{r.profile ? (TAX_STATUS_OPTIONS.find((t) => t.value === r.profile!.taxStatus)?.label ?? r.profile.taxStatus) : "—"}</span>
                          <span className="text-[10px] text-slate-400">{r.profile ? `PTKP ${fmtIDR(r.profile.ptkpValue)}/thn` : ""}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[9px] font-bold", r.profile?.processMethod === "NetToGross" ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400" : "")}>
                          {r.profile?.processMethod === "NetToGross" ? "NetToGross" : "GrossToNet"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{r.profile?.wageTemplateName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {r.profile?.bankName ? (
                          <div className="flex items-center gap-1">
                            <Wallet className="h-3 w-3 text-slate-400" />
                            <span>{r.profile.bankName} <span className="font-mono text-[10px] text-slate-400">{r.profile.bankAccount}</span></span>
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <button onClick={() => setEditing(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Edit profil payroll">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProfileDialog row={editing} templates={templatesApi.data?.templates ?? []} onClose={() => { setEditing(null); refresh(); }} />
    </div>
  );
}

function ProfileDialog({ row, templates, onClose }: { row: ProfileRow | null; templates: TemplateRow[]; onClose: () => void }) {
  const [npwp, setNpwp] = useState("");
  const [hasNpwp, setHasNpwp] = useState(true);
  const [taxStatus, setTaxStatus] = useState("TK0");
  const [dependents, setDependents] = useState("0");
  const [processMethod, setProcessMethod] = useState("GrossToNet");
  const [wageTemplateId, setWageTemplateId] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const rowKey = row?.employeeId ?? "none";
  if (key !== rowKey) {
    setKey(rowKey);
    setNpwp(row?.profile?.npwp ?? "");
    setHasNpwp(row?.profile?.hasNpwp ?? true);
    setTaxStatus(row?.profile?.taxStatus ?? "TK0");
    setDependents(String(row?.profile?.dependents ?? 0));
    setProcessMethod(row?.profile?.processMethod ?? "GrossToNet");
    setWageTemplateId(row?.profile?.wageTemplateId ?? "");
    setBankName(row?.profile?.bankName ?? "");
    setBankAccount(row?.profile?.bankAccount ?? "");
  }

  const submit = async () => {
    if (!row) return;
    setBusy(true);
    try {
      await apiSend("/api/onevity/payroll-profiles", "PATCH", {
        employeeId: row.employeeId,
        npwp: hasNpwp ? npwp.trim() || null : null,
        hasNpwp,
        taxStatus,
        dependents: Number(dependents) || 0,
        processMethod,
        wageTemplateId: wageTemplateId || null,
        bankName: bankName.trim() || null,
        bankAccount: bankAccount.trim() || null,
      });
      toast.success(`Profil payroll ${row.fullName} disimpan`);
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (!row) return null;
  const selectedPtkp = TAX_STATUS_OPTIONS.find((t) => t.value === taxStatus);

  return (
    <Dialog open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><IdCard className="h-4 w-4 text-emerald-600" /> Data Payroll — {row.fullName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div>
              <p className="text-xs font-bold">Punya NPWP</p>
              <p className="text-[10px] text-slate-400">Non-NPWP dikenai tarif 20% lebih tinggi</p>
            </div>
            <Switch checked={hasNpwp} onCheckedChange={setHasNpwp} />
          </div>
          {hasNpwp && (
            <div>
              <Label className="text-xs">Nomor NPWP</Label>
              <Input value={npwp} onChange={(e) => setNpwp(e.target.value)} placeholder="09.XXX.XXX.X-XXX.000" className="mt-1.5 font-mono" />
            </div>
          )}
          <div>
            <Label className="text-xs">Status PTKP</Label>
            <Select value={taxStatus} onValueChange={setTaxStatus}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAX_STATUS_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label} — {fmtIDR(t.ptkp)}/thn</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPtkp && <p className="mt-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">PTKP tahunan: {fmtIDR(selectedPtkp.ptkp)}</p>}
          </div>
          <div>
            <Label className="text-xs">Jumlah Tanggungan (max 3)</Label>
            <Input type="number" min={0} max={3} value={dependents} onChange={(e) => setDependents(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Metode Proses</Label>
            <Select value={processMethod} onValueChange={setProcessMethod}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GrossToNet">Gross to Net — pajak dipotong dari gaji</SelectItem>
                <SelectItem value="NetToGross">Net to Gross — pajak ditanggung perusahaan (gross-up)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Template Upah</Label>
            <Select value={wageTemplateId} onValueChange={setWageTemplateId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pilih template" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} ({t.items.length} komponen)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Bank</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="BCA / Mandiri / …" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">No. Rekening</Label>
              <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="1234567890" className="mt-1.5 font-mono" />
            </div>
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
