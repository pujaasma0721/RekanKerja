"use client";
// OneVity Travel — Klaim & Settlement: buat klaim dari request Approved dengan
// rincian biaya per jenis (padanan 4 tab oranHR: General/Allowance/Mileage/
// Entertainment+Guest) + formula (a)+(b)-(c) live.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/lib/onevity/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  TravelClaimRowUI, TravelRequestRowUI, ExpenseTypeRowUI, EmployeeOption,
  TRAVEL_STATUS_LABEL, EXPENSE_KIND_LABEL, fmtIDR, fmtIDRShort, fmtDateID,
} from "./travel-types";
import {
  FileText, Plus, Search, Calculator, Wallet, ChevronDown, ChevronRight,
  Landmark, AlertTriangle, Trash2, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Transferred", label: "Ditransfer" },
  { key: "Paid", label: "Dibayar" },
  { key: "Rejected", label: "Ditolak" },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

interface ExpenseLine {
  expenseCode: string; expenseDate: string; description: string;
  amount: string; qty: string; guestName: string;
}

interface ClaimPreviewData {
  requestId: string; docNo: string | null;
  employee: { id: string; employeeNo: string; fullName: string };
  templateCode: string; templateName: string; settlementMethod: string;
  costCenter: string | null; purpose: string | null;
  advanceAmount: number;
  destinations: { city: string; country: string; dateFrom: string; dateTo: string; overseas: boolean }[];
}

const newLine = (defaultCode: string): ExpenseLine => ({
  expenseCode: "", expenseDate: todayISO(), description: "", amount: "", qty: "1", guestName: "",
});

export function TravelClaimsPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"request" | "standalone">("request");
  const [requestId, setRequestId] = useState("");
  const [previewData, setPreviewData] = useState<ClaimPreviewData | null>(null);
  const [lines, setLines] = useState<ExpenseLine[]>([newLine("")]);
  const [amounts, setAmounts] = useState({ otherCompanyExp: "", exchangeLoss: "", payableEmployee: "", payableCompany: "", voucherNo: "", remark: "" });

  const api = useApi<{ claims: TravelClaimRowUI[]; stats: { total: number; submitted: number; approved: number; transferred: number; paid: number; totalSettlement: number; payableEmployee: number; payableCompany: number } }>(
    `/api/onevity/travel/claims?status=${statusFilter}`,
  );
  const detailApi = useApi<{ claims: TravelClaimRowUI[] }>(`/api/onevity/travel/claims?status=all`);
  const approvedRequests = useApi<{ requests: TravelRequestRowUI[] }>("/api/onevity/travel/requests?status=Approved");
  const master = useApi<{ expenseTypes: ExpenseTypeRowUI[]; employees: EmployeeOption[] }>("/api/onevity/travel/templates");

  const claims = useMemo(() => (api.data?.claims ?? []).filter((c) =>
    !query || c.fullName.toLowerCase().includes(query.toLowerCase()) || c.docNo.toLowerCase().includes(query.toLowerCase()),
  ), [api.data, query]);

  const expenseTypes = master.data?.expenseTypes ?? [];
  const typeByCode = useMemo(() => new Map(expenseTypes.map((t) => [t.code, t])), [expenseTypes]);

  // pratinjau otomatis saat request dipilih (padanan LOV Travel Request oranHR)
  useEffect(() => {
    if (!dialog || mode !== "request" || !requestId) { setPreviewData(null); return; }
    (async () => {
      try {
        const res = await apiSend<ClaimPreviewData>(`/api/onevity/travel/claims?requestId=${requestId}`, "GET");
        setPreviewData(res);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal memuat pratinjau klaim");
      }
    })();
  }, [dialog, mode, requestId]);

  // hitung saran (b)/(c) dari total rincian + uang muka (padanan Expense Summary oranHR)
  const totalExpenses = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const advance = previewData?.advanceAmount ?? 0;
  const grossRealisasi = totalExpenses + (Number(amounts.otherCompanyExp) || 0) + (Number(amounts.exchangeLoss) || 0);
  const suggestedB = Math.max(0, grossRealisasi - advance);
  const suggestedC = Math.max(0, advance - grossRealisasi);
  const totalFormula =
    (Number(amounts.otherCompanyExp) || 0) + (Number(amounts.exchangeLoss) || 0) +
    (Number(amounts.payableEmployee) || 0) - (Number(amounts.payableCompany) || 0);

  const openDialog = (m: "request" | "standalone") => {
    setMode(m);
    setRequestId(m === "request" ? (approvedRequests.data?.requests ?? [])[0]?.id ?? "" : "");
    setPreviewData(null);
    setLines([newLine("")]);
    setAmounts({ otherCompanyExp: "", exchangeLoss: "", payableEmployee: "", payableCompany: "", voucherNo: "", remark: "" });
    setDialog(true);
  };

  const submit = async () => {
    const validLines = lines.filter((l) => l.expenseCode && Number(l.amount) > 0);
    if (validLines.length === 0) { toast.error("Minimal 1 baris biaya dengan jenis & nominal terisi"); return; }
    if (mode === "request" && !requestId) { toast.error("Pilih permintaan travel Approved sebagai dasar klaim"); return; }
    if (mode === "standalone" && !master.data?.employees?.length) { toast.error("Data karyawan belum tersedia"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; totalSettlement: number; totalExpenses: number; overLimitLines: number }>(
        "/api/onevity/travel/claims", "POST",
        {
          requestId: mode === "request" ? requestId : undefined,
          employeeId: mode === "request" ? previewData?.employee.id : (master.data?.employees ?? [])[0]?.id,
          templateCode: mode === "request" ? previewData?.templateCode : "TRAVEL",
          voucherNo: amounts.voucherNo || undefined,
          remark: amounts.remark || undefined,
          expenses: validLines.map((l) => ({
            expenseCode: l.expenseCode,
            expenseDate: l.expenseDate || undefined,
            description: l.description || undefined,
            amount: Number(l.amount),
            qty: Number(l.qty) || 1,
            guestName: l.guestName || undefined,
          })),
          otherCompanyExp: Number(amounts.otherCompanyExp) || 0,
          exchangeLoss: Number(amounts.exchangeLoss) || 0,
          payableEmployee: Number(amounts.payableEmployee) || 0,
          payableCompany: Number(amounts.payableCompany) || 0,
        },
      );
      toast.success(
        `${res.docNo} diajukan — total settlement ${fmtIDR(res.totalSettlement)}${res.overLimitLines > 0 ? ` (${res.overLimitLines} baris lewat limit — perlu perhatian approver)` : ""}`,
      );
      setDialog(false);
      api.refresh();
      detailApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat klaim");
    } finally { setBusy(false); }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL TRAVEL"
        title="Klaim & Settlement Perjalanan"
        description="Rincian biaya per jenis (General / Allowance / Mileage / Entertainment + tamu) dengan formula oranHR Total = (a)+(b)−(c) — uang muka otomatis dikurangkan"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openDialog("request")} className="gap-2 bg-orange-600 font-bold hover:bg-orange-700">
              <Plus className="h-4 w-4" /> Klaim dari Permintaan
            </Button>
            <Button variant="outline" onClick={() => openDialog("standalone")} className="gap-2 font-bold">
              <FileText className="h-4 w-4" /> Klaim Mandiri
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
              statusFilter === f.key
                ? "bg-orange-600 text-white shadow-sm"
                : "bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800",
            )}
          >
            {f.label}
            {f.key === "all" && stats ? ` (${stats.total})` : ""}
            {f.key === "Submitted" && stats ? ` (${stats.submitted})` : ""}
            {f.key === "Approved" && stats ? ` (${stats.approved})` : ""}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama / nomor klaim…" className="w-56 pl-9 text-sm" />
        </div>
      </div>

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <LoadingRows rows={6} />
          ) : claims.length === 0 ? (
            <EmptyState icon={FileText} title="Belum ada klaim" description="Buat klaim settlement dari permintaan Approved atau klaim mandiri." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-stone-50 dark:hover:bg-stone-800/60">
                    <TableHead className="w-8" />
                    <TableHead>Nomor</TableHead>
                    <TableHead>Karyawan</TableHead>
                    <TableHead className="hidden md:table-cell">Basis</TableHead>
                    <TableHead className="text-right">(a)+(b)−(c)</TableHead>
                    <TableHead className="hidden lg:table-cell">Jurnal</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.map((c) => (
                    <Fragment key={c.id}>
                      <TableRow key={c.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/60" onClick={() => setExpanded(expanded === c.docNo ? null : c.docNo)}>
                        <TableCell className="p-2">
                          {expanded === c.docNo ? <ChevronDown className="h-4 w-4 text-stone-400" /> : <ChevronRight className="h-4 w-4 text-stone-400" />}
                        </TableCell>
                        <TableCell>
                          <p className="font-mono text-xs font-bold text-orange-700 dark:text-orange-400">{c.docNo}</p>
                          <p className="text-[11px] text-stone-500">{fmtDateID(c.claimDate)}{c.voucherNo ? ` · ${c.voucherNo}` : ""}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{c.fullName}</p>
                          <p className="text-[11px] text-stone-500">{c.employeeNo}{c.costCenter ? ` · CC ${c.costCenter}` : ""}</p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {c.requestDocNo ? (
                            <Badge variant="outline" className="font-mono text-[10px] font-bold">{c.requestDocNo}</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] font-bold">Mandiri</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <p className={cn("text-sm font-black", c.totalSettlement < 0 ? "text-rose-600" : "text-stone-900 dark:text-stone-100")}>
                            {fmtIDRShort(c.totalSettlement)}
                          </p>
                          <p className="text-[11px] text-stone-500">
                            {c.expenseLines} baris · {c.advanceAmount > 0 ? `muka ${fmtIDRShort(c.advanceAmount)}` : "tanpa muka"}
                          </p>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {c.journalNo ? (
                            <span className="flex items-center gap-1 font-mono text-[11px] font-bold text-teal-700 dark:text-teal-400">
                              <Landmark className="h-3 w-3" /> {c.journalNo}
                            </span>
                          ) : (
                            <span className="text-[11px] text-stone-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={TRAVEL_STATUS_LABEL[c.status] ?? c.status} />
                          {c.overLimitLines > 0 && (
                            <Badge className="ml-1 bg-amber-100 text-[9px] font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">LEBIH LIMIT</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === c.docNo && (
                        <TableRow key={`${c.id}-d`} className="bg-stone-50/60 dark:bg-stone-800/30">
                          <TableCell colSpan={7} className="px-6 py-3">
                            <div className="grid gap-3 lg:grid-cols-3">
                              <div className="lg:col-span-2">
                                <p className="mb-1 text-xs font-black uppercase tracking-wide text-stone-500">Formula Settlement (oranHR)</p>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                                  <div className="rounded-lg bg-white px-3 py-2 dark:bg-stone-900">
                                    <p className="text-[10px] font-bold text-stone-500">(a) Pihak lain</p>
                                    <p className="text-sm font-black text-stone-800 dark:text-stone-200">{fmtIDR(c.otherCompanyExp)}</p>
                                  </div>
                                  <div className="rounded-lg bg-white px-3 py-2 dark:bg-stone-900">
                                    <p className="text-[10px] font-bold text-stone-500">(a) Rugi kurs</p>
                                    <p className="text-sm font-black text-stone-800 dark:text-stone-200">{fmtIDR(c.exchangeLoss)}</p>
                                  </div>
                                  <div className="rounded-lg bg-white px-3 py-2 dark:bg-stone-900">
                                    <p className="text-[10px] font-bold text-stone-500">(b) Ke karyawan</p>
                                    <p className="text-sm font-black text-teal-700 dark:text-teal-400">{fmtIDR(c.payableEmployee)}</p>
                                  </div>
                                  <div className="rounded-lg bg-white px-3 py-2 dark:bg-stone-900">
                                    <p className="text-[10px] font-bold text-stone-500">(c) Ke perusahaan</p>
                                    <p className="text-sm font-black text-rose-700 dark:text-rose-400">{fmtIDR(c.payableCompany)}</p>
                                  </div>
                                  <div className="rounded-lg border-2 border-orange-200 bg-orange-50 px-3 py-2 dark:border-orange-800 dark:bg-orange-950/40">
                                    <p className="text-[10px] font-bold text-orange-700 dark:text-orange-400">TOTAL</p>
                                    <p className="text-sm font-black text-orange-700 dark:text-orange-400">{fmtIDR(c.totalSettlement)}</p>
                                  </div>
                                </div>
                                {c.remark && <p className="mt-2 text-[11px] text-stone-500">{c.remark}</p>}
                                {c.status === "Paid" && c.paidRunNo && (
                                  <p className="mt-2 flex items-center gap-1 rounded-lg bg-teal-50 px-3 py-1.5 text-[11px] font-bold text-teal-700 dark:bg-teal-950/30 dark:text-teal-400">
                                    <Landmark className="h-3 w-3" /> Dibayar via payroll run {c.paidRunNo} (period {c.periodCode})
                                  </p>
                                )}
                                {c.status === "Transferred" && (
                                  <p className="mt-2 flex items-center gap-1 rounded-lg bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                    <Landmark className="h-3 w-3" /> Menunggu run payroll period {c.periodCode} dikonfirmasi → Dibayar
                                  </p>
                                )}
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-black uppercase tracking-wide text-stone-500">Jenis Biaya</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {c.expenseKinds.map((k) => (
                                    <Badge key={k} variant="outline" className="text-[10px] font-bold">{EXPENSE_KIND_LABEL[k] ?? k}</Badge>
                                  ))}
                                  <span className="text-[11px] text-stone-500">total biaya {fmtIDR(c.totalExpenses)}</span>
                                </div>
                                {c.decisionNote && (
                                  <p className="mt-2 rounded-lg bg-white px-3 py-2 text-[11px] text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                                    {c.decisionNote}
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-orange-600" /> Klaim Settlement
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {mode === "request" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Permintaan Travel (Approved) *</Label>
                <Select value={requestId} onValueChange={setRequestId}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Pilih permintaan" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(approvedRequests.data?.requests ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id} className="text-sm">
                        {r.docNo} — {r.fullName} ({r.destinations.map((d) => d.city).join(" → ")})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {previewData && (
              <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-3 text-xs dark:border-orange-800 dark:bg-orange-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-[11px] font-bold text-orange-700 dark:text-orange-400">{previewData.docNo} — {previewData.employee.fullName}</p>
                    <p className="mt-0.5 text-stone-600 dark:text-stone-300">{previewData.destinations.map((d) => d.city).join(" → ")} · {previewData.templateName}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-amber-700 dark:text-amber-400">Uang muka: {fmtIDR(previewData.advanceAmount)}</p>
                    {previewData.costCenter && <p className="text-[11px] text-stone-500">CC {previewData.costCenter}</p>}
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-stone-500">{previewData.purpose}</p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">Rincian Biaya *</Label>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => setLines([...lines, newLine("")])}>
                  <Plus className="h-3 w-3" /> Tambah Baris
                </Button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const t = l.expenseCode ? typeByCode.get(l.expenseCode) : undefined;
                  const overLimit = t && !t.unlimited && t.limitAmount > 0 && (Number(l.amount) || 0) > t.limitAmount;
                  return (
                    <div key={i} className="rounded-xl border border-stone-200 bg-stone-50/50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-stone-500">Baris {i + 1}</span>
                        {lines.length > 1 && (
                          <button className="flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700" onClick={() => setLines(lines.filter((_, x) => x !== i))}>
                            <Trash2 className="h-3 w-3" /> Hapus
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-stone-500">Jenis biaya *</Label>
                          <Select value={l.expenseCode} onValueChange={(v) => setLines(lines.map((x, xi) => xi === i ? { ...x, expenseCode: v } : x))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih jenis" /></SelectTrigger>
                            <SelectContent className="max-h-56">
                              {expenseTypes.map((t2) => (
                                <SelectItem key={t2.id} value={t2.code} className="text-xs">
                                  {t2.code} — {t2.name} ({EXPENSE_KIND_LABEL[t2.kind] ?? t2.kind})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-stone-500">Tanggal</Label>
                          <Input type="date" value={l.expenseDate} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, expenseDate: e.target.value } : x))} className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-stone-500">Nominal (Rp) *</Label>
                          <Input type="number" min="0" value={l.amount} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))} placeholder="0" className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-stone-500">
                            {t?.kind === "MILEAGE" ? "Km / unit" : t?.kind === "ALLOWANCE" ? "Jumlah hari" : "Qty"}
                          </Label>
                          <Input type="number" min="0" value={l.qty} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, qty: e.target.value } : x))} className="h-8 text-sm" />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-[10px] font-bold text-stone-500">Keterangan</Label>
                          <Input value={l.description} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x))} placeholder="Mis. Hotel 2 malam" className="h-8 text-sm" />
                        </div>
                        {t?.kind === "ENTERTAINMENT" && (
                          <div className="col-span-2 space-y-1">
                            <Label className="flex items-center gap-1 text-[10px] font-bold text-stone-500">
                              <Users className="h-3 w-3" /> Tamu / Relasi (Entertainment Guest)
                            </Label>
                            <Input value={l.guestName} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, guestName: e.target.value } : x))} placeholder="Mis. Direktur PT Sinar Abadi + 3" className="h-8 text-sm" />
                          </div>
                        )}
                      </div>
                      {t && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                          <Badge variant="outline" className="text-[9px] font-bold">{EXPENSE_KIND_LABEL[t.kind] ?? t.kind}</Badge>
                          {t.needDocs && <Badge variant="secondary" className="text-[9px] font-bold">Perlu dokumen</Badge>}
                          {t.limitAmount > 0 && !t.unlimited && (
                            <span className={cn("font-semibold", overLimit ? "text-rose-600" : "text-stone-500")}>
                              {overLimit ? <><AlertTriangle className="mr-1 inline h-3 w-3" />Melebihi limit {fmtIDR(t.limitAmount)} — tetap bisa diajukan (warning)</> : `Limit ${fmtIDR(t.limitAmount)}`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-stone-100 px-3 py-2 text-xs font-bold dark:bg-stone-800">
                <span className="text-stone-600 dark:text-stone-300">Total rincian biaya</span>
                <span className="text-stone-900 dark:text-stone-100">{fmtIDR(totalExpenses)}</span>
              </div>
            </div>

            <div className="rounded-xl border-2 border-orange-200 bg-orange-50/40 p-3 dark:border-orange-800 dark:bg-orange-950/20">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-black text-orange-700 dark:text-orange-400">
                <Calculator className="h-3.5 w-3.5" /> Formula Settlement oranHR — Total = (a) + (b) − (c)
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-stone-500">(a) Biaya pihak lain</Label>
                  <Input type="number" min="0" value={amounts.otherCompanyExp} onChange={(e) => setAmounts({ ...amounts, otherCompanyExp: e.target.value })} placeholder="0" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-stone-500">(a) Rugi kurs</Label>
                  <Input type="number" min="0" value={amounts.exchangeLoss} onChange={(e) => setAmounts({ ...amounts, exchangeLoss: e.target.value })} placeholder="0" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-teal-700 dark:text-teal-400">(b) Dibayar ke karyawan</Label>
                  <Input
                    type="number" min="0" value={amounts.payableEmployee}
                    onChange={(e) => setAmounts({ ...amounts, payableEmployee: e.target.value })}
                    placeholder={String(suggestedB)} className="h-8 text-sm font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-rose-700 dark:text-rose-400">(c) Kembali ke perusahaan</Label>
                  <Input
                    type="number" min="0" value={amounts.payableCompany}
                    onChange={(e) => setAmounts({ ...amounts, payableCompany: e.target.value })}
                    placeholder={String(suggestedC)} className="h-8 text-sm font-bold"
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
                  {advance > 0 && <span className="font-bold text-amber-700 dark:text-amber-400"><Wallet className="mr-1 inline h-3 w-3" />Uang muka {fmtIDR(advance)} — saran (b) {fmtIDR(suggestedB)} / (c) {fmtIDR(suggestedC)}</span>}
                  <span>Total rincian + (a) = {fmtIDR(grossRealisasi)}</span>
                </div>
                <span className="rounded-lg border-2 border-orange-300 bg-white px-3 py-1 font-black text-orange-700 dark:border-orange-700 dark:bg-stone-900 dark:text-orange-400">
                  Total = {fmtIDR(totalFormula)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-bold">No. Voucher</Label>
                <Input value={amounts.voucherNo} onChange={(e) => setAmounts({ ...amounts, voucherNo: e.target.value })} placeholder="V-2609-001" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">Catatan</Label>
                <Input value={amounts.remark} onChange={(e) => setAmounts({ ...amounts, remark: e.target.value })} placeholder="Kwitansi terlampir" className="h-8 text-sm" />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog(false)} className="font-bold">Batal</Button>
            <Button onClick={submit} disabled={busy} className="gap-2 bg-orange-600 font-bold hover:bg-orange-700">
              <FileText className="h-4 w-4" /> {busy ? "Menyimpan…" : "Ajukan Klaim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
