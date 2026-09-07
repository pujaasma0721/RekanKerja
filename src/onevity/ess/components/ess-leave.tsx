"use client";
// Cuti Saya — saldo per jenis (bar progres), form ajukan cuti dengan
// PRATINJAU LIVE (hari kerja, sisa setelah, tanggal kembali kerja),
// riwayat pengajuan dengan jejak approval, dan batalkan (milik sendiri).
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarDays, Plus, Loader2, Sparkles, XCircle, ChevronDown, Info,
  CheckCircle2, Clock3, CircleDashed, PartyPopper,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useApi, apiSend, fmtDate } from "@/onevity/shared/lib/api";
import { StatusPill, EmptyState } from "@/onevity/shared/components/ui-kit";
import { EssSection, BalanceBar, PageSkeleton } from "@/onevity/ess/components/ess-ui";
import { useEssNav } from "@/onevity/ess/lib/ess-store";
import { cn } from "@/lib/utils";

interface LeaveData {
  year: number;
  balances: {
    balanceId: string | null; leaveTypeCode: string; leaveTypeName: string; unit: string;
    year: number; periodLabel: string; entitlement: number; carriedOver: number;
    taken: number; applied: number; remaining: number; maxPerRequest: number | null;
  }[];
  prevBalances: unknown[];
  requests: {
    id: string; docNo: string; leaveTypeName: string; leaveTypeCode: string;
    requestDate: string; dateFrom: string; dateTo: string; sessionFrom: string; sessionTo: string;
    workingDays: number; status: string; reason: string | null; note: string | null;
    decisionNote: string | null; decidedAt: string | null; backToWorkDate: string | null;
    approval: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
  }[];
  types: {
    id: string; code: string; name: string; unit: string; paid: boolean; cashable: boolean;
    entitlement: number; maxPerRequest: number | null; waitingMonths: number | null;
    allowAdvance: boolean; allowHalfDay: boolean; needDocs: boolean;
  }[];
}

interface PreviewResult {
  workingDays: number;
  balance: number;
  remaining: number;
  backToWork: string | null;
  maxPerRequest: number | null;
  unit: string;
  waitingMonths: number | null;
  allowAdvance: boolean;
  periodLabel: string | null;
}

