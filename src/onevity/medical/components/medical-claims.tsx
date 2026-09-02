"use client";
// OneVity Medical — Klaim Medis: daftar + dialog pengajuan multi-baris perawatan
// (padanan MedicalBenefitClaim.jsp + wizard ESS MyMedicalExpenseClaim.jsp).
import { Fragment, useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
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
  ClaimUI, ClaimPreviewUI, ClaimLineUI, BenefitTypeUI, EmployeeOption,
  CLAIM_STATUS_LABEL, fmtIDR, fmtDateID, fmtDateTimeID, todayISO,
} from "./medical-types";
import {
  FileText, Plus, Search, ChevronDown, ChevronRight, Trash2, Activity, Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Draft", label: "Draft" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Settled", label: "Settled" },
  { key: "Rejected", label: "Ditolak" },
];

interface LineForm {
  treatedName: string; treatment: string; treatmentDate: string;
  receiptNo: string; physician: string; hospital: string;
  occupationalInjury: boolean; billAmount: string; reimburseAmount: string; approvedAmount: string;
}

const newLine = (treatedName = ""): LineForm => ({
  treatedName: "", treatment: "", treatmentDate: todayISO(),
  receiptNo: "", physician: "", hospital: "",
  occupationalInjury: false, billAmount: "", reimburseAmount: "", approvedAmount: "",
});

