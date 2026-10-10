"use client";
// RekanKerja Recruitment F1 — daftar Permintaan Karyawan (PR) + form New/Edit
// (padanan PersonnelRequisition.jsp oranHR §2.3 analisa, state machine §4.3).
// Server-side: pagination offset + advance search `&` + filter status + sort.
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { encodeAdvParam, type AdvSearch, type AdvFieldDef, txt, dt, num, sel } from "@/rekankerja/shared/lib/adv-search";
import {
  PR_STATUSES, PR_STATUS_LABEL, PR_STATUS_LABEL_EN, PR_STATUS_TONE,
  PR_EMPLOYMENT_STATUSES, PR_EMPLOYMENT_LABEL, PR_EMPLOYMENT_LABEL_EN, PR_SOURCES,
  type PrRowUI, type PrOptions,
} from "./recruitment-types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  UserPlus, Search, Send, Ban, PauseCircle, PlayCircle, XCircle, Copy, MoreHorizontal,
  Pencil, Trash2, Eye, ChevronLeft, ChevronRight, FileSpreadsheet, Wallet, Clock3, CalendarRange,
} from "lucide-react";

const PAGE_SIZE = 10;

const todayISO = () => new Date().toISOString().slice(0, 10);

/** tanggal tampilan pendek dwibahasa (pola leave-requests) */
function fmtDay(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

/** Pill status PR — StatusPill global tidak mengenal Draft/OnHold/Fulfilled. */
function PrStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = PR_STATUS_TONE[status] ?? "slate";
  const cls: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
    rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
    violet: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/25",
    teal: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
    zinc: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/25",
  };
  const dot: Record<string, string> = {
    slate: "bg-slate-400", amber: "bg-amber-500", emerald: "bg-emerald-500", rose: "bg-rose-500",
    violet: "bg-violet-500", teal: "bg-teal-500", zinc: "bg-zinc-400",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", cls[tone], dot[tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot[tone])} />
      {t(PR_STATUS_LABEL[status] ?? status, PR_STATUS_LABEL_EN[status] ?? status)}
    </span>
  );
}

interface ListResp { rows: PrRowUI[]; total: number; stats: Record<string, number> }

// Advance search — SERVER-side (whitelist di pr-service PR_ADV_FIELDS).
const ADV_FIELDS: AdvFieldDef<Record<string, unknown>>[] = [
  txt("prNo", "Nomor PR", "PR No."),
  txt("requester", "Pengaju", "Requester"),
  txt("position", "Posisi", "Position"),
  txt("orgUnit", "Unit Organisasi", "Org Unit"),
  txt("officer", "Recruitment Officer", "Recruitment Officer"),
  sel("status", "Status", "Status", PR_STATUSES.map((s): [string, string, string] => [s.key, s.label, s.labelEn])),
  sel("employmentStatus", "Status Kerja", "Employment", PR_EMPLOYMENT_STATUSES.map((s): [string, string, string] => [s.key, s.label, s.labelEn])),
  dt("requestDate", "Tanggal Permintaan", "Request Date"),
  dt("earliestDate", "Paling Awal", "Earliest Date"),
  dt("latestDate", "Paling Lambat", "Latest Date"),
  num("requiredNo", "Jumlah Kebutuhan", "Required No."),
];

interface FormState {
  requestDate: string;
  requestedById: string;
  positionId: string;
  jobId: string;
  orgUnitId: string;
  companyOfficeId: string;
  requiredNo: string;
  employmentStatus: string;
  preferredSource: string;
  earliestDate: string;
  latestDate: string;
  recruitmentOfficerId: string;
  reason: string;
  miscSpec: string;
  additionalQualification: string;
  salaryBudget: string;
  autoPostOpening: boolean;
  slaTargetDays: string;
  replacedEmployeeId: string;
}

const emptyForm = (): FormState => ({
  requestDate: todayISO(),
  requestedById: "", positionId: "", jobId: "", orgUnitId: "", companyOfficeId: "",
  requiredNo: "1", employmentStatus: "Permanent", preferredSource: "Any",
  earliestDate: "", latestDate: "", recruitmentOfficerId: "",
  reason: "", miscSpec: "", additionalQualification: "",
  salaryBudget: "", autoPostOpening: false, slaTargetDays: "", replacedEmployeeId: "",
});

