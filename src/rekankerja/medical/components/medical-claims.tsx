"use client";
// RekanKerja Medical — Klaim Medis: daftar + dialog pengajuan multi-baris perawatan
// (padanan MedicalBenefitClaim.jsp + wizard ESS MyMedicalExpenseClaim.jsp).
import { Fragment, useEffect, useMemo, useState } from "react";
import { useApi, apiSend, apiUpload } from "@/rekankerja/shared/lib/api";
import { useTableSort, nextServerSort, ServerSortHead, type ServerSortDir } from "@/rekankerja/shared/lib/use-table-sort";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import {
  AttachmentUploadArea, AttachmentChips, AttachmentCountBadge,
} from "@/rekankerja/shared/components/attachment-upload";
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
  CLAIM_STATUS_LABEL, CLAIM_STATUS_LABEL_EN, FREQ_PERIOD_LABEL, FREQ_PERIOD_LABEL_EN,
  fmtIDR, fmtDateID, fmtDateTimeID, todayISO,
} from "./medical-types";
import {
  FileText, Plus, Search, ChevronDown, ChevronRight, Trash2, Activity, Calculator, Paperclip,
} from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { trServer } from "@/rekankerja/shared/lib/i18n-core";
import { cn } from "@/lib/utils";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, num, dt, sel, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Draft", label: "Draft" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Settled", label: "Settled" },
  { key: "Rejected", label: "Ditolak" },
];

/** Task adv-search — field Advance Search klaim medis (filter client-side
 *  TAMBAHAN di atas query & tab status; opsi status reuse CLAIM_STATUS_LABEL). */
const CLAIM_ADV_FIELDS: AdvFieldDef<ClaimUI>[] = [
  txt("docNo", "No. Dokumen", "Doc. No."),
  txt("employeeNo", "No. Karyawan", "Employee No."),
  txt("fullName", "Nama Karyawan", "Employee Name"),
  txt("orgUnitName", "Unit Organisasi", "Org Unit"),
  txt("typeName", "Jenis Benefit", "Benefit Type"),
  txt("typeCode", "Kode Jenis", "Type Code"),
  dt("claimDate", "Tanggal", "Date"),
  num("totalBill", "Tagihan", "Bill"),
  num("totalReimburse", "Reimburse", "Reimburse"),
  num("totalApproved", "Disetujui", "Approved"),
  sel("state", "Status", "Status", Object.keys(CLAIM_STATUS_LABEL).map(
    (k) => [k, CLAIM_STATUS_LABEL[k], CLAIM_STATUS_LABEL_EN[k] ?? k] as [string, string, string],
  )),
  txt("letterNo", "No. Surat Rujukan", "Referral Letter No."),
];

interface LineForm {
  treatedName: string; treatment: string; treatmentDate: string;
  receiptNo: string; providerId: string; physician: string; hospital: string;
  occupationalInjury: boolean; billAmount: string; reimburseAmount: string; approvedAmount: string;
}

const newLine = (treatedName = ""): LineForm => ({
  treatedName: "", treatment: "", treatmentDate: todayISO(),
  receiptNo: "", providerId: "", physician: "", hospital: "",
  occupationalInjury: false, billAmount: "", reimburseAmount: "", approvedAmount: "",
});

