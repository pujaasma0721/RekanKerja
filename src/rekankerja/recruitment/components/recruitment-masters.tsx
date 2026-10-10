"use client";
// RekanKerja Recruitment — Master Rekrutmen (F0): CRUD 10 tipe master via satu
// endpoint ?type=… (pola master medical-benefit-type; label dwibahasa inline t()).
import { useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useTableSort } from "@/rekankerja/shared/lib/use-table-sort";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Boxes, Plus, Pencil, Trash2, ListChecks, CalendarClock, Layers, BadgeCheck, Megaphone, Handshake, Wallet, Sparkles, FileCheck2 } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { MASTER_DEFS, masterDefOf, type MasterFieldKind } from "./recruitment-types";

interface MasterRowUI {
  id: string;
  code: string;
  name?: string | null;
  title?: string | null;
  scope?: string | null;
  description?: string | null;
  address?: string | null;
  contact?: string | null;
  note?: string | null;
  fileType?: string | null;
  mandatory?: boolean | null;
  ranking?: number | null;
  days?: number | null;
  resultType?: string | null;
  processOrder?: number | null;
  slaDays?: number | null;
  needAcknowledgement?: boolean | null;
  appliesInternal?: boolean | null;
  appliesExternal?: boolean | null;
  minResultPass?: number | null;
  active: boolean;
  sortOrder: number;
}

// ikon tab per tipe (identitas visual ringan)
const TYPE_ICON: Record<string, React.ElementType> = {
  method: Megaphone,
  "ad-media": BadgeCheck,
  agency: Handshake,
  "cost-item": Wallet,
  skill: Sparkles,
  "required-document": FileCheck2,
  "eval-category": Layers,
  "eval-scale": Layers,
  "sla-group": CalendarClock,
  "selection-process": ListChecks,
};

interface FormState {
  id?: string;
  code: string;
  name: string;
  title: string;
  scope: string;
  description: string;
  address: string;
  contact: string;
  note: string;
  fileType: string;
  mandatory: boolean;
  ranking: string;
  days: string;
  resultType: string;
  processOrder: string;
  slaDays: string;
  minResultPass: string;
  needAcknowledgement: boolean;
  appliesInternal: boolean;
  appliesExternal: boolean;
  mandatoryStep: boolean;
  active: boolean;
  sortOrder: string;
}

const emptyForm: FormState = {
  code: "", name: "", title: "", scope: "External", description: "",
  address: "", contact: "", note: "", fileType: "", mandatory: false,
  ranking: "1", days: "30", resultType: "Qualitative", processOrder: "1",
  slaDays: "", minResultPass: "", needAcknowledgement: false,
  appliesInternal: true, appliesExternal: true, mandatoryStep: true,
  active: true, sortOrder: "0",
};

