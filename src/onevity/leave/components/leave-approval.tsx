"use client";
// OneVity Leave — Persetujuan: Approve | Reject | Cancel (padanan LeaveRequestToApprove.jsp
// menu Operation oranHR). Approve → hari cuti masuk rekap absensi (OnLeave).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RequestRowUI, LEAVE_STATUS_LABEL, SESSION_LABEL, fmtDay } from "./leave-types";
import { CheckCircle2, XCircle, Ban, Inbox, Search, CalendarClock, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type Action = "approve" | "reject" | "cancel";

export function LeaveApprovalPage() {
  const { navigate } = useNav();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<RequestRowUI | null>(null);
  const [action, setAction] = useState<Action>("approve");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useApi<{ requests: RequestRowUI[]; stats: { submitted: number; pendingDays: number } }>(
    "/api/onevity/leave/requests?status=Submitted",
  );

  const requests = useMemo(() => (api.data?.requests ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.docNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  const openDialog = (r: RequestRowUI, a: Action) => {
    setTarget(r);
    setAction(a);
    setNote(a === "approve" ? "Disetujui" : a === "reject" ? "" : "Dibatalkan pemberi kuasa");
  };

  const decide = async () => {
    if (!target) return;
    if (action === "reject" && !note.trim()) { toast.error("Alasan penolakan wajib diisi"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; status: string; regeneratedDays: number }>(
        "/api/onevity/leave/requests", "PATCH", { id: target.id, action, note },
      );
      toast.success(
        res.status === "Approved"
          ? `${res.docNo} disetujui — ${res.regeneratedDays} hari rekap absensi diperbarui (OnLeave)`
          : `${res.docNo} → ${LEAVE_STATUS_LABEL[res.status] ?? res.status}`,
      );
      setTarget(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses keputusan");
    } finally { setBusy(false); }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL LEAVE"
        title="Persetujuan Cuti"
        description="Keputusan permintaan cuti menunggu — Approve / Reject / Cancel (padanan Operation oranHR); hari cuti otomatis masuk rekap absensi"
        actions={
          <Button variant="outline" onClick={() => navigate("leave", "leave-request")} className="gap-2 font-bold">
            <Inbox className="h-4 w-4" /> Lihat Semua Permintaan
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Menunggu Keputusan", value: stats?.submitted ?? 0, sub: "permintaan cuti", icon: Inbox, tone: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-500/15" },
          { label: "Total Hari Diminta", value: stats?.pendingDays ?? 0, sub: "akumulasi hari kerja", icon: CalendarClock, tone: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-500/15" },
          { label: "Efek Approve", value: "OnLeave", sub: "status rekap absensi", icon: ShieldCheck, tone: "text-teal-600", bg: "bg-teal-100 dark:bg-teal-500/15" },
          { label: "Dokumen Wajib", value: String(requests.filter((r) => r.leaveTypeCode.startsWith("CT-MATI") || r.leaveTypeCode === "CT-NIKAH" || r.leaveTypeCode.startsWith("CT-KHITAN")).length), sub: "perlu verifikasi dokumen", icon: CheckCircle2, tone: "text-rose-600", bg: "bg-rose-100 dark:bg-rose-500/15" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex items-center gap-2">
                <div className={`rounded-lg p-1.5 ${k.bg}`}><Icon className={cn("h-3.5 w-3.5", k.tone)} /></div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{k.label}</p>
              </div>
              <p className="mt-1.5 text-lg font-extrabold text-stone-800 dark:text-stone-100">{k.value}</p>
              <p className="text-[11px] text-stone-400">{k.sub}</p>
            </div>
          );
        })}
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <p className="text-xs font-bold text-stone-500 dark:text-stone-400">Permintaan berstatus Menunggu — urut terbaru</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari karyawan / no. dokumen…"
                className="h-8 w-56 rounded-md border border-stone-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-orange-400 dark:border-stone-700 dark:bg-stone-900"
              />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : requests.length === 0 ? (
            <div className="p-5"><EmptyState title="Tidak ada permintaan menunggu" description="Semua permintaan cuti sudah diproses — kerja bagus!" icon={<CheckCircle2 className="h-6 w-6" />} /></div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                    <TableHead className="text-[11px] font-bold">Dokumen</TableHead>
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Jenis & Alasan</TableHead>
                    <TableHead className="text-[11px] font-bold">Rentang</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Hari</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Sisa Saldo</TableHead>
                    <TableHead className="w-44" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-stone-700 dark:text-stone-200">{r.docNo}</p>
                        <p className="text-[10px] text-stone-400">diajukan {new Date(r.requestDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" })}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-bold text-stone-800 dark:text-stone-100">{r.employeeNo}</p>
                        <p className="text-[10px] text-stone-400">{r.fullName}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-stone-700 dark:text-stone-200">{r.leaveTypeName}</p>
                        <p className="max-w-52 truncate text-[10px] text-stone-400" title={r.reason ?? ""}>{r.reason}</p>
                      </TableCell>
                      <TableCell className="text-[11px] font-semibold text-stone-700 dark:text-stone-200">
                        {new Date(r.dateFrom).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} {SESSION_LABEL[r.sessionFrom]} → {new Date(r.dateTo).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} {SESSION_LABEL[r.sessionTo]}
                        <span className="block text-[10px] font-normal text-stone-400">
                          kembali {r.backToWorkDate ? new Date(r.backToWorkDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-stone-700 dark:text-stone-200">{fmtDay(r.workingDays)}</TableCell>
                      <TableCell className={cn("text-right text-xs font-bold tabular-nums", r.remainingAtRequest < 0 ? "text-rose-600" : "text-stone-500")}>{fmtDay(r.remainingAtRequest)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => openDialog(r, "approve")} className="h-7 gap-1 bg-emerald-600 text-[11px] font-bold hover:bg-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Setujui
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openDialog(r, "reject")} className="h-7 gap-1 border-rose-200 text-[11px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:hover:bg-rose-950/40">
                            <XCircle className="h-3.5 w-3.5" /> Tolak
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openDialog(r, "cancel")} className="h-7 text-[11px] font-bold text-stone-400" title="Batalkan">
                            <Ban className="h-3.5 w-3.5" />
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

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className={cn("flex items-center gap-2 text-sm",
              action === "approve" ? "text-emerald-700 dark:text-emerald-400" : action === "reject" ? "text-rose-600" : "text-stone-500")}>
              {action === "approve" ? <CheckCircle2 className="h-4 w-4" /> : action === "reject" ? <XCircle className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
              {action === "approve" ? "Setujui Permintaan Cuti" : action === "reject" ? "Tolak Permintaan Cuti" : "Batalkan Permintaan Cuti"}
            </DialogTitle>
          </DialogHeader>
          {target && (
            <div className="space-y-3">
              <div className="rounded-xl bg-stone-50 p-3 text-xs dark:bg-stone-900/60">
                <p className="font-bold text-stone-800 dark:text-stone-100">{target.docNo} — {target.fullName}</p>
                <p className="mt-0.5 text-stone-500">
                  {target.leaveTypeName} · {new Date(target.dateFrom).toLocaleDateString("id-ID")} {SESSION_LABEL[target.sessionFrom]} → {new Date(target.dateTo).toLocaleDateString("id-ID")} {SESSION_LABEL[target.sessionTo]} · {fmtDay(target.workingDays)} hari kerja
                </p>
                <p className="mt-0.5 text-stone-400">Alasan: {target.reason}</p>
              </div>
              {action === "approve" && (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-2.5 text-[11px] leading-relaxed text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>Saat disetujui: saldo (g· terpakai mendatang) diperbarui, dan rekap absensi rentang cuti dihitung ulang menjadi <b>OnLeave</b> (dibayar bila jenis cuti dibayar).</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{action === "reject" ? "Alasan Penolakan *" : "Catatan Keputusan"}</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === "reject" ? "mis. Bentrok jadwal produksi — usulkan minggu berikutnya" : "Opsional"} className="min-h-16 text-xs" />
              </div>
              {action === "reject" && (
                <Badge variant="outline" className="border-rose-200 text-[10px] text-rose-600">Karyawan dapat mengajukan ulang dengan tanggal lain</Badge>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} className="text-xs font-bold">Batal</Button>
            <Button
              onClick={decide}
              disabled={busy}
              className={cn("gap-1.5 text-xs font-bold",
                action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700")}
            >
              {action === "approve" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {action === "approve" ? "Setujui" : action === "reject" ? "Tolak" : "Batalkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
