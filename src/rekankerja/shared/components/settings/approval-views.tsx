"use client";
// RekanKerja — Settings: Approval Engine (Template + Temporary Approver)
import { useState } from "react";
import { useApi, apiSend, fmtDate, initials, avatarColor } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { ApprovalStructureView } from "@/rekankerja/shared/components/settings/approval-structure-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Loader2, CheckCircle2, Layers, ArrowRight, Zap, Clock3,
  UserRound, CalendarRange, PlusCircle, MinusCircle, UserCog, UserCheck, GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

// ================= types =================
interface LayerDef { layer: number; role: string }
interface ApprovalTemplate {
  id: string;
  code: string;
  name: string;
  docType: string;
  layersJson: string;
  layers: LayerDef[];
  autoApprove: boolean;
  active: boolean;
}
interface TemplatesResp { templates: ApprovalTemplate[] }

interface Delegation {
  id: string;
  docType: string;
  validFrom: string;
  validTo: string;
  reason: string | null;
  active: boolean;
  approver: { id: string; username: string; fullName: string; role: string };
  delegate: { id: string; username: string; fullName: string; role: string };
}
interface DelegationsResp { delegations: Delegation[]; users: { id: string; username: string; fullName: string; role: string; active: boolean }[] }

const DOC_TYPES = ["PersonnelAction", "PayrollRun", "Overtime", "LeaveRequest", "TravelRequest", "MedicalClaim"];

/** docType pilihan delegasi — nama engine (Leave/Travel/Medical/Loan/WorkOff)
 *  + wildcard All; mesin approval juga menerima nama legacy di atas. */
const DELEGATION_DOC_TYPES = [...DOC_TYPES, "Leave", "Travel", "Medical", "Loan", "WorkOff", "RecruitmentPR", "All"];

// =================================================================
export function ApprovalEngineView() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("Approval Berjenjang")}
        description={t("Struktur persetujuan multi-level per dokumen (cuti, travel, medical, pinjaman) — dicocokkan ke pemohon berdasarkan kantor, lokasi kerja, unit, posisi, grade & level jabatan, plus jenjang bersyarat nominal.", "Multi-level approval structures per document (leave, travel, medical, loan) — matched to the requester by office, work location, unit, position, grade & job level, plus amount-conditional tiers.")}
      />
      <Tabs defaultValue="structure" className="space-y-5">
        <TabsList className="h-12 rounded-xl ov-tile p-1">
          <TabsTrigger value="structure" className="h-10 gap-2 rounded-lg px-4 text-[13px] font-semibold data-[state=active]:ov-fill">
            <GitBranch className="h-4 w-4" /> {t("Struktur Berjenjang", "Tiered Structure")}
          </TabsTrigger>
          <TabsTrigger value="templates" className="h-10 gap-2 rounded-lg px-4 text-[13px] font-semibold data-[state=active]:ov-fill">
            <Layers className="h-4 w-4" /> {t("Template PA", "PA Templates")}
          </TabsTrigger>
          <TabsTrigger value="temp" className="h-10 gap-2 rounded-lg px-4 text-[13px] font-semibold data-[state=active]:ov-fill">
            <UserRound className="h-4 w-4" /> Temporary Approver
          </TabsTrigger>
        </TabsList>
        <TabsContent value="structure"><ApprovalStructureView /></TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="temp"><TempApproversTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// =================================================================
