"use client";
// OneVity Travel — Klaim & Settlement: buat klaim dari request Approved dengan
// rincian biaya per jenis (padanan 4 tab: General/Allowance/Mileage/
// Entertainment+Guest) + formula Total = rincian + rugi kurs − (a) live.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useApi, apiSend, apiUpload } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import {
  AttachmentUploadArea, AttachmentChips, AttachmentCountBadge,
} from "@/onevity/shared/components/attachment-upload";
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
  TRAVEL_STATUS_LABEL, TRAVEL_STATUS_LABEL_EN, EXPENSE_KIND_LABEL, fmtIDR, fmtIDRShort, fmtDateID,
} from "./travel-types";
import {
  FileText, Plus, Search, Calculator, Wallet, ChevronDown, ChevronRight,
  Landmark, AlertTriangle, Trash2, Users, Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Transferred", label: "Ditransfer" },
  { key: "Paid", label: "Dibayar" },
  { key: "Rejected", label: "Ditolak" },
];

// Peta EN paralel STATUS_FILTERS (render: t(f.label, STATUS_FILTERS_EN[f.key])).
const STATUS_FILTERS_EN: Record<string, string> = {
  all: "All",
  Submitted: "Pending",
  Approved: "Approved",
  Transferred: "Transferred",
  Paid: "Paid",
  Rejected: "Rejected",
};

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
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"request" | "standalone">("request");
  const [requestId, setRequestId] = useState("");
  const [previewData, setPreviewData] = useState<ClaimPreviewData | null>(null);
  const [lines, setLines] = useState<ExpenseLine[]>([newLine("")]);
  const [amounts, setAmounts] = useState({ otherCompanyExp: "", exchangeLoss: "", voucherNo: "", remark: "" });
  // T16-ATTACH — file kwitansi pra-submit (diunggah dgn entityId "draft:" saat
  // klaim diajukan → di-rebind server ke klaim baru).
  const [files, setFiles] = useState<File[]>([]);

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

  // K-2 (24-FIX-TRAVEL): dropdown hanya memuat permintaan Approved TANPA klaim aktif —
  // satu permintaan hanya boleh satu klaim aktif (server juga menolak / guard 400).
  const claimableRequests = useMemo(
    () => (approvedRequests.data?.requests ?? []).filter((r) => !r.hasActiveClaim),
    [approvedRequests.data],
  );

  // pratinjau otomatis saat request dipilih (padanan LOV Travel Request)
  useEffect(() => {
    if (!dialog || mode !== "request" || !requestId) { setPreviewData(null); return; }
    (async () => {
      try {
        const res = await apiSend<ClaimPreviewData>(`/api/onevity/travel/claims?requestId=${requestId}`, "GET");
        setPreviewData(res);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("Gagal memuat pratinjau klaim", "Failed to load claim preview"));
      }
    })();
  }, [dialog, mode, requestId]);

  // hitung (b)/(c) dari total rincian + uang muka (padanan Expense Summary) —
  // T3-TRAVEL: server menghitung ulang & memakai hasilnya (input klien diabaikan).
  // R = rincian + rugi kurs − (a); b = max(0, R − advance); c = max(0, advance − R).
  const totalExpenses = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const advance = previewData?.advanceAmount ?? 0;
  // T16-ATTACH — hint jenis biaya needDocs pada dialog (enforcement server).
  const needDocsHint = useMemo(() => {
    const names = [
      ...new Set(
        lines
          .filter((l) => l.expenseCode && Number(l.amount) > 0)
          .map((l) => typeByCode.get(l.expenseCode))
          .filter((et) => et?.needDocs)
          .map((et) => et!.name),
      ),
    ];
    return names.length > 0
      ? t("Jenis {x} mewajibkan lampiran kwitansi — unggah minimal 1 file", "Type {x} requires receipts — upload at least 1 file", { x: names.join(", ") })
      : undefined;
  }, [lines, typeByCode, t]);
  const totalReimbursement = Math.max(0, totalExpenses + (Number(amounts.exchangeLoss) || 0) - (Number(amounts.otherCompanyExp) || 0));
  const suggestedB = Math.max(0, totalReimbursement - advance);
  const suggestedC = Math.max(0, advance - totalReimbursement);
  const totalFormula = totalReimbursement;

  const openDialog = (m: "request" | "standalone") => {
    setMode(m);
    setRequestId(m === "request" ? claimableRequests[0]?.id ?? "" : "");
    setPreviewData(null);
    setLines([newLine("")]);
    setAmounts({ otherCompanyExp: "", exchangeLoss: "", voucherNo: "", remark: "" });
    setFiles([]);
    setDialog(true);
  };

  // T16-ATTACH — unggah file sebagai draf (entityId draft:{uuid}); server
  // me-rebind ke klaim saat POST klaim sukses; gagal submit → draf disapu.
  async function uploadDraftFiles(): Promise<string[]> {
    const ids: string[] = [];
    for (const f of files) {
      const form = new FormData();
      form.append("file", f);
      form.append("entityType", "TravelClaim");
      form.append("entityId", `draft:${crypto.randomUUID()}`);
      const res = await apiUpload<{ id: string }>("/api/onevity/attachments", form);
      ids.push(res.id);
    }
    return ids;
  }

  const submit = async () => {
    const validLines = lines.filter((l) => l.expenseCode && Number(l.amount) > 0);
    if (validLines.length === 0) { toast.error(t("Minimal 1 baris biaya dengan jenis & nominal terisi", "At least 1 expense line with type & amount filled")); return; }
    if (mode === "request" && !requestId) { toast.error(t("Pilih permintaan travel Approved sebagai dasar klaim", "Select an Approved travel request as the claim basis")); return; }
    if (mode === "standalone" && !master.data?.employees?.length) { toast.error(t("Data karyawan belum tersedia", "Employee data not yet available")); return; }
    // T16-ATTACH — mirror enforcement server: jenis biaya needDocs wajib kwitansi.
    const needDocsNames = validLines
      .map((l) => typeByCode.get(l.expenseCode))
      .filter((et) => et?.needDocs)
      .map((et) => et!.name);
    if (needDocsNames.length > 0 && files.length === 0) {
      toast.error(t("Jenis biaya {x} mewajibkan lampiran kwitansi", "Expense type {x} requires receipt attachments", { x: [...new Set(needDocsNames)].join(", ") }));
      return;
    }
    setBusy(true);
    try {
      // 1) unggah file dulu (draf) → 2) submit klaim dgn attachmentIds
      const attachmentIds = await uploadDraftFiles();
      const res = await apiSend<{ docNo: string; totalSettlement: number; totalExpenses: number; overLimitLines: number; attachmentCount?: number }>(
        "/api/onevity/travel/claims", "POST",
        {
          requestId: mode === "request" ? requestId : undefined,
          employeeId: mode === "request" ? previewData?.employee.id : (master.data?.employees ?? [])[0]?.id,
          templateCode: mode === "request" ? previewData?.templateCode : "TRAVEL",
          voucherNo: amounts.voucherNo || undefined,
          remark: amounts.remark || undefined,
          attachmentIds,
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
          // T3-TRAVEL: b/c dihitung server dari (rincian + rugi kurs − a) vs uang muka —
          // kirim nilai terhitung (server tetap otoritatif dan mengabaikan manipulasi klien).
          payableEmployee: suggestedB,
          payableCompany: suggestedC,
        },
      );
      toast.success(
        t("{no} diajukan — total settlement {total}{warn}{att}", "{no} submitted — total settlement {total}{warn}{att}", {
          no: res.docNo,
          total: fmtIDR(res.totalSettlement),
          warn: res.overLimitLines > 0 ? t(" ({n} baris lewat limit — perlu perhatian approver)", " ({n} lines over limit — needs approver attention)", { n: res.overLimitLines }) : "",
          att: (res.attachmentCount ?? 0) > 0 ? t(" · {n} lampiran", " · {n} attachments", { n: res.attachmentCount ?? 0 }) : "",
        }),
      );
      setDialog(false);
      api.refresh();
      detailApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membuat klaim", "Failed to create the claim"));
    } finally { setBusy(false); }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL TRAVEL", "TRAVEL MODULE")}
        title={t("Klaim & Settlement Perjalanan", "Travel Claims & Settlement")}
        description={t("Rincian biaya per jenis (General / Allowance / Mileage / Entertainment + tamu) dengan formula Total = rincian + rugi kurs − (a) — biaya pihak lain tidak dibayar ke karyawan; uang muka otomatis mengurangi (b) / menambah (c)", "Expense details per type (General / Allowance / Mileage / Entertainment + guests) with the formula Total = expenses + exchange loss − (a) — third-party costs are not paid to the employee; the advance automatically reduces (b) / adds to (c)")}
        actions={
          <div className="flex flex-wrap gap-2">
            {perms.can("travel", "travel-claim", "create") && (
              <Button onClick={() => openDialog("request")} className="gap-2 font-bold">
                <Plus className="h-4 w-4" /> {t("Klaim dari Permintaan", "Claim from Request")}
              </Button>
            )}
            {perms.can("travel", "travel-claim", "create") && (
              <Button variant="outline" onClick={() => openDialog("standalone")} className="gap-2 font-bold">
                <FileText className="h-4 w-4" /> {t("Klaim Mandiri", "Standalone Claim")}
              </Button>
            )}
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
                ? "ov-fill shadow-sm"
                : "bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800",
            )}
          >
            {t(f.label, STATUS_FILTERS_EN[f.key])}
            {f.key === "all" && stats ? ` (${stats.total})` : ""}
            {f.key === "Submitted" && stats ? ` (${stats.submitted})` : ""}
            {f.key === "Approved" && stats ? ` (${stats.approved})` : ""}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari nama / nomor klaim…", "Search name / claim number…")} className="w-56 pl-9 text-sm" />
        </div>
      </div>

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <LoadingRows rows={6} />
          ) : claims.length === 0 ? (
            <EmptyState icon={FileText} title={t("Belum ada klaim", "No claims yet")} description={t("Buat klaim settlement dari permintaan Approved atau klaim mandiri.", "Create a settlement claim from an Approved request or a standalone claim.")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-stone-50 dark:hover:bg-stone-800/60">
                    <TableHead className="w-8" />
                    <TableHead>{t("Nomor", "No.")}</TableHead>
                    <TableHead>{t("Karyawan")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Basis", "Basis")}</TableHead>
                    <TableHead className="text-right">{t("Total Settlement", "Total Settlement")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Jurnal", "Journal")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
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
                          <p className="font-mono text-xs font-bold ov-text-accent">{c.docNo}</p>
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
                            <Badge variant="secondary" className="text-[10px] font-bold">{t("Mandiri", "Standalone")}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <p className={cn("text-sm font-black", c.totalSettlement < 0 ? "text-rose-600" : "text-stone-900 dark:text-stone-100")}>
                            {fmtIDRShort(c.totalSettlement)}
                          </p>
                          <p className="text-[11px] text-stone-500">
                            {t("{n} baris · {muka}", "{n} lines · {muka}", { n: c.expenseLines, muka: c.advanceAmount > 0 ? t("muka {amt}", "advance {amt}", { amt: fmtIDRShort(c.advanceAmount) }) : t("tanpa muka", "no advance") })}
                          </p>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {c.journalNo ? (
                            <span className="flex items-center gap-1 font-mono text-[11px] font-bold text-brand-deep dark:text-brand/85">
                              <Landmark className="h-3 w-3" /> {c.journalNo}
                            </span>
                          ) : (
                            <span className="text-[11px] text-stone-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={t(TRAVEL_STATUS_LABEL[c.status] ?? c.status, TRAVEL_STATUS_LABEL_EN[c.status] ?? c.status)} />
                          {(c.attachmentCount ?? 0) > 0 && <AttachmentCountBadge count={c.attachmentCount ?? 0} />}
                          {c.overLimitLines > 0 && (
                            <Badge className="ml-1 bg-amber-100 text-[9px] font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">{t("LEBIH LIMIT", "OVER LIMIT")}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === c.docNo && (
                        <TableRow key={`${c.id}-d`} className="bg-stone-50/60 dark:bg-stone-800/30">
                          <TableCell colSpan={7} className="px-6 py-3">
                            <div className="grid gap-3 lg:grid-cols-3">
                              <div className="lg:col-span-2">
                                <p className="mb-1 text-xs font-black uppercase tracking-wide text-stone-500">{t("Formula Settlement")}</p>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                                  <div className="rounded-lg bg-white px-3 py-2 dark:bg-stone-900">
                                    <p className="text-[10px] font-bold text-stone-500">{t("(a) Pihak lain (kontra)", "(a) Third party (contra)")}</p>
                                    <p className="text-sm font-black text-stone-800 dark:text-stone-200">{fmtIDR(c.otherCompanyExp)}</p>
                                  </div>
                                  <div className="rounded-lg bg-white px-3 py-2 dark:bg-stone-900">
                                    <p className="text-[10px] font-bold text-stone-500">{t("(a) Rugi kurs", "(a) Exchange loss")}</p>
                                    <p className="text-sm font-black text-stone-800 dark:text-stone-200">{fmtIDR(c.exchangeLoss)}</p>
                                  </div>
                                  <div className="rounded-lg bg-white px-3 py-2 dark:bg-stone-900">
                                    <p className="text-[10px] font-bold text-stone-500">{t("(b) Ke karyawan", "(b) To employee")}</p>
                                    <p className="text-sm font-black text-brand-deep dark:text-brand/85">{fmtIDR(c.payableEmployee)}</p>
                                  </div>
                                  <div className="rounded-lg bg-white px-3 py-2 dark:bg-stone-900">
                                    <p className="text-[10px] font-bold text-stone-500">{t("(c) Ke perusahaan", "(c) To company")}</p>
                                    <p className="text-sm font-black text-rose-700 dark:text-rose-400">{fmtIDR(c.payableCompany)}</p>
                                  </div>
                                  <div className="rounded-lg border-2 ov-border-accent ov-soft px-3 py-2">
                                    <p className="text-[10px] font-bold">{t("TOTAL · rincian + kurs − (a)", "TOTAL · expenses + fx − (a)")}</p>
                                    <p className="text-sm font-black">{fmtIDR(c.totalSettlement)}</p>
                                  </div>
                                </div>
                                {c.remark && <p className="mt-2 text-[11px] text-stone-500">{c.remark}</p>}
                                {c.status === "Paid" && c.paidRunNo && (
                                  <p className="mt-2 flex items-center gap-1 rounded-lg bg-brand/10 px-3 py-1.5 text-[11px] font-bold text-brand-deep dark:bg-brand/90/30 dark:text-brand/85">
                                    <Landmark className="h-3 w-3" /> {t("Dibayar via payroll run {no} (period {p})", "Paid via payroll run {no} (period {p})", { no: c.paidRunNo, p: c.periodCode ?? "-" })}
                                  </p>
                                )}
                                {c.status === "Transferred" && (
                                  <p className="mt-2 flex items-center gap-1 rounded-lg bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                    <Landmark className="h-3 w-3" /> {t("Menunggu run payroll period {p} dikonfirmasi → Dibayar", "Waiting for the payroll run of period {p} to be confirmed → Paid", { p: c.periodCode ?? "-" })}
                                  </p>
                                )}
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-black uppercase tracking-wide text-stone-500">{t("Jenis Biaya", "Expense Types")}</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {c.expenseKinds.map((k) => (
                                    <Badge key={k} variant="outline" className="text-[10px] font-bold">{EXPENSE_KIND_LABEL[k] ?? k}</Badge>
                                  ))}
                                  <span className="text-[11px] text-stone-500">{t("total biaya {amt}", "total expenses {amt}", { amt: fmtIDR(c.totalExpenses) })}</span>
                                </div>
                                <p className="mb-1 mt-3 text-xs font-black uppercase tracking-wide text-stone-500">{t("Lampiran Kwitansi", "Receipt Attachments")}</p>
                                <AttachmentChips
                                  attachments={c.attachments ?? []}
                                  showDelete={c.status === "Submitted" || c.status === "Rejected"}
                                  onDeleted={() => { api.refresh(); detailApi.refresh(); }}
                                />
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
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 ov-text-accent" /> {t("Klaim Settlement", "Settlement Claim")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {mode === "request" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Permintaan Travel (Approved) *", "Travel Request (Approved) *")}</Label>
                <Select value={requestId} onValueChange={setRequestId}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder={t("Pilih permintaan", "Select a request")} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {claimableRequests.map((r) => (
                      <SelectItem key={r.id} value={r.id} className="text-sm">
                        {r.docNo} — {r.fullName} ({r.destinations.map((d) => d.city).join(" → ")})
                      </SelectItem>
                    ))}
                    {claimableRequests.length === 0 && (
                      <SelectItem value="none" disabled className="text-xs">
                        {t("Tidak ada permintaan Approved yang belum diklaim", "No unclaimed Approved requests")}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-stone-500">
                  {t("Hanya permintaan Approved tanpa klaim aktif yang ditampilkan — satu permintaan hanya boleh satu klaim aktif.", "Only Approved requests without an active claim are shown — one request may have only one active claim.")}
                </p>
              </div>
            )}

            {previewData && (
              <div className="rounded-xl border ov-border-accent ov-soft p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-[11px] font-bold">{previewData.docNo} — {previewData.employee.fullName}</p>
                    <p className="mt-0.5 text-stone-600 dark:text-stone-300">{previewData.destinations.map((d) => d.city).join(" → ")} · {previewData.templateName}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-amber-700 dark:text-amber-400">{t("Uang muka: {amt}", "Advance: {amt}", { amt: fmtIDR(previewData.advanceAmount) })}</p>
                    {previewData.costCenter && <p className="text-[11px] text-stone-500">CC {previewData.costCenter}</p>}
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-stone-500">{previewData.purpose}</p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">{t("Rincian Biaya *", "Expense Details *")}</Label>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs font-bold" onClick={() => setLines([...lines, newLine("")])}>
                  <Plus className="h-3 w-3" /> {t("Tambah Baris", "Add Line")}
                </Button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const et = l.expenseCode ? typeByCode.get(l.expenseCode) : undefined;
                  const overLimit = et && !et.unlimited && et.limitAmount > 0 && (Number(l.amount) || 0) > et.limitAmount;
                  return (
                    <div key={i} className="rounded-xl border border-stone-200 bg-stone-50/50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-stone-500">{t("Baris {n}", "Line {n}", { n: i + 1 })}</span>
                        {lines.length > 1 && (
                          <button className="flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700" onClick={() => setLines(lines.filter((_, x) => x !== i))}>
                            <Trash2 className="h-3 w-3" /> {t("Hapus")}
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-stone-500">{t("Jenis biaya *", "Expense type *")}</Label>
                          <Select value={l.expenseCode} onValueChange={(v) => setLines(lines.map((x, xi) => xi === i ? { ...x, expenseCode: v } : x))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("Pilih jenis", "Select type")} /></SelectTrigger>
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
                          <Label className="text-[10px] font-bold text-stone-500">{t("Tanggal")}</Label>
                          <Input type="date" value={l.expenseDate} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, expenseDate: e.target.value } : x))} className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-stone-500">{t("Nominal (Rp) *", "Amount (Rp) *")}</Label>
                          <Input type="number" min="0" value={l.amount} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))} placeholder="0" className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-stone-500">
                            {et?.kind === "MILEAGE" ? t("Km / unit", "Km / unit") : et?.kind === "ALLOWANCE" ? t("Jumlah hari", "Number of days") : "Qty"}
                          </Label>
                          <Input type="number" min="0" value={l.qty} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, qty: e.target.value } : x))} className="h-8 text-sm" />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-[10px] font-bold text-stone-500">{t("Keterangan")}</Label>
                          <Input value={l.description} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x))} placeholder={t("Mis. Hotel 2 malam", "e.g. Hotel for 2 nights")} className="h-8 text-sm" />
                        </div>
                        {et?.kind === "ENTERTAINMENT" && (
                          <div className="col-span-2 space-y-1">
                            <Label className="flex items-center gap-1 text-[10px] font-bold text-stone-500">
                              <Users className="h-3 w-3" /> {t("Tamu / Relasi (Entertainment Guest)", "Guest / Relation (Entertainment Guest)")}
                            </Label>
                            <Input value={l.guestName} onChange={(e) => setLines(lines.map((x, xi) => xi === i ? { ...x, guestName: e.target.value } : x))} placeholder={t("Mis. Direktur PT Sinar Abadi + 3", "e.g. Director of PT Sinar Abadi + 3")} className="h-8 text-sm" />
                          </div>
                        )}
                      </div>
                      {et && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                          <Badge variant="outline" className="text-[9px] font-bold">{EXPENSE_KIND_LABEL[et.kind] ?? et.kind}</Badge>
                          {et.needDocs && <Badge variant="secondary" className="text-[9px] font-bold">{t("Perlu dokumen", "Docs required")}</Badge>}
                          {et.limitAmount > 0 && !et.unlimited && (
                            <span className={cn("font-semibold", overLimit ? "text-rose-600" : "text-stone-500")}>
                              {overLimit ? <><AlertTriangle className="mr-1 inline h-3 w-3" />{t("Melebihi limit {amt} — tetap bisa diajukan (warning)", "Exceeds limit {amt} — can still be submitted (warning)", { amt: fmtIDR(et.limitAmount) })}</> : t("Limit {amt}", "Limit {amt}", { amt: fmtIDR(et.limitAmount) })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-stone-100 px-3 py-2 text-xs font-bold dark:bg-stone-800">
                <span className="text-stone-600 dark:text-stone-300">{t("Total rincian biaya", "Total expenses")}</span>
                <span className="text-stone-900 dark:text-stone-100">{fmtIDR(totalExpenses)}</span>
              </div>
            </div>

            <div className="rounded-xl border-2 ov-border-accent ov-soft p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-black">
                <Calculator className="h-3.5 w-3.5" /> {t("Formula Settlement — Total = Rincian + Rugi kurs − (a)", "Settlement Formula — Total = Expenses + Exchange loss − (a)")}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-stone-500">{t("(a) Biaya pihak lain (kontra — tidak dibayar ke karyawan)", "(a) Third-party costs (contra — not paid to employee)")}</Label>
                  <Input type="number" min="0" value={amounts.otherCompanyExp} onChange={(e) => setAmounts({ ...amounts, otherCompanyExp: e.target.value })} placeholder="0" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-stone-500">{t("(a) Rugi kurs", "(a) Exchange loss")}</Label>
                  <Input type="number" min="0" value={amounts.exchangeLoss} onChange={(e) => setAmounts({ ...amounts, exchangeLoss: e.target.value })} placeholder="0" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-brand-deep dark:text-brand/85">{t("(b) Dibayar ke karyawan", "(b) Paid to employee")}</Label>
                  <Input
                    type="number" min="0" readOnly value={suggestedB}
                    placeholder={String(suggestedB)} className="h-8 bg-stone-50 text-sm font-bold dark:bg-stone-900"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-rose-700 dark:text-rose-400">{t("(c) Kembali ke perusahaan", "(c) Returned to company")}</Label>
                  <Input
                    type="number" min="0" readOnly value={suggestedC}
                    placeholder={String(suggestedC)} className="h-8 bg-stone-50 text-sm font-bold dark:bg-stone-900"
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
                  {advance > 0 && <span className="font-bold text-amber-700 dark:text-amber-400"><Wallet className="mr-1 inline h-3 w-3" />{t("Uang muka {amt}", "Advance {amt}", { amt: fmtIDR(advance) })}</span>}
                  <span>{t("Total rincian + rugi kurs − (a) = {amt}", "Total expenses + exchange loss − (a) = {amt}", { amt: fmtIDR(totalReimbursement) })}</span>
                  <span>{t("(b)/(c) dihitung otomatis server dari (rincian + rugi kurs − a) vs uang muka", "(b)/(c) computed automatically by the server from (expenses + loss − a) vs advance")}</span>
                </div>
                <span className="rounded-lg border-2 ov-border-accent bg-white px-3 py-1 font-black ov-text-accent dark:bg-stone-900">
                  Total = {fmtIDR(totalFormula)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-bold">{t("No. Voucher", "Voucher No.")}</Label>
                <Input value={amounts.voucherNo} onChange={(e) => setAmounts({ ...amounts, voucherNo: e.target.value })} placeholder="V-2609-001" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold">{t("Catatan")}</Label>
                <Input value={amounts.remark} onChange={(e) => setAmounts({ ...amounts, remark: e.target.value })} placeholder={t("Kwitansi terlampir", "Receipts attached")} className="h-8 text-sm" />
              </div>
            </div>

            {/* T16-ATTACH — upload kwitansi (multiple, preview, hapus pra-submit) */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-bold">
                <Paperclip className="h-3.5 w-3.5" />
                {t("Lampiran Kwitansi", "Receipt Attachments")}
                {needDocsHint && <span className="text-amber-600 dark:text-amber-400">*</span>}
              </Label>
              <AttachmentUploadArea
                files={files}
                onChange={setFiles}
                hint={needDocsHint}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog(false)} className="font-bold">{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy} className="gap-2 font-bold">
              <FileText className="h-4 w-4" /> {busy ? t("Menyimpan…") : t("Ajukan Klaim", "Submit Claim")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
