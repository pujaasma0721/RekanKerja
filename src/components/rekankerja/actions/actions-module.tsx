"use client";
// RekanKerja — Modul Personnel Action: inbox, all documents, detail workflow
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtDate, fmtDateTime, initials, avatarColor, paTypeLabelSafe } from "@/lib/rekankerja/api";
import { useNav } from "@/lib/rekankerja/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows, PA_TYPES } from "@/components/rekankerja/ui-kit";
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

export function ActionsModule({ view }: { view: string }) {
  const { params } = useNav();
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
  const { data, loading, refresh } = useApi<{ actions: PA[] }>("/api/rekankerja/personnel-actions?mine=1");
  const [decision, setDecision] = useState<{ pa: PA; act: "approve" | "reject" } | null>(null);

  const doDecision = async (note: string) => {
    if (!decision) return;
    try {
      const res = await apiSend<{ status: string }>(`/api/rekankerja/personnel-actions/${decision.pa.id}`, "PATCH", { action: decision.act, note });
      toast.success(decision.act === "approve" ? `Layer disetujui — dokumen ${res.status === "Approved" ? "lulus semua layer!" : "lanjut layer berikutnya"}` : "Dokumen ditolak");
      setDecision(null);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader eyebrow="PENGAJUAN & PERSETUJUAN" title="Menunggu Persetujuan" description="Pengajuan yang menunggu keputusan persetujuan Anda" />
      {loading && !data ? (
        <LoadingRows rows={4} />
      ) : data && data.actions.length > 0 ? (
        <div className="space-y-3">
          {data.actions.map((a) => {
            const pendingLayer = a.layers.find((l) => l.status === "Pending");
            return (
              <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="group rounded-2xl border-slate-200/80 shadow-sm transition-all hover:border-amber-200 hover:shadow-md dark:border-slate-800 dark:hover:border-amber-500/30">
                  <CardContent className="flex flex-wrap items-center gap-4 p-5">
                    <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold", avatarColor(a.employee.fullName))}>
                      {initials(a.employee.fullName)}
                    </div>
                    <div className="min-w-44 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-xs font-bold text-slate-500">{a.docNo}</p>
                        <Badge variant="outline" className="text-[10px] font-bold">{paTypeLabelSafe(a.type)}</Badge>
                        <StatusPill status={a.status} />
                      </div>
                      <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-200">{a.employee.fullName}</p>
                      <p className="text-[11px] text-slate-400">{a.employee.position?.title ?? "—"} · efektif {fmtDate(a.effectiveDate)}</p>
                      {a.reason && <p className="mt-1 line-clamp-1 max-w-lg text-[11px] italic text-slate-500">"{a.reason}"</p>}
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1.5">
                        {a.layers.map((l) => (
                          <span key={l.id} className={cn("h-2 w-8 rounded-full", l.status === "Approved" ? "bg-emerald-500" : l.status === "Rejected" ? "bg-rose-500" : "bg-amber-300 dark:bg-amber-400/50")} />
                        ))}
                      </div>
                      <p className="text-[10px] font-bold text-slate-400">Layer {a.currentLayer}/{a.layers.length} — {pendingLayer?.approverRole}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setDecision({ pa: a, act: "approve" })} className="gap-1.5 bg-emerald-600 font-bold hover:bg-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Setujui
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDecision({ pa: a, act: "reject" })} className="gap-1.5 border-rose-200 font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400">
                        <XCircle className="h-3.5 w-3.5" /> Tolak
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => navigate("actions", "inbox", { id: a.id })} className="px-2" aria-label="Detail">
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
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50/40 shadow-sm dark:border-emerald-500/25 dark:bg-emerald-500/5">
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
              <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Semua approval selesai! 🎉</p>
            <p className="text-xs text-slate-500">Tidak ada pengajuan yang menunggu keputusan Anda saat ini.</p>
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
            {isApprove ? "Setujui Dokumen?" : "Tolak Dokumen?"}
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-900">
          <p className="font-mono text-[11px] font-bold text-slate-400">{decision.pa.docNo}</p>
          <p className="text-sm font-bold">{decision.pa.employee.fullName} — {paTypeLabelSafe(decision.pa.type)}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Efektif {fmtDate(decision.pa.effectiveDate)} · Layer {decision.pa.currentLayer} dari {decision.pa.layers.length}</p>
        </div>
        <div>
          <Label className="text-xs">{isApprove ? "Catatan (opsional)" : "Alasan penolakan"}</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={isApprove ? "cth: Setuju, data sudah sesuai" : "cth: Gaji baru melebihi rentang grade"} className="mt-1.5 min-h-20" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setNote(""); onClose(); }}>Batal</Button>
          <Button
            onClick={async () => { setBusy(true); await onConfirm(note); setBusy(false); setNote(""); }}
            disabled={busy}
            className={cn("font-bold", isApprove ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700")}
          >
            {busy ? "Memproses…" : isApprove ? "Ya, Setujui" : "Ya, Tolak"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= ALL DOCUMENTS =================
function AllDocuments() {
  const { navigate } = useNav();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status !== "all") p.set("status", status);
    if (type !== "all") p.set("type", type);
    return `/api/rekankerja/personnel-actions?${p.toString()}`;
  }, [q, status, type]);

  const { data, loading, refresh } = useApi<{ actions: PA[]; statusCounts: Record<string, number> }>(url);
  const sc = data?.statusCounts ?? {};

  const statCards: [string, string, number][] = [
    ["Prepared", "Draft", sc.Prepared ?? 0],
    ["Submitted", "Menunggu", sc.Submitted ?? 0],
    ["Approved", "Disetujui", sc.Approved ?? 0],
    ["Rejected", "Ditolak", sc.Rejected ?? 0],
    ["Processed", "Diproses", sc.Processed ?? 0],
    ["Cancelled", "Batal", sc.Cancelled ?? 0],
  ];

  return (
    <div>
      <PageHeader
        eyebrow="PENGAJUAN & PERSETUJUAN"
        title="Semua Pengajuan"
        description="Riwayat lengkap pengajuan karyawan (Personnel Action) — 12 jenis aksi"
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Pengajuan Baru
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {statCards.map(([st, label, val]) => (
          <button key={st} onClick={() => { setStatus(status === st ? "all" : st); }} className={cn(
            "rounded-2xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
            status === st ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10" : "border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
          )}>
            <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-0.5 text-xl font-extrabold text-slate-900 dark:text-slate-50">{val}</p>
          </button>
        ))}
      </div>

      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-wrap items-center gap-2.5 p-3.5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari no. dokumen / nama karyawan…" className="pl-9" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              {statCards.map(([st, label]) => <SelectItem key={st} value={st}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Semua jenis" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua jenis aksi</SelectItem>
              {Object.entries(PA_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : data && data.actions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="min-w-36 text-[11px] font-bold">Dokumen</TableHead>
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Jenis</TableHead>
                    <TableHead className="text-[11px] font-bold">Efektif</TableHead>
                    <TableHead className="min-w-28 text-[11px] font-bold">Progress</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.actions.map((a) => (
                    <TableRow key={a.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60" onClick={() => navigate("actions", "all", { id: a.id })}>
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-400">{a.docNo}</p>
                        <p className="text-[10px] text-slate-400">{fmtDate(a.createdAt)}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold", avatarColor(a.employee.fullName))}>{initials(a.employee.fullName)}</span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold">{a.employee.fullName}</p>
                            <p className="truncate text-[10px] text-slate-400">{a.employee.position?.title ?? "—"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] font-bold">{paTypeLabelSafe(a.type)}</Badge></TableCell>
                      <TableCell className="text-xs text-slate-500">{fmtDate(a.effectiveDate)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {a.layers.map((l) => (
                            <span key={l.id} className={cn("h-1.5 w-6 rounded-full", l.status === "Approved" ? "bg-emerald-500" : l.status === "Rejected" ? "bg-rose-500" : "bg-amber-300 dark:bg-amber-400/50")} />
                          ))}
                          <span className="ml-1 text-[10px] font-bold text-slate-400">{a.currentLayer}/{a.layers.length}</span>
                        </div>
                      </TableCell>
                      <TableCell><StatusPill status={a.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4"><EmptyState title="Tidak ada pengajuan" description="Buat pengajuan baru atau ubah filter." icon={<Workflow className="h-6 w-6" />} /></div>
          )}
        </CardContent>
      </Card>

      <CreatePADialog open={createOpen} setOpen={(v) => { setCreateOpen(v); if (!v) refresh(); }} />
    </div>
  );
}

function CreatePADialog({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const opts = useApi<{
    managers: { id: string; fullName: string; employeeNo: string }[];
    positions: { id: string; title: string }[];
    grades: { id: string; code: string; name: string }[];
    orgUnits: { id: string; name: string }[];
  }>("/api/rekankerja/employee-options");
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("Promotion");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [empQ, setEmpQ] = useState("");

  const employees = (opts.data?.managers ?? []).filter((m) => !empQ || m.fullName.toLowerCase().includes(empQ.toLowerCase()) || m.employeeNo.includes(empQ)).slice(0, 30);

  const submit = async () => {
    if (!employeeId) { toast.error("Pilih karyawan"); return; }
    if (!effectiveDate) { toast.error("Tanggal efektif wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/personnel-actions", "POST", { employeeId, type, effectiveDate, reason: reason || null, detail: Object.keys(detail).length ? detail : null });
      toast.success("Dokumen PA dibuat sebagai Draft");
      setOpen(false); setEmployeeId(""); setType("Promotion"); setEffectiveDate(""); setReason(""); setDetail({}); setEmpQ("");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const setD = (k: string, v: string) => setDetail((d) => ({ ...d, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4 text-emerald-600" /> Dokumen Personnel Action Baru</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Karyawan *</Label>
            <div className="relative mt-1.5">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={empQ} onChange={(e) => setEmpQ(e.target.value)} placeholder="Filter daftar karyawan…" className="pl-9" />
            </div>
            <Select value={employeeId || "none"} onValueChange={setEmployeeId}>
              <SelectTrigger className="mt-2 max-h-9 overflow-hidden"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">— Pilih karyawan —</SelectItem>
                {employees.map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} · {m.employeeNo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Jenis Aksi *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                {Object.entries(PA_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tanggal Efektif *</Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="mt-1.5" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Alasan / Catatan</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="cth: Promosi karena kinerja excellent 2 tahun berturut" className="mt-1.5 min-h-16" />
          </div>

          {/* dynamic detail fields */}
          {["Promotion", "Demotion", "Transfer", "Mutation"].includes(type) && (
            <>
              <div className="sm:col-span-2 mt-1 rounded-xl border border-dashed border-slate-200 p-3 dark:border-slate-700">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><Zap className="h-3 w-3 text-amber-500" /> Detail Perubahan</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Posisi Tujuan</Label>
                    <Select value={detail.positionId || "none"} onValueChange={(v) => setD("positionId", v === "none" ? "" : v)}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pilih" /></SelectTrigger>
                      <SelectContent className="max-h-52">
                        <SelectItem value="none">— Tetap —</SelectItem>
                        {(opts.data?.positions ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Grade Baru</Label>
                    <Select value={detail.gradeId || "none"} onValueChange={(v) => setD("gradeId", v === "none" ? "" : v)}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pilih" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Tetap —</SelectItem>
                        {(opts.data?.grades ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Gaji Baru (Rp) — kosongkan bila tetap</Label>
                    <Input type="number" value={detail.newSalary ?? ""} onChange={(e) => setD("newSalary", e.target.value)} className="mt-1.5 font-mono" placeholder="11500000" />
                  </div>
                </div>
              </div>
            </>
          )}
          {type === "SalaryAdjustment" && (
            <div className="sm:col-span-2">
              <Label className="text-xs">Gaji Baru (Rp) *</Label>
              <Input type="number" value={detail.newSalary ?? ""} onChange={(e) => setD("newSalary", e.target.value)} className="mt-1.5 font-mono" placeholder="7500000" />
            </div>
          )}
          {type === "ChangeStatus" && (
            <div>
              <Label className="text-xs">Status Baru</Label>
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
              <Label className="text-xs">Hari Terakhir Kerja</Label>
              <Input type="date" value={detail.lastDay ?? ""} onChange={(e) => setD("lastDay", e.target.value)} className="mt-1.5" />
            </div>
          )}
          {["ContractRenewal", "ExtendProbation"].includes(type) && (
            <div>
              <Label className="text-xs">Durasi (bulan)</Label>
              <Input type="number" value={detail.months ?? ""} onChange={(e) => setD("months", e.target.value)} className="mt-1.5" placeholder="12" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Membuat…" : "Buat Dokumen (Draft)"}</Button>
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
  const { data, loading, refresh } = useApi<PADetail>(params.id ? `/api/rekankerja/personnel-actions/${params.id}` : null);
  const [decision, setDecision] = useState<{ act: "approve" | "reject" } | null>(null);
  const [confirmAct, setConfirmAct] = useState<string | null>(null);

  const transition = async (act: string, note?: string) => {
    try {
      const res = await apiSend<{ status: string }>(`/api/rekankerja/personnel-actions/${params.id}`, "PATCH", { action: act, note });
      toast.success(`Dokumen sekarang: ${res.status}`);
      setConfirmAct(null);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  if (loading && !data) {
    return <div><PageHeader eyebrow="PENGAJUAN & PERSETUJUAN" title="Detail Pengajuan" /><LoadingRows rows={6} /></div>;
  }
  if (!data?.action) return <EmptyState title="Pengajuan tidak ditemukan" />;

  const a = data.action;
  const detail: Record<string, string | number | null> = a.detailJson ? JSON.parse(a.detailJson) : {};
  const canApprove = a.status === "Submitted" && a.layers.some((l) => l.status === "Pending");
  const detailLabels: Record<string, string> = {
    positionId: "Posisi Baru", gradeId: "Grade Baru", newSalary: "Gaji Baru", oldSalary: "Gaji Lama",
    percent: "Persentase", months: "Durasi (bln)", lastDay: "Hari Terakhir", newEndDate: "Tanggal Berakhir",
    newEmploymentStatus: "Status Baru", plannedPosition: "Posisi Direncanakan", plannedSalary: "Gaji Direncanakan",
    fromUnit: "Unit Asal", toUnit: "Unit Tujuan", fromPosition: "Posisi Asal", toPosition: "Posisi Baru", reason: "Alasan",
  };
  const fmtVal = (k: string, v: string | number | null) => {
    if (v === null || v === undefined || v === "") return "—";
    if (k.toLowerCase().includes("salary")) return fmtIDR(Number(v));
    return String(v);
  };

  return (
    <div>
      <button onClick={() => { setParams({}); navigate("actions", "all"); }} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-emerald-700 hover:underline dark:text-emerald-400">
        <ArrowLeft className="h-4 w-4" /> Kembali ke Daftar
      </button>

      {/* header */}
      <Card className="mb-4 overflow-hidden rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <div className={cn("h-1.5", a.status === "Approved" || a.status === "Processed" ? "bg-emerald-500" : a.status === "Rejected" ? "bg-rose-500" : a.status === "Submitted" ? "bg-amber-400" : "bg-slate-300")} />
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm font-extrabold text-slate-500">{a.docNo}</p>
                <Badge variant="outline" className="text-[11px] font-bold">{paTypeLabelSafe(a.type)}</Badge>
                <StatusPill status={a.status} />
              </div>
              <h1 className="mt-2 text-lg font-extrabold text-slate-900 dark:text-slate-50">{a.employee.fullName}</h1>
              <p className="text-xs text-slate-500">{a.employee.position?.title ?? "—"} · {a.employee.orgUnit?.name ?? "—"} · <span className="font-mono">{a.employee.employeeNo}</span></p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[11px] text-slate-500">
                <span><b className="text-slate-700 dark:text-slate-300">Efektif:</b> {fmtDate(a.effectiveDate)}</span>
                <span><b className="text-slate-700 dark:text-slate-300">Dibuat:</b> {fmtDateTime(a.createdAt)} oleh {a.createdBy ?? "—"}</span>
                {a.submittedAt && <span><b className="text-slate-700 dark:text-slate-300">Submit:</b> {fmtDateTime(a.submittedAt)}</span>}
                {a.processedAt && <span><b className="text-slate-700 dark:text-slate-300">Diproses:</b> {fmtDateTime(a.processedAt)}</span>}
              </div>
            </div>
            <div className={cn("flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold", avatarColor(a.employee.fullName))}>
              {initials(a.employee.fullName)}
            </div>
          </div>
          {a.reason && (
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Alasan</p>
              <p className="mt-0.5 text-sm italic text-slate-700 dark:text-slate-300">"{a.reason}"</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* detail payload */}
          {Object.keys(detail).length > 0 && (
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-emerald-600" /> Detail Perubahan</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {Object.entries(detail).map(([k, v]) => (
                    <div key={k}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{detailLabels[k] ?? k}</p>
                      <p className="mt-0.5 text-[13px] font-semibold text-slate-800 dark:text-slate-200">{fmtVal(k, v)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* approval timeline */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><History className="h-4 w-4 text-emerald-600" /> Alur Approval</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="relative ml-2 space-y-0 border-l-2 border-slate-100 pl-6 dark:border-slate-800">
                {a.layers.map((l, i) => {
                  const isCurrent = a.status === "Submitted" && l.status === "Pending" && l.layerNo === a.currentLayer;
                  return (
                    <li key={l.id} className="relative pb-6 last:pb-0">
                      <span className={cn(
                        "absolute -left-[35px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white dark:ring-slate-950",
                        l.status === "Approved" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400" :
                        l.status === "Rejected" ? "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400" :
                        isCurrent ? "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 animate-pulse" :
                        "bg-slate-100 text-slate-400 dark:bg-slate-800"
                      )}>
                        {l.status === "Approved" ? <CheckCircle2 className="h-4 w-4" /> : l.status === "Rejected" ? <XCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                      </span>
                      <div className={cn("rounded-xl border p-3.5", isCurrent ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5" : "border-slate-100 dark:border-slate-800")}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[9px] font-bold">Layer {l.layerNo}</Badge>
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{l.approverRole}</p>
                          {l.approver && <span className="text-[10px] text-slate-400">· {l.approver.fullName}</span>}
                          <StatusPill status={l.status} className="ml-auto" />
                        </div>
                        {l.note && <p className="mt-1.5 text-[11px] italic text-slate-500">"{l.note}"</p>}
                        {l.decidedAt && <p className="mt-1 text-[10px] text-slate-400">{fmtDateTime(l.decidedAt)}</p>}
                      </div>
                      {i < a.layers.length - 1 && null}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          {/* activity trail */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><PenLine className="h-4 w-4 text-emerald-600" /> Jejak Aktivitas</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="space-y-3">
                {data.activities.map((act) => (
                  <li key={act.id} className="flex items-start gap-3 text-xs">
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full",
                      act.action === "Approved" ? "bg-emerald-500" : act.action === "Rejected" ? "bg-rose-500" : act.action === "Processed" ? "bg-teal-500" : "bg-slate-300")} />
                    <div>
                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                        <b>{act.appUser?.fullName ?? "System"}</b> · {act.action}
                      </p>
                      {act.detail && <p className="text-[11px] text-slate-500">{act.detail}</p>}
                      <p className="text-[10px] text-slate-400">{fmtDateTime(act.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* right column: action bar */}
        <div className="space-y-4">
          <Card className="sticky top-20 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><Workflow className="h-4 w-4 text-emerald-600" /> Aksi Workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0">
              {/* progress */}
              <div className="mb-3">
                <div className="mb-1.5 flex justify-between text-[11px] font-bold">
                  <span className="text-slate-400">Progress Approval</span>
                  <span className="text-slate-600 dark:text-slate-400">{a.currentLayer}/{a.layers.length} layer</span>
                </div>
                <Progress value={(a.currentLayer / Math.max(a.layers.length, 1)) * 100} className="h-2 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-teal-500" />
              </div>

              {a.status === "Prepared" && (
                <>
                  <ActionButton icon={Send} label="Submit untuk Approval" tone="emerald" onClick={() => setConfirmAct("submit")} desc="Kirim dokumen ke alur approval multi-layer" />
                  <ActionButton icon={Ban} label="Batalkan Dokumen" tone="stone" onClick={() => setConfirmAct("cancel")} desc="Dokumen dibatalkan & tidak diproses" />
                </>
              )}
              {canApprove && (
                <>
                  <ActionButton icon={CheckCircle2} label="Setujui Layer Ini" tone="emerald" onClick={() => setDecision({ act: "approve" })} desc={`Menyetujui sebagai layer ${a.currentLayer}`} />
                  <ActionButton icon={XCircle} label="Tolak Dokumen" tone="rose" onClick={() => setDecision({ act: "reject" })} desc="Dokumen ditolak pada layer ini" />
                </>
              )}
              {a.status === "Approved" && (
                <ActionButton icon={Play} label="Proses Sekarang" tone="teal" prominent onClick={() => setConfirmAct("process")} desc="Terapkan efek ke data karyawan (posisi/gaji/status)" />
              )}
              {["Rejected", "Cancelled"].includes(a.status) && (
                <ActionButton icon={Undo2} label="Kembalikan ke Draft" tone="stone" onClick={() => setConfirmAct("return")} desc="Reset semua layer & status menjadi Draft" />
              )}
              {a.status === "Processed" && (
                <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-center dark:border-teal-500/25 dark:bg-teal-500/5">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-teal-600 dark:text-teal-400" />
                  <p className="mt-1.5 text-sm font-bold text-teal-700 dark:text-teal-300">Dokumen Selesai</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Efek sudah diterapkan {fmtDate(a.processedAt)}</p>
                </div>
              )}
              {a.status === "Submitted" && !canApprove && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-center dark:border-amber-500/25 dark:bg-amber-500/5">
                  <Clock className="mx-auto h-7 w-7 text-amber-600 dark:text-amber-400" />
                  <p className="mt-1 text-[13px] font-bold text-amber-700 dark:text-amber-300">Menunggu Layer {a.currentLayer}</p>
                  <p className="text-[11px] text-slate-500">Menunggu keputusan approver berikutnya</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <DecisionDialog decision={decision ? { pa: a, act: decision.act } : null} onClose={() => setDecision(null)} onConfirm={(note) => transition(decision!.act, note)} />
      <ConfirmDialog act={confirmAct} onConfirm={() => transition(confirmAct!)} onClose={() => setConfirmAct(null)} />
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
    stone: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
  };
  return (
    <button onClick={onClick} className={cn("w-full rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5", tones[tone], prominent && "animate-pulse-once")}>
      <div className="flex items-center gap-2.5">
        <Icon className="h-5 w-5 shrink-0" />
        <p className="text-sm font-bold">{label}</p>
      </div>
      <p className={cn("mt-1 pl-8 text-[11px]", tone === "teal" ? "text-white/80" : "text-slate-500 dark:text-slate-400")}>{desc}</p>
    </button>
  );
}

function ConfirmDialog({ act, onConfirm, onClose }: { act: string | null; onConfirm: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!act) return null;
  const labels: Record<string, { title: string; desc: string; tone: string }> = {
    submit: { title: "Submit untuk Approval?", desc: "Dokumen akan dikirim ke layer approval pertama dan tidak bisa diedit lagi.", tone: "emerald" },
    process: { title: "Proses Dokumen?", desc: "Efek akan DITERAPKAN PERMANEN ke data karyawan (posisi/gaji/status sesuai jenis aksi).", tone: "teal" },
    cancel: { title: "Batalkan Dokumen?", desc: "Dokumen akan berstatus Dibatalkan dan tidak diproses.", tone: "stone" },
    return: { title: "Kembalikan ke Draft?", desc: "Semua layer approval di-reset menjadi Pending dan dokumen kembali menjadi Draft.", tone: "stone" },
  };
  const l = labels[act];
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">{l.title}</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-500">{l.desc}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }} disabled={busy} className={cn("font-bold", l.tone === "emerald" ? "bg-emerald-600 hover:bg-emerald-700" : l.tone === "teal" ? "bg-teal-600 hover:bg-teal-700" : "bg-slate-600 hover:bg-slate-700")}>
            {busy ? "Memproses…" : "Ya, Lanjutkan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