const toISODate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function EssLeave() {
  const { params, setParams } = useEssNav();
  const { data, loading, error, refresh } = useApi<LeaveData>(`/api/ess/leave?year=${new Date().getFullYear()}`);
  // dialog buka dari tombol lokal ATAU deep-link ?dialog=request (tanpa effect:
  // param URL d derivasi murni; menutup dialog juga membersihkan param).
  const wantsDialog = params.dialog === "request";
  const [formOpen, setFormOpen] = useState(false);
  const dialogOpen = formOpen || wantsDialog;
  const closeDialog = () => {
    setFormOpen(false);
    if (wantsDialog) setParams({});
  };
  const [cancelId, setCancelId] = useState<string | null>(null);

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <EmptyState title="Gagal memuat data cuti" description={error} icon={<CalendarDays className="h-6 w-6" />} />;

  const annual = data?.balances.filter((b) => ["CT-THN", "CT-ANNIV"].includes(b.leaveTypeCode)) ?? [];
  const others = data?.balances.filter((b) => !["CT-THN", "CT-ANNIV"].includes(b.leaveTypeCode)) ?? [];
  const cancelTarget = data?.requests.find((r) => r.id === cancelId) ?? null;

  return (
    <div className="space-y-6">
      {/* header aksi */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">Cuti Saya</h1>
          <p className="mt-0.5 text-[13px] text-stone-500 dark:text-stone-400">Saldo, pengajuan, dan riwayat cuti Anda tahun {data?.year}</p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="rounded-xl bg-emerald-600 shadow-md shadow-emerald-600/25 hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> Ajukan Cuti
        </Button>
      </div>

      {/* ===== saldo cuti tahunan (utama) ===== */}
      <EssSection title="Cuti Tahunan" description="Saldo utama Anda — periode berjalan" icon={<CalendarDays />}>
        <div className="grid gap-4 md:grid-cols-2">
          {(annual.length > 0 ? annual : data?.balances.slice(0, 2) ?? []).map((b, i) => (
            <motion.div
              key={b.balanceId ?? b.leaveTypeCode}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="h-full border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardContent className="p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">{b.leaveTypeName}</p>
                    <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {b.remaining}
                      <span className="ml-1 text-xs font-medium text-stone-400">/ {b.entitlement} hari</span>
                    </p>
                  </div>
                  <BalanceBar value={b.remaining} max={b.entitlement} className="mt-3" />
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                    <span>Diambil: <b className="text-stone-700 dark:text-stone-200">{b.taken}</b></span>
                    <span>Menunggu: <b className="text-amber-600 dark:text-amber-400">{b.applied}</b></span>
                    {b.carriedOver > 0 && <span>Dibawa: <b className="text-stone-700 dark:text-stone-200">{b.carriedOver}</b></span>}
                    <span className="text-stone-400">{b.periodLabel}</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </EssSection>

      {/* ===== saldo jenis lain ===== */}
      {others.length > 0 && (
        <EssSection title="Cuti Khusus & Izin" description="Jatah per keperluan (pernikahan, melahirkan, dll.)">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {others.map((b) => (
              <div key={b.balanceId ?? b.leaveTypeCode} className="rounded-xl border border-stone-200/80 bg-card p-3.5 shadow-sm transition-colors hover:border-emerald-300 dark:border-stone-800 dark:hover:border-emerald-500/40">
                <p className="truncate text-[11px] font-medium text-stone-500 dark:text-stone-400" title={b.leaveTypeName}>{b.leaveTypeName}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-stone-800 dark:text-stone-100">
                  {b.remaining}<span className="ml-1 text-[10px] font-medium text-stone-400">/ {b.entitlement}</span>
                </p>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${b.entitlement > 0 ? (b.remaining / b.entitlement) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </EssSection>
      )}

      {/* ===== riwayat pengajuan ===== */}
      <EssSection title="Riwayat Pengajuan" description={`Semua pengajuan Anda tahun ${data?.year}`} icon={<Clock3 />}>
        <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-2">
            {data && data.requests.length > 0 ? (
              <div className="max-h-[420px] overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar]:w-1.5">
                <ul className="divide-y divide-stone-100 dark:divide-stone-800/70">
                  {data.requests.map((r, i) => (
                    <motion.li
                      key={r.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      className="rounded-lg p-3 transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/50"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">{r.leaveTypeName}</p>
                        <StatusPill status={r.status} />
                        <span className="ml-auto font-mono text-[11px] text-stone-400">{r.docNo}</span>
                      </div>
                      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        {fmtDate(r.dateFrom)} – {fmtDate(r.dateTo)} · {r.workingDays} hari kerja · diajukan {fmtDate(r.requestDate)}
                        {(r.sessionFrom === "PM" || r.sessionTo === "AM") && ` · setengah hari`}
                      </p>
                      {r.reason && <p className="mt-1 line-clamp-2 rounded-lg bg-stone-50 px-3 py-1.5 text-xs italic text-stone-500 dark:bg-stone-900/50 dark:text-stone-400">“{r.reason}”</p>}
                      {/* jejak approval */}
                      {r.approval && r.status === "Submitted" && (
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400">
                          <CircleDashed className="h-3.5 w-3.5" />
                          Menunggu {r.approval.currentApprover ?? "approver"} · jenjang {r.approval.currentLevel}/{r.approval.totalLevels}
                        </div>
                      )}
                      {r.status === "Approved" && r.backToWorkDate && (
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-400">
                          <PartyPopper className="h-3.5 w-3.5" /> Disetujui — kembali kerja {fmtDate(r.backToWorkDate)}
                        </div>
                      )}
                      {r.decisionNote && r.status !== "Submitted" && (
                        <p className="mt-1 text-[11px] text-stone-400">Catatan: {r.decisionNote}</p>
                      )}
                      {r.status === "Submitted" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 rounded-lg px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
                          onClick={() => setCancelId(r.id)}
                        >
                          <XCircle className="h-3.5 w-3.5" /> Batalkan
                        </Button>
                      )}
                    </motion.li>
                  ))}
                </ul>
              </div>
            ) : (
              <EmptyState
                title="Belum ada pengajuan cuti"
                description="Klik “Ajukan Cuti” untuk mengajukan cuti pertama Anda tahun ini."
                icon={<CalendarDays className="h-6 w-6" />}
              />
            )}
          </CardContent>
        </Card>
      </EssSection>

      {/* ===== dialog form ajukan ===== */}
      <RequestDialog
        open={dialogOpen}
        setOpen={(v) => (v ? setFormOpen(true) : closeDialog())}
        types={data?.types ?? []}
        onDone={refresh}
      />

      {/* ===== dialog konfirmasi batal ===== */}
      <AlertDialog open={!!cancelId} onOpenChange={(v) => { if (!v) setCancelId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan pengajuan ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget ? `${cancelTarget.leaveTypeName} ${cancelTarget.docNo} (${fmtDate(cancelTarget.dateFrom)} – ${fmtDate(cancelTarget.dateTo)}) akan dibatalkan dan saldo cuti kembali tersedia. Saldo yang sedang diproses approval lain tidak terpengaruh.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tidak</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async () => {
                if (!cancelId) return;
                try {
                  const res = await apiSend<{ docNo: string }>("/api/ess/leave/cancel", "POST", { id: cancelId });
                  toast.success(`Pengajuan ${res.docNo} dibatalkan`);
                  setCancelId(null);
                  refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Gagal membatalkan");
                }
              }}
            >
              Ya, Batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ form ajukan cuti (dialog dengan pratinjau live) ============

function RequestDialog({
  open, setOpen, types, onDone,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  types: LeaveData["types"];
  onDone: () => void;
}) {
  const [typeId, setTypeId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sessionFrom, setSessionFrom] = useState<"AM" | "PM">("AM");
  const [sessionTo, setSessionTo] = useState<"AM" | "PM">("PM");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedType = types.find((t) => t.id === typeId) ?? null;
  const singleDay = !!dateFrom && !!dateTo && dateFrom === dateTo;

  // pratinjau live (debounce 600ms)
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const canPreview = !!typeId && !!dateFrom && !!dateTo && dateFrom <= dateTo;

  useEffect(() => {
    if (!open) return;
    if (!canPreview) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const t = setTimeout(async () => {
      setPreviewing(true);
      setPreviewError(null);
      try {
        const res = await apiSend<PreviewResult>("/api/ess/leave/request", "POST", {
          preview: true, leaveTypeId: typeId, dateFrom, sessionFrom, dateTo, sessionTo, reason: reason || "pratinjau",
        });
        setPreview(res);
      } catch (e) {
        setPreview(null);
        setPreviewError(e instanceof Error ? e.message : "Pratinjau gagal");
      } finally {
        setPreviewing(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [open, typeId, dateFrom, dateTo, sessionFrom, sessionTo, canPreview, reason]);

  const reset = () => {
    setTypeId(""); setDateFrom(""); setDateTo(""); setSessionFrom("AM"); setSessionTo("PM");
    setReason(""); setNote(""); setPreview(null); setPreviewError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; workingDays: number; remaining: number; approvalLevels: number; firstApprover: string | null }>(
        "/api/ess/leave/request", "POST",
        { leaveTypeId: typeId, dateFrom, sessionFrom, dateTo, sessionTo, reason, note: note || undefined },
      );
      toast.success(`Pengajuan ${res.docNo} terkirim`, {
        description: `${res.workingDays} hari kerja · menunggu ${res.firstApprover ?? "approver"}${res.approvalLevels > 1 ? ` (jenjang 1/${res.approvalLevels})` : ""}`,
      });
      setOpen(false);
      reset();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengajukan cuti");
    } finally {
      setBusy(false);
    }
  };

  const insufficient = preview && !selectedType?.allowAdvance && preview.remaining < 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { setOpen(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-lg overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-emerald-600" /> Ajukan Cuti
          </DialogTitle>
          <DialogDescription>Pengajuan langsung masuk jalur persetujuan atasan — source: ESS.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* jenis cuti */}
          <div className="space-y-1.5">
            <Label htmlFor="lv-type">Jenis Cuti</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger id="lv-type" className="rounded-lg"><SelectValue placeholder="Pilih jenis cuti…" /></SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-stone-400">{t.code}</span> {t.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedType && (
              <p className="flex flex-wrap gap-x-3 text-[11px] text-stone-400">
                <span>jatah {selectedType.entitlement} hari</span>
                {selectedType.needDocs && <span className="text-amber-600 dark:text-amber-400">perlu dokumen</span>}
                {selectedType.allowHalfDay ? <span>bisa setengah hari</span> : <span>minimal 1 hari</span>}
              </p>
            )}
          </div>

          {/* tanggal */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lv-from">Tanggal Mulai</Label>
              <Input id="lv-from" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); if (!dateTo || e.target.value > dateTo) setDateTo(e.target.value); }} className="rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lv-to">Tanggal Sampai</Label>
              <Input id="lv-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg" />
            </div>
          </div>

          {/* sesi (setengah hari — hanya bila jenis mengizinkan & satu hari) */}
          <AnimatePresence>
            {selectedType?.allowHalfDay && singleDay && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-2 gap-3 overflow-hidden"
              >
                <div className="space-y-1.5">
                  <Label>Sesi Mulai</Label>
                  <Select value={sessionFrom} onValueChange={(v) => setSessionFrom(v === "PM" ? "PM" : "AM")}>
                    <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AM">Pagi (full day)</SelectItem>
                      <SelectItem value="PM">Siang (setengah hari)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Sesi Kembali</Label>
                  <Select value={sessionTo} onValueChange={(v) => setSessionTo(v === "AM" ? "AM" : "PM")}>
                    <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AM">Pagi (setengah hari)</SelectItem>
                      <SelectItem value="PM">Siang (full day)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* alasan */}
          <div className="space-y-1.5">
            <Label htmlFor="lv-reason">Alasan <span className="text-rose-500">*</span></Label>
            <Textarea id="lv-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Contoh: acara keluarga di luar kota…" className="rounded-lg resize-none" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lv-note">Catatan untuk Approver <span className="text-stone-400">(opsional)</span></Label>
            <Input id="lv-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nomor telp darurat, pengganti tugas, dll." className="rounded-lg" />
          </div>

          {/* ===== panel pratinjau live ===== */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
              <Info className="h-3.5 w-3.5" /> Pratinjau Otomatis
            </p>
            {previewing && (
              <p className="mt-2 flex items-center gap-2 text-xs text-stone-400"><Loader2 className="h-3 w-3 animate-spin" /> Menghitung…</p>
            )}
            {previewError && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{previewError}</p>}
            {preview && !previewing && (
              <div className="mt-2 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-lg font-bold tabular-nums text-stone-800 dark:text-stone-100">{preview.workingDays}</p>
                  <p className="text-[10px] text-stone-400">hari kerja</p>
                </div>
                <div>
                  <p className={cn("text-lg font-bold tabular-nums", insufficient ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400")}>
                    {preview.remaining}
                  </p>
                  <p className="text-[10px] text-stone-400">sisa setelahnya</p>
                </div>
                <div>
                  <p className="text-[13px] font-bold text-stone-800 dark:text-stone-100">{preview.backToWork ? fmtDate(preview.backToWork) : "—"}</p>
                  <p className="text-[10px] text-stone-400">kembali kerja</p>
                </div>
              </div>
            )}
            {!preview && !previewing && !previewError && (
              <p className="mt-2 text-xs text-stone-400">Pilih jenis & tanggal — sistem menghitung hari kerja, saldo, dan tanggal kembali secara otomatis.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={busy}>Batal</Button>
          <Button
            onClick={submit}
            disabled={busy || !typeId || !dateFrom || !dateTo || !reason.trim() || !!insufficient || (canPreview && !preview)}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-700"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Kirim Pengajuan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