export function RecruitmentMastersPage() {
  const { t } = useI18n();
  const [type, setType] = useState<string>("selection-process");
  const api = useApi<{ rows: MasterRowUI[] }>(`/api/rekankerja/recruitment/masters?type=${type}`, [type]);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const def = masterDefOf(type as never);
  const rows = api.data?.rows ?? [];

  const sort = useTableSort(rows, {
    code: (r) => r.code,
    name: (r) => r.name ?? r.title ?? "",
    order: (r) => r.processOrder ?? r.ranking ?? r.days ?? r.sortOrder,
    active: (r) => (r.active ? 0 : 1),
  }, { defaultKey: type === "selection-process" ? "order" : "name", defaultDir: "asc" });

  const openNew = () => {
    const next = { ...emptyForm };
    // default cerdas per tipe
    if (type === "selection-process") {
      const maxOrder = rows.reduce((n, r) => Math.max(n, r.processOrder ?? 0), 0);
      next.processOrder = String(maxOrder + 1);
      next.sortOrder = String(maxOrder + 1);
    }
    if (type === "sla-group") next.days = "30";
    if (type === "eval-scale") next.ranking = String(rows.reduce((n, r) => Math.max(n, r.ranking ?? 0), 0) + 1);
    setForm(next);
    setDialog(true);
  };

  const openEdit = (r: MasterRowUI) => {
    setForm({
      id: r.id,
      code: r.code,
      name: r.name ?? "",
      title: r.title ?? "",
      scope: r.scope ?? "External",
      description: r.description ?? "",
      address: r.address ?? "",
      contact: r.contact ?? "",
      note: r.note ?? "",
      fileType: r.fileType ?? "",
      mandatory: r.mandatory === true,
      ranking: r.ranking != null ? String(r.ranking) : "1",
      days: r.days != null ? String(r.days) : "30",
      resultType: r.resultType ?? "Qualitative",
      processOrder: r.processOrder != null ? String(r.processOrder) : "1",
      slaDays: r.slaDays != null ? String(r.slaDays) : "",
      minResultPass: r.minResultPass != null ? String(r.minResultPass) : "",
      needAcknowledgement: r.needAcknowledgement === true,
      appliesInternal: r.appliesInternal !== false,
      appliesExternal: r.appliesExternal !== false,
      mandatoryStep: r.mandatory !== false,
      active: r.active,
      sortOrder: String(r.sortOrder),
    });
    setDialog(true);
  };

  const save = async () => {
    const isDoc = type === "required-document";
    if (!form.code.trim() || (isDoc ? !form.title.trim() : !form.name.trim())) {
      toast.error(t("Kode & nama wajib diisi", "Code & name are required"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/recruitment/masters", "POST", {
        type,
        id: form.id,
        code: form.code,
        name: isDoc ? undefined : form.name,
        title: isDoc ? form.title : undefined,
        scope: type === "method" ? form.scope : undefined,
        description: form.description || undefined,
        address: type === "agency" ? form.address || undefined : undefined,
        contact: type === "agency" ? form.contact || undefined : undefined,
        note: type === "agency" ? form.note || undefined : undefined,
        fileType: type === "required-document" ? form.fileType || undefined : undefined,
        mandatory: type === "required-document" ? form.mandatory : undefined,
        ranking: type === "eval-scale" ? Number(form.ranking) || 1 : undefined,
        days: type === "sla-group" ? Number(form.days) || 30 : undefined,
        resultType: type === "selection-process" ? form.resultType : undefined,
        processOrder: type === "selection-process" ? Number(form.processOrder) || 1 : undefined,
        slaDays: type === "selection-process" ? (form.slaDays ? Number(form.slaDays) : null) : undefined,
        minResultPass: type === "selection-process" ? (form.minResultPass ? Number(form.minResultPass) : null) : undefined,
        needAcknowledgement: type === "selection-process" ? form.needAcknowledgement : undefined,
        appliesInternal: type === "selection-process" ? form.appliesInternal : undefined,
        appliesExternal: type === "selection-process" ? form.appliesExternal : undefined,
        mandatoryStep: type === "selection-process" ? form.mandatoryStep : undefined,
        active: form.active,
        sortOrder: Number(form.sortOrder) || 0,
      });
      toast.success(form.id ? t("Master diperbarui", "Master updated") : t("Master ditambahkan", "Master added"));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: MasterRowUI) => {
    if (!window.confirm(t(`Hapus ${r.code} — ${r.name ?? r.title ?? ""}?`, `Delete ${r.code} — ${r.name ?? r.title ?? ""}?`))) return;
    try {
      await apiSend(`/api/rekankerja/recruitment/masters?type=${type}&id=${r.id}`, "DELETE");
      toast.success(t("Master dihapus", "Master deleted"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus", "Failed to delete"));
    }
  };

  // render sel ringkas per tipe (kolom tambahan setelah nama)
  const detailCell = (r: MasterRowUI) => {
    switch (type) {
      case "method":
        return <span className="text-xs text-slate-500">{r.scope === "Internal" ? t("Internal saja", "Internal only") : r.scope === "External" ? t("Eksternal saja", "External only") : t("Internal & Eksternal", "Internal & External")}</span>;
      case "agency":
        return <span className="block text-xs text-slate-500">{[r.address, r.contact].filter(Boolean).join(" · ") || "—"}</span>;
      case "required-document":
        return <span className="text-xs text-slate-500">{r.mandatory ? t("Wajib", "Mandatory") : t("Opsional", "Optional")}{r.fileType ? ` · ${r.fileType}` : ""}</span>;
      case "eval-scale":
        return <span className="text-xs text-slate-500">{t("Ranking", "Ranking")} {r.ranking ?? 1}</span>;
      case "sla-group":
        return <span className="text-xs text-slate-500">{t("{n} hari", "{n} days", { n: r.days ?? 30 })}</span>;
      case "selection-process":
        return (
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">#{r.processOrder ?? 1}</span>
            {r.resultType === "Quantitative" ? t("Kuantitatif", "Quantitative") : t("Kualitatif", "Qualitative")}
            {r.slaDays != null && <span>· SLA {r.slaDays} {t("hari", "days")}</span>}
            {r.needAcknowledgement && <span>· {t("perlu konfirmasi", "needs ack")}</span>}
            {r.mandatory === false && <span className="text-amber-600 dark:text-amber-400">· {t("opsional", "optional")}</span>}
          </span>
        );
      default:
        return r.description ? <span className="text-xs text-slate-500">{r.description}</span> : null;
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · Master")}
        title={t("Master Rekrutmen", "Recruitment Masters")}
        description={t(
          "Konfigurasi master modul rekrutmen: metode & media pencarian, agency, pos biaya, skill, dokumen wajib pelamar, kategori & skala penilaian, grup SLA, dan katalog tahap seleksi (padanan General Setting oranHR — 15 master dirasionalisasi menjadi 10).",
          "Recruitment module master configuration: sourcing methods & media, agencies, cost items, skills, required documents, evaluation categories & scales, SLA groups, and the selection stage catalog (oranHR General Setting — 15 masters rationalized into 10).",
        )}
        actions={(
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> {t("Master Baru", "New Master")}
          </Button>
        )}
      />

      <Tabs value={type} onValueChange={setType} className="mb-4">
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
          {MASTER_DEFS.map((m) => {
            const Icon = TYPE_ICON[m.type] ?? Boxes;
            return (
              <TabsTrigger
                key={m.type}
                value={m.type}
                className="gap-1.5 px-3 py-1.5 text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100"
                title={t(m.desc, m.descEn)}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {t(m.label, m.labelEn)}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={t("Belum ada data master ini", "No data in this master yet")}
                description={t("Tambahkan lewat tombol Master Baru.", "Add one via the New Master button.")}
                icon={Boxes}
              />
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    {sort.head("code", t("Kode", "Code"))}
                    {sort.head(type === "selection-process" ? "order" : "name", type === "required-document" ? t("Dokumen") : t("Nama", "Name"))}
                    {type === "selection-process" && <TableHead>{t("Berlaku", "Applies To")}</TableHead>}
                    {sort.head("active", t("Status"))}
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sort.sorted.map((r) => (
                    <TableRow key={r.id} className={cn(!r.active && "opacity-50")}>
                      <TableCell className="font-mono text-xs font-semibold">{r.code}</TableCell>
                      <TableCell>
                        <p className="font-semibold">{r.name ?? r.title ?? r.code}</p>
                        {detailCell(r)}
                      </TableCell>
                      {type === "selection-process" && (
                        <TableCell className="text-xs text-slate-500">
                          {[
                            r.appliesInternal !== false ? t("Internal", "Internal") : null,
                            r.appliesExternal !== false ? t("Eksternal", "External") : null,
                          ].filter(Boolean).join(" + ") || "—"}
                        </TableCell>
                      )}
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          r.active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
                          {r.active ? t("Aktif") : t("Nonaktif", "Inactive")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)} aria-label={t("Ubah", "Edit")}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => remove(r)} aria-label={t("Hapus", "Delete")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {(() => { const Icon = TYPE_ICON[type] ?? Boxes; return <Icon className="h-5 w-5 ov-text-accent" aria-hidden />; })()}
              {form.id
                ? t(`Ubah Master — ${def.label}`, `Edit Master — ${def.labelEn}`)
                : t(`Master Baru — ${def.label}`, `New Master — ${def.labelEn}`)}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Kode *", "Code *")}</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={Boolean(form.id)} placeholder={t("mis. IJP", "e.g. IJP")} />
            </div>

            {type === "required-document" ? (
              <div className="space-y-1.5">
                <Label>{t("Nama Dokumen *", "Document Name *")}</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("mis. Portofolio", "e.g. Portfolio")} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{t("Nama *", "Name *")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("mis. Internal Job Posting", "e.g. Internal Job Posting")} />
              </div>
            )}

            {def.fields.includes("scope") && (
              <div className="space-y-1.5">
                <Label>{t("Cakupan *", "Scope *")}</Label>
                <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Internal">{t("Internal saja", "Internal only")}</SelectItem>
                    <SelectItem value="External">{t("Eksternal saja", "External only")}</SelectItem>
                    <SelectItem value="Both">{t("Internal & Eksternal", "Internal & External")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {def.fields.includes("resultType") && (
              <div className="space-y-1.5">
                <Label>{t("Tipe Hasil *", "Result Type *")}</Label>
                <Select value={form.resultType} onValueChange={(v) => setForm({ ...form, resultType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Qualitative">{t("Kualitatif", "Qualitative")}</SelectItem>
                    <SelectItem value="Quantitative">{t("Kuantitatif (skor)", "Quantitative (score)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {def.fields.includes("processOrder") && (
              <div className="space-y-1.5">
                <Label>{t("Urutan Tahap *", "Stage Order *")}</Label>
                <Input type="number" min={1} value={form.processOrder} onChange={(e) => setForm({ ...form, processOrder: e.target.value })} />
              </div>
            )}

            {def.fields.includes("slaDays") && (
              <div className="space-y-1.5">
                <Label>{t("SLA (hari)", "SLA (days)")}</Label>
                <Input type="number" min={1} value={form.slaDays} onChange={(e) => setForm({ ...form, slaDays: e.target.value })} placeholder={t("mis. 30", "e.g. 30")} />
              </div>
            )}

            {def.fields.includes("minResultPass") && (
              <div className="space-y-1.5">
                <Label>{t("Nilai Minimal Lulus", "Minimum Passing Score")}</Label>
                <Input type="number" min={0} step="0.01" value={form.minResultPass} onChange={(e) => setForm({ ...form, minResultPass: e.target.value })} placeholder={t("opsional (skor)", "optional (score)")} />
              </div>
            )}

            {def.fields.includes("ranking") && (
              <div className="space-y-1.5">
                <Label>{t("Ranking (1–10) *", "Ranking (1–10) *")}</Label>
                <Input type="number" min={1} max={10} value={form.ranking} onChange={(e) => setForm({ ...form, ranking: e.target.value })} />
              </div>
            )}

            {def.fields.includes("days") && (
              <div className="space-y-1.5">
                <Label>{t("Jumlah Hari *", "Days *")}</Label>
                <Input type="number" min={1} max={365} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
              </div>
            )}

            {def.fields.includes("fileType") && (
              <div className="space-y-1.5">
                <Label>{t("Tipe File (hint)", "File Types (hint)")}</Label>
                <Input value={form.fileType} onChange={(e) => setForm({ ...form, fileType: e.target.value })} placeholder="pdf,jpg" />
              </div>
            )}

            {def.fields.includes("address") && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Alamat", "Address")}</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            )}

            {def.fields.includes("contact") && (
              <div className="space-y-1.5">
                <Label>{t("Kontak", "Contact")}</Label>
                <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder={t("telepon / email", "phone / email")} />
              </div>
            )}

            {def.fields.includes("description") && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Deskripsi", "Description")}</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
              </div>
            )}

            {def.fields.includes("note") && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Catatan", "Note")}</Label>
                <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t("Urut Tampil", "Display Order")}</Label>
              <Input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
            </div>
          </div>

          {(def.fields.includes("mandatory") || def.fields.includes("needAcknowledgement") || def.fields.includes("appliesInternal") || def.fields.includes("mandatoryStep")) && (
            <div className="flex flex-wrap items-center gap-4">
              {def.fields.includes("mandatory" as MasterFieldKind) && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.mandatory} onCheckedChange={(v) => setForm({ ...form, mandatory: Boolean(v) })} />
                  {t("Wajib dikumpulkan pelamar", "Mandatory for applicants")}
                </label>
              )}
              {def.fields.includes("mandatoryStep") && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.mandatoryStep} onCheckedChange={(v) => setForm({ ...form, mandatoryStep: Boolean(v) })} />
                  {t("Tahap wajib", "Mandatory stage")}
                </label>
              )}
              {def.fields.includes("needAcknowledgement") && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.needAcknowledgement} onCheckedChange={(v) => setForm({ ...form, needAcknowledgement: Boolean(v) })} />
                  {t("Perlu konfirmasi jadwal", "Needs schedule acknowledgement")}
                </label>
              )}
              {def.fields.includes("appliesInternal") && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.appliesInternal} onCheckedChange={(v) => setForm({ ...form, appliesInternal: Boolean(v) })} />
                  {t("Berlaku kandidat internal", "Applies to internal candidates")}
                </label>
              )}
              {def.fields.includes("appliesExternal") && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.appliesExternal} onCheckedChange={(v) => setForm({ ...form, appliesExternal: Boolean(v) })} />
                  {t("Berlaku kandidat eksternal", "Applies to external candidates")}
                </label>
              )}
            </div>
          )}

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: Boolean(v) })} />
              {t("Aktif")}
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal")}</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? t("Menyimpan…", "Saving…") : t("Simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
