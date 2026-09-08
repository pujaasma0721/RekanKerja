"use client";
// OneVity Payroll — Parameter › UMP/UMK (upah minimum per kantor, 26-b P0) ==
// =====================================================================
// Master MinimumWage (PP 36/2021): tahun × kantor (null = default tenant).
// Engine payroll memakainya untuk menandai baris run dengan gaji pokok di
// bawah upah minimum kantor penempatan (warning edukatif non-bloking).
// CRUD penuh — tombol ter-gate hak aksi payroll:parameters (menu-perms-context).
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Coins, Plus, Pencil, Trash2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

interface WageRow {
  id: string;
  year: number;
  companyOfficeId: string | null;
  label: string;
  monthlyAmount: number;
  active: boolean;
  companyOffice: { code: string; name: string; city: string | null } | null;
}

interface WagesResp {
  wages: WageRow[];
  offices: { id: string; code: string; name: string; city: string | null }[];
  years: number[];
}

export function MinimumWageTab() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const { data, loading, refresh } = useApi<WagesResp>("/api/onevity/minimum-wages");
  const [year, setYear] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<WageRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WageRow | null>(null);

  const years = data?.years ?? [];
  const currentYear = year ?? years[0] ?? new Date().getFullYear();
  const wages = useMemo(() => (data?.wages ?? []).filter((w) => w.year === currentYear), [data, currentYear]);
  const hasDefault = wages.some((w) => w.companyOfficeId === null);

  const toggle = async (w: WageRow) => {
    try {
      await apiSend("/api/onevity/minimum-wages", "PATCH", { id: w.id, active: !w.active });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const remove = async (w: WageRow) => {
    try {
      await apiSend(`/api/onevity/minimum-wages?id=${w.id}`, "DELETE");
      toast.success(t("Entri UMP/UMK dihapus", "Minimum wage entry deleted"));
      setConfirmDelete(null);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <Coins className="h-4 w-4 ov-text-accent" /> {t("UMP/UMK per Kantor — PP 36/2021", "UMP/UMK per Office — PP 36/2021")}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {years.length > 1 && (
            <Select value={String(currentYear)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-8 w-[120px] rounded-lg text-xs font-bold" aria-label={t("Filter tahun", "Year filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {perms.can("payroll", "parameters", "create") && (
            <Button size="sm" onClick={() => setAddOpen(true)} className="h-8 gap-1.5 rounded-lg font-bold">
              <Plus className="h-3.5 w-3.5" /> {t("Entri Baru", "New Entry")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[11.5px] leading-relaxed text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <p>
            {t(
              "Saat run dihitung, gaji pokok karyawan dibandingkan dengan entri tahun period untuk kantor penempatannya (tanpa kantor spesifik → entri default tenant). Gaji di bawah upah minimum ditandai sebagai warning di detail run — edukatif, hitungan tetap sah.",
              "When a run is calculated, each employee's base salary is compared against the entry for the run year and their placement office (no specific office → the tenant default entry). Salaries below the minimum are flagged as warnings in the run detail — educational, the calculation remains valid.",
            )}
          </p>
        </div>

        {loading && !data ? (
          <LoadingRows rows={4} />
        ) : wages.length === 0 ? (
          <EmptyState
            title={t("Belum ada UMP/UMK", "No minimum wage yet")}
            description={t("Tambahkan upah minimum tahun {y} per kantor — tanpa entri, validasi gaji pokok dilewati.", "Add the {y} minimum wage per office — without an entry, base salary validation is skipped.", { y: String(currentYear) })}
            icon={<Coins className="h-6 w-6" />}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                  <TableHead className="text-[11px] font-bold">{t("Tahun", "Year")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Kantor", "Office")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Label")}</TableHead>
                  <TableHead className="text-right text-[11px] font-bold">{t("Jumlah / Bulan", "Amount / Month")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Aktif")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {wages.map((w) => (
                  <TableRow key={w.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                    <TableCell className="font-mono text-xs font-bold">{w.year}</TableCell>
                    <TableCell>
                      {w.companyOffice ? (
                        <span className="text-[13px] font-semibold">{w.companyOffice.name}<span className="ml-1.5 font-mono text-[10px] text-stone-400">{w.companyOffice.code}</span></span>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] font-bold">{t("Default tenant", "Tenant default")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-[13px]", !w.active && "text-stone-400 line-through")}>{w.label}</TableCell>
                    <TableCell className="text-right font-mono text-[13px] font-bold ov-text-accent">{fmtIDR(w.monthlyAmount)}</TableCell>
                    <TableCell>
                      <Switch checked={w.active} onCheckedChange={() => toggle(w)} disabled={!perms.can("payroll", "parameters", "update")} aria-label={t("Toggle aktif", "Toggle active")} />
                    </TableCell>
                    <TableCell>
                      {perms.can("payroll", "parameters", "update") && (
                        <button onClick={() => setEditing(w)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800" aria-label={t("Ubah entri", "Edit entry")}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {perms.can("payroll", "parameters", "delete") && (
                        <button onClick={() => setConfirmDelete(w)} className="rounded-lg p-1.5 text-stone-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label={t("Hapus entri", "Delete entry")}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!loading && data && !hasDefault && wages.length > 0 && (
          <p className="mt-2.5 text-[11px] text-stone-400">
            {t("Belum ada entri default tenant (tanpa kantor) — karyawan tanpa kantor penempatan memakai entri terbaru mana pun.", "No tenant-default entry (no office) yet — employees without a placement office fall back to the latest entry.")}
          </p>
        )}
      </CardContent>

      <WageDialog
        open={addOpen}
        setOpen={(v) => { setAddOpen(v); if (!v) refresh(); }}
        offices={data?.offices ?? []}
        defaultYear={currentYear}
        item={null}
      />
      <WageDialog
        open={!!editing}
        setOpen={(v) => { if (!v) { setEditing(null); refresh(); } }}
        offices={data?.offices ?? []}
        defaultYear={currentYear}
        item={editing}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(v) => { if (!v) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{t("Hapus entri UMP/UMK?", "Delete minimum wage entry?")}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-stone-600 dark:text-stone-300">
            {t("{label} ({year}) akan dihapus permanen.", "{label} ({year}) will be permanently deleted.", { label: confirmDelete?.label ?? "", year: String(confirmDelete?.year ?? "") })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>{t("Batal")}</Button>
            <Button onClick={() => confirmDelete && remove(confirmDelete)} className="bg-rose-600 font-bold hover:bg-rose-700">{t("Hapus")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function WageDialog({ open, setOpen, offices, defaultYear, item }: {
  open: boolean;
  setOpen: (v: boolean) => void;
  offices: { id: string; code: string; name: string; city: string | null }[];
  defaultYear: number;
  item: WageRow | null;
}) {
  const { t } = useI18n();
  const [year, setYear] = useState(String(item?.year ?? defaultYear));
  const [officeId, setOfficeId] = useState(item?.companyOfficeId ?? "default");
  const [label, setLabel] = useState(item?.label ?? "");
  const [amount, setAmount] = useState(item ? String(item.monthlyAmount) : "");
  const [busy, setBusy] = useState(false);
  const itemKey = item?.id ?? "new";
  const [key, setKey] = useState(itemKey);
  if (key !== itemKey) {
    setKey(itemKey);
    setYear(String(item?.year ?? defaultYear));
    setOfficeId(item?.companyOfficeId ?? "default");
    setLabel(item?.label ?? "");
    setAmount(item ? String(item.monthlyAmount) : "");
  }

  const submit = async () => {
    const amt = Number(amount);
    if (!label.trim()) { toast.error(t("Label wajib diisi", "Label is required")); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast.error(t("Jumlah harus angka positif", "Amount must be a positive number")); return; }
    const y = Number(year);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) { toast.error(t("Tahun tidak valid", "Invalid year")); return; }
    setBusy(true);
    try {
      if (item) {
        await apiSend("/api/onevity/minimum-wages", "PATCH", { id: item.id, label: label.trim(), monthlyAmount: amt });
        toast.success(t("Entri UMP/UMK diperbarui", "Minimum wage entry updated"));
      } else {
        await apiSend("/api/onevity/minimum-wages", "POST", {
          year: y,
          companyOfficeId: officeId === "default" ? null : officeId,
          label: label.trim(),
          monthlyAmount: amt,
        });
        toast.success(t("Entri UMP/UMK ditambahkan", "Minimum wage entry added"));
      }
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {item ? t("Edit UMP/UMK", "Edit Minimum Wage") : t("Entri UMP/UMK Baru", "New Minimum Wage Entry")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">{t("Tahun *", "Year *")}</Label>
            <Input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} className="mt-1.5 font-mono" inputMode="numeric" disabled={!!item} placeholder="2026" />
          </div>
          <div>
            <Label className="text-xs">{t("Kantor", "Office")}</Label>
            <Select value={officeId} onValueChange={setOfficeId} disabled={!!item}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("Default tenant (tanpa kantor)", "Tenant default (no office)")}</SelectItem>
                {offices.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.code} — {o.name}{o.city ? ` (${o.city})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("Label *", "Label *")}</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1.5" placeholder={t("cth: UMK DKI Jakarta 2026", "e.g. DKI Jakarta 2026 minimum wage")} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("Jumlah per bulan *", "Monthly amount *")}</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="mt-1.5 font-mono" inputMode="numeric" placeholder="5396761" />
            {amount && <p className="mt-1 text-[11px] font-bold ov-text-accent">{fmtIDR(Number(amount))} / {t("bulan", "month")}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
