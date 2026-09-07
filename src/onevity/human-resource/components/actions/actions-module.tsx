"use client";
// OneVity — Modul Personnel Action: inbox, all documents, detail workflow
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtDate, fmtDateTime, fmtIDR, initials, avatarColor, paTypeLabelSafe } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PA_TYPE_LABEL_EN } from "./pa-types";
import { PageHeader, StatusPill, EmptyState, LoadingRows, PA_TYPES } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Inbox, Workflow, Clock, CheckCircle2, XCircle, Play, Ban, Undo2, Send, ChevronRight,
  ChevronLeft, Plus, FileText, Search, Trash2, ArrowLeft, PenLine, History, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { LetterTemplatesView } from "./letter-templates-view";
import { LetterPreviewDialog } from "../employee/letter-preview-dialog";

export function ActionsModule({ view }: { view: string }) {
  const { params } = useNav();
  // Task 3-LETTERS: view "templates" (Dokumen & Surat → Template Surat) —
  // dicek PERTAMA agar tidak tertelan params.id detail pengajuan.
  if (view === "templates") return <LetterTemplatesView />;
  if (params.id) return <ActionDetail />;
  if (view === "inbox") return <ApprovalInbox />;
  return <AllDocuments />;
}

interface PALayer {
  id: string; layerNo: number; approverRole: string; status: string; note: string | null; decidedAt: string | null;
  approver: { id: string; fullName: string; role: string } | null;
}
interface PA {
  id: string; docNo: string; type: string; status: string; effectiveDate: string;
  reason: string | null; detailJson: string | null; currentLayer: number;
  createdBy: string | null; createdAt: string; submittedAt: string | null; processedAt: string | null;
  employee: { id: string; fullName: string; employeeNo: string; position: { title: string } | null; orgUnit: { name: string } | null };
  layers: PALayer[];
}