export function PrListPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [adv, setAdv] = useState<AdvSearch | null>(null);
  const [offset, setOffset] = useState(0);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // dialog create/edit + view
  const [dialog, setDialog] = useState<null | "new" | "edit">(null);
  const [editRow, setEditRow] = useState<PrRowUI | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitNow, setSubmitNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewRow, setViewRow] = useState<PrRowUI | null>(null);

  // dialog aksi dengan catatan (cancel/close)
  const [noteTarget, setNoteTarget] = useState<{ row: PrRowUI; action: "cancel" | "close" } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQ(query.trim()); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const url = useMemo(() => {
    const sp = new URLSearchParams({
      status: statusFilter, q: debouncedQ, limit: String(PAGE_SIZE), offset: String(offset),
      sortBy: "requestDate", sortDir,
    });
    const e = encodeAdvParam(adv);
    if (e) sp.set("adv", e);
    return `/api/rekankerja/recruitment/pr?${sp.toString()}`;
  }, [statusFilter, debouncedQ, offset, sortDir, adv]);

  const api = useApi<ListResp>(url, [url]);
  const optionsApi = useApi<PrOptions>("/api/rekankerja/recruitment/pr-options");
  const opts = optionsApi.data;

  const rows = api.data?.rows ?? [];
  const total = api.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const canCreate = perms.can("recruitment", "pr", "create");
  const canUpdate = perms.can("recruitment", "pr", "update");
  const canDelete = perms.can("recruitment", "pr", "delete");
  const canApply = perms.canOp("recruitment", "pr", "apply");
  const canCancel = perms.canOp("recruitment", "pr", "cancel");
  const canHold = perms.canOp("recruitment", "pr", "hold");
  const canClose = perms.canOp("recruitment", "pr", "close");
  const canDuplicate = perms.canOp("recruitment", "pr", "duplicate");

  const openNew = () => { setForm(emptyForm()); setEditRow(null); setSubmitNow(false); setDialog("new"); };
  const openEdit = (r: PrRowUI) => {
    setEditRow(r);
    setForm({
      requestDate: r.requestDate.slice(0, 10),
      requestedById: r.requestedById,
      positionId: r.positionId ?? "",
      jobId: r.jobId ?? "",
      orgUnitId: r.orgUnitId ?? "",
      companyOfficeId: r.companyOfficeId ?? "",
      requiredNo: String(r.requiredNo),
      employmentStatus: r.employmentStatus,
      preferredSource: r.preferredSource ?? "Any",
      earliestDate: r.earliestDate ? r.earliestDate.slice(0, 10) : "",
      latestDate: r.latestDate ? r.latestDate.slice(0, 10) : "",
      recruitmentOfficerId: r.recruitmentOfficerId ?? "",
      reason: r.reason ?? "",
      miscSpec: r.miscSpec ?? "",
      additionalQualification: r.additionalQualification ?? "",
      salaryBudget: r.salaryBudget != null ? String(r.salaryBudget) : "",
      autoPostOpening: r.autoPostOpening,
      slaTargetDays: r.slaTargetDays != null ? String(r.slaTargetDays) : "",
      replacedEmployeeId: r.replacedEmployeeId ?? "",
    });
    setSubmitNow(false);
    setDialog("edit");
  };

  const save = async () => {
    if (!form.requestedById) { toast.error(t("Pengaju (karyawan) wajib dipilih", "Requester (employee) is required")); return; }
    if (submitNow && !form.positionId) { toast.error(t("Posisi wajib dipilih untuk mengajukan", "Position is required to submit")); return; }
    setBusy(true);
    try {
      const body = {
        ...form,
        requiredNo: Number(form.requiredNo || 1),
        salaryBudget: form.salaryBudget === "" ? null : Number(form.salaryBudget),
        slaTargetDays: form.slaTargetDays === "" ? null : Number(form.slaTargetDays),
        submit: submitNow,
      };
      if (dialog === "edit" && editRow) {
        await apiSend("/api/rekankerja/recruitment/pr", "PATCH", { ...body, id: editRow.id, action: "update" });
        toast.success(t(`PR ${editRow.prNo} diperbarui`, `PR ${editRow.prNo} updated`));
      } else {
        const res = await apiSend<{ prNo: string; status: string; approvalLevels?: number; firstApprover?: string | null }>(
          "/api/rekankerja/recruitment/pr", "POST", body,
        );
        toast.success(
          submitNow
            ? t(`PR ${res.prNo} diajukan — menunggu keputusan ${res.firstApprover ?? "approver"}`, `PR ${res.prNo} submitted — awaiting ${res.firstApprover ?? "approver"}`)
            : t(`Draft PR ${res.prNo} disimpan`, `Draft PR ${res.prNo} saved`),
        );
      }
      setDialog(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan PR", "Failed to save the requisition"));
    } finally { setBusy(false); }
  };

  const doAction = async (row: PrRowUI, action: string, note?: string) => {
    try {
      const res = await apiSend<{ prNo: string; status: string; approvalLevels?: number; firstApprover?: string | null; final?: boolean }>(
        "/api/rekankerja/recruitment/pr", "PATCH", { id: row.id, action, note },
      );
      if (action === "apply") {
        toast.success(t(`PR ${res.prNo} diajukan — ${res.approvalLevels ?? 1} jenjang, menunggu ${res.firstApprover ?? "approver"}`, `PR ${res.prNo} submitted — ${res.approvalLevels ?? 1} tier(s), awaiting ${res.firstApprover ?? "approver"}`));
      } else if (action === "approve" || action === "reject") {
        toast.success(action === "approve" ? t(`PR ${res.prNo} disetujui`, `PR ${res.prNo} approved`) : t(`PR ${res.prNo} ditolak`, `PR ${res.prNo} rejected`));
      } else if (action === "hold") {
        toast.success(res.status === "OnHold"
          ? t(`PR ${res.prNo} ditahan (On Hold)`, `PR ${res.prNo} put on hold`)
          : t(`PR ${res.prNo} dilanjutkan kembali`, `PR ${res.prNo} resumed`));
      } else {
        toast.success(t(`PR ${res.prNo}: ${res.status}`, `PR ${res.prNo}: ${res.status}`));
      }
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Aksi gagal", "Action failed"));
    }
  };

  const duplicate = async (row: PrRowUI) => {
    try {
      const res = await apiSend<{ prNo: string }>("/api/rekankerja/recruitment/pr", "POST", { duplicateOf: row.id });
      toast.success(t(`Duplikat dibuat: draft ${res.prNo}`, `Duplicate created: draft ${res.prNo}`));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menduplikasi PR", "Failed to duplicate the requisition"));
    }
  };

  const remove = async (row: PrRowUI) => {
    if (!window.confirm(t(`Hapus draft PR ${row.prNo}?`, `Delete draft PR ${row.prNo}?`))) return;
    try {
      await apiSend(`/api/rekankerja/recruitment/pr?id=${row.id}`, "DELETE");
      toast.success(t(`Draft PR ${row.prNo} dihapus`, `Draft PR ${row.prNo} deleted`));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus PR", "Failed to delete the requisition"));
    }
  };

  const submitNote = async () => {
    if (!noteTarget) return;
    setNoteBusy(true);
    try {
      await doAction(noteTarget.row, noteTarget.action, noteText.trim() || undefined);
      setNoteTarget(null);
      setNoteText("");
    } finally { setNoteBusy(false); }
  };

  const employeeItems = (opts?.employees ?? []).map((e) => (
    <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</SelectItem>
  ));

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · Permintaan Karyawan")}
        title={t("Permintaan Karyawan (PR)", "Personnel Requisition (PR)")}
        description={t(
          "Pengajuan kebutuhan karyawan baru/pengganti — masuk jalur approval berjenjang sebelum dibuka lowongan (F2). Padanan Personnel Requisition oranHR.",
          "New/replacement headcount requests — routed through tiered approval before job openings are created (F2). oranHR Personnel Requisition equivalent.",
        )}
        actions={canCreate && (
          <Button onClick={openNew} className="ov-fill ov-glow gap-2">
            <UserPlus className="h-4 w-4" aria-hidden /> {t("PR Baru", "New Requisition")}
          </Button>
        )}
      />

      {/* ringkasan status */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {PR_STATUSES.map((s) => (
          <button
            key={s.key}
            onClick={() => { setStatusFilter(statusFilter === s.key ? "all" : s.key); setOffset(0); }}
            className={cn(
              "rounded-xl border p-3 text-left transition-colors",
              statusFilter === s.key
                ? "ov-border-accent ov-soft"
                : "border-slate-200 bg-white/80 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700",
            )}
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(s.label, s.labelEn)}</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
              {api.data?.stats?.[s.key === "Draft" ? "draft" : s.key === "Submitted" ? "submitted" : s.key === "Approved" ? "approved" : s.key === "Rejected" ? "rejected" : s.key === "OnHold" ? "onHold" : s.key === "Fulfilled" ? "fulfilled" : s.key === "Closed" ? "closed" : "cancelled"] ?? 0}
            </div>
          </button>
        ))}
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4">
          {/* toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Cari nomor / pengaju / posisi…", "Search no. / requester / position…")}
                className="pl-9"
                aria-label={t("Pencarian", "Search")}
              />
            </div>
            <AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={(v) => { setAdv(v); setOffset(0); }} />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}>
              <CalendarRange className="h-4 w-4" aria-hidden />
              {sortDir === "desc" ? t("Terbaru", "Newest") : t("Terlama", "Oldest")}
            </Button>
          </div>

          {api.loading && !api.data ? (
            <LoadingRows rows={6} />
          ) : api.error ? (
            <EmptyState title={t("Gagal memuat daftar PR", "Failed to load requisitions")} description={api.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title={t("Belum ada permintaan karyawan", "No personnel requisitions yet")}
              description={t(
                "Buat PR baru untuk mengajukan kebutuhan karyawan — PR disetujui akan jadi dasar lowongan rekrutmen.",
                "Create a new requisition to request headcount — approved PRs become the basis for job openings.",
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Nomor PR", "PR No.")}</TableHead>
                    <TableHead>{t("Pengaju", "Requester")}</TableHead>
                    <TableHead>{t("Posisi / Jumlah", "Position / Headcount")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Status Kerja", "Employment")}</TableHead>
                    <TableHead>{t("Status", "Status")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Approval", "Approval")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("Anggaran", "Budget")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setViewRow(r)}>
                      <TableCell className="font-mono text-xs font-semibold">{r.prNo}
                        <div className="mt-0.5 font-sans text-[11px] font-normal text-slate-500 dark:text-slate-400">
                          {fmtDay(r.requestDate, locale)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.requesterName}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.requesterNo}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.positionTitle ?? "—"}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t("{n} orang", "{n} headcount", { n: String(r.requiredNo) })}
                          {r.replacedEmployeeName ? ` · ${t("pengganti {n}", "replacing {n}", { n: r.replacedEmployeeName })}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{t(PR_EMPLOYMENT_LABEL[r.employmentStatus] ?? r.employmentStatus, PR_EMPLOYMENT_LABEL_EN[r.employmentStatus] ?? r.employmentStatus)}</TableCell>
                      <TableCell><PrStatusPill status={r.status} /></TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {r.approval && r.status === "Submitted" ? (
                          <div className="text-xs">
                            <span className="font-semibold">{t("Jenjang", "Tier")} {r.approval.currentLevel}/{r.approval.totalLevels}</span>
                            <div className="text-slate-500 dark:text-slate-400">{r.approval.currentApprover ?? "—"}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {r.salaryBudget != null ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                            <Wallet className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Rp {r.salaryBudget.toLocaleString("id-ID")}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Aksi PR", "PR actions")}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => setViewRow(r)}><Eye className="h-4 w-4" /> {t("Lihat detail", "View detail")}</DropdownMenuItem>
                            {r.status === "Draft" && canUpdate && <DropdownMenuItem onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /> {t("Ubah", "Edit")}</DropdownMenuItem>}
                            {r.status === "Draft" && canApply && <DropdownMenuItem onClick={() => doAction(r, "apply")}><Send className="h-4 w-4" /> {t("Ajukan (Apply)", "Submit (Apply)")}</DropdownMenuItem>}
                            {canDuplicate && <DropdownMenuItem onClick={() => duplicate(r)}><Copy className="h-4 w-4" /> {t("Duplikat", "Duplicate")}</DropdownMenuItem>}
                            {(r.status === "Approved" || r.status === "OnHold") && canHold && (
                              <DropdownMenuItem onClick={() => doAction(r, "hold")}>
                                {r.status === "Approved" ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                                {r.status === "Approved" ? t("Tahan (On Hold)", "Put on Hold") : t("Lanjutkan kembali", "Resume")}
                              </DropdownMenuItem>
                            )}
                            {(r.status === "Approved" || r.status === "OnHold") && canClose && (
                              <DropdownMenuItem onClick={() => { setNoteTarget({ row: r, action: "close" }); setNoteText(""); }}>
                                <XCircle className="h-4 w-4" /> {t("Tutup PR…", "Close PR…")}
                              </DropdownMenuItem>
                            )}
                            {(r.status === "Draft" || r.status === "Submitted") && canCancel && (
                              <DropdownMenuItem onClick={() => { setNoteTarget({ row: r, action: "cancel" }); setNoteText(""); }}>
                                <Ban className="h-4 w-4" /> {t("Batalkan…", "Cancel…")}
                              </DropdownMenuItem>
                            )}
                            {r.status === "Draft" && canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => remove(r)}>
                                  <Trash2 className="h-4 w-4" /> {t("Hapus draft", "Delete draft")}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* pagination */}
          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{t("Halaman {p} dari {n} — {t2} PR", "Page {p} of {n} — {t2} requisitions", { p: String(page), n: String(pages), t2: String(total) })}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label={t("Halaman sebelumnya", "Previous page")}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)} aria-label={t("Halaman berikutnya", "Next page")}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog form New/Edit ===== */}
      <Dialog open={dialog != null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialog === "edit"
                ? t("Ubah PR — {no}", "Edit PR — {no}", { no: editRow?.prNo ?? "" })
                : t("Permintaan Karyawan Baru", "New Personnel Requisition")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Kebutuhan", "Requirement")}</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("Tanggal Permintaan", "Request Date")}</Label>
                  <Input type="date" value={form.requestDate} onChange={(e) => setForm({ ...form, requestDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Pengaju *", "Requester *")}</Label>
                  <Select value={form.requestedById} onValueChange={(v) => setForm({ ...form, requestedById: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Pilih karyawan pengaju", "Select requester")} /></SelectTrigger>
                    <SelectContent className="max-h-64">{employeeItems}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Posisi *", "Position *")}</Label>
                  <Select value={form.positionId || undefined} onValueChange={(v) => setForm({ ...form, positionId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Pilih posisi", "Select position")} /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {(opts?.positions ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Job", "Job")}</Label>
                  <Select value={form.jobId || undefined} onValueChange={(v) => setForm({ ...form, jobId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {(opts?.jobs ?? []).map((j) => (
                        <SelectItem key={j.id} value={j.id}>{j.code} — {j.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Unit Organisasi", "Org Unit")}</Label>
                  <Select value={form.orgUnitId || undefined} onValueChange={(v) => setForm({ ...form, orgUnitId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {(opts?.orgUnits ?? []).map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.code} — {o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Kantor", "Office")}</Label>
                  <Select value={form.companyOfficeId || undefined} onValueChange={(v) => setForm({ ...form, companyOfficeId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {(opts?.offices ?? []).map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.name}{o.city ? ` — ${o.city}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                  <div className="space-y-1.5">
                    <Label>{t("Jumlah Kebutuhan (orang)", "Headcount (persons)")}</Label>
                    <Input type="number" min={1} max={999} value={form.requiredNo} onChange={(e) => setForm({ ...form, requiredNo: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("Status Kerja", "Employment Status")}</Label>
                    <Select value={form.employmentStatus} onValueChange={(v) => setForm({ ...form, employmentStatus: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PR_EMPLOYMENT_STATUSES.map((s) => (
                          <SelectItem key={s.key} value={s.key}>{t(s.label, s.labelEn)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Jadwal & SLA", "Schedule & SLA")}</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>{t("Kebutuhan Paling Awal", "Earliest Date")}</Label>
                  <Input type="date" value={form.earliestDate} onChange={(e) => setForm({ ...form, earliestDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Paling Lambat", "Latest Date")}</Label>
                  <Input type="date" value={form.latestDate} onChange={(e) => setForm({ ...form, latestDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Clock3 className="h-3 w-3" aria-hidden /> {t("Target SLA (hari)", "SLA Target (days)")}</Label>
                  <Input type="number" min={1} max={365} placeholder="30" value={form.slaTargetDays} onChange={(e) => setForm({ ...form, slaTargetDays: e.target.value })} />
                </div>
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Anggaran & Sumber", "Budget & Sourcing")}</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Wallet className="h-3 w-3" aria-hidden /> {t("Anggaran Gaji (Rp/bulan, opsional)", "Salary Budget (Rp/month, optional)")}</Label>
                  <Input type="number" min={0} placeholder="15000000" value={form.salaryBudget} onChange={(e) => setForm({ ...form, salaryBudget: e.target.value })} />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t("Terenkripsi vault uang — hanya role dengan izin yang melihat.", "Encrypted in the money vault — visible only to permitted roles.")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Sumber Kandidat Pilihan", "Preferred Source")}</Label>
                  <Select value={form.preferredSource || "Any"} onValueChange={(v) => setForm({ ...form, preferredSource: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PR_SOURCES.map((s) => (
                        <SelectItem key={s.key} value={s.key}>{t(s.label, s.labelEn)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Recruitment Officer", "Recruitment Officer")}</Label>
                  <Select value={form.recruitmentOfficerId || undefined} onValueChange={(v) => setForm({ ...form, recruitmentOfficerId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional — pemilik proses", "Optional — process owner")} /></SelectTrigger>
                    <SelectContent className="max-h-64">{employeeItems}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("PR Pengganti Karyawan (attrition)", "Replacement of Employee (attrition)")}</Label>
                  <Select value={form.replacedEmployeeId || undefined} onValueChange={(v) => setForm({ ...form, replacedEmployeeId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                    <SelectContent className="max-h-64">{employeeItems}</SelectContent>
                  </Select>
                </div>
              </div>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <Checkbox checked={form.autoPostOpening} onCheckedChange={(c) => setForm({ ...form, autoPostOpening: c === true })} className="mt-0.5" />
                <span>
                  {t("Auto-post lowongan saat PR disetujui", "Auto-post job opening when the PR is approved")}
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    {t("Lowongan dibuat otomatis di fase F2 (JobOpening).", "The opening is created automatically in phase F2 (JobOpening).")}
                  </span>
                </span>
              </label>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Detail & Alasan", "Detail & Reason")}</h4>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>{t("Alasan Kebutuhan", "Reason")}</Label>
                  <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder={t("Contoh: ekspansi lini produksi 2, penambahan shift malam", "e.g. production line 2 expansion, new night shift")} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Spesifikasi Lain", "Misc Specification")}</Label>
                  <Textarea rows={2} value={form.miscSpec} onChange={(e) => setForm({ ...form, miscSpec: e.target.value })}
                    placeholder={t("Jam kerja shift, penempatan khusus, catatan negosiasi…", "Shift hours, special placement, negotiation notes…")} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Kualifikasi Tambahan", "Additional Qualification")}</Label>
                  <Textarea rows={2} value={form.additionalQualification} onChange={(e) => setForm({ ...form, additionalQualification: e.target.value })}
                    placeholder={t("Di luar kualifikasi standar job/posisi", "Beyond the standard job/position qualifications")} />
                </div>
              </div>
            </section>
          </div>

          <DialogFooter className="mt-2 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={submitNow} onCheckedChange={(c) => setSubmitNow(c === true)} />
              {t("Ajukan langsung ke approval", "Submit directly to approval")}
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialog(null)}>{t("Batal", "Cancel")}</Button>
              <Button onClick={save} disabled={busy} className="ov-fill">
                {busy ? t("Menyimpan…", "Saving…") : dialog === "edit" ? t("Simpan Perubahan", "Save Changes") : submitNow ? t("Simpan & Ajukan", "Save & Submit") : t("Simpan Draft", "Save Draft")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog detail (view) ===== */}
      <Dialog open={viewRow != null} onOpenChange={(o) => { if (!o) setViewRow(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{viewRow?.prNo}</span>
              {viewRow && <PrStatusPill status={viewRow.status} />}
            </DialogTitle>
          </DialogHeader>
          {viewRow && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {([
                  [t("Tanggal Permintaan", "Request Date"), fmtDay(viewRow.requestDate, locale)],
                  [t("Pengaju", "Requester"), `${viewRow.requesterName} (${viewRow.requesterNo})`],
                  [t("Posisi", "Position"), viewRow.positionTitle ?? "—"],
                  [t("Job", "Job"), viewRow.jobTitle ?? "—"],
                  [t("Unit Organisasi", "Org Unit"), viewRow.orgUnitName ?? "—"],
                  [t("Kantor", "Office"), viewRow.officeName ?? "—"],
                  [t("Jumlah Kebutuhan", "Headcount"), String(viewRow.requiredNo)],
                  [t("Status Kerja", "Employment"), t(PR_EMPLOYMENT_LABEL[viewRow.employmentStatus] ?? viewRow.employmentStatus, PR_EMPLOYMENT_LABEL_EN[viewRow.employmentStatus] ?? viewRow.employmentStatus)],
                  [t("Sumber Kandidat", "Preferred Source"), viewRow.preferredSource ?? "—"],
                  [t("Recruitment Officer", "Recruitment Officer"), viewRow.officerName ?? "—"],
                  [t("Paling Awal", "Earliest"), fmtDay(viewRow.earliestDate, locale)],
                  [t("Paling Lambat", "Latest"), fmtDay(viewRow.latestDate, locale)],
                  [t("Target SLA", "SLA Target"), viewRow.slaTargetDays != null ? `${viewRow.slaTargetDays} ${t("hari", "days")}` : "—"],
                  [t("Anggaran Gaji", "Salary Budget"), viewRow.salaryBudget != null ? `Rp ${viewRow.salaryBudget.toLocaleString("id-ID")}` : t("disembunyikan / kosong", "hidden / empty")],
                  [t("Pengganti", "Replacing"), viewRow.replacedEmployeeName ?? "—"],
                  [t("Auto-post Lowongan", "Auto-post Opening"), viewRow.autoPostOpening ? t("Ya (aktif di F2)", "Yes (active in F2)") : t("Tidak", "No")],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{k}</div>
                    <div className="font-medium">{v}</div>
                  </div>
                ))}
              </div>
              {viewRow.reason && (
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("Alasan", "Reason")}</div>
                  <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">{viewRow.reason}</p>
                </div>
              )}
              {viewRow.miscSpec && (
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("Spesifikasi Lain", "Misc Specification")}</div>
                  <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">{viewRow.miscSpec}</p>
                </div>
              )}
              {viewRow.additionalQualification && (
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("Kualifikasi Tambahan", "Additional Qualification")}</div>
                  <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">{viewRow.additionalQualification}</p>
                </div>
              )}
              {viewRow.approval && (
                <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="mb-1 text-xs font-semibold">{t("Jalur Approval", "Approval Chain")}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    {t("Jenjang {c} dari {n}", "Tier {c} of {n}", { c: String(viewRow.approval.currentLevel), n: String(viewRow.approval.totalLevels) })} · {viewRow.approval.currentApprover ?? "—"}
                    {viewRow.approval.status !== "InProgress" ? ` · ${viewRow.approval.status}` : ""}
                  </div>
                </div>
              )}
              {viewRow.decisionNote && (
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("Catatan Keputusan", "Decision Note")}</div>
                  <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">{viewRow.decisionNote}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewRow(null)}>{t("Tutup", "Close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog catatan (cancel/close) ===== */}
      <Dialog open={noteTarget != null} onOpenChange={(o) => { if (!o) setNoteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {noteTarget?.action === "close" ? t("Tutup PR", "Close PR") : t("Batalkan PR", "Cancel PR")} — {noteTarget?.row.prNo}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {noteTarget?.action === "close"
                ? t("PR yang ditutup tidak dapat dibuka kembali — rekrutmen dihentikan. Anda bisa menduplikasi PR bila dibutuhkan lagi.", "A closed PR cannot be reopened — recruitment is stopped. You can duplicate the PR if needed again.")
                : t("Pengajuan akan dibatalkan (termasuk jalur approval bila masih menunggu).", "The request will be cancelled (including the approval chain if still pending).")}
            </p>
            <div className="space-y-1.5">
              <Label>{t("Catatan (opsional)", "Note (optional)")}</Label>
              <Textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("Alasan pembatalan / penutupan…", "Reason for cancelling / closing…")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" onClick={submitNote} disabled={noteBusy}>
              {noteBusy ? t("Memproses…", "Processing…") : noteTarget?.action === "close" ? t("Tutup PR", "Close PR") : t("Batalkan PR", "Cancel PR")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
