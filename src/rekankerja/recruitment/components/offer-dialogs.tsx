"use client";
// RekanKerja Recruitment F4 — dialog view "Offer & Pengangkatan":
//   · OfferFormDialog — buat/edit offer Draft (PR + kandidat offerable + gaji
//     dgn guidance rentang iklan JO + tanggal mulai/expiry + note).
//   · ApprovalChainDialog — jenjang approval offer (approver + status + note).
//   · DecisionDialog — keputusan (approve/reject-approval/accept/decline)
//     dgn catatan (note counter/nego kandidat).
//   · OfferLetterDialog — pratinjau surat (PDF inline) + unduh.
//   · AppointFlowDialog — alur pengangkatan 3 keadaan: form penempatan
//     (prefill ?context=) → konfirmasi onboarding → hasil karyawan baru.
// Tipe mirror serializer offer-service/appointment-service (pola F2/F3:
// komponen client TIDAK meng-import file service). Dwibahasa t(id,en).
import { useEffect, useState, type ReactNode } from "react";
import { useApi, apiSend, fmtIDR, fmtDate, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  AlertTriangle, BadgeCheck, CalendarClock, Check, ChevronsUpDown, Copy, Download, FileText,
  Handshake, History, Info, Link2, ListChecks, MessagesSquare, PartyPopper, Send, UserRoundCheck,
} from "lucide-react";

export const OFFERS_API = "/api/rekankerja/recruitment/offers";

// ============ tipe (mirror JSON API F4) ============

export type OfferStatus = "Draft" | "PendingApproval" | "Sent" | "Viewed" | "Accepted" | "Declined" | "Expired";

export interface OfferRow {
  id: string;
  offerNo: string;
  status: OfferStatus;
  prId: string;
  prNo: string;
  positionTitle: string | null;
  candidateId: string;
  candidateName: string;
  candidateSource: string;
  jobOpeningId: string | null;
  joRefNo: string | null;
  salary: number | null;
  currency: string;
  salaryUnit: string;
  startDate: string | null;
  expiryDate: string | null;
  expiresInDays: number | null;
  letterNo: string | null;
  letterId: string | null;
  note: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  appointedAt: string | null;
  hasAppointment: boolean;
  createdAt: string;
  /** P2.4 — riwayat versi ringkas. */
  versions: OfferVersionLite[];
}

/** P2.4 — versi ringkas offer (D-BM19). */
export interface OfferVersionLite {
  versionNo: number;
  label: string | null;
  createdAt: string;
  createdById: string | null;
}

/** P2.4 — diff non-uang antar versi "a → b". */
export interface OfferVersionDiffField {
  field: string;
  from: string | null;
  to: string | null;
}

/** P2.4 — diff nominal (angka hanya bila brankas terbuka). */
export interface OfferSalaryDiff {
  from: number | null;
  to: number | null;
  changed: boolean;
}

export interface OfferVersionView extends OfferVersionLite {
  diff: {
    fields: OfferVersionDiffField[];
    salaryDiff: OfferSalaryDiff | null;
  } | null;
}

export interface ChainStepLite {
  levelNo: number;
  approverType: string;
  approverLabel: string;
  status: string; // Waiting|Current|Approved|Rejected|Skipped
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface ChainLite {
  id: string;
  status: string;
  currentLevel: number;
  totalLevels: number;
  steps: ChainStepLite[];
}

export interface AppointmentLite {
  id: string;
  appointmentDate: string;
  status: string; // Appointed|Onboarded
  letterNo: string | null;
  positionTitle: string | null;
  officeName: string | null;
  supervisorName: string | null;
  employeeNo: string | null;
  employeeId: string | null;
  onboardingId: string | null;
}

export interface OfferDetailRow extends OfferRow {
  approval: ChainLite | null;
  appointment: AppointmentLite | null;
  /** P2.4 — versi + diff vs versi sebelumnya. */
  versionDiffs: OfferVersionView[];
  /** P2.4 — tautan putusan mandiri (raw token) bila Sent/Viewed + token aktif. */
  selfServiceLink: string | null;
}

export interface OfferableCandidate {
  id: string;
  fullName: string;
  status: string;
  source: string;
  applicantNo: string | null;
  expectedSalary: number | null;
  currentStage: string | null;
  activeOfferNo: string | null;
}

export interface OfferablePr {
  id: string;
  prNo: string;
  positionTitle: string | null;
  requiredNo: number;
  employmentStatus: string;
  officerName: string | null;
  appointedCount: number;
  salaryGuide: { min: number | null; max: number | null } | null;
  salaryBudget: number | null;
  candidates: OfferableCandidate[];
}

export interface AppointContext {
  offer: { id: string; offerNo: string; status: string; salary: number | null; startDate: string | null; expiryDate: string | null };
  candidate: { id: string; fullName: string; source: string; applicantNo: string | null; email: string | null; phone: string | null };
  pr: {
    id: string; prNo: string; positionTitle: string | null; requiredNo: number; employmentStatus: string;
    orgUnitId: string | null; orgUnitName: string | null; companyOfficeId: string | null; officeName: string | null; officerId: string | null;
  };
  documents: { id: string; title: string; verified: boolean; fileName: string | null }[];
  otherActiveCandidates: { id: string; fullName: string; status: string }[];
  appointedCount: number;
  employees: { id: string; employeeNo: string; fullName: string; positionTitle: string | null }[];
  grades: { id: string; code: string; name: string }[];
  positions: { id: string; title: string; code: string }[];
  offices: { id: string; name: string }[];
  workLocations: { id: string; name: string }[];
}

export interface AppointResult {
  appointmentId: string;
  letterNo: string;
  prStatus: string;
  rejectedCount: number;
}

export interface OnboardResult {
  employeeId: string;
  employeeNo: string;
  onboardingId: string;
  emailsSent: number;
}

export interface ApprovalInboxRow {
  id: string;
  offerNo: string;
  candidateName: string;
  prNo: string;
  positionTitle: string | null;
  salary: string | null;
  approval: ChainLite;
}

// ============ label domain + pill (pola STATUS_TONE F4) ============

export const OFFER_STATUS_LABEL: Record<string, string> = {
  Draft: "Draft",
  PendingApproval: "Menunggu Approval",
  Sent: "Terkirim",
  Viewed: "Dilihat",
  Accepted: "Diterima",
  Declined: "Ditolak",
  Expired: "Kedaluwarsa",
};
export const OFFER_STATUS_LABEL_EN: Record<string, string> = {
  Draft: "Draft",
  PendingApproval: "Pending Approval",
  Sent: "Sent",
  Viewed: "Viewed",
  Accepted: "Accepted",
  Declined: "Declined",
  Expired: "Expired",
};

const OFFER_TONE_CLS: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  PendingApproval: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  Sent: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/25",
  Viewed: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/25",
  Accepted: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  Declined: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  Expired: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/25",
};
const OFFER_TONE_DOT: Record<string, string> = {
  Draft: "bg-slate-400", PendingApproval: "bg-amber-500", Sent: "bg-cyan-500", Viewed: "bg-violet-500",
  Accepted: "bg-emerald-500", Declined: "bg-rose-500", Expired: "bg-zinc-400",
};