// ================= INBOX =================
function ApprovalInbox() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const perms = useMenuPerms();
  const { data, loading, refresh } = useApi<{ actions: PA[] }>("/api/onevity/personnel-actions?mine=1");
  const [decision, setDecision] = useState<{ pa: PA; act: "approve" | "reject" } | null>(null);

  const doDecision = async (note: string) => {
    if (!decision) return;
    try {
      const res = await apiSend<{ status: string }>(`/api/onevity/personnel-actions/${decision.pa.id}`, "PATCH", { action: decision.act, note });
      toast.success(decision.act === "approve"
        ? (res.status === "Approved"
          ? t("Layer disetujui — dokumen lulus semua layer!", "Layer approved — document passed all layers!")
          : t("Layer disetujui — dokumen lanjut layer berikutnya.", "Layer approved — document moves to the next layer."))
        : t("Dokumen ditolak", "Document rejected"));
      setDecision(null);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader eyebrow={t("Pengajuan & Persetujuan")} title={t("Menunggu Persetujuan")} description={t("Pengajuan yang menunggu keputusan persetujuan Anda", "Requests awaiting your approval decision")} />
      {loading && !data ? (
        <LoadingRows rows={4} />
      ) : data && data.actions.length > 0 ? (
        <div className="space-y-3">
          {data.actions.map((a) => {
            const pendingLayer = a.layers.find((l) => l.status === "Pending");
            return (
              <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="group rounded-2xl border-stone-200/80 shadow-sm transition-all hover:border-amber-200 hover:shadow-md dark:border-stone-800 dark:hover:border-amber-500/30">
                  <CardContent className="flex flex-wrap items-center gap-4 p-5">
                    <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold", avatarColor(a.employee.fullName))}>
                      {initials(a.employee.fullName)}
                    </div>
                    <div className="min-w-44 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-xs font-bold text-stone-500">{a.docNo}</p>
                        <Badge variant="outline" className="text-[10px] font-bold">{paTypeLabelSafe(a.type)}</Badge>
                        <StatusPill status={a.status} />
                      </div>
                      <p className="mt-1 text-sm font-bold text-stone-800 dark:text-stone-200">{a.employee.fullName}</p>
                      <p className="text-[11px] text-stone-400">{a.employee.position?.title ?? "—"} · {t("efektif {date}", "effective {date}", { date: fmtDate(a.effectiveDate) })}</p>
                      {a.reason && <p className="mt-1 line-clamp-1 max-w-lg text-[11px] italic text-stone-500">"{a.reason}"</p>}
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1.5">
                        {a.layers.map((l) => (
                          <span key={l.id} className={cn("h-2 w-8 rounded-full", l.status === "Approved" ? "bg-emerald-500" : l.status === "Rejected" ? "bg-rose-500" : "bg-amber-300 dark:bg-amber-400/50")} />
                        ))}
                      </div>
                      <p className="text-[10px] font-bold text-stone-400">{t("Layer {cur}/{total} — {role}", "Layer {cur}/{total} — {role}", { cur: a.currentLayer, total: a.layers.length, role: pendingLayer?.approverRole ?? "—" })}</p>
                    </div>
                    <div className="flex gap-2">
                      {perms.canOp("hr", "inbox", "approve") && (
                        <>
                          <Button size="sm" onClick={() => setDecision({ pa: a, act: "approve" })} className="gap-1.5 bg-emerald-600 font-bold hover:bg-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> {t("Setujui", "Approve")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDecision({ pa: a, act: "reject" })} className="gap-1.5 border-rose-200 font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400">
                            <XCircle className="h-3.5 w-3.5" /> {t("Tolak", "Reject")}
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => navigate("actions", "inbox", { id: a.id })} className="px-2" aria-label={t("Detail")}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <Card className="rounded-2xl ov-border-accent ov-soft shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full ov-tile">
              <CheckCircle2 className="h-7 w-7 ov-text-accent" />
            </div>
            <p className="text-sm font-bold ov-text-accent">{t("Semua approval selesai! 🎉", "All approvals done! 🎉")}</p>
            <p className="text-xs text-stone-500">{t("Tidak ada pengajuan yang menunggu keputusan Anda saat ini.", "No requests awaiting your decision right now.")}</p>
          </CardContent>
        </Card>
      )}
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} onConfirm={doDecision} />
    </div>
  );
}

function DecisionDialog({ decision, onClose, onConfirm }: {
  decision: { pa: PA; act: "approve" | "reject" } | null;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const perms = useMenuPerms();
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!decision) return null;
  const isApprove = decision.act === "approve";
  return (
    <Dialog open onOpenChange={(v) => { if (!v) { setNote(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={cn("flex items-center gap-2 text-base", isApprove ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {isApprove ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            {isApprove ? t("Setujui Dokumen?", "Approve Document?") : t("Tolak Dokumen?", "Reject Document?")}
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-xl bg-stone-50 p-3.5 dark:bg-stone-900">
          <p className="font-mono text-[11px] font-bold text-stone-400">{decision.pa.docNo}</p>
          <p className="text-sm font-bold">{decision.pa.employee.fullName} — {paTypeLabelSafe(decision.pa.type)}</p>
          <p className="mt-0.5 text-[11px] text-stone-500">{t("Efektif {date} · Layer {cur} dari {total}", "Effective {date} · Layer {cur} of {total}", { date: fmtDate(decision.pa.effectiveDate), cur: decision.pa.currentLayer, total: decision.pa.layers.length })}</p>
        </div>
        <div>
          <Label className="text-xs">{isApprove ? t("Catatan (opsional)", "Note (optional)") : t("Alasan penolakan", "Rejection reason")}</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={isApprove ? t("cth: Setuju, data sudah sesuai", "e.g.: Approved, data is correct") : t("cth: Gaji baru melebihi rentang grade", "e.g.: New salary exceeds the grade range")} className="mt-1.5 min-h-20" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setNote(""); onClose(); }}>{t("Batal")}</Button>
          {perms.canOp("hr", "inbox", "approve") && (
            <Button
              onClick={async () => { setBusy(true); await onConfirm(note); setBusy(false); setNote(""); }}
              disabled={busy}
              className={cn("font-bold", isApprove ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700")}
            >
              {busy ? t("Memproses…", "Processing…") : isApprove ? t("Ya, Setujui", "Yes, Approve") : t("Ya, Tolak", "Yes, Reject")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= ALL DOCUMENTS =================
function AllDocuments() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status !== "all") p.set("status", status);
    if (type !== "all") p.set("type", type);
    return `/api/onevity/personnel-actions?${p.toString()}`;
  }, [q, status, type]);

  const { data, loading, refresh } = useApi<{ actions: PA[]; statusCounts: Record<string, number> }>(url);
  const sc = data?.statusCounts ?? {};

  const statCards: [string, string, number][] = [
    ["Prepared", "Draft", sc.Prepared ?? 0],
    ["Submitted", t("Menunggu"), sc.Submitted ?? 0],
    ["Approved", t("Disetujui"), sc.Approved ?? 0],
    ["Rejected", t("Ditolak"), sc.Rejected ?? 0],
    ["Processed", t("Diproses"), sc.Processed ?? 0],
    ["Cancelled", t("Batal", "Cancelled"), sc.Cancelled ?? 0],
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("Pengajuan & Persetujuan")}
        title={t("Semua Pengajuan")}
        description={t("Riwayat lengkap pengajuan karyawan (Personnel Action) — 12 jenis aksi", "Complete employee request history (Personnel Action) — 12 action types")}
        actions={
          perms.can("hr", "all", "create") && (
            <Button onClick={() => setCreateOpen(true)} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Pengajuan Baru", "New Request")}
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {statCards.map(([st, label, val]) => (
          <button key={st} onClick={() => { setStatus(status === st ? "all" : st); }} className={cn(
            "rounded-2xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
            status === st ? "ov-border-accent ov-soft" : "border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
          )}>
            <p className="text-[9px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
            <p className="mt-0.5 text-xl font-extrabold text-stone-900 dark:text-stone-50">{val}</p>
          </button>
        ))}
      </div>

      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="flex flex-wrap items-center gap-2.5 p-3.5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cari no. dokumen / nama karyawan…", "Search doc no. / employee name…")} className="pl-9" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua status", "All statuses")}</SelectItem>
              {statCards.map(([st, label]) => <SelectItem key={st} value={st}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder={t("Semua jenis", "All types")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua jenis aksi", "All action types")}</SelectItem>
              {Object.entries(PA_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{t(v.label, PA_TYPE_LABEL_EN[k])}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : data && data.actions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="min-w-36 text-[11px] font-bold">{t("Dokumen", "Document")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Jenis")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Efektif", "Effective")}</TableHead>
                    <TableHead className="min-w-28 text-[11px] font-bold">Progress</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.actions.map((a) => (
                    <TableRow key={a.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60" onClick={() => navigate("actions", "all", { id: a.id })}>
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-stone-600 dark:text-stone-400">{a.docNo}</p>
                        <p className="text-[10px] text-stone-400">{fmtDate(a.createdAt)}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold", avatarColor(a.employee.fullName))}>{initials(a.employee.fullName)}</span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold">{a.employee.fullName}</p>
                            <p className="truncate text-[10px] text-stone-400">{a.employee.position?.title ?? "—"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] font-bold">{paTypeLabelSafe(a.type)}</Badge></TableCell>
                      <TableCell className="text-xs text-stone-500">{fmtDate(a.effectiveDate)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {a.layers.map((l) => (
                            <span key={l.id} className={cn("h-1.5 w-6 rounded-full", l.status === "Approved" ? "bg-emerald-500" : l.status === "Rejected" ? "bg-rose-500" : "bg-amber-300 dark:bg-amber-400/50")} />
                          ))}
                          <span className="ml-1 text-[10px] font-bold text-stone-400">{a.currentLayer}/{a.layers.length}</span>
                        </div>
                      </TableCell>
                      <TableCell><StatusPill status={a.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4"><EmptyState title={t("Tidak ada pengajuan", "No requests")} description={t("Buat pengajuan baru atau ubah filter.", "Create a new request or change the filter.")} icon={<Workflow className="h-6 w-6" />} /></div>
          )}
        </CardContent>
      </Card>

      <CreatePADialog open={createOpen} setOpen={(v) => { setCreateOpen(v); if (!v) refresh(); }} />
    </div>
  );
}

function CreatePADialog({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { t } = useI18n();
  const opts = useApi<{
    managers: { id: string; fullName: string; employeeNo: string }[];
    positions: { id: string; title: string; code: string; orgUnitId: string | null }[];
    grades: { id: string; code: string; name: string }[];
    orgUnits: { id: string; name: string; code: string; level: number }[];
  }>("/api/onevity/employee-options");
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("Promotion");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [empQ, setEmpQ] = useState("");

  const employees = (opts.data?.managers ?? []).filter((m) => !empQ || m.fullName.toLowerCase().includes(empQ.toLowerCase()) || m.employeeNo.includes(empQ)).slice(0, 30);

  const submit = async () => {
    if (!employeeId) { toast.error(t("Pilih karyawan", "Select an employee")); return; }
    if (!effectiveDate) { toast.error(t("Tanggal efektif wajib diisi", "Effective date is required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/personnel-actions", "POST", { employeeId, type, effectiveDate, reason: reason || null, detail: Object.keys(detail).length ? detail : null });
      toast.success(t("Dokumen PA dibuat sebagai Draft", "PA document created as Draft"));
      setOpen(false); setEmployeeId(""); setType("Promotion"); setEffectiveDate(""); setReason(""); setDetail({}); setEmpQ("");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const setD = (k: string, v: string) => setDetail((d) => ({ ...d, [k]: v }));

  // fix K-01: simpan ID (positionId/orgUnitId/gradeId — dibaca handler process) DAN
  // kode pendamping (toPosition/toUnit/newGrade — untuk display detail dokumen).
  const setPos = (id: string) => {
    const p = (opts.data?.positions ?? []).find((x) => x.id === id);
    setDetail((d) => {
      const { toPosition, ...rest } = d;
      return p ? { ...rest, positionId: p.id, toPosition: p.code } : { ...rest, positionId: "" };
    });
  };
  const setUnit = (id: string) => {
    const u = (opts.data?.orgUnits ?? []).find((x) => x.id === id);
    setDetail((d) => {
      const { toUnit, ...rest } = d;
      return u ? { ...rest, orgUnitId: u.id, toUnit: u.code } : { ...rest, orgUnitId: "" };
    });
  };
  const setGrade = (id: string) => {
    const g = (opts.data?.grades ?? []).find((x) => x.id === id);
    setDetail((d) => {
      const { newGrade, ...rest } = d;
      return g ? { ...rest, gradeId: g.id, newGrade: g.code } : { ...rest, gradeId: "" };
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4 ov-text-accent" /> {t("Dokumen Personnel Action Baru", "New Personnel Action Document")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("Karyawan *", "Employee *")}</Label>
            <div className="relative mt-1.5">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input value={empQ} onChange={(e) => setEmpQ(e.target.value)} placeholder={t("Filter daftar karyawan…", "Filter employee list…")} className="pl-9" />
            </div>
            <Select value={employeeId || "none"} onValueChange={setEmployeeId}>
              <SelectTrigger className="mt-2 max-h-9 overflow-hidden"><SelectValue placeholder={t("Pilih karyawan", "Select an employee")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">{t("— Pilih karyawan —", "— Select an employee —")}</SelectItem>
                {employees.map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} · {m.employeeNo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Jenis Aksi *", "Action Type *")}</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                {Object.entries(PA_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{t(v.label, PA_TYPE_LABEL_EN[k])}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Tanggal Efektif *", "Effective Date *")}</Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="mt-1.5" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("Alasan / Catatan", "Reason / Note")}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("cth: Promosi karena kinerja excellent 2 tahun berturut", "e.g.: Promotion for two consecutive years of excellent performance")} className="mt-1.5 min-h-16" />
          </div>

          {/* dynamic detail fields */}
          {["Promotion", "Demotion", "Transfer", "Mutation"].includes(type) && (
            <>
              <div className="sm:col-span-2 mt-1 rounded-xl border border-dashed border-stone-200 p-3 dark:border-stone-700">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-400"><Zap className="h-3 w-3 text-amber-500" /> {t("Detail Perubahan", "Change Details")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">{t("Unit Organisasi Tujuan", "Target Organizational Unit")}</Label>
                    <Select value={detail.orgUnitId || "none"} onValueChange={(v) => setUnit(v === "none" ? "" : v)}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih", "Select")} /></SelectTrigger>
                      <SelectContent className="max-h-52">
                        <SelectItem value="none">{t("— Tetap —", "— Unchanged —")}</SelectItem>
                        {(opts.data?.orgUnits ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("Posisi Tujuan", "Target Position")}</Label>
                    <Select value={detail.positionId || "none"} onValueChange={(v) => setPos(v === "none" ? "" : v)}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih", "Select")} /></SelectTrigger>
                      <SelectContent className="max-h-52">
                        <SelectItem value="none">{t("— Tetap —", "— Unchanged —")}</SelectItem>
                        {(opts.data?.positions ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("Grade Baru", "New Grade")}</Label>
                    <Select value={detail.gradeId || "none"} onValueChange={(v) => setGrade(v === "none" ? "" : v)}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih", "Select")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("— Tetap —", "— Unchanged —")}</SelectItem>
                        {(opts.data?.grades ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t("Gaji Baru (Rp) — kosongkan bila tetap", "New Salary (Rp) — leave empty if unchanged")}</Label>
                    <Input type="number" value={detail.newSalary ?? ""} onChange={(e) => setD("newSalary", e.target.value)} className="mt-1.5 font-mono" placeholder="11500000" />
                  </div>
                </div>
              </div>
            </>
          )}
          {type === "SalaryAdjustment" && (
            <div className="sm:col-span-2">
              <Label className="text-xs">{t("Gaji Baru (Rp) *", "New Salary (Rp) *")}</Label>
              <Input type="number" value={detail.newSalary ?? ""} onChange={(e) => setD("newSalary", e.target.value)} className="mt-1.5 font-mono" placeholder="7500000" />
            </div>
          )}
          {type === "ChangeStatus" && (
            <div>
              <Label className="text-xs">{t("Status Baru", "New Status")}</Label>
              <Select value={detail.newEmploymentStatus || "Permanent"} onValueChange={(v) => setD("newEmploymentStatus", v)}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Permanent", "Contract", "Probation", "Outsourcing"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {["Resignation", "Termination", "Retirement"].includes(type) && (
            <div>
              <Label className="text-xs">{t("Hari Terakhir Kerja", "Last Working Day")}</Label>
              <Input type="date" value={detail.lastDay ?? ""} onChange={(e) => setD("lastDay", e.target.value)} className="mt-1.5" />
            </div>
          )}
          {["ContractRenewal", "ExtendProbation"].includes(type) && (
            <div>
              <Label className="text-xs">{t("Durasi (bulan)", "Duration (months)")}</Label>
              <Input type="number" value={detail.months ?? ""} onChange={(e) => setD("months", e.target.value)} className="mt-1.5" placeholder="12" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Membuat…", "Creating…") : t("Buat Dokumen (Draft)", "Create Document (Draft)")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= DETAIL =================
interface PADetail {
  action: PA & {
    detailJson: string | null;
    employee: {
      id: string; fullName: string; employeeNo: string; status: string; employmentStatus: string;
      joinDate: string; endDate: string | null; baseSalary: number; workShift: string;
      position: { id: true, title: string; code: string } | null;
      orgUnit: { id: true, name: string; code: string } | null;
      grade: { id: true, code: string; name: string } | null;
    };
  };
  activities: { id: string; action: string; detail: string | null; createdAt: string; appUser: { fullName: string } | null }[];
}

function ActionDetail() {
  const { params, navigate, setParams } = useNav();
  const { t } = useI18n();
  const perms = useMenuPerms();
  const { data, loading, refresh } = useApi<PADetail>(params.id ? `/api/onevity/personnel-actions/${params.id}` : null);
  const [decision, setDecision] = useState<{ act: "approve" | "reject" } | null>(null);
  const [confirmAct, setConfirmAct] = useState<string | null>(null);
  // Task 3-LETTERS: dialog terbitkan & cetak surat dari dokumen PA
  const [letterOpen, setLetterOpen] = useState(false);

  const transition = async (act: string, note?: string) => {
    try {
      const res = await apiSend<{ status: string }>(`/api/onevity/personnel-actions/${params.id}`, "PATCH", { action: act, note });
      toast.success(t("Dokumen sekarang: {status}", "Document is now: {status}", { status: res.status }));
      setConfirmAct(null);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  if (loading && !data) {
    return <div><PageHeader eyebrow={t("Pengajuan & Persetujuan")} title={t("Detail Pengajuan", "Request Details")} /><LoadingRows rows={6} /></div>;
  }
  if (!data?.action) return <EmptyState title={t("Pengajuan tidak ditemukan", "Request not found")} />;

  const a = data.action;
  const detail: Record<string, string | number | null> = a.detailJson ? JSON.parse(a.detailJson) : {};
  // sembunyikan kunci ID mentah (positionId/orgUnitId/gradeId) dari tampilan —
  // kode pendamping (toPosition/toUnit/newGrade) sudah mewakili untuk display.
  const detailRows = Object.entries(detail).filter(([k]) => !["positionId", "orgUnitId", "gradeId"].includes(k));
  const canApprove = a.status === "Submitted" && a.layers.some((l) => l.status === "Pending");
  const detailLabels: Record<string, string> = {
    positionId: "Posisi Baru", gradeId: "Grade Baru", newSalary: "Gaji Baru", oldSalary: "Gaji Lama",
    percent: "Persentase", months: "Durasi (bln)", lastDay: "Hari Terakhir", newEndDate: "Tanggal Berakhir",
    newEmploymentStatus: "Status Baru", plannedPosition: "Posisi Direncanakan", plannedSalary: "Gaji Direncanakan",
    fromUnit: "Unit Asal", toUnit: "Unit Tujuan", fromPosition: "Posisi Asal", toPosition: "Posisi Baru", reason: "Alasan",
    newGrade: "Grade Baru",
  };
  // En paralel untuk detailLabels di atas (map ID dipertahankan — Task I-3)
  const detailLabelsEn: Record<string, string> = {
    positionId: "New Position", gradeId: "New Grade", newSalary: "New Salary", oldSalary: "Old Salary",
    percent: "Percentage", months: "Duration (mo)", lastDay: "Last Day", newEndDate: "End Date",
    newEmploymentStatus: "New Status", plannedPosition: "Planned Position", plannedSalary: "Planned Salary",
    fromUnit: "Source Unit", toUnit: "Target Unit", fromPosition: "Source Position", toPosition: "New Position", reason: "Reason",
    newGrade: "New Grade",
  };
  const fmtVal = (k: string, v: string | number | null) => {
    if (v === null || v === undefined || v === "") return "—";
    if (k.toLowerCase().includes("salary")) return fmtIDR(Number(v));
    return String(v);
  };

  return (
    <div>
      <button onClick={() => { setParams({}); navigate("actions", "all"); }} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-bold ov-text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" /> {t("Kembali ke Daftar", "Back to List")}
      </button>

      {/* header */}
      <Card className="mb-4 overflow-hidden rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <div className={cn("h-1.5", a.status === "Approved" || a.status === "Processed" ? "bg-emerald-500" : a.status === "Rejected" ? "bg-rose-500" : a.status === "Submitted" ? "bg-amber-400" : "bg-stone-300")} />
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm font-extrabold text-stone-500">{a.docNo}</p>
                <Badge variant="outline" className="text-[11px] font-bold">{paTypeLabelSafe(a.type)}</Badge>
                <StatusPill status={a.status} />
              </div>
              <h1 className="mt-2 text-lg font-extrabold text-stone-900 dark:text-stone-50">{a.employee.fullName}</h1>
              <p className="text-xs text-stone-500">{a.employee.position?.title ?? "—"} · {a.employee.orgUnit?.name ?? "—"} · <span className="font-mono">{a.employee.employeeNo}</span></p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[11px] text-stone-500">
                <span><b className="text-stone-700 dark:text-stone-300">{t("Efektif:", "Effective:")}</b> {fmtDate(a.effectiveDate)}</span>
                <span><b className="text-stone-700 dark:text-stone-300">{t("Dibuat:", "Created:")}</b> {fmtDateTime(a.createdAt)} {t("oleh", "by")} {a.createdBy ?? "—"}</span>
                {a.submittedAt && <span><b className="text-stone-700 dark:text-stone-300">Submit:</b> {fmtDateTime(a.submittedAt)}</span>}
                {a.processedAt && <span><b className="text-stone-700 dark:text-stone-300">{t("Diproses:", "Processed:")}</b> {fmtDateTime(a.processedAt)}</span>}
              </div>
            </div>
            <div className={cn("flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold", avatarColor(a.employee.fullName))}>
              {initials(a.employee.fullName)}
            </div>
          </div>
          {a.reason && (
            <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50 p-3.5 dark:border-stone-800 dark:bg-stone-900">
              <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Alasan", "Reason")}</p>
              <p className="mt-0.5 text-sm italic text-stone-700 dark:text-stone-300">"{a.reason}"</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* detail payload */}
          {detailRows.length > 0 && (
            <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 ov-text-accent" /> {t("Detail Perubahan", "Change Details")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {detailRows.map(([k, v]) => (
                    <div key={k}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t(detailLabels[k] ?? k, detailLabelsEn[k])}</p>
                      <p className="mt-0.5 text-[13px] font-semibold text-stone-800 dark:text-stone-200">{fmtVal(k, v)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* approval timeline */}
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><History className="h-4 w-4 ov-text-accent" /> {t("Alur Approval", "Approval Flow")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="relative ml-2 space-y-0 border-l-2 border-stone-100 pl-6 dark:border-stone-800">
                {a.layers.map((l, i) => {
                  const isCurrent = a.status === "Submitted" && l.status === "Pending" && l.layerNo === a.currentLayer;
                  return (
                    <li key={l.id} className="relative pb-6 last:pb-0">
                      <span className={cn(
                        "absolute -left-[35px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white dark:ring-stone-950",
                        l.status === "Approved" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400" :
                        l.status === "Rejected" ? "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400" :
                        isCurrent ? "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 animate-pulse" :
                        "bg-stone-100 text-stone-400 dark:bg-stone-800"
                      )}>
                        {l.status === "Approved" ? <CheckCircle2 className="h-4 w-4" /> : l.status === "Rejected" ? <XCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                      </span>
                      <div className={cn("rounded-xl border p-3.5", isCurrent ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5" : "border-stone-100 dark:border-stone-800")}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[9px] font-bold">Layer {l.layerNo}</Badge>
                          <p className="text-xs font-bold text-stone-800 dark:text-stone-200">{l.approverRole}</p>
                          {l.approver && <span className="text-[10px] text-stone-400">· {l.approver.fullName}</span>}
                          <StatusPill status={l.status} className="ml-auto" />
                        </div>
                        {l.note && <p className="mt-1.5 text-[11px] italic text-stone-500">"{l.note}"</p>}
                        {l.decidedAt && <p className="mt-1 text-[10px] text-stone-400">{fmtDateTime(l.decidedAt)}</p>}
                      </div>
                      {i < a.layers.length - 1 && null}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          {/* activity trail */}
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><PenLine className="h-4 w-4 ov-text-accent" /> {t("Jejak Aktivitas", "Activity Trail")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="space-y-3">
                {data.activities.map((act) => (
                  <li key={act.id} className="flex items-start gap-3 text-xs">
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full",
                      act.action === "Approved" ? "bg-emerald-500" : act.action === "Rejected" ? "bg-rose-500" : act.action === "Processed" ? "bg-teal-500" : "bg-stone-300")} />
                    <div>
                      <p className="font-semibold text-stone-700 dark:text-stone-300">
                        <b>{act.appUser?.fullName ?? "System"}</b> · {act.action}
                      </p>
                      {act.detail && <p className="text-[11px] text-stone-500">{act.detail}</p>}
                      <p className="text-[10px] text-stone-400">{fmtDateTime(act.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* right column: action bar */}
        <div className="space-y-4">
          <Card className="sticky top-20 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><Workflow className="h-4 w-4 ov-text-accent" /> {t("Aksi Workflow", "Workflow Actions")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0">
              {/* progress */}
              <div className="mb-3">
                <div className="mb-1.5 flex justify-between text-[11px] font-bold">
                  <span className="text-stone-400">{t("Progress Approval", "Approval Progress")}</span>
                  <span className="text-stone-600 dark:text-stone-400">{a.currentLayer}/{a.layers.length} layer</span>
                </div>
                <Progress value={(a.currentLayer / Math.max(a.layers.length, 1)) * 100} className="h-2 [&>div]:ov-chart" />
              </div>

              {a.status === "Prepared" && (
                <>
                  <ActionButton icon={Send} label={t("Submit untuk Approval", "Submit for Approval")} tone="emerald" onClick={() => setConfirmAct("submit")} desc={t("Kirim dokumen ke alur approval multi-layer", "Send the document to the multi-layer approval flow")} />
                  <ActionButton icon={Ban} label={t("Batalkan Dokumen", "Cancel Document")} tone="stone" onClick={() => setConfirmAct("cancel")} desc={t("Dokumen dibatalkan & tidak diproses", "Document is cancelled & not processed")} />
                </>
              )}
              {canApprove && perms.canOp("hr", "inbox", "approve") && (
                <>
                  <ActionButton icon={CheckCircle2} label={t("Setujui Layer Ini", "Approve This Layer")} tone="emerald" onClick={() => setDecision({ act: "approve" })} desc={t("Menyetujui sebagai layer {n}", "Approving as layer {n}", { n: a.currentLayer })} />
                  <ActionButton icon={XCircle} label={t("Tolak Dokumen", "Reject Document")} tone="rose" onClick={() => setDecision({ act: "reject" })} desc={t("Dokumen ditolak pada layer ini", "Document rejected at this layer")} />
                </>
              )}
              {a.status === "Approved" && (
                <ActionButton icon={Play} label={t("Proses Sekarang", "Process Now")} tone="teal" prominent onClick={() => setConfirmAct("process")} desc={t("Terapkan efek ke data karyawan (posisi/gaji/status)", "Apply effects to employee data (position/salary/status)")} />
              )}
              {/* Task 3-LETTERS — cetak surat resmi: hanya dokumen final (Approved/Processed) */}
              {(a.status === "Approved" || a.status === "Processed") && (
                <ActionButton icon={FileText} label={t("Cetak Surat", "Print Letter")} tone="stone" onClick={() => setLetterOpen(true)} desc={t("Terbitkan & unduh surat resmi (PDF)", "Issue & download the official letter (PDF)")} />
              )}
              {["Rejected", "Cancelled"].includes(a.status) && (
                <ActionButton icon={Undo2} label={t("Kembalikan ke Draft", "Return to Draft")} tone="stone" onClick={() => setConfirmAct("return")} desc={t("Reset semua layer & status menjadi Draft", "Reset all layers & status to Draft")} />
              )}
              {a.status === "Processed" && (
                <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-center dark:border-teal-500/25 dark:bg-teal-500/5">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-teal-600 dark:text-teal-400" />
                  <p className="mt-1.5 text-sm font-bold text-teal-700 dark:text-teal-300">{t("Dokumen Selesai", "Document Completed")}</p>
                  <p className="mt-0.5 text-[11px] text-stone-500">{t("Efek sudah diterapkan {date}", "Effects applied on {date}", { date: fmtDate(a.processedAt) })}</p>
                </div>
              )}
              {a.status === "Submitted" && !canApprove && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-center dark:border-amber-500/25 dark:bg-amber-500/5">
                  <Clock className="mx-auto h-7 w-7 text-amber-600 dark:text-amber-400" />
                  <p className="mt-1 text-[13px] font-bold text-amber-700 dark:text-amber-300">{t("Menunggu Layer {n}", "Waiting for Layer {n}", { n: a.currentLayer })}</p>
                  <p className="text-[11px] text-stone-500">{t("Menunggu keputusan approver berikutnya", "Waiting for the next approver's decision")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <DecisionDialog decision={decision ? { pa: a, act: decision.act } : null} onClose={() => setDecision(null)} onConfirm={(note) => transition(decision!.act, note)} />
      <ConfirmDialog act={confirmAct} onConfirm={() => transition(confirmAct!)} onClose={() => setConfirmAct(null)} />
      {/* dialog surat PA (idempoten — klik berkali-kali aman; mount-on-open) */}
      {letterOpen && (
        <LetterPreviewDialog
          category="PersonnelAction"
          personnelActionId={a.id}
          employeeName={a.employee.fullName}
          onClose={() => setLetterOpen(false)}
        />
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, label, desc, tone, onClick, prominent }: {
  icon: React.ElementType; label: string; desc: string; tone: string; onClick: () => void; prominent?: boolean;
}) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400",
    teal: "border-teal-300 bg-gradient-to-r from-teal-500 to-emerald-600 text-white hover:from-teal-600 hover:to-emerald-700 shadow-lg shadow-teal-500/25",
    rose: "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400",
    stone: "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400",
  };
  return (
    <button onClick={onClick} className={cn("w-full rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5", tones[tone], prominent && "animate-pulse-once")}>
      <div className="flex items-center gap-2.5">
        <Icon className="h-5 w-5 shrink-0" />
        <p className="text-sm font-bold">{label}</p>
      </div>
      <p className={cn("mt-1 pl-8 text-[11px]", tone === "teal" ? "text-white/80" : "text-stone-500 dark:text-stone-400")}>{desc}</p>
    </button>
  );
}

function ConfirmDialog({ act, onConfirm, onClose }: { act: string | null; onConfirm: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  if (!act) return null;
  const labels: Record<string, { title: string; desc: string; tone: string }> = {
    submit: { title: "Submit untuk Approval?", desc: "Dokumen akan dikirim ke layer approval pertama dan tidak bisa diedit lagi.", tone: "emerald" },
    process: { title: "Proses Dokumen?", desc: "Efek akan DITERAPKAN PERMANEN ke data karyawan (posisi/gaji/status sesuai jenis aksi).", tone: "teal" },
    cancel: { title: "Batalkan Dokumen?", desc: "Dokumen akan berstatus Dibatalkan dan tidak diproses.", tone: "stone" },
    return: { title: "Kembalikan ke Draft?", desc: "Semua layer approval di-reset menjadi Pending dan dokumen kembali menjadi Draft.", tone: "stone" },
  };
  // En paralel untuk labels di atas (tone/ikon tetap di map ID — Task I-3)
  const labelsEn: Record<string, { title: string; desc: string }> = {
    submit: { title: "Submit for Approval?", desc: "The document will be sent to the first approval layer and can no longer be edited." },
    process: { title: "Process Document?", desc: "Effects will be PERMANENTLY APPLIED to employee data (position/salary/status per action type)." },
    cancel: { title: "Cancel Document?", desc: "The document will be marked Cancelled and not processed." },
    return: { title: "Return to Draft?", desc: "All approval layers are reset to Pending and the document returns to Draft." },
  };
  const l = labels[act];
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">{t(l.title, labelsEn[act].title)}</DialogTitle></DialogHeader>
        <p className="text-sm text-stone-500">{t(l.desc, labelsEn[act].desc)}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }} disabled={busy} className={cn("font-bold", l.tone === "emerald" ? "bg-emerald-600 hover:bg-emerald-700" : l.tone === "teal" ? "bg-teal-600 hover:bg-teal-700" : "bg-stone-600 hover:bg-stone-700")}>
            {busy ? t("Memproses…", "Processing…") : t("Ya, Lanjutkan", "Yes, Continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