// TAB 1 — APPROVAL TEMPLATES
// =================================================================
function TemplatesTab() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<TemplatesResp>("/api/rekankerja/approval-templates");
  const [editing, setEditing] = useState<ApprovalTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ApprovalTemplate | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/rekankerja/approval-templates?id=${deleting.id}`, "DELETE");
      toast.success(t("Template {code} dihapus", "Template {code} deleted", { code: deleting.code }));
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error(t("Gagal menghapus template", "Failed to delete the template"), { description: (e as Error).message });
    }
  };

  const templates = data?.templates ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("{n} template — menentukan layer approval per jenis dokumen.", "{n} templates — define the approval layers per document type.", { n: templates.length })}</p>
        <Button onClick={() => setCreating(true)} className="h-11 gap-2 px-5 font-bold">
          <Plus className="h-4 w-4" /> {t("Template Baru", "New Template")}
        </Button>
      </div>

      {loading ? (
        <LoadingRows rows={3} />
      ) : error ? (
        <EmptyState title={t("Gagal memuat template", "Failed to load templates")} description={error} />
      ) : templates.length === 0 ? (
        <EmptyState title={t("Belum ada template", "No templates yet")} description={t("Buat template approval pertama.", "Create the first approval template.")} icon={<Layers className="h-6 w-6" />} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {templates.map((tpl) => (
            <article key={tpl.id} className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl ov-fill ov-glow">
                    <CheckCircle2 className="h-5.5 w-5.5" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-50">{tpl.name}</h3>
                    <p className="font-mono text-[11px] text-slate-400">{tpl.code}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="rounded-full border-brand/25 bg-brand/10 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">{tpl.docType}</Badge>
                  {tpl.autoApprove && (
                    <Badge className="gap-1 rounded-full bg-amber-50 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      <Zap className="h-3 w-3" /> AUTO
                    </Badge>
                  )}
                  <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:ov-text-accent" onClick={() => setEditing(tpl)} aria-label={`Edit ${tpl.code}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-rose-600" onClick={() => setDeleting(tpl)} disabled={tpl.code === "AT-PA-STD"} aria-label={`Hapus ${tpl.code}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* numbered layer steps */}
              <ol className="mt-4 flex flex-wrap items-center gap-2">
                {tpl.layers.map((l, i) => (
                  <li key={l.layer} className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 font-mono text-[10px] font-extrabold text-white dark:bg-slate-200 dark:text-slate-900">{l.layer}</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{l.role}</span>
                    </span>
                    {i < tpl.layers.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />}
                  </li>
                ))}
              </ol>

              <p className="mt-3 text-[11px] text-slate-400">
                {t("{n} layer approval{auto}{off}", "{n} approval layers{auto}{off}", {
                  n: tpl.layers.length,
                  auto: tpl.autoApprove ? t(" · dokumen auto-approve bila approver tidak ditemukan", " · document auto-approves when no approver is found") : "",
                  off: !tpl.active ? t(" · nonaktif", " · inactive") : "",
                })}
              </p>
            </article>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <TemplateDialog
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={refresh}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus Template?", "Delete Template?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Template")} <b>{deleting?.name} ({deleting?.code})</b> {t("akan dihapus permanen.", "will be permanently deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="h-11 bg-rose-600 font-bold hover:bg-rose-700">{t("Hapus")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TemplateDialog({ initial, onClose, onDone }: { initial: ApprovalTemplate | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [docType, setDocType] = useState(initial?.docType ?? "PersonnelAction");
  const [layers, setLayers] = useState<LayerDef[]>(
    initial?.layers?.length ? initial.layers.map((l) => ({ ...l })) : [{ layer: 1, role: "HR Manager" }]
  );
  const [autoApprove, setAutoApprove] = useState(initial?.autoApprove ?? false);
  const [busy, setBusy] = useState(false);

  const addLayer = () => setLayers((ls) => [...ls, { layer: ls.length + 1, role: "" }]);
  const removeLayer = (idx: number) => setLayers((ls) => ls.filter((_, i) => i !== idx).map((l, i) => ({ ...l, layer: i + 1 })));
  const setRole = (idx: number, role: string) => setLayers((ls) => ls.map((l, i) => (i === idx ? { ...l, role } : l)));

  const submit = async () => {
    const validLayers = layers.filter((l) => l.role.trim());
    if (!code.trim() || !name.trim()) {
      toast.error(t("Kode dan nama template wajib diisi", "Template code and name are required"));
      return;
    }
    if (validLayers.length === 0) {
      toast.error(t("Minimal satu layer approval dengan nama role", "At least one approval layer with a role name is required"));
      return;
    }
    setBusy(true);
    const body = { code: code.trim().toUpperCase(), name: name.trim(), docType, layers: validLayers, autoApprove };
    try {
      if (initial) {
        await apiSend(`/api/rekankerja/approval-templates?id=${initial.id}`, "PATCH", body);
        toast.success(t("Template {code} diperbarui", "Template {code} updated", { code: body.code }));
      } else {
        await apiSend("/api/rekankerja/approval-templates", "POST", body);
        toast.success(t("Template {code} dibuat ({n} layer)", "Template {code} created ({n} layers)", { code: body.code, n: validLayers.length }));
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error(t("Gagal menyimpan template", "Failed to save the template"), { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? t("Edit Template — {code}", "Edit Template — {code}", { code: initial.code }) : t("Template Approval Baru", "New Approval Template")}</DialogTitle>
          <DialogDescription>{t("Layer disetujui berurutan dari layer 1 hingga terakhir.", "Layers are approved sequentially from layer 1 to the last.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="at-code">{t("Kode")} <span className="text-rose-500">*</span></Label>
              <Input id="at-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="AT-PA-CUSTOM" className="h-11 font-mono" disabled={!!initial} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="at-name">{t("Nama")} <span className="text-rose-500">*</span></Label>
              <Input id="at-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Custom Personnel Action" className="h-11" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("Jenis Dokumen", "Document Type")}</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((d) => <SelectItem key={d} value={d} className="py-2.5">{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("Layer Approval", "Approval Layers")}</Label>
            <ul className="space-y-2">
              {layers.map((l, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 font-mono text-xs font-extrabold text-white dark:bg-slate-200 dark:text-slate-900">{i + 1}</span>
                  <Input
                    value={l.role}
                    onChange={(e) => setRole(i, e.target.value)}
                    placeholder={t("Nama role approver (mis. HR Manager)", "Approver role name (e.g. HR Manager)")}
                    className="h-11"
                    aria-label={t("Role layer {n}", "Role for layer {n}", { n: i + 1 })}
                  />
                  <Button size="icon" variant="ghost" onClick={() => removeLayer(i)} disabled={layers.length === 1} className="h-11 w-11 shrink-0 text-slate-400 hover:text-rose-600" aria-label={t("Hapus layer", "Delete layer")}>
                    <MinusCircle className="h-4.5 w-4.5" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={addLayer} className="h-10 gap-1.5">
              <PlusCircle className="h-4 w-4" /> {t("Tambah Layer", "Add Layer")}
            </Button>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3.5 dark:border-slate-700/60 dark:bg-slate-800/30">
            <Switch id="at-auto" checked={autoApprove} onCheckedChange={setAutoApprove} />
            <div>
              <Label htmlFor="at-auto" className="text-xs font-semibold">{t("Auto-approve bila approver tidak ditemukan", "Auto-approve when no approver is found")}</Label>
              <p className="mt-0.5 text-[11px] text-slate-400">{t("Dokumen otomatis diloloskan pada layer tanpa approver aktif.", "Documents are automatically passed on layers without an active approver.")}</p>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy} className="h-11 px-5">{t("Batal")}</Button>
          <Button onClick={() => void submit()} disabled={busy} className="h-11 px-6 font-bold">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================================================================
// TAB 2 — TEMPORARY APPROVER (delegasi)
// =================================================================
// Peta EN paralel label status delegasi (label ID tetap dari delegationStatus).
const DELEGATION_LABEL_EN: Record<string, string> = {
  "Nonaktif": "Inactive", "Terjadwal": "Scheduled", "Kedaluwarsa": "Expired", "Aktif": "Active",
};

function delegationStatus(d: Delegation): { label: string; cls: string } {
  const now = new Date();
  const from = new Date(d.validFrom);
  const to = new Date(d.validTo);
  if (!d.active) return { label: "Nonaktif", cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25" };
  if (now < from) return { label: "Terjadwal", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25" };
  if (now > to) return { label: "Kedaluwarsa", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25" };
  return { label: "Aktif", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25" };
}

function TempApproversTab() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<DelegationsResp>("/api/rekankerja/temporary-approvers");
  const [editing, setEditing] = useState<Delegation | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Delegation | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/rekankerja/temporary-approvers?id=${deleting.id}`, "DELETE");
      toast.success(t("Delegasi dihapus", "Delegation deleted"));
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error(t("Gagal menghapus delegasi", "Failed to delete the delegation"), { description: (e as Error).message });
    }
  };

  const delegations = data?.delegations ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("{n} delegasi approver aktif/tercatat.", "{n} approver delegations active/recorded.", { n: delegations.length })}</p>
          <p className="mt-0.5 text-xs text-brand dark:text-brand/85">{t("Delegasi AKTIF — mesin approval membacanya saat keputusan jenjang (Leave/Travel/Medical/Loan/WorkOff/PA).", "Delegations are LIVE — the approval engine enforces them on tier decisions (Leave/Travel/Medical/Loan/WorkOff/PA).")}</p>
        </div>
        <Button onClick={() => setCreating(true)} className="h-11 gap-2 px-5 font-bold">
          <Plus className="h-4 w-4" /> {t("Delegasi Baru", "New Delegation")}
        </Button>
      </div>

      {loading ? (
        <LoadingRows rows={3} />
      ) : error ? (
        <EmptyState title={t("Gagal memuat delegasi", "Failed to load delegations")} description={error} />
      ) : delegations.length === 0 ? (
        <EmptyState title={t("Belum ada delegasi", "No delegations yet")} description={t("Buat delegasi approver sementara, mis. saat approver cuti.", "Create a temporary approver delegation, e.g. while the approver is on leave.")} icon={<UserRound className="h-6 w-6" />} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {delegations.map((d) => {
            const st = delegationStatus(d);
            return (
              <article key={d.id} className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* approver → delegate */}
                  <div className="flex items-center gap-3">
                    <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold", avatarColor(d.approver.fullName))} title={`${d.approver.fullName} (${d.approver.role})`}>
                      {initials(d.approver.fullName)}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900 dark:text-slate-50">
                        <UserCog className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="truncate">{d.approver.fullName}</span>
                      </p>
                      <p className="font-mono text-[10px] text-slate-400">{d.approver.username} · {d.approver.role}</p>
                    </div>
                    <ArrowRight className="mx-1 h-5 w-5 shrink-0 ov-text-accent" aria-label={t("mendelegasikan ke", "delegates to")} />
                    <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ring-2 ring-(--ov-accent)/60", avatarColor(d.delegate.fullName))} title={`${d.delegate.fullName} (${d.delegate.role})`}>
                      {initials(d.delegate.fullName)}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900 dark:text-slate-50">
                        <UserCheck className="h-4 w-4 shrink-0 ov-text-accent" />
                        <span className="truncate">{d.delegate.fullName}</span>
                      </p>
                      <p className="font-mono text-[10px] text-slate-400">{d.delegate.username} · {d.delegate.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", st.cls)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", st.label === "Aktif" ? "bg-brand" : st.label === "Terjadwal" ? "bg-brand" : st.label === "Kedaluwarsa" ? "bg-rose-500" : "bg-slate-400")} />
                      {t(st.label, DELEGATION_LABEL_EN[st.label] ?? st.label)}
                    </span>
                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:ov-text-accent" onClick={() => setEditing(d)} aria-label={t("Edit delegasi", "Edit delegation")}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-rose-600" onClick={() => setDeleting(d)} aria-label={t("Hapus delegasi", "Delete delegation")}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarRange className="h-3.5 w-3.5" />
                    {fmtDate(d.validFrom)} <span className="text-slate-300 dark:text-slate-600">{t("s.d.", "to")}</span> {fmtDate(d.validTo)}
                  </span>
                  <Badge variant="outline" className="rounded-full border-brand/25 bg-brand/10 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">{d.docType}</Badge>
                  <span className="inline-flex items-center gap-1.5 text-slate-400">
                    <Clock3 className="h-3.5 w-3.5" />
                    {t("{n} hari tersisa", "{n} days left", { n: Math.max(0, Math.ceil((new Date(d.validTo).getTime() - Date.now()) / 86400000)) })}
                  </span>
                </div>
                {d.reason && (
                  <p className="mt-3 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3.5 py-2.5 text-xs italic text-slate-500 dark:border-slate-700/60 dark:bg-slate-800/30 dark:text-slate-400">
                    “{d.reason}”
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <DelegationDialog
          initial={editing}
          users={data?.users ?? []}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={refresh}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus Delegasi?", "Delete Delegation?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Delegasi")} <b>{deleting?.approver.fullName} → {deleting?.delegate.fullName}</b> {t("akan dihapus permanen.", "will be permanently deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="h-11 bg-rose-600 font-bold hover:bg-rose-700">{t("Hapus")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DelegationDialog({ initial, users, onClose, onDone }: { initial: Delegation | null; users: { id: string; username: string; fullName: string; role: string; active: boolean }[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [approverId, setApproverId] = useState(initial?.approver.id ?? "");
  const [delegateId, setDelegateId] = useState(initial?.delegate.id ?? "");
  const [docType, setDocType] = useState(initial?.docType ?? "PersonnelAction");
  const [validFrom, setValidFrom] = useState(initial ? initial.validFrom.slice(0, 10) : "");
  const [validTo, setValidTo] = useState(initial ? initial.validTo.slice(0, 10) : "");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!approverId || !delegateId) {
      toast.error(t("Approver asal dan pendelegasian wajib dipilih", "Source approver and delegate are required"));
      return;
    }
    if (!validFrom || !validTo) {
      toast.error(t("Rentang tanggal valid wajib diisi", "The valid date range is required"));
      return;
    }
    setBusy(true);
    const body = { approverId, delegateId, docType, validFrom, validTo, reason: reason.trim() || null, active };
    try {
      if (initial) {
        await apiSend(`/api/rekankerja/temporary-approvers?id=${initial.id}`, "PATCH", body);
        toast.success(t("Delegasi diperbarui", "Delegation updated"));
      } else {
        await apiSend("/api/rekankerja/temporary-approvers", "POST", body);
        toast.success(t("Delegasi dibuat", "Delegation created"));
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error(t("Gagal menyimpan delegasi", "Failed to save the delegation"), { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const userItem = (u: { id: string; username: string; fullName: string; role: string }) => (
    <SelectItem key={u.id} value={u.id} className="py-2.5">
      <span className={cn("mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold", avatarColor(u.fullName))}>{initials(u.fullName)}</span>
      <span className="min-w-0 flex-1 truncate">{u.fullName}</span>
      <span className="ml-2 font-mono text-[10px] text-slate-400">{u.username}</span>
    </SelectItem>
  );

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl ov-fill">
              <UserRound className="h-4.5 w-4.5" />
            </span>
            {initial ? t("Edit Delegasi Approver", "Edit Approver Delegation") : t("Delegasi Approver Baru", "New Approver Delegation")}
          </DialogTitle>
          <DialogDescription>{t("Approver asal mendelegasikan keputusan sementara ke pengguna lain — aktif dipakai mesin approval pada jenjang yang menunggu approver tersebut.", "The source approver temporarily delegates decisions to another user — enforced live by the approval engine on the tier awaiting that approver.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("Approver Asal", "Source Approver")} <span className="text-rose-500">*</span></Label>
              <Select value={approverId} onValueChange={setApproverId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Pilih approver", "Select an approver")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {users.filter((u) => u.id !== delegateId).map(userItem)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("Pendelegasian (Delegate)", "Delegate")} <span className="text-rose-500">*</span></Label>
              <Select value={delegateId} onValueChange={setDelegateId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Pilih delegate", "Select a delegate")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {users.filter((u) => u.id !== approverId).map(userItem)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("Jenis Dokumen", "Document Type")}</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DELEGATION_DOC_TYPES.map((d) => <SelectItem key={d} value={d} className="py-2.5">{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-400">{t("All = semua jenis dokumen. Rentang tanggal mengatur kapan delegate boleh memutus.", "All = every document type. The date range controls when the delegate may decide.")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ta-from">{t("Valid Dari", "Valid From")} <span className="text-rose-500">*</span></Label>
              <Input id="ta-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ta-to">{t("Valid S.d.", "Valid Until")} <span className="text-rose-500">*</span></Label>
              <Input id="ta-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="h-11" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ta-reason">{t("Alasan Delegasi", "Delegation Reason")}</Label>
            <Textarea id="ta-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Contoh: Cuti tahunan 2 minggu — approve diwakilkan selama periode.", "Example: 2-week annual leave — approvals delegated for the period.")} rows={2} className="resize-none" />
          </div>
          <div className="flex items-center gap-3">
            <Switch id="ta-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="ta-active" className="text-xs font-normal text-slate-500">{t("Delegasi aktif", "Delegation active")}</Label>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy} className="h-11 px-5">{t("Batal")}</Button>
          <Button onClick={() => void submit()} disabled={busy} className="h-11 px-6 font-bold">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
