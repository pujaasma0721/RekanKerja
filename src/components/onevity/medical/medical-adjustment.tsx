"use client";
// OneVity Medical — Penyesuaian Saldo: ± employee/dependent amount dengan approval
// (padanan MedicalBenefitAdjustment.jsp + MedicalBenefitAdjustmentToApprove.jsp).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/lib/onevity/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  AdjustmentUI, BenefitTypeUI, EmployeeOption, fmtIDR, fmtDateID, todayISO,
} from "./medical-types";
import { Activity, Plus, XCircle, Ban, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const STATE_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Rejected", label: "Ditolak" },
];

export function MedicalAdjustmentPage() {
  const currentYear = new Date().getFullYear();
  const [stateFilter, setStateFilter] = useState("all");
  const [dialog, setDialog] = useState(false);
  const [decideDialog, setDecideDialog] = useState<{ adj: AdjustmentUI; action: "approve" | "reject" | "cancel" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // form
  const [employeeId, setEmployeeId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [year, setYear] = useState(String(currentYear));
  const [forDependent, setForDependent] = useState(false);
  const [amount, setAmount] = useState("");
  const [adjustmentDate, setAdjustmentDate] = useState(todayISO());
  const [note, setNote] = useState("");

  const api = useApi<{ adjustments: AdjustmentUI[]; employees: EmployeeOption[]; stats: { total: number; submitted: number; approved: number } }>(
    `/api/onevity/medical/adjustments?state=${stateFilter}`,
  );
  const master = useApi<{ types: BenefitTypeUI[] }>("/api/onevity/medical/types");

  const adjustments = api.data?.adjustments ?? [];
  const employees = api.data?.employees ?? [];
  const types = (master.data?.types ?? []).filter((t) => t.active);

  const stats = useMemo(() => {
    const all = api.data?.stats;
    const approvedAmount = adjustments.filter((a) => a.state === "Approved").reduce((s, a) => s + a.amount, 0);
    return { all, approvedAmount };
  }, [api.data, adjustments]);

  const openDialog = () => {
    setEmployeeId(employees[0]?.id ?? "");
    setTypeId(types[0]?.id ?? "");
    setYear(String(currentYear));
    setForDependent(false);
    setAmount("");
    setAdjustmentDate(todayISO());
    setNote("");
    setDialog(true);
  };

  const submit = async () => {
    const amt = Number(amount);
    if (!employeeId || !typeId) { toast.error("Pilih karyawan & jenis"); return; }
    if (!Number.isFinite(amt) || amt === 0) { toast.error("Jumlah harus ≠ 0 (boleh negatif)"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string }>("/api/onevity/medical/adjustments", "POST", {
        employeeId, typeId, year: Number(year), forDependent,
        amount: amt, adjustmentDate, note: note || undefined,
      });
      toast.success(`Penyesuaian ${res.docNo} diajukan — menunggu approval`);
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengajukan penyesuaian");
    } finally {
      setBusy(false);
    }
  };

  const decide = async () => {
    if (!decideDialog) return;
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; state: string }>("/api/onevity/medical/adjustments", "PATCH", {
        id: decideDialog.adj.id, action: decideDialog.action, note: reason || undefined,
      });
      toast.success(`${res.docNo} → ${res.state}`);
      setDecideDialog(null);
      setReason("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="MEDICAL · PENYESUAIAN"
        title="Penyesuaian Saldo Medis"
        description="Tambah/kurangi benefit limit karyawan atau dependent (± amount) dengan alur persetujuan — padanan Medical Adjustment + Medical Adjustment Approval oranHR"
        actions={(
          <Button onClick={openDialog} className="bg-rose-600 hover:bg-rose-700">
            <Plus className="h-4 w-4" /> Ajukan Penyesuaian
          </Button>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {STATE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStateFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
              stateFilter === f.key
                ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Menunggu Approval</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{stats.all?.submitted ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Total Disetujui</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{stats.all?.approved ?? 0}</p>
            <p className="mt-1 text-xs text-stone-500">net {fmtIDR(stats.approvedAmount)}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Efek</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
              <TrendingUp className="h-4 w-4 text-emerald-600" /> Approve → saldo ± langsung
            </p>
            <p className="mt-1 text-xs text-stone-500">employee / dependent terpisah</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-bold">
            <Activity className="h-4 w-4 text-rose-600" /> Riwayat Penyesuaian
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : adjustments.length === 0 ? (
            <div className="p-6"><EmptyState title="Belum ada penyesuaian" description="Ajukan penyesuaian saldo ± untuk karyawan tertentu." icon={Activity} /></div>
          ) : (
            <div className="max-h-[26rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                  <TableRow>
                    <TableHead>No. Dokumen</TableHead>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Untuk</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adjustments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-semibold">{a.docNo}</TableCell>
                      <TableCell>
                        <p className="font-medium">{a.fullName}</p>
                        <p className="text-xs text-stone-500">{a.employeeNo}</p>
                      </TableCell>
                      <TableCell>{a.typeName}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", a.forDependent
                          ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400"
                          : "bg-stone-100 text-stone-600 dark:bg-stone-500/15 dark:text-stone-400")}>
                          {a.forDependent ? "Dependent" : "Karyawan"}
                        </span>
                      </TableCell>
                      <TableCell className={cn("text-right font-bold", a.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                        {a.amount > 0 ? "+" : ""}{fmtIDR(a.amount)}
                      </TableCell>
                      <TableCell className="text-sm">{fmtDateID(a.adjustmentDate)}</TableCell>
                      <TableCell><StatusPill status={a.state} /></TableCell>
                      <TableCell>
                        {a.state === "Submitted" && (
                          <div className="flex gap-1">
                            <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" onClick={() => { setDecideDialog({ adj: a, action: "approve" }); setReason(""); }}>
                              <XCircle className="mr-0.5 h-3 w-3 rotate-45" /> Setujui
                            </Button>
                            <Button size="sm" variant="outline" className="h-7" onClick={() => { setDecideDialog({ adj: a, action: "reject" }); setReason(""); }}>
                              Tolak
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* dialog ajukan */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-rose-600" /> Ajukan Penyesuaian Saldo
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Karyawan *</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Jenis Benefit *</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue placeholder="Pilih jenis" /></SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tahun Saldo *</Label>
              <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Jumlah (±) *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="mis. 500000 atau -250000" />
            </div>
            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <Input type="date" value={adjustmentDate} onChange={(e) => setAdjustmentDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={forDependent} onCheckedChange={(v) => setForDependent(Boolean(v))} />
                Untuk dependent
              </label>
            </div>
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan / alasan penyesuaian…" rows={2} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
            <Button onClick={submit} disabled={busy} className="bg-rose-600 hover:bg-rose-700">
              {busy ? "Mengirim…" : "Ajukan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog keputusan */}
      <Dialog open={Boolean(decideDialog)} onOpenChange={(v) => !v && setDecideDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {decideDialog?.action === "approve" ? <XCircle className="h-5 w-5 rotate-45 text-emerald-600" /> : <Ban className="h-5 w-5 text-rose-600" />}
              {decideDialog?.action === "approve" ? "Setujui Penyesuaian" : "Tolak Penyesuaian"}
            </DialogTitle>
          </DialogHeader>
          {decideDialog && (
            <div className="space-y-3">
              <div className="rounded-xl bg-stone-50 p-3 text-sm dark:bg-stone-800/60">
                <p className="font-bold">{decideDialog.adj.docNo} — {decideDialog.adj.fullName}</p>
                <p className="text-stone-600 dark:text-stone-300">
                  {decideDialog.adj.typeName} · {decideDialog.adj.forDependent ? "dependent" : "karyawan"} · {fmtDateID(decideDialog.adj.adjustmentDate)}
                </p>
                <p className="text-sm font-black">
                  {decideDialog.adj.amount > 0 ? "+" : ""}{fmtIDR(decideDialog.adj.amount)}
                </p>
                {decideDialog.adj.note && <p className="text-xs text-stone-500">{decideDialog.adj.note}</p>}
              </div>
              {decideDialog.action === "approve" && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                  Approve akan langsung mengubah saldo: {decideDialog.adj.forDependent ? "depAdjustment" : "adjustmentAmount"} {decideDialog.adj.amount > 0 ? "bertambah" : "berkurang"} {fmtIDR(Math.abs(decideDialog.adj.amount))}.
                </p>
              )}
              <div className="space-y-1.5">
                <Label>Alasan</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecideDialog(null)}>Batal</Button>
            <Button onClick={decide} disabled={busy} className={decideDialog?.action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}>
              {busy ? "Memproses…" : decideDialog?.action === "approve" ? "Setujui" : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
