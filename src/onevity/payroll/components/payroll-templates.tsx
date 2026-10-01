"use client";
// OneVity Payroll — Template Upah: paket komponen per karyawan
import { useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { LayoutTemplate, Plus, Pencil, Trash2, Users } from "lucide-react";
import { WageCompFull, TemplateRow } from "@/onevity/payroll/components/payroll-types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

export function PayrollTemplatesPage() {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ templates: TemplateRow[] }>("/api/onevity/wage-templates");
  const [dialog, setDialog] = useState<{ open: boolean; tpl: TemplateRow | null }>({ open: false, tpl: null });

  const remove = async (tpl: TemplateRow) => {
    if (!window.confirm(t("Hapus template {name}?", "Delete template {name}?", { name: tpl.name }))) return;
    try {
      await apiSend(`/api/onevity/wage-templates?id=${tpl.id}`, "DELETE");
      toast.success(t("Template {name} dihapus", "Template {name} deleted", { name: tpl.name }));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Template Upah")}
        description={t("Paket komponen upah yang bisa dipilih per karyawan — cth: DEFAULT (tunjangan+BPJS penuh), BS (gaji pokok saja)", "Packages of wage components selectable per employee — e.g. DEFAULT (full allowance+BPJS), BS (base salary only)")}
        actions={
          <Button onClick={() => setDialog({ open: true, tpl: null })} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Template Baru", "New Template")}
          </Button>
        }
      />

      {loading && !data ? (
        <LoadingRows rows={4} />
      ) : (data?.templates.length ?? 0) === 0 ? (
        <EmptyState title={t("Belum ada template", "No templates yet")} description={t("Buat template upah berisi deretan komponen.", "Create a wage template containing a set of components.")} icon={<LayoutTemplate className="h-6 w-6" />} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(data?.templates ?? []).map((tpl) => (
            <Card key={tpl.id} className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px] font-bold">{tpl.code}</Badge>
                      <p className="truncate text-[15px] font-bold">{tpl.name}</p>
                    </div>
                    {tpl.description && <p className="mt-0.5 text-[11px] text-slate-400">{tpl.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => setDialog({ open: true, tpl: tpl })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label={t("Ubah")}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(tpl)} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label={t("Hapus")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tpl.items.map((it) => (
                    <span key={it.id} className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold",
                      it.wageComponent.type === "Earning" ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85" :
                      it.wageComponent.type === "Deduction" ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400" :
                      "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                    )}>
                      {it.wageComponent.name}
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex items-center gap-2 border-t border-dashed border-slate-200 pt-3 dark:border-slate-800">
                  <Users className="h-3.5 w-3.5 text-slate-400" />
                  <p className="text-[11px] font-bold text-slate-500">{t("{n} karyawan memakai template ini", "{n} employees use this template", { n: tpl._count.profiles })}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TemplateDialog open={dialog.open} tpl={dialog.tpl} onClose={() => { setDialog({ open: false, tpl: null }); refresh(); }} />
    </div>
  );
}

function TemplateDialog({ open, tpl, onClose }: { open: boolean; tpl: TemplateRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const compsApi = useApi<{ components: WageCompFull[] }>(open ? "/api/onevity/wage-components" : null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const compKey = tpl?.id ?? "new";
  if (key !== compKey) {
    setKey(compKey);
    setCode(tpl?.code ?? "");
    setName(tpl?.name ?? "");
    setDescription(tpl?.description ?? "");
    setSelected(tpl?.items.map((i) => i.wageComponent.id) ?? []);
  }

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast.error(t("Kode & nama template wajib diisi", "Template code & name are required")); return; }
    if (selected.length === 0) { toast.error(t("Pilih minimal satu komponen", "Select at least one component")); return; }
    setBusy(true);
    try {
      if (tpl) {
        await apiSend("/api/onevity/wage-templates", "PATCH", { id: tpl.id, name, description, componentIds: selected });
        toast.success(t("Template diperbarui", "Template updated"));
      } else {
        await apiSend("/api/onevity/wage-templates", "POST", { code: code.trim().toUpperCase(), name, description, componentIds: selected });
        toast.success(t("Template dibuat", "Template created"));
      }
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const groups: Record<string, WageCompFull[]> = {};
  for (const c of compsApi.data?.components ?? []) {
    (groups[c.type] ??= []).push(c);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] sm:max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><LayoutTemplate className="h-4 w-4 ov-text-accent" /> {tpl ? t("Edit Template", "Edit Template") : t("Template Upah Baru", "New Wage Template")}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {!tpl && (
            <div>
              <Label className="text-xs">{t("Kode *", "Code *")}</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("cth: STAFF-OPS", "e.g. STAFF-OPS")} className="mt-1.5 font-mono uppercase" />
            </div>
          )}
          <div>
            <Label className="text-xs">{t("Nama *", "Name *")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("cth: Template Operator Shift", "e.g. Shift Operator Template")} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">{t("Deskripsi")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("opsional", "optional")} className="mt-1.5" />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs">{t("Komponen dalam template *", "Components in template *")} ({selected.length})</Label>
              <Select value="all" onValueChange={() => {}}>
                <SelectTrigger className="hidden h-7 w-24 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent />
              </Select>
            </div>
            <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              {Object.entries(groups).map(([gname, comps]) => (
                <div key={gname}>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{gname}</p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {comps.map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <Checkbox checked={selected.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
                        <span className="truncate text-xs font-medium">{c.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {compsApi.loading && <p className="py-3 text-center text-xs text-slate-400">{t("Memuat komponen…", "Loading components…")}</p>}
            </div>
          </div>
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900">
            {t("Komponen", "The")} <b>PPH21</b> {t("otomatis dihitung engine saat run diproses (tidak perlu dimasukkan). Angsuran pinjaman juga otomatis masuk bila jatuh tempo.", "component is calculated automatically by the engine when the run is processed (no need to add it). Loan installments are also included automatically when due.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