export function MedicalClaimsPage() {
  const perms = useMenuPerms();
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  // Task adv-search — kondisi advance search (filter tambahan di atas query).
  const [adv, setAdv] = useState<AdvSearch | null>(null);
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
  // T16-ATTACH — file kwitansi pra-submit (diunggah dgn entityId "draft:" saat
  // klaim diajukan → di-rebind server ke klaim baru).
  const [files, setFiles] = useState<File[]>([]);

  // Task 76 — sorting SERVER-SIDE utk kolom teks/tanggal (whitelist di service).
  // Kolom uang (bill/approved) terenkripsi → tetap diurut client-side via hook.
  const [sortKey, setSortKey] = useState<"doc" | "employee" | "type" | "date" | "bill" | "approved" | "status">("date");
  const [sortDir, setSortDir] = useState<ServerSortDir>("desc");
  const clickSort = (k: typeof sortKey) => {
    const n = nextServerSort(sortKey, sortDir, k);
    setSortKey(n.sortBy as typeof sortKey);
    setSortDir(n.sortDir);
  };
  const serverSorted = sortKey === "bill" || sortKey === "approved";
  const api = useApi<{ claims: ClaimUI[]; stats: { total: number; submitted: number; approved: number; settled: number; settledAmount: number } }>(
    `/api/rekankerja/medical/claims?state=${statusFilter}${serverSorted ? "" : `&sortBy=${sortKey}&sortDir=${sortDir}`}`,
  );
  const detailApi = useApi<{ claims: ClaimUI[] }>(`/api/rekankerja/medical/claims?state=all&includeLines=1`, [statusFilter]);
  const master = useApi<{ types: BenefitTypeUI[] }>("/api/rekankerja/medical/types");
  const balanceMeta = useApi<{ employees: EmployeeOption[] }>("/api/rekankerja/medical/balances?year=" + new Date().getFullYear());
  // W1-6 — master provider aktif utk dropdown Rumah Sakit/Klinik.
  const providersMeta = useApi<{ providers: { id: string; name: string; kind: string; city: string | null; active: boolean }[] }>("/api/rekankerja/medical/providers");
  // W1-7 — daftar anggota keluarga karyawan terpilih (dropdown dependent).
  const familyMeta = useApi<{ family: { id: string; name: string; relation: string; birthDate: string | null; isDependent: boolean }[] }>(
    dialog && forDependent && employeeId ? `/api/rekankerja/medical/providers?familyFor=${employeeId}` : null,
  );
  const hospitals = (providersMeta.data?.providers ?? []).filter((p) => p.kind === "HOSPITAL" && p.active);
  const familyMembers = familyMeta.data?.family ?? [];

  const claims = useMemo(() => filterRowsByAdv((api.data?.claims ?? []).filter((c) =>
    !query || c.fullName.toLowerCase().includes(query.toLowerCase()) || c.docNo.toLowerCase().includes(query.toLowerCase()),
  ), adv, CLAIM_ADV_FIELDS), [api.data, query, adv]);

  // Task 72 — sorting client utk kolom uang (fallback)
  const sort = useTableSort(claims, {
    bill: (c) => c.totalBill,
    approved: (c) => c.totalApproved,
  }, { defaultKey: "bill", defaultDir: "desc" });

  const employees = balanceMeta.data?.employees ?? [];
  const types = (master.data?.types ?? []).filter((t) => t.active);

  // pratinjau saldo (snapshot limit/used/remaining + frekuensi) saat employee+type
  // dipilih — forDependent ikut dihitung agar preview memakai POOL YANG BENAR
  // (fix K-3: SHARED → pool bersama karyawan; EACH/TOTAL → pool dependent).
  // W2-4: refetch juga saat claimDate berubah — tahun preview mengikuti form.
  useEffect(() => {
    if (!dialog || !employeeId || !typeId) { setPreview(null); return; }
    const t = setTimeout(async () => {
      try {
        const res = await apiSend<{ preview: ClaimPreviewUI }>(
          // W2-4 (fix m-4): preview memakai tahun claimDate form (dulu selalu
          // tahun berjalan — snapshot yang dipratinjau bisa beda dari yang
          // divalidasi submitClaim bila claimDate tahun lain).
          `/api/rekankerja/medical/claims?preview=1&employeeId=${employeeId}&typeId=${typeId}&forDependent=${forDependent ? 1 : 0}&year=${Number(claimDate.slice(0, 4))}`, "GET",
        );
        setPreview(res.preview);
      } catch {
        setPreview(null);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [dialog, employeeId, typeId, forDependent, claimDate]);

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
    setFiles([]);
    setDialog(true);
  };

  // T16-ATTACH — jenis benefit terpilih butuh kwitansi? (enforcement server).
  const selectedType = useMemo(() => types.find((t) => t.id === typeId), [types, typeId]);
  // W3-1 (fix G-2): jenis terpilih mewajibkan nomor surat rujukan — label input
  // wajib & submit diblok client-side (server tetap guard).
  const needLetter = selectedType?.needLetter === true;

  // T16-ATTACH — unggah file sebagai draf (entityId draft:{uuid}); server
  // me-rebind ke klaim saat POST klaim sukses; gagal submit → draf disapu.
  async function uploadDraftFiles(): Promise<string[]> {
    const ids: string[] = [];
    for (const f of files) {
      const form = new FormData();
      form.append("file", f);
      form.append("entityType", "MedicalClaim");
      form.append("entityId", `draft:${crypto.randomUUID()}`);
      const res = await apiUpload<{ id: string }>("/api/rekankerja/attachments", form);
      ids.push(res.id);
    }
    return ids;
  }

  const setLine = (i: number, patch: Partial<LineForm>) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const submit = async () => {
    const valid = lines.filter((l) => l.treatedName.trim() && Number(l.billAmount) > 0 && Number(l.approvedAmount) >= 0);
    if (!employeeId || !typeId) { toast.error(t("Pilih karyawan & jenis benefit", "Select employee & benefit type")); return; }
    if (valid.length === 0) { toast.error(t("Minimal 1 baris perawatan lengkap (nama yang dirawat + tagihan)", "At least 1 complete treatment line (treated name + bill)")); return; }
    // T16-ATTACH — mirror enforcement server: jenis benefit needReceipt wajib kwitansi.
    if (selectedType?.needReceipt && files.length === 0) {
      toast.error(t("Jenis benefit {x} mewajibkan lampiran kwitansi", "Benefit type {x} requires receipt attachments", { x: selectedType.name }));
      return;
    }
    // W3-1 (fix G-2) — mirror enforcement server: jenis needLetter wajib surat rujukan.
    if (needLetter && !letterNo.trim()) {
      toast.error(t("Jenis benefit {x} mewajibkan nomor surat rujukan dokter/RS", "Benefit type {x} requires a doctor/hospital referral letter no.", { x: selectedType?.name }));
      return;
    }
    setBusy(true);
    try {
      // 1) unggah file dulu (draf) → 2) submit klaim dgn attachmentIds
      const attachmentIds = await uploadDraftFiles();
      const res = await apiSend<{ docNo: string; totalApproved: number; remainingAfter: number; attachmentCount?: number; warnings?: string[] }>("/api/rekankerja/medical/claims", "POST", {
        employeeId, typeId, claimDate, letterNo: letterNo || undefined,
        forDependent, note: note || undefined, submit: true,
        attachmentIds,
        lines: valid.map((l) => ({
          treatedName: l.treatedName, treatment: l.treatment || undefined,
          treatmentDate: l.treatmentDate || undefined, receiptNo: l.receiptNo || undefined,
          providerId: l.providerId || undefined, // W1-6 — relasi master provider
          physician: l.physician || undefined, hospital: l.hospital || undefined,
          occupationalInjury: l.occupationalInjury,
          billAmount: Number(l.billAmount) || 0,
          reimburseAmount: Number(l.reimburseAmount) || 0,
          approvedAmount: Number(l.approvedAmount) || 0,
        })),
      });
      toast.success(t("Klaim {d} diajukan — approved {a} · sisa saldo {r}{att}", "Claim {d} submitted — approved {a} · remaining balance {r}{att}", { d: res.docNo, a: fmtIDR(res.totalApproved), r: fmtIDR(res.remainingAfter), att: (res.attachmentCount ?? 0) > 0 ? t(" · {n} lampiran", " · {n} attachments", { n: res.attachmentCount ?? 0 }) : "" }));
      // Task 82-b (audit T10): warning validasi lembut klaim dependent — toast
      // AMBER non-blocking setelah submit sukses (nama tak cocok data keluarga /
      // jumlah dependent melebihi batas jenis benefit).
      for (const w of res.warnings ?? []) {
        toast.warning(trServer(w), { duration: 7000 });
      }
      setDialog(false);
      api.refresh();
      detailApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan klaim", "Failed to submit claim"));
    } finally {
      setBusy(false);
    }
  };

  const detailOf = (id: string) => (detailApi.data?.claims ?? []).find((c) => c.id === id);

  return (
    <div>
      <PageHeader
        eyebrow={t("Medical · Transaksi", "Medical · Transactions")}
        title={t("Klaim Medis")}
        description={t("Pengajuan reimbursement perawatan karyawan & dependent — snapshot saldo, baris perawatan dengan kwitansi/dokter/rumah sakit, validasi frekuensi per jenis (padanan Medical Claim)", "Employee & dependent treatment reimbursement claims — balance snapshot, treatment lines with receipt/physician/hospital, per-type frequency validation (equivalent to Medical Claim)")}
        actions={(
          perms.can("medical", "medical-claim", "create") && (
            <Button onClick={openDialog}>
              <Plus className="h-4 w-4" /> {t("Ajukan Klaim", "Submit Claim")}
            </Button>
          )
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
                ? "ov-soft ov-border-accent"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
            )}
          >
            {t(f.label)}
            {f.key !== "all" && api.data?.stats && (
              <span className="ml-1 opacity-60">
                {f.key === "Draft" ? api.data.stats.total - api.data.stats.submitted - api.data.stats.approved - api.data.stats.settled : undefined}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari nama / no. dokumen…", "Search name / doc. no.…")} className="pl-8" />
          </div>
          <AdvSearchButton fields={CLAIM_ADV_FIELDS} value={adv} onChange={setAdv} />
        </div>
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : claims.length === 0 ? (
            <div className="p-6"><EmptyState title={t("Belum ada klaim medis", "No medical claims yet")} description={t("Ajukan klaim reimbursement perawatan pertama — pilih karyawan & jenis benefit.", "Submit the first treatment reimbursement claim — pick an employee & benefit type.")} icon={FileText} /></div>
          ) : (
            <div className="max-h-[30rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead className="w-8" />
                    <ServerSortHead label={t("No. Dokumen", "Doc. No.")} active={sortKey === "doc"} dir={sortDir} onClick={() => clickSort("doc")} />
                    <ServerSortHead label={t("Karyawan")} active={sortKey === "employee"} dir={sortDir} onClick={() => clickSort("employee")} />
                    <ServerSortHead label={t("Jenis")} active={sortKey === "type"} dir={sortDir} onClick={() => clickSort("type")} />
                    <ServerSortHead label={t("Tanggal")} active={sortKey === "date"} dir={sortDir} onClick={() => clickSort("date")} />
                    {sort.head("bill", t("Tagihan", "Bill"), "text-right")}
                    {sort.head("approved", t("Disetujui", "Approved"), "text-right")}
                    <ServerSortHead label={t("Status")} active={sortKey === "status"} dir={sortDir} onClick={() => clickSort("status")} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(serverSorted ? sort.sorted : claims).map((c) => {
                    const open = expanded === c.id;
                    const detail = open ? detailOf(c.id) : null;
                    return (
                      <Fragment key={c.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setExpanded(open ? null : c.id)}
                        >
                          <TableCell>
                            {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                          </TableCell>
                          <TableCell className="font-semibold text-slate-900 dark:text-slate-100">{c.docNo}</TableCell>
                          <TableCell>
                            <p className="font-medium">{c.fullName}</p>
                            <p className="text-xs text-slate-500">{c.employeeNo}{c.orgUnitName ? ` · ${c.orgUnitName}` : ""}</p>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">{c.typeName}</span>
                            {c.forDependent && <span className="ml-1 text-xs text-brand dark:text-brand/85">(dependent)</span>}
                          </TableCell>
                          <TableCell className="text-sm">{fmtDateID(c.claimDate)}</TableCell>
                          <TableCell className="text-right">{fmtIDR(c.totalBill)}</TableCell>
                          <TableCell className="text-right font-semibold">{fmtIDR(c.totalApproved)}</TableCell>
                          <TableCell>
                            <StatusPill status={c.state} />
                            {(c.attachmentCount ?? 0) > 0 && <AttachmentCountBadge count={c.attachmentCount ?? 0} />}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-slate-50/70 dark:bg-slate-900/60 hover:bg-slate-50/70">
                            <TableCell colSpan={8} className="p-4">
                              {!detail ? (
                                <p className="text-sm text-slate-500">{t("Memuat rincian…", "Loading details…")}</p>
                              ) : (
                                <div className="space-y-4">
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                    <div className="rounded-lg bg-white p-3 dark:bg-slate-900">
                                      <p className="text-[11px] font-bold uppercase text-slate-400">{t("Snapshot Limit", "Snapshot Limit")}</p>
                                      <p className="text-sm font-black">{fmtIDR(c.maxBenefitAt)}</p>
                                      <p className="text-xs text-slate-500">{t("used saat ajukan: {v}", "used at submission: {v}", { v: fmtIDR(c.usedAt) })}</p>
                                    </div>
                                    <div className="rounded-lg bg-white p-3 dark:bg-slate-900">
                                      <p className="text-[11px] font-bold uppercase text-slate-400">{t("Total Reimbursement", "Total Reimbursement")}</p>
                                      <p className="text-sm font-black">{fmtIDR(c.totalReimburse)}</p>
                                    </div>
                                    <div className="rounded-lg bg-white p-3 dark:bg-slate-900">
                                      <p className="text-[11px] font-bold uppercase text-slate-400">{t("Non Reimbursement", "Non Reimbursement")}</p>
                                      <p className="text-sm font-black">{fmtIDR(c.totalNonRe)}</p>
                                    </div>
                                    <div className="rounded-lg bg-white p-3 dark:bg-slate-900">
                                      <p className="text-[11px] font-bold uppercase text-slate-400">{t("Settlement", "Settlement")}</p>
                                      <p className="text-sm font-black">{c.settleDate ? fmtDateID(c.settleDate) : "—"}</p>
                                      {c.journalNo && <p className="text-xs text-slate-500">{t("jurnal {n}", "journal {n}", { n: c.journalNo })}</p>}
                                    </div>
                                  </div>

                                  <div className="rounded-lg bg-white p-3 dark:bg-slate-900">
                                    <p className="mb-1.5 text-[11px] font-bold uppercase text-slate-400">{t("Lampiran Kwitansi", "Receipt Attachments")}</p>
                                    <AttachmentChips
                                      attachments={c.attachments ?? []}
                                      showDelete={c.state === "Submitted" || c.state === "Returned" || c.state === "Rejected"}
                                      onDeleted={() => { api.refresh(); detailApi.refresh(); }}
                                    />
                                  </div>

                                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>{t("Yang Dirawat", "Treated Person")}</TableHead>
                                          <TableHead>{t("Perawatan", "Treatment")}</TableHead>
                                          <TableHead>{t("Tanggal")}</TableHead>
                                          <TableHead>{t("Dokter / RS", "Physician / Hospital")}</TableHead>
                                          <TableHead className="text-right">{t("Tagihan", "Bill")}</TableHead>
                                          <TableHead className="text-right">{t("Disetujui", "Approved")}</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {(detail.lines ?? []).map((l: ClaimLineUI, i: number) => (
                                          <TableRow key={i}>
                                            <TableCell>
                                              <p className="font-medium">{l.treatedName}</p>
                                              {l.occupationalInjury && <span className="text-xs font-semibold text-brand">CK / PJK</span>}
                                            </TableCell>
                                            <TableCell className="text-sm">{l.treatment ?? "—"}</TableCell>
                                            <TableCell className="text-sm">{fmtDateID(l.treatmentDate)}</TableCell>
                                            <TableCell className="text-sm">
                                              {l.physician || l.hospital ? `${l.physician ?? ""}${l.hospital ? ` · ${l.hospital}` : ""}` : "—"}
                                              {l.receiptNo && <span className="block text-xs text-slate-500">{t("kwitansi {n}", "receipt {n}", { n: l.receiptNo })}</span>}
                                            </TableCell>
                                            <TableCell className="text-right">{fmtIDR(l.billAmount)}</TableCell>
                                            <TableCell className="text-right font-semibold">{fmtIDR(l.approvedAmount)}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>

                                  {detail.statusLog?.length > 0 && (
                                    <div className="rounded-lg bg-white p-3 dark:bg-slate-900">
                                      <p className="mb-1.5 text-[11px] font-bold uppercase text-slate-400">{t("Log Status", "Status Log")}</p>
                                      <div className="space-y-1">
                                        {detail.statusLog.map((sl, i) => (
                                          <p key={i} className="text-xs text-slate-600 dark:text-slate-400">
                                            <span className="font-semibold">{t(CLAIM_STATUS_LABEL[sl.state] ?? sl.state, CLAIM_STATUS_LABEL_EN[sl.state])}</span>
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 ov-text-accent" /> {t("Ajukan Klaim Medis", "Submit Medical Claim")}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Karyawan *", "Employee *")}</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Jenis Benefit *", "Benefit Type *")}</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue placeholder={t("Pilih jenis", "Select type")} /></SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Tanggal Klaim *", "Claim Date *")}</Label>
              <Input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>
                {t("No. Surat Rujukan", "Referral Letter No.")}
                {/* W3-1 (fix G-2): wajib utk jenis needLetter */}
                {needLetter && <span className="text-rose-500"> *</span>}
              </Label>
              <Input value={letterNo} onChange={(e) => setLetterNo(e.target.value)} placeholder={needLetter ? t("wajib", "required") : t("opsional", "optional")} />
              {needLetter && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("Jenis {x} mewajibkan nomor surat rujukan dokter/RS", "Benefit type {x} requires a referral letter no.", { x: selectedType?.name })}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={forDependent} onCheckedChange={(v) => setForDependent(Boolean(v))} />
              {t("Klaim untuk anggota keluarga (dependent)", "Claim for a family member (dependent)")}
            </label>
          </div>

          {preview && (
            <div className="grid gap-2 rounded-xl border ov-border-accent ov-soft p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-[11px] font-bold uppercase ov-text-accent">{t("Limit", "Limit")}</p>
                <p className="font-black text-slate-900 dark:text-slate-50">{preview.limitRule === "UNLIMITED" || preview.unlimited ? "Unlimited" : fmtIDR(preview.benefitAmount)}</p>
                {preview.prorateFactor != null && preview.prorateFactor < 1 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t("prorata masa kerja {p}%", "tenure proration {p}%", { p: Math.round((preview.prorateFactor ?? 1) * 100) })}
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase ov-text-accent">{t("Sudah Terpakai", "Used So Far")}</p>
                <p className="font-black text-slate-900 dark:text-slate-50">{fmtIDR(preview.usedAmount)}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase ov-text-accent">
                  {t("Sisa Saldo", "Remaining Balance")}{preview.claimPool === "dependent" ? " (Dependent)" : forDependent && preview.claimPool === "employee" ? t(" (Bersama)", " (Shared)") : ""}
                </p>
                <p className="font-black text-slate-900 dark:text-slate-50">{preview.limitRule === "UNLIMITED" || preview.unlimited ? "∞" : fmtIDR(preview.remainingForClaim ?? preview.remaining)}</p>
                {preview.poolNote && <p className="text-xs text-slate-500">{preview.poolNote}</p>}
                {(preview.pendingReserved ?? 0) > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{t("menunggu klaim lain: {v}", "reserved by other pending claims: {v}", { v: fmtIDR(preview.pendingReserved ?? 0) })}</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase ov-text-accent">{t("Frekuensi", "Frequency")}</p>
                <p className="font-black text-slate-900 dark:text-slate-50">
                  {preview.freqUnlimited ? "Unlimited" : `${preview.freqValue}× / ${t(FREQ_PERIOD_LABEL[preview.freqPeriod] ?? preview.freqPeriod, FREQ_PERIOD_LABEL_EN[preview.freqPeriod] ?? preview.freqPeriod)}`}
                </p>
                <p className="text-xs text-slate-500">{t("{n} klaim tahun ini", "{n} claims this year", { n: preview.claimCountYear })}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-bold">{t("Baris Perawatan", "Treatment Lines")}</Label>
              <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
                <Plus className="h-3.5 w-3.5" /> {t("Baris", "Row")}
              </Button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Nama yang Dirawat *", "Treated Person Name *")}</Label>
                      {forDependent && familyMembers.length > 0 ? (
                        <Select
                          value={familyMembers.some((f) => f.name === l.treatedName) ? l.treatedName : "__manual"}
                          onValueChange={(v) => setLine(i, { treatedName: v === "__manual" ? "" : v })}
                        >
                          <SelectTrigger><SelectValue placeholder={t("Pilih dependent terdaftar", "Select registered dependent")} /></SelectTrigger>
                          <SelectContent>
                            {familyMembers.map((f) => (
                              <SelectItem key={f.id} value={f.name}>
                                {f.name}{f.relation === "Child" ? t(" (anak)", " (child)") : f.relation === "Spouse" ? t(" (pasangan)", " (spouse)") : ` (${f.relation})`}
                              </SelectItem>
                            ))}
                            <SelectItem value="__manual">{t("— Ketik manual —", "— Type manually —")}</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value={l.treatedName} onChange={(e) => setLine(i, { treatedName: e.target.value })} placeholder={t("karyawan / anggota keluarga", "employee / family member")} />
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Perawatan / Diagnosa", "Treatment / Diagnosis")}</Label>
                      <Input value={l.treatment} onChange={(e) => setLine(i, { treatment: e.target.value })} placeholder={t("mis. konsultasi, scaling, rawat inap 2 hari", "e.g. consultation, scaling, 2-day inpatient care")} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Tanggal Perawatan", "Treatment Date")}</Label>
                      <Input type="date" value={l.treatmentDate} onChange={(e) => setLine(i, { treatmentDate: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("No. Kwitansi", "Receipt No.")} {preview?.needReceipt ? "*" : ""}</Label>
                      <Input value={l.receiptNo} onChange={(e) => setLine(i, { receiptNo: e.target.value })} placeholder={t("mis. INV-2026-0042", "e.g. INV-2026-0042")} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Dokter", "Physician")}</Label>
                      <Input value={l.physician} onChange={(e) => setLine(i, { physician: e.target.value })} placeholder="dr. …" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Rumah Sakit / Klinik", "Hospital / Clinic")}</Label>
                      {hospitals.length > 0 ? (
                        <Select
                          value={hospitals.some((p) => p.id === l.providerId) ? l.providerId : "__manual"}
                          onValueChange={(v) => {
                            if (v === "__manual") {
                              setLine(i, { providerId: "", hospital: "" });
                            } else {
                              const p = hospitals.find((x) => x.id === v);
                              setLine(i, { providerId: v, hospital: p?.name ?? "" });
                            }
                          }}
                        >
                          <SelectTrigger><SelectValue placeholder={t("Pilih dari master", "Select from master")} /></SelectTrigger>
                          <SelectContent>
                            {hospitals.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}{p.city ? ` — ${p.city}` : ""}</SelectItem>
                            ))}
                            <SelectItem value="__manual">{t("— Ketik manual —", "— Type manually —")}</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value={l.hospital} onChange={(e) => setLine(i, { hospital: e.target.value })} placeholder={t("mis. RS Siloam Surabaya", "e.g. Siloam Hospital Surabaya")} />
                      )}
                      {l.hospital && !l.providerId && <Input value={l.hospital} onChange={(e) => setLine(i, { hospital: e.target.value })} placeholder={t("nama RS manual", "manual hospital name")} className="mt-1" />}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Tagihan (Bill) *", "Bill *")}</Label>
                      <Input type="number" min={0} value={l.billAmount} onChange={(e) => {
                        const bill = e.target.value;
                        setLine(i, { billAmount: bill, approvedAmount: l.approvedAmount || bill });
                      }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Disetujui *", "Approved *")}</Label>
                      <Input type="number" min={0} value={l.approvedAmount} onChange={(e) => setLine(i, { approvedAmount: e.target.value, reimburseAmount: l.reimburseAmount || e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Reimbursement", "Reimbursement")}</Label>
                      <Input type="number" min={0} value={l.reimburseAmount} onChange={(e) => setLine(i, { reimburseAmount: e.target.value })} />
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox checked={l.occupationalInjury} onCheckedChange={(v) => setLine(i, { occupationalInjury: Boolean(v) })} />
                        {t("Kecelakaan/Penyakit Kerja (CK)", "Occupational Injury / Illness (CK)")}
                      </label>
                      <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                        <Trash2 className="h-3.5 w-3.5 text-brand" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <span className="flex items-center gap-1.5 font-semibold"><Calculator className="h-4 w-4 ov-text-accent" /> {t("Total")}</span>
            <span className="text-slate-600 dark:text-slate-300">{t("Tagihan", "Bill")} <span className="font-black">{fmtIDR(totals.bill)}</span></span>
            <span className="text-slate-600 dark:text-slate-300">{t("Reimburse", "Reimburse")} <span className="font-black">{fmtIDR(totals.re)}</span></span>
            <span className="ov-text-accent">{t("Disetujui", "Approved")} <span className="font-black">{fmtIDR(totals.approved)}</span></span>
          </div>

          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Catatan pengajuan (opsional)…", "Submission note (optional)…")} rows={2} />

          {/* T16-ATTACH — upload kwitansi (multiple, preview, hapus pra-submit) */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm font-bold">
              <Paperclip className="h-3.5 w-3.5" />
              {t("Lampiran Kwitansi", "Receipt Attachments")}
              {selectedType?.needReceipt && <span className="text-amber-600 dark:text-amber-400">*</span>}
            </Label>
            <AttachmentUploadArea
              files={files}
              onChange={setFiles}
              hint={selectedType?.needReceipt ? t("Jenis benefit {x} mewajibkan lampiran kwitansi — unggah minimal 1 file", "Benefit type {x} requires receipts — upload at least 1 file", { x: selectedType.name }) : undefined}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? t("Mengirim…", "Submitting…") : t("Ajukan Klaim", "Submit Claim")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
