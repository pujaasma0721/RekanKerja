"use client";
// OneVity Payroll — Data Gaji Karyawan: NPWP, PTKP, metode proses, template upah per karyawan
import { useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
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
import { ProfileRow, TAX_STATUS_OPTIONS, TAX_STATUS_OPTION_EN, TemplateRow } from "@/onevity/payroll/components/payroll-types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

export function PayrollProfilesPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const { data, loading, refresh } = useApi<{ employees: ProfileRow[] }>(`/api/onevity/payroll-profiles${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const templatesApi = useApi<{ templates: TemplateRow[] }>("/api/onevity/wage-templates");
  const [editing, setEditing] = useState<ProfileRow | null>(null);

  const rows = data?.employees ?? [];

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Data Gaji Karyawan")}
        description={t("NPWP, status PTKP (penentu pajak), metode Gross-to-Net / Net-to-Gross, template upah, dan rekening bank per karyawan", "NPWP, PTKP status (tax determinant), Gross-to-Net / Net-to-Gross method, wage template, and bank account per employee")}
      />

      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-3.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cari nama atau nomor karyawan…", "Search by name or employee number…")} className="pl-9" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={8} /></div>
          ) : rows.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Tidak ada karyawan", "No employees")} description={t("Belum ada karyawan aktif dengan profil payroll.", "No active employees with a payroll profile yet.")} icon={<IdCard className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Gaji Pokok")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("NPWP")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("PTKP")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Metode", "Method")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Template")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Bank")}</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.employeeId} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold">{r.fullName}</p>
                        <p className="font-mono text-[10px] text-stone-400">{r.employeeNo} · {r.positionName ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-xs font-bold">{fmtIDR(r.baseSalary)}</TableCell>
                      <TableCell>
                        {r.profile?.npwp ? (
                          <span className="font-mono text-[11px] font-semibold">{r.profile.npwp}</span>
                        ) : (
                          <Badge variant="outline" className="border-rose-300 bg-rose-50 text-[9px] font-bold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">{t("Non-NPWP +20%", "Non-NPWP +20%")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold">{r.profile
                            ? t(
                              TAX_STATUS_OPTIONS.find((o) => o.value === r.profile!.taxStatus)?.label ?? r.profile.taxStatus,
                              TAX_STATUS_OPTION_EN[r.profile.taxStatus],
                            )
                            : "—"}</span>
                          <span className="text-[10px] text-stone-400">{r.profile ? t("PTKP {v}/thn", "PTKP {v}/yr", { v: fmtIDR(r.profile.ptkpValue) }) : ""}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[9px] font-bold", r.profile?.processMethod === "NetToGross" ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400" : "")}>
                          {r.profile?.processMethod === "NetToGross" ? "NetToGross" : "GrossToNet"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{r.profile?.wageTemplateName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-stone-500">
                        {r.profile?.bankName ? (
                          <div className="flex items-center gap-1">
                            <Wallet className="h-3 w-3 text-stone-400" />
                            <span>{r.profile.bankName} <span className="font-mono text-[10px] text-stone-400">{r.profile.bankAccount}</span></span>
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <button onClick={() => setEditing(r)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800" aria-label={t("Edit profil payroll", "Edit payroll profile")}>
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
  const { t } = useI18n();
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
      toast.success(t("Profil payroll {name} disimpan", "Payroll profile of {name} saved", { name: row.fullName }));
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (!row) return null;
  const selectedPtkp = TAX_STATUS_OPTIONS.find((o) => o.value === taxStatus);

  return (
    <Dialog open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><IdCard className="h-4 w-4 ov-text-accent" /> {t("Data Payroll — {name}", "Payroll Data — {name}", { name: row.fullName })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center justify-between rounded-xl border border-stone-200 p-3 dark:border-stone-700">
            <div>
              <p className="text-xs font-bold">{t("Punya NPWP", "Has NPWP")}</p>
              <p className="text-[10px] text-stone-400">{t("Non-NPWP dikenai tarif 20% lebih tinggi", "Non-NPWP is charged a 20% higher rate")}</p>
            </div>
            <Switch checked={hasNpwp} onCheckedChange={setHasNpwp} />
          </div>
          {hasNpwp && (
            <div>
              <Label className="text-xs">{t("Nomor NPWP", "NPWP Number")}</Label>
              <Input value={npwp} onChange={(e) => setNpwp(e.target.value)} placeholder="09.XXX.XXX.X-XXX.000" className="mt-1.5 font-mono" />
            </div>
          )}
          <div>
            <Label className="text-xs">{t("Status PTKP", "PTKP Status")}</Label>
            <Select value={taxStatus} onValueChange={setTaxStatus}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAX_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{t(o.label, TAX_STATUS_OPTION_EN[o.value])} — {fmtIDR(o.ptkp)}/{t("thn", "yr")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPtkp && <p className="mt-1 text-[11px] font-bold ov-text-accent">{t("PTKP tahunan: {v}", "Annual PTKP: {v}", { v: fmtIDR(selectedPtkp.ptkp) })}</p>}
          </div>
          <div>
            <Label className="text-xs">{t("Jumlah Tanggungan (max 3)", "Number of Dependents (max 3)")}</Label>
            <Input type="number" min={0} max={3} value={dependents} onChange={(e) => setDependents(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">{t("Metode Proses", "Process Method")}</Label>
            <Select value={processMethod} onValueChange={setProcessMethod}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GrossToNet">{t("Gross to Net — pajak dipotong dari gaji", "Gross to Net — tax deducted from salary")}</SelectItem>
                <SelectItem value="NetToGross">{t("Net to Gross — pajak ditanggung perusahaan (gross-up)", "Net to Gross — tax borne by the company (gross-up)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Template Upah")}</Label>
            <Select value={wageTemplateId} onValueChange={setWageTemplateId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih template", "Select template")} /></SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.items.length} {t("komponen", "components")})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Bank")}</Label>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="BCA / Mandiri / …" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">{t("No. Rekening", "Account No.")}</Label>
              <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="1234567890" className="mt-1.5 font-mono" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
