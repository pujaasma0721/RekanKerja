"use client";
// Persetujuan (ESS) — kotak masuk approver: dokumen yang jenjang saat ini
// menunggu keputusan karyawan login. Setujui/Tolak dengan catatan —
// otorisasi jenjang diverifikasi server oleh mesin approval.
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardCheck, CheckCircle2, XCircle, Plane, HeartPulse, CalendarDays, Coins, Loader2, Inbox,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { useApi, apiSend, fmtIDR, fmtDate, initials } from "@/onevity/shared/lib/api";
import { EmptyState } from "@/onevity/shared/components/ui-kit";
import { EssSection, PageSkeleton } from "@/onevity/ess/components/ess-ui";
import { useEssSession } from "@/onevity/ess/components/ess-session";
import { cn } from "@/lib/utils";

interface InboxItem {
  docType: "Leave" | "Travel" | "Medical" | "Loan";
  docId: string;
  docNo: string;
  requester: { employeeNo: string | null; fullName: string; photoUrl: string | null };
  title: string;
  lines: string[];
  amount: number | null;
  requestedAt: string | null;
  currentLevel: number;
  totalLevels: number;
}

const TYPE_META: Record<string, { icon: typeof Plane; cls: string; label: string }> = {
  Leave: { icon: CalendarDays, cls: "bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400", label: "Cuti" },
  Travel: { icon: Plane, cls: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400", label: "Perjalanan" },
  Medical: { icon: HeartPulse, cls: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400", label: "Medis" },
  Loan: { icon: Coins, cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400", label: "Pinjaman" },
};

export function EssApprovals() {
  const { data, loading, error, refresh } = useApi<{ items: InboxItem[]; count: number }>("/api/ess/approvals");
  const { refresh: refreshSession } = useEssSession();
  const [decide, setDecide] = useState<{ item: InboxItem; action: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!decide || busy) return;
    setBusy(true);
    try {
      const res = await apiSend<{ ok: boolean; docType: string; status: string; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null } }>(
        "/api/ess/approvals/decide", "POST",
        { docType: decide.item.docType, docId: decide.item.docId, action: decide.action, note: note || undefined },
      );
      if (res.approval) {
        toast.success(
          decide.action === "approve"
            ? `Jenjang ${res.approval.currentLevel - 1}/${res.approval.totalLevels} disetujui — menunggu ${res.approval.currentApprover ?? "jenjang berikutnya"}`
            : "Dokumen ditolak",
          { description: decide.item.docNo },
        );
      } else {
        toast.success(decide.action === "approve" ? `${decide.item.docNo} disetujui sepenuhnya` : `${decide.item.docNo} ditolak`);
      }
      setDecide(null);
      setNote("");
      refresh();
      refreshSession();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses keputusan");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <EmptyState title="Gagal memuat kotak persetujuan" description={error} icon={<ClipboardCheck className="h-6 w-6" />} />;

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">Persetujuan</h1>
        <p className="mt-0.5 text-[13px] text-stone-500 dark:text-stone-400">
          {items.length > 0 ? `${items.length} pengajuan menunggu keputusan Anda` : "Pengajuan dari tim Anda yang butuh persetujuan"}
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Semua sudah diproses"
          description="Tidak ada pengajuan yang menunggu keputusan Anda saat ini — Anda akan melihat daftar di sini begitu ada yang baru."
          icon={<Inbox className="h-6 w-6" />}
        />
      ) : (
        <div className="space-y-4">
          <AnimatePresence>
            {items.map((item, i) => {
              const meta = TYPE_META[item.docType] ?? TYPE_META.Leave!;
              const Icon = meta.icon;
              return (
                <motion.div
                  key={`${item.docType}-${item.docId}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ delay: Math.min(i * 0.06, 0.3) }}
                  layout
                >
                  <Card className="border-stone-200/80 shadow-sm transition-shadow hover:shadow-md dark:border-stone-800">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <Avatar className="h-11 w-11 shrink-0">
                          {item.requester.photoUrl ? <AvatarImage src={item.requester.photoUrl} alt={item.requester.fullName} /> : null}
                          <AvatarFallback className="bg-stone-100 text-sm font-bold text-stone-600 dark:bg-stone-800">{initials(item.requester.fullName)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-stone-900 dark:text-stone-50">{item.requester.fullName}</p>
                            {item.requester.employeeNo && <span className="font-mono text-[11px] text-stone-400">{item.requester.employeeNo}</span>}
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", meta.cls)}>
                              <Icon className="h-3 w-3" /> {meta.label}
                            </span>
                            <span className="ml-auto font-mono text-[11px] text-stone-400">{item.docNo}</span>
                          </div>
                          <p className="mt-0.5 text-[13px] font-medium text-stone-700 dark:text-stone-200">{item.title}</p>
                          <ul className="mt-1.5 space-y-0.5">
                            {item.lines.map((l, li) => (
                              <li key={li} className="text-xs text-stone-500 dark:text-stone-400">{l}</li>
                            ))}
                            {item.amount != null && item.amount > 0 && (
                              <li className="text-xs font-semibold text-stone-700 dark:text-stone-200">Nilai: {fmtIDR(item.amount)}</li>
                            )}
                          </ul>
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            {/* progres jenjang */}
                            {item.totalLevels > 1 && (
                              <span className="flex items-center gap-1.5 text-[11px] text-stone-400">
                                {Array.from({ length: item.totalLevels }).map((_, li) => (
                                  <span key={li} className={cn("h-1.5 w-5 rounded-full", li < item.currentLevel ? "bg-emerald-500" : "bg-stone-200 dark:bg-stone-700")} />
                                ))}
                                jenjang {item.currentLevel}/{item.totalLevels}
                              </span>
                            )}
                            {item.requestedAt && <span className="text-[11px] text-stone-400">diajukan {fmtDate(item.requestedAt)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-lg border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
                          onClick={() => { setDecide({ item, action: "reject" }); setNote(""); }}
                        >
                          <XCircle className="h-4 w-4" /> Tolak
                        </Button>
                        <Button
                          size="sm"
                          className="rounded-lg bg-emerald-600 shadow-md shadow-emerald-600/20 hover:bg-emerald-700"
                          onClick={() => { setDecide({ item, action: "approve" }); setNote(""); }}
                        >
                          <CheckCircle2 className="h-4 w-4" /> Setujui
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* dialog catatan keputusan */}
      <Dialog open={!!decide} onOpenChange={(v) => { if (!busy && !v) setDecide(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {decide?.action === "approve" ? (
                <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Setujui pengajuan?</>
              ) : (
                <><XCircle className="h-4 w-4 text-rose-600" /> Tolak pengajuan?</>
              )}
            </DialogTitle>
            <DialogDescription>
              {decide ? `${decide.item.title} — ${decide.item.requester.fullName} (${decide.item.docNo})` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Catatan untuk pemohon (opsional)…"
              className="rounded-lg resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecide(null)} disabled={busy}>Batal</Button>
            <Button
              onClick={submit}
              disabled={busy}
              className={cn("rounded-lg", decide?.action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700")}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : decide?.action === "approve" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {decide?.action === "approve" ? "Setujui" : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
