"use client";
// OneVity — Settings: Approval Engine (Template + Temporary Approver)
import { useState } from "react";
import { useApi, apiSend, fmtDate, initials, avatarColor } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
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
  UserRound, CalendarRange, PlusCircle, MinusCircle, UserCog, UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

// =================================================================
export function ApprovalEngineView() {
  return (
    <div>
      <PageHeader
        eyebrow="PENGATURAN"
        title="Template Approval"
        description="Template berlapis untuk alur persetujuan dokumen dan delegasi approver sementara."
      />
      <Tabs defaultValue="templates" className="space-y-5">
        <TabsList className="h-12 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/70">
          <TabsTrigger value="templates" className="h-10 gap-2 rounded-lg px-4 text-[13px] font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-900">
            <Layers className="h-4 w-4" /> Template
          </TabsTrigger>
          <TabsTrigger value="temp" className="h-10 gap-2 rounded-lg px-4 text-[13px] font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-900">
            <UserRound className="h-4 w-4" /> Temporary Approver
          </TabsTrigger>
        </TabsList>
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
  const { data, loading, error, refresh } = useApi<TemplatesResp>("/api/onevity/approval-templates");
  const [editing, setEditing] = useState<ApprovalTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ApprovalTemplate | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/onevity/approval-templates?id=${deleting.id}`, "DELETE");
      toast.success(`Template ${deleting.code} dihapus`);
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error("Gagal menghapus template", { description: (e as Error).message });
    }
  };

  const templates = data?.templates ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{templates.length} template — menentukan layer approval per jenis dokumen.</p>
        <Button onClick={() => setCreating(true)} className="h-11 gap-2 bg-emerald-600 px-5 font-bold hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> Template Baru
        </Button>
      </div>

      {loading ? (
        <LoadingRows rows={3} />
      ) : error ? (
        <EmptyState title="Gagal memuat template" description={error} />
      ) : templates.length === 0 ? (
        <EmptyState title="Belum ada template" description="Buat template approval pertama." icon={<Layers className="h-6 w-6" />} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {templates.map((t) => (
            <article key={t.id} className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md shadow-emerald-600/20">
                    <CheckCircle2 className="h-5.5 w-5.5" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-50">{t.name}</h3>
                    <p className="font-mono text-[11px] text-slate-400">{t.code}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="rounded-full border-teal-200 bg-teal-50 text-[10px] font-bold text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400">{t.docType}</Badge>
                  {t.autoApprove && (
                    <Badge className="gap-1 rounded-full bg-amber-50 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      <Zap className="h-3 w-3" /> AUTO
                    </Badge>
                  )}
                  <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-emerald-600" onClick={() => setEditing(t)} aria-label={`Edit ${t.code}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-rose-600" onClick={() => setDeleting(t)} disabled={t.code === "AT-PA-STD"} aria-label={`Hapus ${t.code}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* numbered layer steps */}
              <ol className="mt-4 flex flex-wrap items-center gap-2">
                {t.layers.map((l, i) => (
                  <li key={l.layer} className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 font-mono text-[10px] font-extrabold text-white dark:bg-slate-200 dark:text-slate-900">{l.layer}</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{l.role}</span>
                    </span>
                    {i < t.layers.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />}
                  </li>
                ))}
              </ol>

              <p className="mt-3 text-[11px] text-slate-400">
                {t.layers.length} layer approval{t.autoApprove ? " · dokumen auto-approve bila approver tidak ditemukan" : ""}{!t.active ? " · nonaktif" : ""}
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
            <AlertDialogTitle>Hapus Template?</AlertDialogTitle>
            <AlertDialogDescription>
              Template <b>{deleting?.name} ({deleting?.code})</b> akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="h-11 bg-rose-600 font-bold hover:bg-rose-700">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TemplateDialog({ initial, onClose, onDone }: { initial: ApprovalTemplate | null; onClose: () => void; onDone: () => void }) {
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
      toast.error("Kode dan nama template wajib diisi");
      return;
    }
    if (validLayers.length === 0) {
      toast.error("Minimal satu layer approval dengan nama role");
      return;
    }
    setBusy(true);
    const body = { code: code.trim().toUpperCase(), name: name.trim(), docType, layers: validLayers, autoApprove };
    try {
      if (initial) {
        await apiSend(`/api/onevity/approval-templates?id=${initial.id}`, "PATCH", body);
        toast.success(`Template ${body.code} diperbarui`);
      } else {
        await apiSend("/api/onevity/approval-templates", "POST", body);
        toast.success(`Template ${body.code} dibuat (${validLayers.length} layer)`);
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error("Gagal menyimpan template", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit Template — ${initial.code}` : "Template Approval Baru"}</DialogTitle>
          <DialogDescription>Layer disetujui berurutan dari layer 1 hingga terakhir.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="at-code">Kode <span className="text-rose-500">*</span></Label>
              <Input id="at-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="AT-PA-CUSTOM" className="h-11 font-mono" disabled={!!initial} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="at-name">Nama <span className="text-rose-500">*</span></Label>
              <Input id="at-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Custom Personnel Action" className="h-11" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Jenis Dokumen</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((d) => <SelectItem key={d} value={d} className="py-2.5">{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Layer Approval</Label>
            <ul className="space-y-2">
              {layers.map((l, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 font-mono text-xs font-extrabold text-white dark:bg-slate-200 dark:text-slate-900">{i + 1}</span>
                  <Input
                    value={l.role}
                    onChange={(e) => setRole(i, e.target.value)}
                    placeholder="Nama role approver (mis. HR Manager)"
                    className="h-11"
                    aria-label={`Role layer ${i + 1}`}
                  />
                  <Button size="icon" variant="ghost" onClick={() => removeLayer(i)} disabled={layers.length === 1} className="h-11 w-11 shrink-0 text-slate-400 hover:text-rose-600" aria-label="Hapus layer">
                    <MinusCircle className="h-4.5 w-4.5" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={addLayer} className="h-10 gap-1.5">
              <PlusCircle className="h-4 w-4" /> Tambah Layer
            </Button>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3.5 dark:border-slate-700/60 dark:bg-slate-800/30">
            <Switch id="at-auto" checked={autoApprove} onCheckedChange={setAutoApprove} />
            <div>
              <Label htmlFor="at-auto" className="text-xs font-semibold">Auto-approve bila approver tidak ditemukan</Label>
              <p className="mt-0.5 text-[11px] text-slate-400">Dokumen otomatis diloloskan pada layer tanpa approver aktif.</p>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy} className="h-11 px-5">Batal</Button>
          <Button onClick={() => void submit()} disabled={busy} className="h-11 bg-emerald-600 px-6 font-bold hover:bg-emerald-700">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================================================================
// TAB 2 — TEMPORARY APPROVER (delegasi)
// =================================================================
function delegationStatus(d: Delegation): { label: string; cls: string } {
  const now = new Date();
  const from = new Date(d.validFrom);
  const to = new Date(d.validTo);
  if (!d.active) return { label: "Nonaktif", cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25" };
  if (now < from) return { label: "Terjadwal", cls: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25" };
  if (now > to) return { label: "Kedaluwarsa", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25" };
  return { label: "Aktif", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25" };
}

function TempApproversTab() {
  const { data, loading, error, refresh } = useApi<DelegationsResp>("/api/onevity/temporary-approvers");
  const [editing, setEditing] = useState<Delegation | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Delegation | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/onevity/temporary-approvers?id=${deleting.id}`, "DELETE");
      toast.success("Delegasi dihapus");
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error("Gagal menghapus delegasi", { description: (e as Error).message });
    }
  };

  const delegations = data?.delegations ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{delegations.length} delegasi approver aktif/tercatat.</p>
        <Button onClick={() => setCreating(true)} className="h-11 gap-2 bg-emerald-600 px-5 font-bold hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> Delegasi Baru
        </Button>
      </div>

      {loading ? (
        <LoadingRows rows={3} />
      ) : error ? (
        <EmptyState title="Gagal memuat delegasi" description={error} />
      ) : delegations.length === 0 ? (
        <EmptyState title="Belum ada delegasi" description="Buat delegasi approver sementara, mis. saat approver cuti." icon={<UserRound className="h-6 w-6" />} />
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
                    <ArrowRight className="mx-1 h-5 w-5 shrink-0 text-emerald-500" aria-label="mendelegasikan ke" />
                    <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ring-2 ring-emerald-400/60", avatarColor(d.delegate.fullName))} title={`${d.delegate.fullName} (${d.delegate.role})`}>
                      {initials(d.delegate.fullName)}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900 dark:text-slate-50">
                        <UserCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                        <span className="truncate">{d.delegate.fullName}</span>
                      </p>
                      <p className="font-mono text-[10px] text-slate-400">{d.delegate.username} · {d.delegate.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", st.cls)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", st.label === "Aktif" ? "bg-emerald-500" : st.label === "Terjadwal" ? "bg-teal-500" : st.label === "Kedaluwarsa" ? "bg-rose-500" : "bg-slate-400")} />
                      {st.label}
                    </span>
                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-emerald-600" onClick={() => setEditing(d)} aria-label="Edit delegasi">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-rose-600" onClick={() => setDeleting(d)} aria-label="Hapus delegasi">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarRange className="h-3.5 w-3.5" />
                    {fmtDate(d.validFrom)} <span className="text-slate-300 dark:text-slate-600">s.d.</span> {fmtDate(d.validTo)}
                  </span>
                  <Badge variant="outline" className="rounded-full border-teal-200 bg-teal-50 text-[10px] font-bold text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400">{d.docType}</Badge>
                  <span className="inline-flex items-center gap-1.5 text-slate-400">
                    <Clock3 className="h-3.5 w-3.5" />
                    {Math.max(0, Math.ceil((new Date(d.validTo).getTime() - Date.now()) / 86400000))} hari tersisa
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
            <AlertDialogTitle>Hapus Delegasi?</AlertDialogTitle>
            <AlertDialogDescription>
              Delegasi <b>{deleting?.approver.fullName} → {deleting?.delegate.fullName}</b> akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="h-11 bg-rose-600 font-bold hover:bg-rose-700">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DelegationDialog({ initial, users, onClose, onDone }: { initial: Delegation | null; users: { id: string; username: string; fullName: string; role: string; active: boolean }[]; onClose: () => void; onDone: () => void }) {
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
      toast.error("Approver asal dan pendelegasian wajib dipilih");
      return;
    }
    if (!validFrom || !validTo) {
      toast.error("Rentang tanggal valid wajib diisi");
      return;
    }
    setBusy(true);
    const body = { approverId, delegateId, docType, validFrom, validTo, reason: reason.trim() || null, active };
    try {
      if (initial) {
        await apiSend(`/api/onevity/temporary-approvers?id=${initial.id}`, "PATCH", body);
        toast.success("Delegasi diperbarui");
      } else {
        await apiSend("/api/onevity/temporary-approvers", "POST", body);
        toast.success("Delegasi dibuat");
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error("Gagal menyimpan delegasi", { description: (e as Error).message });
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
              <UserRound className="h-4.5 w-4.5" />
            </span>
            {initial ? "Edit Delegasi Approver" : "Delegasi Approver Baru"}
          </DialogTitle>
          <DialogDescription>Approver asal mendelegasikan keputusan sementara ke pengguna lain.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Approver Asal <span className="text-rose-500">*</span></Label>
              <Select value={approverId} onValueChange={setApproverId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="Pilih approver" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {users.filter((u) => u.id !== delegateId).map(userItem)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Pendelegasian (Delegate) <span className="text-rose-500">*</span></Label>
              <Select value={delegateId} onValueChange={setDelegateId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="Pilih delegate" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {users.filter((u) => u.id !== approverId).map(userItem)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Jenis Dokumen</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((d) => <SelectItem key={d} value={d} className="py-2.5">{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ta-from">Valid Dari <span className="text-rose-500">*</span></Label>
              <Input id="ta-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ta-to">Valid S.d. <span className="text-rose-500">*</span></Label>
              <Input id="ta-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="h-11" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ta-reason">Alasan Delegasi</Label>
            <Textarea id="ta-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: Cuti tahunan 2 minggu — approve diwakilkan selama periode." rows={2} className="resize-none" />
          </div>
          <div className="flex items-center gap-3">
            <Switch id="ta-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="ta-active" className="text-xs font-normal text-slate-500">Delegasi aktif</Label>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy} className="h-11 px-5">Batal</Button>
          <Button onClick={() => void submit()} disabled={busy} className="h-11 bg-emerald-600 px-6 font-bold hover:bg-emerald-700">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