export function MedicalClaimsPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);

  // form state
  const [employeeId, setEmployeeId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [claimDate, setClaimDate] = useState(todayISO());
  const [letterNo, setLetterNo] = useState("");
  const [forDependent, setForDependent] = useState(false);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineForm[]>([newLine()]);
  const [preview, setPreview] = useState<ClaimPreviewUI | null>(null);

  const api = useApi<{ claims: ClaimUI[]; stats: { total: number; submitted: number; approved: number; settled: number; settledAmount: number } }>(
    `/api/onevity/medical/claims?state=${statusFilter}`,
  );
  const detailApi = useApi<{ claims: ClaimUI[] }>(`/api/onevity/medical/claims?state=all&includeLines=1`, [statusFilter]);
  const master = useApi<{ types: BenefitTypeUI[] }>("/api/onevity/medical/types");
  const balanceMeta = useApi<{ employees: EmployeeOption[] }>("/api/onevity/medical/balances?year=" + new Date().getFullYear());

  const claims = useMemo(() => (api.data?.claims ?? []).filter((c) =>
    !query || c.fullName.toLowerCase().includes(query.toLowerCase()) || c.docNo.toLowerCase().includes(query.toLowerCase()),
  ), [api.data, query]);

  const employees = balanceMeta.data?.employees ?? [];
  const types = (master.data?.types ?? []).filter((t) => t.active);

  // pratinjau saldo (snapshot limit/used/remaining + frekuensi) saat employee+type
  // dipilih — forDependent ikut dihitung agar preview memakai POOL YANG BENAR
  // (fix K-3: SHARED → pool bersama karyawan; EACH/TOTAL → pool dependent).
  useEffect(() => {
    if (!dialog || !employeeId || !typeId) { setPreview(null); return; }
    const t = setTimeout(async () => {
      try {
        const res = await apiSend<{ preview: ClaimPreviewUI }>(
          `/api/onevity/medical/claims?preview=1&employeeId=${employeeId}&typeId=${typeId}&forDependent=${forDependent ? 1 : 0}`, "GET",
        );
        setPreview(res.preview);
      } catch {
        setPreview(null);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [dialog, employeeId, typeId, forDependent]);

  const totals = lines.reduce((acc, l) => ({
    bill: acc.bill + (Number(l.billAmount) || 0),
    re: acc.re + (Number(l.reimburseAmount) || 0),
    approved: acc.approved + (Number(l.approvedAmount) || 0),
  }), { bill: 0, re: 0, approved: 0 });

  const openDialog = () => {
    setEmployeeId(employees[0]?.id ?? "");
    setTypeId(types[0]?.id ?? "");
    setClaimDate(todayISO());
    setLetterNo(""); setForDependent(false); setNote("");
    setLines([newLine()]);
    setPreview(null);
    setDialog(true);
  };

  const setLine = (i: number, patch: Partial<LineForm>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const submit = async () => {
    const valid = lines.filter((l) => l.treatedName.trim() && Number(l.billAmount) > 0 && Number(l.approvedAmount) >= 0);
    if (!employeeId || !typeId) { toast.error("Pilih karyawan & jenis benefit"); return; }
    if (valid.length === 0) { toast.error("Minimal 1 baris perawatan lengkap (nama yang dirawat + tagihan)"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; totalApproved: number; remainingAfter: number }>("/api/onevity/medical/claims", "POST", {
        employeeId, typeId, claimDate, letterNo: letterNo || undefined,
        forDependent, note: note || undefined, submit: true,
        lines: valid.map((l) => ({
          treatedName: l.treatedName, treatment: l.treatment || undefined,
          treatmentDate: l.treatmentDate || undefined, receiptNo: l.receiptNo || undefined,
          physician: l.physician || undefined, hospital: l.hospital || undefined,
          occupationalInjury: l.occupationalInjury,
          billAmount: Number(l.billAmount) || 0,
          reimburseAmount: Number(l.reimburseAmount) || 0,
          approvedAmount: Number(l.approvedAmount) || 0,
        })),
      });
      toast.success(`Klaim ${res.docNo} diajukan — approved ${fmtIDR(res.totalApproved)} · sisa saldo ${fmtIDR(res.remainingAfter)}`);
      setDialog(false);
      api.refresh();
      detailApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengajukan klaim");
    } finally {
      setBusy(false);
    }
  };

  const detailOf = (id: string) => (detailApi.data?.claims ?? []).find((c) => c.id === id);

  return (
    <div>
      <PageHeader
        eyebrow="MEDICAL · TRANSAKSI"
        title="Klaim Medis"
        description="Pengajuan reimbursement perawatan karyawan & dependent — snapshot saldo, baris perawatan dengan kwitansi/dokter/rumah sakit, validasi frekuensi per jenis (padanan Medical Claim oranHR)"
        actions={(
          <Button onClick={openDialog} className="bg-rose-600 hover:bg-rose-700">
            <Plus className="h-4 w-4" /> Ajukan Klaim
          </Button>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
              statusFilter === f.key
                ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400",
            )}
          >
            {f.label}
            {f.key !== "all" && api.data?.stats && (
              <span className="ml-1 opacity-60">
                {f.key === "Draft" ? api.data.stats.total - api.data.stats.submitted - api.data.stats.approved - api.data.stats.settled : undefined}
              </span>
            )}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-stone-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama / no. dokumen…" className="pl-8" />
        </div>
      </div>

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : claims.length === 0 ? (
            <div className="p-6"><EmptyState title="Belum ada klaim medis" description="Ajukan klaim reimbursement perawatan pertama — pilih karyawan & jenis benefit." icon={FileText} /></div>
          ) : (
            <div className="max-h-[30rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>No. Dokumen</TableHead>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className="text-right">Tagihan</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.map((c) => {
                    const open = expanded === c.id;
                    const detail = open ? detailOf(c.id) : null;
                    return (
                      <Fragment key={c.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setExpanded(open ? null : c.id)}
                        >
                          <TableCell>
                            {open ? <ChevronDown className="h-4 w-4 text-stone-400" /> : <ChevronRight className="h-4 w-4 text-stone-400" />}
                          </TableCell>
                          <TableCell className="font-semibold text-stone-900 dark:text-stone-100">{c.docNo}</TableCell>
                          <TableCell>
                            <p className="font-medium">{c.fullName}</p>
                            <p className="text-xs text-stone-500">{c.employeeNo}{c.orgUnitName ? ` · ${c.orgUnitName}` : ""}</p>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">{c.typeName}</span>
                            {c.forDependent && <span className="ml-1 text-xs text-violet-600 dark:text-violet-400">(dependent)</span>}
                          </TableCell>
                          <TableCell className="text-sm">{fmtDateID(c.claimDate)}</TableCell>
                          <TableCell className="text-right">{fmtIDR(c.totalBill)}</TableCell>
                          <TableCell className="text-right font-semibold">{fmtIDR(c.totalApproved)}</TableCell>
                          <TableCell><StatusPill status={c.state} /></TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-stone-50/70 dark:bg-stone-900/60 hover:bg-stone-50/70">
                            <TableCell colSpan={8} className="p-4">
                              {!detail ? (
                                <p className="text-sm text-stone-500">Memuat rincian…</p>
                              ) : (
                                <div className="space-y-4">
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                    <div className="rounded-lg bg-white p-3 dark:bg-stone-900">
                                      <p className="text-[11px] font-bold uppercase text-stone-400">Snapshot Limit</p>
                                      <p className="text-sm font-black">{fmtIDR(c.maxBenefitAt)}</p>
                                      <p className="text-xs text-stone-500">used saat ajukan: {fmtIDR(c.usedAt)}</p>
                                    </div>
                                    <div className="rounded-lg bg-white p-3 dark:bg-stone-900">
                                      <p className="text-[11px] font-bold uppercase text-stone-400">Total Reimbursement</p>
                                      <p className="text-sm font-black">{fmtIDR(c.totalReimburse)}</p>
                                    </div>
                                    <div className="rounded-lg bg-white p-3 dark:bg-stone-900">
                                      <p className="text-[11px] font-bold uppercase text-stone-400">Non Reimbursement</p>
                                      <p className="text-sm font-black">{fmtIDR(c.totalNonRe)}</p>
                                    </div>
                                    <div className="rounded-lg bg-white p-3 dark:bg-stone-900">
                                      <p className="text-[11px] font-bold uppercase text-stone-400">Settlement</p>
                                      <p className="text-sm font-black">{c.settleDate ? fmtDateID(c.settleDate) : "—"}</p>
                                      {c.journalNo && <p className="text-xs text-stone-500">jurnal {c.journalNo}</p>}
                                    </div>
                                  </div>

                                  <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Yang Dirawat</TableHead>
                                          <TableHead>Perawatan</TableHead>
                                          <TableHead>Tanggal</TableHead>
                                          <TableHead>Dokter / RS</TableHead>
                                          <TableHead className="text-right">Tagihan</TableHead>
                                          <TableHead className="text-right">Approved</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {(detail.lines ?? []).map((l: ClaimLineUI, i: number) => (
                                          <TableRow key={i}>
                                            <TableCell>
                                              <p className="font-medium">{l.treatedName}</p>
                                              {l.occupationalInjury && <span className="text-xs font-semibold text-rose-600">CK / PJK</span>}
                                            </TableCell>
                                            <TableCell className="text-sm">{l.treatment ?? "—"}</TableCell>
                                            <TableCell className="text-sm">{fmtDateID(l.treatmentDate)}</TableCell>
                                            <TableCell className="text-sm">
                                              {l.physician || l.hospital ? `${l.physician ?? ""}${l.hospital ? ` · ${l.hospital}` : ""}` : "—"}
                                              {l.receiptNo && <span className="block text-xs text-stone-500">kwitansi {l.receiptNo}</span>}
                                            </TableCell>
                                            <TableCell className="text-right">{fmtIDR(l.billAmount)}</TableCell>
                                            <TableCell className="text-right font-semibold">{fmtIDR(l.approvedAmount)}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>

                                  {detail.statusLog?.length > 0 && (
                                    <div className="rounded-lg bg-white p-3 dark:bg-stone-900">
                                      <p className="mb-1.5 text-[11px] font-bold uppercase text-stone-400">Status Log (padanan oranHR)</p>
                                      <div className="space-y-1">
                                        {detail.statusLog.map((sl, i) => (
                                          <p key={i} className="text-xs text-stone-600 dark:text-stone-400">
                                            <span className="font-semibold">{CLAIM_STATUS_LABEL[sl.state] ?? sl.state}</span>
                                            {" · "}{fmtDateTimeID(sl.at)}{sl.note ? ` · ${sl.note}` : ""}
                                          </p>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ==== dialog klaim ==== */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-rose-600" /> Ajukan Klaim Medis
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
              <Label>Tanggal Klaim *</Label>
              <Input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>No. Surat Rujukan</Label>
              <Input value={letterNo} onChange={(e) => setLetterNo(e.target.value)} placeholder="opsional" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={forDependent} onCheckedChange={(v) => setForDependent(Boolean(v))} />
              Klaim untuk anggota keluarga (dependent)
            </label>
          </div>

          {preview && (
            <div className="grid gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950/30 sm:grid-cols-4">
              <div>
                <p className="text-[11px] font-bold uppercase text-rose-500">Limit</p>
                <p className="font-black">{preview.limitRule === "UNLIMITED" ? "Unlimited" : fmtIDR(preview.benefitAmount)}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase text-rose-500">Sudah Terpakai</p>
                <p className="font-black">{fmtIDR(preview.usedAmount)}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase text-rose-500">
                  Sisa Saldo{preview.claimPool === "dependent" ? " (Dependent)" : forDependent && preview.claimPool === "employee" ? " (Bersama)" : ""}
                </p>
                <p className="font-black">{preview.limitRule === "UNLIMITED" ? "∞" : fmtIDR(preview.remainingForClaim ?? preview.remaining)}</p>
                {preview.poolNote && <p className="text-xs text-stone-500">{preview.poolNote}</p>}
                {(preview.pendingReserved ?? 0) > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">menunggu klaim lain: {fmtIDR(preview.pendingReserved ?? 0)}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase text-rose-500">Frekuensi</p>
                <p className="font-black">
                  {preview.freqUnlimited ? "Unlimited" : `${preview.freqValue}× / ${preview.freqPeriod}`}
                </p>
                <p className="text-xs text-stone-500">{preview.claimCountYear} klaim tahun ini</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-bold">Baris Perawatan</Label>
              <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
                <Plus className="h-3.5 w-3.5" /> Baris
              </Button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Nama yang Dirawat *</Label>
                      <Input value={l.treatedName} onChange={(e) => setLine(i, { treatedName: e.target.value })} placeholder="karyawan / anggota keluarga" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Perawatan / Diagnosa</Label>
                      <Input value={l.treatment} onChange={(e) => setLine(i, { treatment: e.target.value })} placeholder="mis. konsultasi, scaling, rawat inap 2 hari" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Tanggal Perawatan</Label>
                      <Input type="date" value={l.treatmentDate} onChange={(e) => setLine(i, { treatmentDate: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">No. Kwitansi {preview?.needReceipt ? "*" : ""}</Label>
                      <Input value={l.receiptNo} onChange={(e) => setLine(i, { receiptNo: e.target.value })} placeholder="mis. INV-2026-0042" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Dokter</Label>
                      <Input value={l.physician} onChange={(e) => setLine(i, { physician: e.target.value })} placeholder="dr. …" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Rumah Sakit / Klinik</Label>
                      <Input value={l.hospital} onChange={(e) => setLine(i, { hospital: e.target.value })} placeholder="mis. RS Siloam Surabaya" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Tagihan (Bill) *</Label>
                      <Input type="number" min={0} value={l.billAmount} onChange={(e) => {
                        const bill = e.target.value;
                        setLine(i, { billAmount: bill, approvedAmount: l.approvedAmount || bill });
                      }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Approved *</Label>
                      <Input type="number" min={0} value={l.approvedAmount} onChange={(e) => setLine(i, { approvedAmount: e.target.value, reimburseAmount: l.reimburseAmount || e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Reimbursement</Label>
                      <Input type="number" min={0} value={l.reimburseAmount} onChange={(e) => setLine(i, { reimburseAmount: e.target.value })} />
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox checked={l.occupationalInjury} onCheckedChange={(v) => setLine(i, { occupationalInjury: Boolean(v) })} />
                        Kecelakaan/Penyakit Kerja (CK)
                      </label>
                      <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                        <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-stone-50 p-3 text-sm dark:bg-stone-800/60">
            <span className="flex items-center gap-1.5 font-semibold"><Calculator className="h-4 w-4 text-rose-600" /> Total</span>
            <span className="text-stone-600 dark:text-stone-300">Tagihan <span className="font-black">{fmtIDR(totals.bill)}</span></span>
            <span className="text-stone-600 dark:text-stone-300">Reimburse <span className="font-black">{fmtIDR(totals.re)}</span></span>
            <span className="text-rose-700 dark:text-rose-400">Approved <span className="font-black">{fmtIDR(totals.approved)}</span></span>
          </div>

          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan pengajuan (opsional)…" rows={2} />

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
            <Button onClick={submit} disabled={busy} className="bg-rose-600 hover:bg-rose-700">
              {busy ? "Mengirim…" : "Ajukan Klaim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