export function OfferStatusPill({ status, className }: { status: string; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      OFFER_TONE_CLS[status] ?? OFFER_TONE_CLS.Draft, className,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", OFFER_TONE_DOT[status] ?? OFFER_TONE_DOT.Draft)} />
      {t(OFFER_STATUS_LABEL[status] ?? status, OFFER_STATUS_LABEL_EN[status] ?? status)}
    </span>
  );
}

/** "YYYY-MM-DD" hari ini (lokal). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" hari ini + n hari. */
export function isoPlusDays(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ============ helper kecil ============

/** baris label:value (pola Field F3). */
function Field({ label, value, danger }: { label: string; value: ReactNode; danger?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className={cn("text-xs", danger ? "font-semibold text-rose-600 dark:text-rose-400" : "font-medium text-slate-700 dark:text-slate-200")}>{value}</div>
    </div>
  );
}

/** pill status langkah approval chain. */
function ChainStepPill({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, [string, string, string]> = {
    Waiting: [t("Menunggu", "Waiting"), "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25", ""],
    Current: [t("Menunggu Keputusan", "Awaiting Decision"), "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25", "bg-amber-500"],
    Approved: [t("Disetujui", "Approved"), "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25", "bg-emerald-500"],
    Rejected: [t("Ditolak", "Rejected"), "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", "bg-rose-500"],
    Skipped: [t("Dilewati", "Skipped"), "bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/25", "bg-zinc-400"],
  };
  const [label, cls, dot] = map[status] ?? map.Waiting;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold", cls)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />}
      {label}
    </span>
  );
}

/** daftar jenjang chain approval (dipakai dialog chain + inbox). */
export function ChainSteps({ chain }: { chain: ChainLite | null }) {
  const { t } = useI18n();
  if (!chain) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400 dark:border-slate-700">
        {t("Tidak ada jenjang approval — offer langsung terkirim saat dikirim (jalur cepat).", "No approval chain — offers are sent straight away (fast path).")}
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {chain.steps.map((s) => (
        <li key={s.levelNo} className={cn("rounded-xl border p-2.5",
          s.status === "Current" ? "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10"
            : "border-slate-200 dark:border-slate-800")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">{s.levelNo}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{s.approverLabel}</span>
            <ChainStepPill status={s.status} />
          </div>
          {(s.decidedBy || s.decidedAt || s.note) && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-8 text-[10px] text-slate-500 dark:text-slate-400">
              {s.decidedBy && <span>{t("oleh", "by")} {s.decidedBy}</span>}
              {s.decidedAt && <span>{fmtDateTime(s.decidedAt)}</span>}
              {s.note && <span className="italic">“{s.note}”</span>}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

// ============================================================
// Dialog buat / edit offer (Draft)
// ============================================================

/** picker kandidat offerable (searchable — pola PersonPicker F3, + disable offer aktif). */
function CandidatePicker({ candidates, selectedId, onSelect }: {
  candidates: OfferableCandidate[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-10 w-full justify-between font-normal">
          {selected ? (
            <span className="min-w-0 truncate text-left">
              <b>{selected.fullName}</b>
              {selected.applicantNo ? ` · ${selected.applicantNo}` : ""}
              {selected.expectedSalary != null ? ` · ${t("ekspektasi", "expects")} ${fmtIDR(selected.expectedSalary)}` : ""}
            </span>
          ) : (
            <span className="text-slate-400">{t("Cari kandidat lulus seleksi…", "Search a selection-passed candidate…")}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter>
          <CommandInput placeholder={t("Ketik nama kandidat…", "Type a candidate name…")} />
          <CommandList className="max-h-64">
            <CommandEmpty>{t("Tidak ditemukan.", "No results found.")}</CommandEmpty>
            <CommandGroup>
              {candidates.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.fullName} ${c.applicantNo ?? ""}`}
                  disabled={!!c.activeOfferNo}
                  onSelect={() => { onSelect(c.id); setOpen(false); }}
                  className="items-start"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <b className="text-[13px]">{c.fullName}</b>
                      {c.applicantNo && <span className="font-mono text-[10px] text-slate-400">{c.applicantNo}</span>}
                      <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                        c.status === "Passed"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400")}>
                        {c.status === "Passed" ? t("Lulus", "Passed") : t("Proses", "In Process")}
                      </span>
                      {c.activeOfferNo && (
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                          {t("offer aktif", "active offer")} {c.activeOfferNo}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                      {c.currentStage ? `${t("tahap", "stage")}: ${c.currentStage}` : t("semua tahap seleksi lulus", "all selection stages passed")}
                      {c.expectedSalary != null ? ` · ${t("ekspektasi gaji", "expected salary")} ${fmtIDR(c.expectedSalary)}` : ""}
                    </span>
                  </span>
                  <Check className={cn("h-4 w-4 shrink-0", selectedId === c.id ? "opacity-100 ov-text-accent" : "opacity-0")} aria-hidden />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export interface OfferFormTarget {
  mode: "create" | "edit";
  /** create: PR terpilih (opsional) + kandidat prefill (dari board seleksi). */
  prId?: string;
  candidateId?: string;
  /** edit: baris offer Draft. */
  row?: OfferRow;
}

export function OfferFormDialog({ target, prs, onClose, onDone }: {
  target: OfferFormTarget | null;
  prs: OfferablePr[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [prId, setPrId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [salary, setSalary] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const edit = target?.mode === "edit" ? target.row ?? null : null;

  useEffect(() => {
    if (!target) return;
    if (edit) {
      setPrId("");
      setCandidateId("");
      setSalary(edit.salary != null ? String(edit.salary) : "");
      setStartDate(edit.startDate ? edit.startDate.slice(0, 10) : "");
      setExpiryDate(edit.expiryDate ? edit.expiryDate.slice(0, 10) : "");
      setNote(edit.note ?? "");
    } else {
      const p = prs.find((x) => x.id === target.prId) ?? prs[0];
      setPrId(p?.id ?? "");
      setCandidateId(target.candidateId ?? "");
      setSalary("");
      setStartDate(todayIso());
      setExpiryDate(isoPlusDays(14));
      setNote("");
    }
  }, [target, prs]);

  const pr = prs.find((p) => p.id === prId) ?? null;
  const candidates = pr?.candidates ?? [];
  const guide = pr?.salaryGuide ?? null;
  const salaryNum = salary === "" ? null : Number(salary);
  const outOfRange = guide != null && salaryNum != null && Number.isFinite(salaryNum)
    && ((guide.min != null && salaryNum < guide.min) || (guide.max != null && salaryNum > guide.max));

  const submit = async () => {
    if (!target) return;
    if (!edit) {
      if (!prId) { toast.error(t("Pilih PR terlebih dahulu", "Pick a PR first")); return; }
      if (!candidateId) { toast.error(t("Pilih kandidat", "Pick a candidate")); return; }
    }
    setBusy(true);
    try {
      if (edit) {
        await apiSend(OFFERS_API, "POST", {
          action: "update", id: edit.id,
          salary: salary === "" ? null : Number(salary),
          startDate: startDate || null,
          expiryDate: expiryDate || null,
          note: note || null,
        });
        toast.success(t(`Offer ${edit.offerNo} diperbarui`, `Offer ${edit.offerNo} updated`));
      } else {
        const res = await apiSend<{ id: string; offerNo: string; warning: string | null }>(OFFERS_API, "POST", {
          action: "create",
          prId, candidateId,
          salary: salary === "" ? null : Number(salary),
          startDate: startDate || null,
          expiryDate: expiryDate || null,
          note: note || null,
        });
        toast.success(t(`Offer ${res.offerNo} dibuat (Draft) — siap dikirim`, `Offer ${res.offerNo} created (Draft) — ready to send`));
        if (res.warning) toast.warning(res.warning, { duration: 9000 });
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan offer", "Failed to save the offer"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={target != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-4 w-4 ov-text-accent" aria-hidden />
            {edit
              ? t("Edit Offer — {no}", "Edit Offer — {no}", { no: edit.offerNo })
              : t("Buat Offer", "Create Offer")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {edit ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
              <Field label="Offer" value={<span className="font-mono">{edit.offerNo}</span>} />
              <Field label={t("Status", "Status")} value={<OfferStatusPill status={edit.status} />} />
              <Field label={t("Kandidat", "Candidate")} value={edit.candidateName} />
              <Field label={t("PR", "PR")} value={`${edit.prNo}${edit.positionTitle ? ` — ${edit.positionTitle}` : ""}`} />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>{t("Permintaan Karyawan (PR) *", "Personnel Requisition (PR) *")}</Label>
                <Select value={prId || undefined} onValueChange={(v) => { setPrId(v); setCandidateId(""); }}>
                  <SelectTrigger><SelectValue placeholder={prs.length === 0 ? t("memuat…", "loading…") : t("Pilih PR…", "Pick a PR…")} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {prs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.prNo} — {p.positionTitle ?? t("tanpa posisi", "no position")} · {t("terangkat {a}/{b}", "{a}/{b} appointed", { a: String(p.appointedCount), b: String(p.requiredNo) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pr && (
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {t("kebutuhan {n} org", "{n} headcount", { n: String(pr.requiredNo) })} · {pr.employmentStatus}
                    {pr.salaryBudget != null ? ` · ${t("budget gaji", "salary budget")} ${fmtIDR(pr.salaryBudget)}` : ""}
                    {pr.officerName ? ` · ${t("officer", "officer")}: ${pr.officerName}` : ""}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t("Kandidat *", "Candidate *")}</Label>
                {candidates.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-700">
                    {t("PR ini tidak punya kandidat offerable (Passed / masih proses).", "This PR has no offerable candidates (Passed / in process).")}
                  </p>
                ) : (
                  <CandidatePicker candidates={candidates} selectedId={candidateId} onSelect={setCandidateId} />
                )}
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="flex flex-wrap items-center gap-2">
              {t("Gaji Final", "Final Salary")}
              <span title={t("tersimpan terenkripsi di brankas uang — tampil sesuai hak akses Anda", "stored encrypted in the money vault — shown per your access rights")}>
                <Info className="h-3 w-3 text-slate-400" aria-hidden />
              </span>
            </Label>
            <Input
              type="number" min={0} inputMode="numeric" value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder={t("mis. 8500000 (per bulan)", "e.g. 8500000 (monthly)")}
              className="tabular-nums"
            />
            {guide && (guide.min != null || guide.max != null) && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t("Rentang iklan JO: {a} – {b}", "JO ad range: {a} – {b}", {
                  a: fmtIDR(guide.min ?? null) === "—" ? "Rp 0" : fmtIDR(guide.min),
                  b: guide.max != null ? fmtIDR(guide.max) : "…",
                })}
              </p>
            )}
            {outOfRange && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("Gaji di luar rentang iklan JO — tetap boleh dikirim (catatan guidance akan tercatat).", "Salary is outside the JO ad range — you may still send it (a guidance note is recorded).")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("Mulai Kerja", "Start Date")}</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                {t("Berlaku S.d.", "Valid Until")}
                <span title={t("melewati tanggal ini tanpa respons → offer otomatis Kedaluwarsa (scheduler)", "no response past this date → the offer auto-Expires (scheduler)")}>
                  <CalendarClock className="h-3 w-3 text-slate-400" aria-hidden />
                </span>
              </Label>
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Catatan", "Note")}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t("opsional — mis. paket kompensasi, hasil nego, persyaratan tambahan…", "optional — e.g. compensation package, negotiation outcome, extra terms…")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy} className="ov-fill">
            {busy ? t("Menyimpan…", "Saving…") : edit ? t("Simpan Perubahan", "Save Changes") : t("Buat Offer", "Create Offer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog jenjang approval offer
// ============================================================

export function ApprovalChainDialog({ offerId, onClose }: { offerId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const api = useApi<{ row: OfferDetailRow }>(offerId ? `${OFFERS_API}?offerId=${offerId}` : null, [offerId]);
  const row = api.data?.row ?? null;
  return (
    <Dialog open={offerId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ListChecks className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Jenjang Approval — {no}", "Approval Chain — {no}", { no: row?.offerNo ?? "" })}
          </DialogTitle>
        </DialogHeader>
        {api.loading && !api.data ? (
          <LoadingRows rows={3} />
        ) : !row ? (
          <EmptyState title={t("Offer tidak ditemukan", "Offer not found")} description={api.error ?? undefined} />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
              <Field label={t("Kandidat", "Candidate")} value={row.candidateName} />
              <Field label={t("Gaji", "Salary")} value={row.salary != null ? fmtIDR(row.salary) : "—"} />
            </div>
            <ChainSteps chain={row.approval} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog keputusan (approve / reject-approval / accept / decline)
// ============================================================

export interface DecisionTarget {
  id: string;
  offerNo: string;
  candidateName: string;
  kind: "reject-approval" | "accept" | "decline";
}

export function DecisionDialog({ target, onClose, onDone }: {
  target: DecisionTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setNote(""); }, [target]);

  if (!target) return null;
  const meta = target.kind === "reject-approval"
    ? {
      title: t("Tolak Pengajuan — {no}?", "Reject Submission — {no}?", { no: target.offerNo }),
      desc: t("Pengajuan offer dikembalikan ke Draft — kandidat tidak menerima apa pun sampai dikirim ulang.", "The offer submission returns to Draft — the candidate receives nothing until it is sent again."),
      danger: true,
      placeholder: t("Alasan penolakan (opsional)", "Rejection reason (optional)"),
      submit: t("Tolak Pengajuan", "Reject Submission"),
    }
    : target.kind === "accept"
      ? {
        title: t("Catat: Offer DITERIMA — {name}?", "Record: Offer ACCEPTED — {name}?", { name: target.candidateName }),
        desc: t("Kandidat menerima penawaran — offer lanjut ke pengangkatan.", "The candidate accepts — the offer proceeds to appointment."),
        danger: false,
        placeholder: t("Catatan (opsional)", "Note (optional)"),
        submit: t("Terima", "Accept"),
      }
      : {
        title: t("Catat: Offer DITOLAK — {name}?", "Record: Offer DECLINED — {name}?", { name: target.candidateName }),
        desc: t("Kandidat menolak penawaran — kandidat bisa dibuatkan offer baru bila masih offerable.", "The candidate declines — a new offer can be created if still offerable."),
        danger: true,
        placeholder: t("Catatan counter / nego (opsional) — mis. minta Rp 8,5 jt + tunjangan transport", "Counter / negotiation note (optional) — e.g. asks for Rp 8.5M + transport allowance"),
        submit: t("Tolak", "Decline"),
      };

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await apiSend(OFFERS_API, "POST", { action: target.kind, id: target.id, note: note || null });
      if (target.kind === "reject-approval") {
        toast.success(t(`Pengajuan offer ${target.offerNo} ditolak — kembali Draft`, `Offer submission ${target.offerNo} rejected — back to Draft`));
      } else {
        toast.success(t(
          `Offer ${target.offerNo} ${target.kind === "accept" ? "DITERIMA" : "DITOLAK"} — ${target.candidateName}`,
          `Offer ${target.offerNo} ${target.kind === "accept" ? "ACCEPTED" : "DECLINED"} — ${target.candidateName}`,
        ));
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan keputusan", "Failed to save the decision"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{meta.title}</DialogTitle></DialogHeader>
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{meta.desc}</p>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={meta.placeholder} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button variant={meta.danger ? "destructive" : "default"} onClick={submit} disabled={busy} className={meta.danger ? "" : "ov-fill"}>
            {busy ? t("Memproses…", "Processing…") : meta.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog pratinjau surat (PDF inline + unduh)
// ============================================================

export interface LetterTarget {
  letterId: string;
  letterNo: string;
  offerNo: string;
  candidateName: string;
  kind: string; // Offer|Appointment|Rejection
}

const LETTER_KIND_LABEL: Record<string, [string, string]> = {
  Offer: ["Surat Penawaran Kerja", "Job Offer Letter"],
  Appointment: ["Surat Pengangkatan", "Appointment Letter"],
  Rejection: ["Surat Penolakan", "Rejection Letter"],
};

export function OfferLetterDialog({ letter, onClose }: { letter: LetterTarget | null; onClose: () => void }) {
  const { t } = useI18n();
  const [label, labelEn] = LETTER_KIND_LABEL[letter?.kind ?? ""] ?? ["Surat", "Letter"];
  return (
    <Dialog open={letter != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <FileText className="h-4 w-4 ov-text-accent" aria-hidden />
            {t(label, labelEn)} — <span className="font-mono">{letter?.letterNo ?? ""}</span>
            <Badge variant="secondary">{letter?.offerNo}</Badge>
          </DialogTitle>
        </DialogHeader>
        {letter && (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {letter.candidateName} · {t("hasil surat rekrutmen (mesin surat, kategori Rekrutmen) — juga tersedia di menu Template Surat.", "recruitment letter output (letter engine, Recruitment category) — also available in the Letter Templates menu.")}
            </p>
            {/* PDF ditampilkan inline (server: Content-Disposition inline) — bukan re-render teks. */}
            <iframe
              src={`${OFFERS_API}?letterPdf=${letter.letterId}`}
              title={label}
              className="h-[56vh] w-full rounded-xl border border-slate-200 bg-white dark:border-slate-800"
            />
            <p className="text-[11px] text-slate-400">
              {t("Bila pratinjau tidak tampil, unduh PDF-nya.", "If the preview does not render, download the PDF.")}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
              <Button className="ov-fill gap-2" onClick={() => window.open(`${OFFERS_API}?letterPdf=${letter.letterId}`, "_blank")}>
                <Download className="h-4 w-4" aria-hidden /> {t("Unduh PDF", "Download PDF")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog alur pengangkatan (form → konfirmasi onboarding → hasil)
// ============================================================

const EMPLOYMENT_STATUSES = ["Permanent", "Contract", "Probation", "Outsourcing"];

export function AppointFlowDialog({ offerId, onClose, onDone }: {
  offerId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const canAppoint = perms.canOp("recruitment", "offers", "op:appoint");
  const [tick, setTick] = useState(0);
  const detailApi = useApi<{ row: OfferDetailRow }>(offerId ? `${OFFERS_API}?offerId=${offerId}` : null, [offerId, tick]);
  const ctxApi = useApi<{ context: AppointContext }>(offerId ? `${OFFERS_API}?context=${offerId}` : null, [offerId, tick]);
  const detail = detailApi.data?.row ?? null;
  const ctx = ctxApi.data?.context ?? null;
  const appt = detail?.appointment ?? null;

  const [appointmentDate, setAppointmentDate] = useState("");
  const [positionId, setPositionId] = useState("");
  const [companyOfficeId, setCompanyOfficeId] = useState("");
  const [workLocationId, setWorkLocationId] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [workShift, setWorkShift] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [appointResult, setAppointResult] = useState<AppointResult | null>(null);
  const [onboardResult, setOnboardResult] = useState<OnboardResult | null>(null);

  // reset saat offer berganti
  useEffect(() => {
    setAppointResult(null); setOnboardResult(null); setBusy(false);
  }, [offerId]);

  // prefill form dari context (hanya saat belum ada pengangkatan)
  useEffect(() => {
    if (!ctx || appt) return;
    setAppointmentDate((ctx.offer.startDate ?? new Date().toISOString()).slice(0, 10));
    setPositionId(ctx.positions.find((p) => p.title === ctx.pr.positionTitle)?.id ?? "");
    setCompanyOfficeId(ctx.pr.companyOfficeId ?? "");
    setWorkLocationId("");
    setSupervisorId("");
    setGradeId("");
    setEmploymentStatus(ctx.pr.employmentStatus);
    setWorkShift("Regular");
    setNote("");
  }, [ctx, appt]);

  const submitAppoint = async () => {
    if (!ctx) return;
    if (!appointmentDate) {
      toast.error(t("Tanggal pengangkatan wajib diisi", "Appointment date is required"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<AppointResult>(OFFERS_API, "POST", {
        action: "appoint",
        offerId: ctx.offer.id,
        appointmentDate,
        positionId: positionId || null,
        orgUnitId: ctx.pr.orgUnitId ?? null,
        companyOfficeId: companyOfficeId || null,
        workLocationId: workLocationId || null,
        supervisorId: supervisorId || null,
        gradeId: gradeId || null,
        employmentStatus: employmentStatus || null,
        workShift: workShift || null,
        note: note || null,
      });
      setAppointResult(res);
      toast.success(t(
        `Surat pengangkatan ${res.letterNo} terbit${res.rejectedCount > 0 ? ` — ${res.rejectedCount} kandidat lain ditolak batch (PR ${res.prStatus})` : ""}`,
        `Appointment letter ${res.letterNo} issued${res.rejectedCount > 0 ? ` — ${res.rejectedCount} other candidates batch-rejected (PR ${res.prStatus})` : ""}`,
      ), { duration: 9000 });
      setTick((x) => x + 1);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan pengangkatan", "Failed to save the appointment"));
    } finally { setBusy(false); }
  };

  const submitOnboard = async () => {
    if (!appt) return;
    setBusy(true);
    try {
      const res = await apiSend<OnboardResult>(OFFERS_API, "POST", { action: "to-onboarding", appointmentId: appt.id });
      setOnboardResult(res);
      toast.success(t(
        `Karyawan ${res.employeeNo} dibuat + onboarding ${res.onboardingId.slice(-6)}${res.emailsSent > 0 ? ` — email checklist ke ${res.emailsSent} bagian` : ""}`,
        `Employee ${res.employeeNo} created + onboarding ${res.onboardingId.slice(-6)}${res.emailsSent > 0 ? ` — checklist emails to ${res.emailsSent} departments` : ""}`,
      ), { duration: 9000 });
      setTick((x) => x + 1);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal melanjutkan ke onboarding", "Failed to continue to onboarding"));
    } finally { setBusy(false); }
  };

  const unverified = ctx ? ctx.documents.filter((d) => !d.verified).length : 0;
  const willFulfill = ctx ? ctx.appointedCount + 1 >= ctx.pr.requiredNo : false;

  return (
    <Dialog open={offerId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <UserRoundCheck className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Pengangkatan Kandidat — {name}", "Candidate Appointment — {name}", { name: detail?.candidateName ?? "" })}
            {appt && <Badge className={appt.status === "Onboarded" ? "bg-emerald-500 font-bold hover:bg-emerald-500" : "ov-fill font-bold"}>{appt.status}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {detailApi.loading && !detailApi.data ? (
          <LoadingRows rows={5} />
        ) : !detail ? (
          <EmptyState title={t("Offer tidak ditemukan", "Offer not found")} description={detailApi.error ?? undefined} />
        ) : (
          <div className="space-y-4">
            {/* ===== ringkasan offer + kandidat ===== */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40 sm:grid-cols-4">
              <Field label="Offer" value={<span className="font-mono">{detail.offerNo}</span>} />
              <Field label={t("Gaji Final", "Final Salary")} value={detail.salary != null ? fmtIDR(detail.salary) : "—"} />
              <Field label={t("Mulai Kerja", "Start Date")} value={fmtDate(detail.startDate)} />
              <Field label={t("Responded", "Responded")} value={fmtDate(detail.respondedAt)} />
            </div>
            {(ctx || appt) && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-4">
                <Field label={t("Kandidat", "Candidate")} value={detail.candidateName} />
                <Field label={t("No. Pelamar", "Applicant No.")} value={ctx?.candidate.applicantNo ?? "—"} />
                <Field label={t("Email", "Email")} value={<span className="break-all">{ctx?.candidate.email ?? "—"}</span>} />
                <Field label={t("Telepon", "Phone")} value={ctx?.candidate.phone ?? "—"} />
              </div>
            )}

            {/* ===== hasil karyawan (Onboarded) ===== */}
            {(appt?.status === "Onboarded" || onboardResult) && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <p className="flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  <PartyPopper className="h-4 w-4" aria-hidden />
                  {t("Karyawan baru telah dibuat", "The new employee has been created")}
                </p>
                <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-emerald-700 dark:text-emerald-300">
                  {onboardResult?.employeeNo ?? appt?.employeeNo ?? "—"}
                </p>
                <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-400/80">
                  {detail.candidateName} · {t("status kandidat Hired — data karyawan & penempatan awal dari pengangkatan", "candidate status Hired — employee & initial assignment created from the appointment")}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-left sm:grid-cols-4">
                  <Field label={t("Onboarding", "Onboarding")} value={<span className="font-mono text-[10px]">{(onboardResult?.onboardingId ?? appt?.onboardingId ?? "—").slice(-8)}</span>} />
                  <Field label={t("Surat", "Letter")} value={<span className="font-mono">{appt?.letterNo ?? "—"}</span>} />
                  <Field label={t("Posisi", "Position")} value={appt?.positionTitle ?? detail.positionTitle ?? "—"} />
                  <Field label={t("Atasan", "Supervisor")} value={appt?.supervisorName ?? "—"} />
                </div>
                {onboardResult && onboardResult.emailsSent > 0 && (
                  <p className="mt-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    {t("Email checklist onboarding terkirim ke {n} bagian.", "Onboarding checklist emails sent to {n} departments.", { n: String(onboardResult.emailsSent) })}
                  </p>
                )}
              </div>
            )}

            {/* ===== konfirmasi onboarding (Appointed) ===== */}
            {appt && appt.status !== "Onboarded" && !onboardResult && (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/25 dark:bg-emerald-500/10">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <BadgeCheck className="h-4 w-4" aria-hidden />
                    {t("Surat pengangkatan terbit — lanjutkan untuk membuat karyawan + onboarding (tanpa double-entry).", "Appointment letter issued — continue to create the employee + onboarding (no double entry).")}
                  </p>
                  {appointResult && (
                    <p className="mt-1 text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                      {t("PR sekarang berstatus {s}.{r}", "PR status is now {s}.{r}", {
                        s: appointResult.prStatus,
                        r: appointResult.rejectedCount > 0 ? ` ${t("Surat penolakan batch terbit utk", "Batch rejection letters issued for")} ${appointResult.rejectedCount} ${t("kandidat lain.", "other candidates.")}` : "",
                      })}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-3">
                  <Field label={t("Tanggal Pengangkatan", "Appointment Date")} value={fmtDate(appt.appointmentDate)} />
                  <Field label={t("Posisi", "Position")} value={appt.positionTitle ?? detail.positionTitle ?? "—"} />
                  <Field label={t("Status Kerja", "Employment Status")} value={ctx?.pr.employmentStatus ?? "—"} />
                  <Field label={t("Atasan", "Supervisor")} value={appt.supervisorName ?? "—"} />
                  <Field label={t("Kantor", "Office")} value={appt.officeName ?? "—"} />
                  <Field label={t("Surat", "Letter")} value={<span className="font-mono">{appt.letterNo ?? "—"}</span>} />
                </div>
                {canAppoint && (
                  <Button onClick={submitOnboard} disabled={busy} className="ov-fill w-full gap-2">
                    <Send className="h-4 w-4" aria-hidden />
                    {busy ? t("Memproses…", "Processing…") : t("Buat Karyawan & Onboarding", "Create Employee & Onboarding")}
                  </Button>
                )}
              </div>
            )}

            {/* ===== form pengangkatan (belum ada appointment) ===== */}
            {!appt && !onboardResult && (
              ctxApi.loading && !ctxApi.data ? (
                <LoadingRows rows={4} />
              ) : !ctx ? (
                <EmptyState title={t("Konteks pengangkatan gagal dimuat", "Failed to load appointment context")} description={ctxApi.error ?? undefined} />
              ) : (
                <>
                  {/* checklist dokumen pre-employment */}
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1">
                      {t("Checklist Dokumen Pre-Employment", "Pre-employment Document Checklist")}
                      <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {ctx.documents.filter((d) => d.verified).length}/{ctx.documents.length}
                      </span>
                    </Label>
                    {ctx.documents.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-200 p-2.5 text-xs text-slate-400 dark:border-slate-700">
                        {t("Tidak ada dokumen pelamar di talent pool.", "No applicant documents in the talent pool.")}
                      </p>
                    ) : (
                      <ul className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                        {ctx.documents.map((d) => (
                          <li key={d.id} className="flex items-center gap-2 text-xs">
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", d.verified ? "bg-emerald-500" : "bg-amber-400")} aria-hidden />
                            <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">{d.title}</span>
                            <span className="min-w-0 max-w-[40%] truncate text-[10px] text-slate-400">{d.fileName ?? "—"}</span>
                            <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                              d.verified
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                                : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400")}>
                              {d.verified ? t("terverifikasi", "verified") : t("belum", "unverified")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {unverified > 0 && (
                      <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        {t("{n} dokumen belum diverifikasi — lengkapi di Talent Pool (tidak menghalangi pengangkatan).", "{n} documents unverified — complete in the Talent Pool (does not block appointment).", { n: String(unverified) })}
                      </p>
                    )}
                  </div>

                  {/* form penempatan */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>{t("Tanggal Pengangkatan *", "Appointment Date *")}</Label>
                      <Input type="date" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("Posisi", "Position")}</Label>
                      <Select value={positionId || undefined} onValueChange={setPositionId}>
                        <SelectTrigger><SelectValue placeholder={t("Pilih posisi…", "Pick a position…")} /></SelectTrigger>
                        <SelectContent className="max-h-56">
                          {ctx.positions.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("Unit Organisasi (dari PR)", "Org Unit (from PR)")}</Label>
                      <Input value={ctx.pr.orgUnitName ?? t("sesuai PR", "per PR")} disabled />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("Kantor", "Office")}</Label>
                      <Select value={companyOfficeId || undefined} onValueChange={setCompanyOfficeId}>
                        <SelectTrigger><SelectValue placeholder={t("Pilih kantor…", "Pick an office…")} /></SelectTrigger>
                        <SelectContent className="max-h-56">
                          {ctx.offices.map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("Lokasi Kerja", "Work Location")}</Label>
                      <Select value={workLocationId || undefined} onValueChange={setWorkLocationId}>
                        <SelectTrigger><SelectValue placeholder={t("Pilih lokasi…", "Pick a location…")} /></SelectTrigger>
                        <SelectContent className="max-h-56">
                          {ctx.workLocations.map((w) => (
                            <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("Atasan Langsung", "Direct Supervisor")}</Label>
                      <Select value={supervisorId || undefined} onValueChange={setSupervisorId}>
                        <SelectTrigger><SelectValue placeholder={t("Cari & pilih atasan…", "Search & pick a supervisor…")} /></SelectTrigger>
                        <SelectContent className="max-h-56">
                          {ctx.employees.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.employeeNo} — {e.fullName}{e.positionTitle ? ` (${e.positionTitle})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("Grade", "Grade")}</Label>
                      <Select value={gradeId || undefined} onValueChange={setGradeId}>
                        <SelectTrigger><SelectValue placeholder={t("Pilih grade…", "Pick a grade…")} /></SelectTrigger>
                        <SelectContent className="max-h-56">
                          {ctx.grades.map((g) => (
                            <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("Status Kerja", "Employment Status")}</Label>
                      <Select value={employmentStatus || undefined} onValueChange={setEmploymentStatus}>
                        <SelectTrigger><SelectValue placeholder={t("Pilih status…", "Pick a status…")} /></SelectTrigger>
                        <SelectContent>
                          {EMPLOYMENT_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("Shift Kerja", "Work Shift")}</Label>
                      <Input value={workShift} onChange={(e) => setWorkShift(e.target.value)} placeholder="Regular" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>{t("Catatan", "Note")}</Label>
                      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder={t("opsional — catatan penempatan", "optional — placement note")} />
                    </div>
                  </div>

                  {/* info efek simpan */}
                  {willFulfill ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[11px] leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                        {t("Saat disimpan: PR otomatis Fulfilled (kuota {a}/{b} tercapai)", "On save: the PR auto-fulfills (quota {a}/{b} reached)", { a: String(ctx.appointedCount + 1), b: String(ctx.pr.requiredNo) })}
                      </p>
                      {ctx.otherActiveCandidates.length > 0 && (
                        <p className="mt-1">
                          {t("Surat penolakan batch terbit untuk {n} kandidat lain:", "Batch rejection letters are issued to {n} other candidates:", { n: String(ctx.otherActiveCandidates.length) })}
                          {" "}{ctx.otherActiveCandidates.map((c) => c.fullName).join(", ")}.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="flex items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t("Pengangkatan ke-{a} dari {b} kebutuhan PR — surat pengangkatan (REC_APPOINT) terbit otomatis saat disimpan.", "Appointment #{a} of {b} PR headcount — the appointment letter (REC_APPOINT) is issued automatically on save.", { a: String(ctx.appointedCount + 1), b: String(ctx.pr.requiredNo) })}
                    </p>
                  )}

                  {canAppoint && (
                    <Button onClick={submitAppoint} disabled={busy} className="ov-fill w-full gap-2">
                      <UserRoundCheck className="h-4 w-4" aria-hidden />
                      {busy ? t("Menyimpan…", "Saving…") : t("Simpan Pengangkatan", "Save Appointment")}
                    </Button>
                  )}
                </>
              )
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// P2.4 (D-BM19) — Dialog riwayat versi + tautan putusan mandiri
// ============================================================

/** Label versi dwibahasa [ID, EN]. */
const VERSION_LABEL: Record<string, [string, string]> = {
  Created: ["Dibuat", "Created"],
  Updated: ["Diperbarui", "Updated"],
  Sent: ["Dikirim", "Sent"],
  Counter: ["Counter (Nego)", "Counter"],
  SelfService: ["Putusan Mandiri", "Self-Service Decision"],
  Responded: ["Direspons HR", "Responded"],
};

/** Label field diff dwibahasa. */
const DIFF_FIELD_LABEL: Record<string, [string, string]> = {
  startDate: ["Mulai Kerja", "Start Date"],
  expiryDate: ["Berlaku S.d.", "Valid Until"],
  status: ["Status", "Status"],
  currency: ["Mata Uang", "Currency"],
  salaryUnit: ["Satuan Gaji", "Salary Unit"],
  jobOpeningId: ["Slot Lowongan", "Job Opening"],
  note: ["Catatan", "Note"],
};

/** Tampilan nilai field diff (tanggal → fmtDate; status → label; lainnya apa adanya). */
function DiffFieldValue({ field, value }: { field: string; value: string | null }) {
  const { t } = useI18n();
  if (value == null || value === "") return <span className="text-slate-400">—</span>;
  if (field === "startDate" || field === "expiryDate") return <span className="tabular-nums">{fmtDate(value.slice(0, 10))}</span>;
  if (field === "status") {
    return <span>{t(OFFER_STATUS_LABEL[value] ?? value, OFFER_STATUS_LABEL_EN[value] ?? value)}</span>;
  }
  if (field === "jobOpeningId") {
    return <span className="font-mono text-[10px]">{value.length > 12 ? `${value.slice(0, 12)}…` : value}</span>;
  }
  const short = value.length > 42 ? `${value.slice(0, 42)}…` : value;
  return <span title={value}>{short}</span>;
}

export function OfferVersionDialog({ offerId, moneyVisible, onClose }: {
  offerId: string | null;
  moneyVisible: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const api = useApi<{ row: OfferDetailRow; moneyVisible: boolean }>(offerId ? `${OFFERS_API}?offerId=${offerId}` : null, [offerId]);
  const row = api.data?.row ?? null;

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("Tautan disalin ke clipboard", "Link copied to clipboard"));
    } catch {
      toast.error(t("Gagal menyalin — salin manual dari kolom", "Copy failed — copy manually from the field"));
    }
  };

  return (
    <Dialog open={offerId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <History className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Riwayat Versi — {no}", "Version History — {no}", { no: row?.offerNo ?? "" })}
          </DialogTitle>
        </DialogHeader>
        {api.loading && !api.data ? (
          <LoadingRows rows={4} />
        ) : !row ? (
          <EmptyState title={t("Offer tidak ditemukan", "Offer not found")} description={api.error ?? undefined} />
        ) : (
          <div className="space-y-4">
            {/* ringkasan + tautan putusan mandiri */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
              <Field label={t("Kandidat", "Candidate")} value={row.candidateName} />
              <Field label={t("Status", "Status")} value={<OfferStatusPill status={row.status} />} />
              <Field label={t("Gaji", "Salary")} value={row.salary != null ? fmtIDR(row.salary) : "—"} />
              <Field label={t("Versi", "Versions")} value={String(row.versions.length)} />
            </div>

            {row.selfServiceLink ? (
              <div className="space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <Label className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300">
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                  {t("Tautan Putusan Mandiri", "Self-Service Decision Link")}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input readOnly value={row.selfServiceLink} className="bg-white font-mono text-[11px] dark:bg-slate-900" />
                  <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1 px-2" onClick={() => copyLink(row.selfServiceLink!)}>
                    <Copy className="h-3.5 w-3.5" aria-hidden /> {t("Salin", "Copy")}
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                  {t(
                    "Kirim tautan ini ke kandidat (juga terotomatis via email saat offer dikirim) — kandidat dapat menerima/menolak sendiri. Kirim ulang offer menimpa tautan lama.",
                    "Send this link to the candidate (also emailed automatically when the offer is sent) — the candidate can accept/decline on their own. Re-sending the offer invalidates the old link.",
                  )}
                </p>
              </div>
            ) : row.status === "Sent" || row.status === "Viewed" ? (
              <p className="rounded-xl border border-dashed border-slate-200 p-2.5 text-[11px] text-slate-400 dark:border-slate-700">
                {t("Tautan putusan tidak tersedia — kirim (ulang) offer utk menerbitkan tautan baru.", "No decision link available — (re-)send the offer to issue a new link.")}
              </p>
            ) : null}

            {/* daftar versi */}
            <div className="space-y-2">
              {row.versionDiffs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-700">
                  {t("Belum ada versi tercatat.", "No versions recorded yet.")}
                </p>
              ) : (
                <ol className="space-y-2">
                  {row.versionDiffs.map((v) => {
                    const [lblId, lblEn] = VERSION_LABEL[v.label ?? ""] ?? [v.label ?? "—", v.label ?? "—"];
                    const sd = v.diff?.salaryDiff ?? null;
                    return (
                      <li key={v.versionNo} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">{v.versionNo}</span>
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t(lblId, lblEn)}</span>
                          <span className="text-[10px] text-slate-400">{fmtDateTime(v.createdAt)}</span>
                        </div>
                        {/* chip diff per versi */}
                        {v.diff && (v.diff.fields.length > 0 || (sd && sd.changed)) ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5 pl-7">
                            {v.diff.fields.map((f) => (
                              <span key={f.field} className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                <span className="shrink-0">{t(DIFF_FIELD_LABEL[f.field]?.[0] ?? f.field, DIFF_FIELD_LABEL[f.field]?.[1] ?? f.field)}:</span>
                                <DiffFieldValue field={f.field} value={f.from} />
                                <span aria-hidden>→</span>
                                <DiffFieldValue field={f.field} value={f.to} />
                              </span>
                            ))}
                            {sd && sd.changed ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                {t("Gaji", "Salary")}:
                                {moneyVisible && sd.from != null && sd.to != null ? (
                                  <span className="tabular-nums">{fmtIDR(sd.from)} → {fmtIDR(sd.to)}</span>
                                ) : (
                                  <span>{t("nominal diubah (brankas terkunci)", "amount changed (vault locked)")}</span>
                                )}
                              </span>
                            ) : null}
                          </div>
                        ) : v.versionNo > 1 ? (
                          <p className="mt-1 pl-7 text-[10px] italic text-slate-400">{t("tanpa perubahan material", "no material change")}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// P2.4 (D-BM19) — Dialog counter offer (nego → kembali Draft)
// ============================================================

export function CounterOfferDialog({ row, onClose, onDone }: {
  row: OfferRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [salary, setSalary] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    setSalary(row.salary != null ? String(row.salary) : "");
    setStartDate(row.startDate ? row.startDate.slice(0, 10) : "");
    setExpiryDate(row.expiryDate ? row.expiryDate.slice(0, 10) : isoPlusDays(14));
    setNote("");
  }, [row]);

  const submit = async () => {
    if (!row) return;
    setBusy(true);
    try {
      await apiSend(OFFERS_API, "POST", {
        action: "counter", id: row.id,
        edits: {
          salary: salary === "" ? null : Number(salary),
          startDate: startDate || null,
          expiryDate: expiryDate || null,
          note: note || null,
        },
      });
      toast.success(t(
        `Counter offer ${row.offerNo} tersimpan — status kembali Draft (versi baru "Counter")`,
        `Counter offer ${row.offerNo} saved — back to Draft (new "Counter" version)`,
      ));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan counter offer", "Failed to save the counter offer"));
    } finally { setBusy(false); }
  };

  if (!row) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <MessagesSquare className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Buat Counter — {no}", "Create Counter — {no}", { no: row.offerNo })}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {t(
            "Revisi penawaran hasil negosiasi — offer kembali Draft (versi Counter tercatat), tautan putusan lama hangus, kirim ulang setelah final.",
            "Revise the offer after negotiation — the offer returns to Draft (a Counter version is recorded), the old decision link is invalidated, re-send once final.",
          )}
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("Gaji Final (hasil nego)", "Final Salary (negotiated)")}</Label>
            <Input type="number" min={0} inputMode="numeric" value={salary} className="tabular-nums"
              onChange={(e) => setSalary(e.target.value)}
              placeholder={t("mis. 8700000", "e.g. 8700000")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("Mulai Kerja", "Start Date")}</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Berlaku S.d.", "Valid Until")}</Label>
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("Catatan Nego", "Negotiation Note")}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t("opsional — mis. kandidat minta tunjangan transport + mulai 2 minggu lebih lambat…", "optional — e.g. candidate asks for transport allowance + a 2-week later start…")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy} className="ov-fill">
            {busy ? t("Menyimpan…", "Saving…") : t("Simpan Counter", "Save Counter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
