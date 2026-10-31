"use client";
// RekanKerja Recruitment F3 — dialog view "Kandidat & Seleksi":
//   · CandidateDetailDialog — detail kandidat multi-tab (Tahapan timeline +
//     aksi per tahap · Scorecard panel & pengisian · Profil PII + catatan).
//   · ResultAdvanceDialog — "Catat Hasil / Naik Tahap" shared (kartu, drag
//     drop board, bulk, tombol per tahap di detail).
//   · TransferDialog — nominasi kandidat (pelamar talent pool / karyawan).
//   · RubricManagerDialog — manager template rubrik scorecard.
//   · ScheduleDialog / InvitePreviewDialog / CancelStepDialog / WithdrawDialog
//     / DayEventsDialog (kalender).
// Semua gating via useMenuPerms() (pola applicants.tsx F2). Dwibahasa t(id,en).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApi, apiSend, fmtIDR, fmtDate, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  SELECTION_API, CANDIDATES_API,
  type ApplicantOpt, type CandidateDetail, type CalendarEvent, type EmployeeOpt,
  type InvitationResult, type PanelResult, type PrStageConfig, type PrStageCatalogRow, type ProcessOpt, type PrOpt, type StepRow, type StepSlot, type SlotInviteResult,
  type TemplateRow, Pill, CandPill, StepPill, RecPill, daysLateOf, monthsLabel,
} from "./selection-shared";
import { AiScorePanel } from "./ai-score-dialogs";
import {
  AlertTriangle, AlarmClock, ArrowDown, ArrowUp, ArrowUpRight, BadgeCheck, CalendarPlus, Check, ChevronLeft, ChevronRight,
  ChevronsUpDown, ClipboardCheck, Copy, Download, FileText, Info, Link2, ListChecks, MailCheck, Pencil, Plus, Send, Settings2,
  Trash2, UserPlus, UserRoundX, Users, Video,
} from "lucide-react";

// ============ helper kecil ============

/** baris label:value (grid meta step & profil). */
function Field({ label, value, danger, title }: { label: string; value: ReactNode; danger?: boolean; title?: string }) {
  return (
    <div title={title}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className={cn("text-xs", danger ? "font-semibold text-rose-600 dark:text-rose-400" : "font-medium text-slate-700 dark:text-slate-200")}>{value}</div>
    </div>
  );
}

/** pilih evaluator (karyawan aktif) — dipakai beberapa dialog. */
function EmployeeSelect({ value, onChange, employees }: { value: string; onChange: (v: string) => void; employees: EmployeeOpt[] }) {
  const { t } = useI18n();
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={t("Pilih evaluator…", "Pick an evaluator…")} /></SelectTrigger>
      <SelectContent className="max-h-64">
        {employees.map((e) => (
          <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}{e.positionTitle ? ` (${e.positionTitle})` : ""}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ============================================================
// Dialog jadwalkan tahap — P2.3 (D-BM18): panel evaluator MULTI (chip
// tambah/hapus, urutan pertama = lead) + seksi slot jadwal mandiri
// (simpan slot + kirim undangan token portal ke kandidat).
// ============================================================

interface SlotDraftRow { startAt: string; durationMin: string }

export function ScheduleDialog({ step, employees, onClose, onDone }: {
  step: StepRow | null;
  employees: EmployeeOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const open = step != null;
  const [planDate, setPlanDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [evaluatorIds, setEvaluatorIds] = useState<string[]>([]);
  const [evaluatorAdd, setEvaluatorAdd] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [busy, setBusy] = useState(false);
  // P2.3 — slot jadwal mandiri (draf baris + slot tersimpan di server)
  const [slotRows, setSlotRows] = useState<SlotDraftRow[]>([]);
  const [slotBusy, setSlotBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [slotTick, setSlotTick] = useState(0);
  const slotsApi = useApi<{ slots: StepSlot[] }>(open && step ? `${SELECTION_API}?stepId=${step.id}` : null, [open, step?.id, slotTick]);
  const savedSlots = slotsApi.data?.slots ?? [];
  const openSlotCount = savedSlots.filter((s) => s.status === "Open").length;

  useEffect(() => {
    if (!step) return;
    setPlanDate(step.planDate ? step.planDate.slice(0, 16) : "");
    setDueDate(step.dueDate ? step.dueDate.slice(0, 16) : "");
    // panel evaluator existing (fallback performedById tunggal — backward-compat)
    setEvaluatorIds(step.evaluators.length > 0 ? step.evaluators.map((e) => e.id) : step.performedById ? [step.performedById] : []);
    setEvaluatorAdd("");
    setMeetingUrl(step.meetingUrl ?? "");
    setInviteLink(null);
    // slot Open existing → baris draf (Booked/Closed read-only — dipertahankan server)
    setSlotRows((step.slots ?? []).filter((s) => s.status === "Open").map((s) => ({ startAt: s.startAt.slice(0, 16), durationMin: String(s.durationMin) })));
  }, [step]);

  const employeeById = (id: string) => employees.find((e) => e.id === id);
  const addEvaluator = (id: string) => {
    if (!id || evaluatorIds.includes(id)) return;
    setEvaluatorIds([...evaluatorIds, id]);
    setEvaluatorAdd("");
  };

  const submit = async () => {
    if (!step) return;
    if (!planDate) {
      toast.error(t("Jadwal (tanggal & jam) wajib diisi", "Schedule date & time is required"));
      return;
    }
    setBusy(true);
    try {
      await apiSend(SELECTION_API, "POST", {
        action: "schedule", stepId: step.id, planDate,
        dueDate: dueDate || null,
        evaluatorIds,
        performedById: evaluatorIds[0] ?? null,
        meetingUrl: meetingUrl.trim() || null,
      });
      toast.success(t(`Tahap ${step.stageName} dijadwalkan${dueDate ? ` — SLA s.d. ${fmtDate(dueDate)}` : ""}`, `Stage ${step.stageName} scheduled${dueDate ? ` — SLA until ${fmtDate(dueDate)}` : ""}`));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menjadwalkan tahap", "Failed to schedule the stage"));
    } finally { setBusy(false); }
  };

  const saveSlots = async () => {
    if (!step) return;
    const rows = slotRows.filter((r) => r.startAt);
    if (rows.length === 0) {
      toast.error(t("Isi minimal satu slot (tanggal & jam) sebelum menyimpan", "Fill in at least one slot (date & time) before saving"));
      return;
    }
    setSlotBusy(true);
    try {
      const res = await apiSend<{ count: number; openCount: number }>(SELECTION_API, "POST", {
        action: "slots-save", stepId: step.id,
        slots: rows.map((r) => ({ startAt: r.startAt, durationMin: r.durationMin === "" ? 60 : Number(r.durationMin) })),
      });
      toast.success(t(`${res.count} slot jadwal disimpan — kandidat bisa memilih sendiri`, `${res.count} schedule slots saved — the candidate can pick one`));
      setSlotTick((x) => x + 1);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan slot jadwal", "Failed to save the schedule slots"));
    } finally { setSlotBusy(false); }
  };

  const sendInvite = async () => {
    if (!step) return;
    setInviteBusy(true);
    try {
      const res = await apiSend<SlotInviteResult>(SELECTION_API, "POST", { action: "invite-slots", stepId: step.id, ttlHours: 72 });
      setInviteLink(res.link);
      toast.success(res.emailSent
        ? t("Undangan pilih jadwal dikirim ke email kandidat — tautan siap dibagikan", "The schedule invitation was emailed to the candidate — link ready to share")
        : t("Tautan undangan dibuat — email kandidat tidak tersedia, bagikan tautan secara manual", "Invitation link created — candidate email unavailable, share the link manually"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menerbitkan undangan", "Failed to issue the invitation"));
    } finally { setInviteBusy(false); }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success(t("Tautan undangan disalin", "Invitation link copied"));
    } catch {
      toast.error(t("Gagal menyalin — salin manual dari kolom tautan", "Copy failed — copy manually from the link field"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Jadwalkan Tahap — {stage}", "Schedule Stage — {stage}", { stage: step?.stageName ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("Jadwal Pelaksanaan *", "Schedule Date & Time *")}</Label>
            <Input type="datetime-local" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              {t("Batas SLA (opsional)")}
              <span title={t("Kosongkan untuk memakai SLA master tahap", "Leave empty to use the stage master SLA")}>
                <Info className="h-3 w-3 text-slate-400" aria-hidden />
              </span>
            </Label>
            <Input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          {/* P2.3 — panel evaluator MULTI: chip pertama = lead (penanggung jawab) */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              {t("Panel Evaluator (1–N)", "Evaluator Panel (1–N)")}
            </Label>
            {evaluatorIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label={t("Panel evaluator terpilih", "Selected evaluator panel")}>
                {evaluatorIds.map((id, i) => {
                  const emp = employeeById(id);
                  return (
                    <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1 text-xs font-medium dark:border-slate-700 dark:bg-slate-800/60">
                      <span className="min-w-0 truncate">{i === 0 ? <b className="mr-0.5">{t("Lead", "Lead")}:</b> : null}{emp ? emp.fullName : id.slice(0, 8)}</span>
                      <button type="button" className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-rose-600 dark:hover:bg-slate-700"
                        onClick={() => setEvaluatorIds(evaluatorIds.filter((x) => x !== id))}
                        aria-label={t("Hapus {n} dari panel", "Remove {n} from the panel", { n: emp?.fullName ?? id })}>
                        <Trash2 className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <EmployeeSelect value={evaluatorAdd} onChange={addEvaluator} employees={employees.filter((e) => !evaluatorIds.includes(e.id))} />
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {t("Tambah evaluator ke panel — evaluator pertama menjadi penanggung jawab; setiap evaluator mengisi scorecard sendiri.", "Add evaluators to the panel — the first one becomes the lead; each evaluator fills their own scorecard.")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              {t("Link Meeting")}
              <span title={t("Tautan video-call utk interview/wawancara online — disertakan di undangan WhatsApp/email kandidat", "Video-call link for online interviews — included in the candidate's WhatsApp/email invitation")}>
                <Info className="h-3 w-3 text-slate-400" aria-hidden />
              </span>
            </Label>
            <Input
              type="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://meet.google.com/abc-defg-hij"
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {t("Opsional — harus URL http/https (mis. Google Meet/Zoom).", "Optional — must be an http/https URL (e.g. Google Meet/Zoom).")}
            </p>
          </div>

          {/* P2.3 — slot jadwal mandiri (opsional) */}
          <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-1 text-xs">
                <CalendarPlus className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                {t("Slot jadwal mandiri (opsional)", "Self-schedule slots (optional)")}
              </Label>
              {savedSlots.length > 0 && (
                <span className="text-[10px] font-semibold text-slate-400" title={t("slot tersimpan (Open/Booked/Closed)", "saved slots (Open/Booked/Closed)")}>
                  {openSlotCount}/{savedSlots.length} {t("Open", "Open")}
                </span>
              )}
            </div>
            {/* slot Booked/Closed tersimpan — read-only */}
            {savedSlots.filter((s) => s.status !== "Open").length > 0 && (
              <ul className="space-y-1">
                {savedSlots.filter((s) => s.status !== "Open").map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 text-[11px] dark:bg-slate-800/60">
                    <span className="min-w-0 truncate">{fmtDateTime(s.startAt)} · {s.durationMin} {t("mnt", "min")}</span>
                    <Pill tone={s.status === "Booked" ? "emerald" : "zinc"}>{s.status === "Booked" ? t("Terpilih", "Booked") : t("Ditutup", "Closed")}</Pill>
                  </li>
                ))}
              </ul>
            )}
            {/* draf slot Open */}
            <div className="space-y-1.5">
              {slotRows.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input type="datetime-local" value={r.startAt} className="h-8 min-w-0 flex-1"
                    onChange={(e) => setSlotRows(slotRows.map((x, xi) => xi === i ? { ...x, startAt: e.target.value } : x))} />
                  <Input type="number" min={5} max={480} step={5} value={r.durationMin} className="h-8 w-20"
                    aria-label={t("Durasi (menit)", "Duration (minutes)")}
                    onChange={(e) => setSlotRows(slotRows.map((x, xi) => xi === i ? { ...x, durationMin: e.target.value } : x))} />
                  <span className="shrink-0 text-[10px] text-slate-400">{t("mnt", "min")}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-rose-600 dark:text-rose-400"
                    onClick={() => setSlotRows(slotRows.filter((_, xi) => xi !== i))} aria-label={t("Hapus slot", "Remove slot")}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1"
                onClick={() => setSlotRows([...slotRows, { startAt: "", durationMin: "60" }])}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah slot", "Add slot")}
              </Button>
            </div>
            {slotRows.filter((r) => r.startAt).length > 0 && (
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1" disabled={slotBusy} onClick={saveSlots}>
                <ClipboardCheck className="h-3.5 w-3.5" aria-hidden /> {slotBusy ? t("Menyimpan…", "Saving…") : t("Simpan Slot", "Save Slots")}
              </Button>
            )}

            {/* undangan token portal — hanya bila ada slot Open tersimpan */}
            {openSlotCount > 0 && (
              <div className="space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                <Button type="button" size="sm" className="h-8 gap-1.5 ov-fill" disabled={inviteBusy} onClick={sendInvite}>
                  <Send className="h-3.5 w-3.5" aria-hidden />
                  {inviteBusy ? t("Mengirim…", "Sending…") : t("Kirim Undangan Pilih Jadwal ke Kandidat", "Send Schedule Invitation to Candidate")}
                </Button>
                {inviteLink && (
                  <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <div className="flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      <Input readOnly value={inviteLink} className="h-8 border-0 bg-transparent font-mono text-[11px] focus-visible:ring-0" />
                      <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1 px-2" onClick={copyLink}>
                        <Copy className="h-3 w-3" aria-hidden /> {t("Salin", "Copy")}
                      </Button>
                    </div>
                    <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                      {t("Tautan berlaku 72 jam sejak diterbitkan — menerbitkan ulang membatalkan tautan lama.", "The link is valid for 72 hours from issuing — reissuing invalidates the old link.")}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy} className="ov-fill">{busy ? t("Menyimpan…", "Saving…") : t("Jadwalkan", "Schedule")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog pratinjau surat undangan
// ============================================================

export function InvitePreviewDialog({ letter, onClose }: { letter: InvitationResult | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={letter != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <MailCheck className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Surat Undangan — {no}", "Invitation Letter — {no}", { no: letter?.letterNo ?? "" })}
            {letter?.existing && <Badge variant="secondary">{t("sudah terbit", "already issued")}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {letter && (
          <>
            {letter.subject && <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{letter.subject}</p>}
            <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-[13px] leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
              {letter.body}
            </div>
            <p className="text-[11px] text-slate-400">
              {t("Surat ini juga tersedia di modul Template Surat (kategori Rekrutmen).", "This letter is also available in the Letter Templates module (Recruitment category).")}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
              <Button className="ov-fill gap-2" onClick={() => window.open(`${SELECTION_API}?letterPdf=${letter.id}`, "_blank")}>
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
// Dialog batalkan tahap
// ============================================================

export function CancelStepDialog({ step, onClose, onDone }: { step: StepRow | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setComment(""); }, [step]);

  const submit = async () => {
    if (!step) return;
    setBusy(true);
    try {
      await apiSend(SELECTION_API, "POST", { action: "cancel-step", stepId: step.id, comment: comment || null });
      toast.success(t(`Tahap ${step.stageName} dibatalkan`, `Stage ${step.stageName} cancelled`));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membatalkan tahap", "Failed to cancel the stage"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={step != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Batalkan Tahap — {stage}?", "Cancel Stage — {stage}?", { stage: step?.stageName ?? "" })}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t("Tahap dibatalkan (tidak relevan utk kandidat ini) — tahap aktif berikutnya otomatis menggantikan.", "The stage is cancelled (not relevant for this candidate) — the next active stage takes over automatically.")}
        </p>
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder={t("Alasan pembatalan (opsional)", "Cancellation reason (optional)")} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button variant="destructive" onClick={submit} disabled={busy} className="gap-1.5">
            <Trash2 className="h-4 w-4" aria-hidden /> {busy ? t("Memproses…", "Processing…") : t("Ya, Batalkan", "Yes, Cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog tarik kandidat (Withdrawn)
// ============================================================

export function WithdrawDialog({ candidateId, name, onClose, onDone }: {
  candidateId: string | null; name: string; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setNote(""); }, [candidateId]);

  const submit = async () => {
    if (!candidateId) return;
    if (!note.trim()) {
      toast.error(t("Alasan penarikan wajib diisi", "Withdrawal reason is required"));
      return;
    }
    setBusy(true);
    try {
      await apiSend(CANDIDATES_API, "PATCH", { id: candidateId, action: "withdraw", note: note.trim() });
      toast.success(t(`${name} ditarik dari proses seleksi`, `${name} withdrawn from the selection process`));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menarik kandidat", "Failed to withdraw the candidate"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={candidateId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRoundX className="h-4 w-4 text-rose-500" aria-hidden />
            {t("Tarik Kandidat — {name}?", "Withdraw Candidate — {name}?", { name })}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t("Kandidat berstatus Withdrawn — seluruh tahap aktif dibatalkan otomatis.", "The candidate becomes Withdrawn — all active stages are cancelled automatically.")}
        </p>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={t("Alasan penarikan (wajib) — mis. kandidat mundur, menerima tawaran lain…", "Withdrawal reason (required) — e.g. candidate stepped back, accepted another offer…")} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button variant="destructive" onClick={submit} disabled={busy} className="gap-1.5">
            <UserRoundX className="h-4 w-4" aria-hidden /> {busy ? t("Memproses…", "Processing…") : t("Tarik Kandidat", "Withdraw Candidate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog Catat Hasil & Naik Tahap (shared: kartu / drag / bulk / detail)
// ============================================================

export interface ResultTarget {
  mode: "result" | "advance" | "bulk";
  /** mode result (dari detail — tahap spesifik). */
  stepId?: string;
  cards: { id: string; fullName: string }[];
  /** nama tahap yang DINILAI (tahap aktif saat ini). */
  evaluatedStageName: string;
  /** tahap tujuan bila naik (advance/bulk). */
  toStageName?: string | null;
  resultType?: string | null;
  minResultPass?: number | null;
}

export function ResultAdvanceDialog({ target, employees, onClose, onDone }: {
  target: ResultTarget | null;
  employees: EmployeeOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<"Pass" | "Fail">("Pass");
  const [score, setScore] = useState("");
  const [resultText, setResultText] = useState("");
  const [comment, setComment] = useState("");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [continueProcess, setContinueProcess] = useState(false);
  const [busy, setBusy] = useState(false);

  const quant = target?.resultType === "Quantitative";
  const minPass = target?.minResultPass ?? null;

  useEffect(() => {
    setOutcome("Pass"); setScore(""); setResultText(""); setComment(""); setEvaluatorId(""); setContinueProcess(false);
  }, [target]);

  // auto-suggest (Quantitative + minResultPass + skor terisi) — masih bisa di-override
  useEffect(() => {
    if (!quant || minPass == null || score === "") return;
    const n = Number(score);
    if (Number.isFinite(n)) setOutcome(n >= minPass ? "Pass" : "Fail");
  }, [score, quant, minPass]);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    const base = {
      performedById: evaluatorId || null,
      score: score === "" ? null : Number(score),
      result: resultText || null,
      comment: comment || null,
      outcome,
      continueProcess: outcome === "Fail" ? continueProcess : null,
    };
    try {
      if (target.mode === "result" && target.stepId) {
        await apiSend(SELECTION_API, "POST", { action: "result", stepId: target.stepId, ...base });
        toast.success(t(`Hasil ${target.evaluatedStageName} — ${target.cards[0].fullName} dicatat`, `Result of ${target.evaluatedStageName} — ${target.cards[0].fullName} recorded`));
        onDone();
        onClose();
        return;
      }
      if (target.mode === "advance" && target.cards.length === 1) {
        await apiSend(SELECTION_API, "POST", { action: "advance", candidateId: target.cards[0].id, ...base });
        toast.success(t(`${target.cards[0].fullName} naik ke ${target.toStageName ?? "tahap berikutnya"}`, `${target.cards[0].fullName} advanced to ${target.toStageName ?? "the next stage"}`));
        onDone();
        onClose();
        return;
      }
      // bulk — advance per kandidat, kumpulkan hasil sukses/gagal
      let ok = 0;
      const fails: string[] = [];
      for (const c of target.cards) {
        try {
          await apiSend(SELECTION_API, "POST", { action: "advance", candidateId: c.id, ...base });
          ok++;
        } catch (e) {
          fails.push(`${c.fullName}: ${e instanceof Error ? e.message : "gagal"}`);
        }
      }
      if (ok > 0) {
        toast.success(t(`Berhasil memajukan ${ok} dari ${target.cards.length} kandidat ke ${target.toStageName ?? "tahap berikutnya"}`, `Advanced ${ok} of ${target.cards.length} candidates to ${target.toStageName ?? "the next stage"}`));
      }
      if (fails.length > 0) {
        toast.error(t(`Gagal memajukan ${fails.length} kandidat — ${fails[0]}`, `Failed to advance ${fails.length} candidates — ${fails[0]}`));
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan hasil tahap", "Failed to save the stage result"));
    } finally { setBusy(false); }
  };

  const title = !target ? "" : target.mode === "result"
    ? t("Catat Hasil — {stage} · {name}", "Record Result — {stage} · {name}", { stage: target.evaluatedStageName, name: target.cards[0]?.fullName ?? "" })
    : target.mode === "bulk"
      ? t("Naikkan {n} Kandidat — ke {stage}", "Advance {n} Candidates — to {stage}", { n: String(target.cards.length), stage: target.toStageName ?? "…" })
      : t("Catat Hasil & Naik Tahap — {name}", "Record Result & Advance — {name}", { name: target.cards[0]?.fullName ?? "" });

  return (
    <Dialog open={target != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {target && (
          <div className="space-y-4">
            {/* info kandidat + tahap */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/50">
              {target.mode === "bulk" ? (
                <div className="max-h-28 overflow-y-auto">
                  {target.cards.map((c) => (
                    <div key={c.id} className="flex items-center gap-1.5 py-0.5 font-medium"><ArrowUpRight className="h-3 w-3 text-slate-400" aria-hidden />{c.fullName}</div>
                  ))}
                </div>
              ) : (
                <div className="font-semibold">{target.cards[0]?.fullName}</div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
                <span>{t("Tahap dinilai", "Stage assessed")}: <b className="text-slate-700 dark:text-slate-200">{target.evaluatedStageName}</b></span>
                {target.toStageName && <span>{t("Naik ke", "Advances to")}: <b className="text-slate-700 dark:text-slate-200">{target.toStageName}</b></span>}
                {quant && minPass != null && <span>{t("kuantitatif — min. lulus {n}", "quantitative — pass mark {n}", { n: String(minPass) })}</span>}
              </div>
            </div>

            {/* hasil akhir */}
            <div className="space-y-1.5">
              <Label>{t("Hasil Akhir *", "Final Outcome *")}</Label>
              <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v === "Fail" ? "Fail" : "Pass")} className="grid grid-cols-2 gap-2">
                <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-colors",
                  outcome === "Pass" ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400" : "border-slate-200 dark:border-slate-700")}>
                  <RadioGroupItem value="Pass" /> {t("Lulus (Pass)", "Pass")}
                </label>
                <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-colors",
                  outcome === "Fail" ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400" : "border-slate-200 dark:border-slate-700")}>
                  <RadioGroupItem value="Fail" /> {t("Gagal (Fail)", "Fail")}
                </label>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Skor", "Score")}</Label>
                <Input type="number" step="any" value={score} onChange={(e) => setScore(e.target.value)}
                  placeholder={quant && minPass != null ? t("min. lulus: {n}", "pass mark: {n}", { n: String(minPass) }) : t("opsional", "optional")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Hasil (teks)", "Result (text)")}</Label>
                <Input value={resultText} onChange={(e) => setResultText(e.target.value)} placeholder={t("mis. Sangat baik", "e.g. Very good")} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("Evaluator", "Evaluator")}</Label>
              <EmployeeSelect value={evaluatorId} onChange={setEvaluatorId} employees={employees} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("Komentar", "Comment")}</Label>
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>

            {outcome === "Fail" && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                <Checkbox checked={continueProcess} onCheckedChange={(c) => setContinueProcess(c === true)} className="mt-0.5" />
                <span>{t("Lanjutkan proses meski gagal — sisa tahap tetap berjalan (keputusan HR).", "Continue the process despite failing — remaining stages stay active (HR decision).")}</span>
              </label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy} className="ov-fill gap-1.5">
            <ArrowUpRight className="h-4 w-4" aria-hidden />
            {busy ? t("Menyimpan…", "Saving…") : target?.mode === "result" ? t("Simpan Hasil", "Save Result") : t("Simpan & Naikkan", "Save & Advance")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog isi scorecard (rubrik kompetensi 1–5 anchored)
// ============================================================

export function ScorecardFillDialog({ step, employees, onClose, onDone }: {
  step: StepRow | null;
  employees: EmployeeOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const open = step != null;
  const tplApi = useApi<{ templates: TemplateRow[]; recommendations: string[] }>(open ? `${SELECTION_API}?templates=1` : null, [open]);
  const templates = (tplApi.data?.templates ?? []).filter((x) => x.active);
  const [templateId, setTemplateId] = useState("");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [recommendation, setRecommendation] = useState("");
  const [overall, setOverall] = useState("");
  const [busy, setBusy] = useState(false);

  const tpl = templates.find((x) => x.id === templateId) ?? null;

  // reset saat ganti tahap / dialog ditutup
  useEffect(() => {
    setTemplateId(""); setEvaluatorId(""); setScores({}); setComments({}); setRecommendation(""); setOverall("");
  }, [step?.id]);

  // default: template terikat tahap bila ada (tandai "(tahap ini)" di label)
  useEffect(() => {
    if (!tplApi.data || templateId || !step) return;
    const bound = templates.find((x) => x.selectionProcessId === step.stageId);
    setTemplateId(bound?.id ?? templates[0]?.id ?? "");
  }, [tplApi.data, step, templateId, templates]);

  const save = async (submit: boolean) => {
    if (!step) return;
    if (!templateId) { toast.error(t("Pilih template rubrik", "Pick a rubric template")); return; }
    if (!evaluatorId) { toast.error(t("Pilih evaluator scorecard", "Pick the scorecard evaluator")); return; }
    setBusy(true);
    try {
      await apiSend(SELECTION_API, "POST", {
        action: "scorecard-save",
        selectionStepId: step.id,
        evaluatorId,
        templateId,
        items: (tpl?.competencies ?? [])
          .filter((c) => Number.isFinite(scores[c.id]) && scores[c.id] >= 1 && scores[c.id] <= 5)
          .map((c) => ({ competencyId: c.id, score: scores[c.id], comment: comments[c.id] || null })),
        recommendation: recommendation || null,
        overallComment: overall || null,
        submit,
      });
      toast.success(submit
        ? t(`Scorecard ${step.stageName} disubmit`, `Scorecard for ${step.stageName} submitted`)
        : t("Draf scorecard disimpan", "Scorecard draft saved"));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan scorecard", "Failed to save the scorecard"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Isi Scorecard — {stage}", "Fill Scorecard — {stage}", { stage: step?.stageName ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Template Rubrik *", "Rubric Template *")}</Label>
              <Select value={templateId || undefined} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder={t("Pilih template…", "Pick a template…")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {templates.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.name}{x.selectionProcessId === step?.stageId ? ` ${t("(tahap ini)", "(this stage)")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Evaluator *", "Evaluator *")}</Label>
              <EmployeeSelect value={evaluatorId} onChange={setEvaluatorId} employees={employees} />
            </div>
          </div>

          {tplApi.loading && !tplApi.data ? (
            <LoadingRows rows={3} />
          ) : !tpl ? (
            <EmptyState title={t("Template rubrik tidak tersedia", "No rubric template available")}
              description={t("Buat template lewat tombol “Rubrik Scorecard” di header halaman.", "Create one via the “Scorecard Rubrics” button in the page header.")} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Kompetensi", "Competency")}</TableHead>
                    <TableHead className="w-16">{t("Bobot", "Weight")}</TableHead>
                    <TableHead className="w-44">{t("Skor 1–5", "Score 1–5")}</TableHead>
                    <TableHead className="min-w-40">{t("Komentar", "Comment")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tpl.competencies.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-medium">
                          {c.name}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" aria-label={t("Anchor rubrik", "Rubric anchors")}>
                                <Info className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-64 space-y-1 text-left">
                              {(c.anchors ?? []).map((a) => (
                                <div key={a.value}><b>{a.value}</b> · {a.label}{a.guide ? ` — ${a.guide}` : ""}</div>
                              ))}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-slate-500">×{c.weight}</TableCell>
                      <TableCell>
                        <Select value={scores[c.id] != null ? String(scores[c.id]) : undefined}
                          onValueChange={(v) => setScores({ ...scores, [c.id]: Number(v) })}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            {(c.anchors ?? []).map((a) => (
                              <SelectItem key={a.value} value={String(a.value)}>{a.value} — {a.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input className="h-8" value={comments[c.id] ?? ""} onChange={(e) => setComments({ ...comments, [c.id]: e.target.value })} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Rekomendasi Akhir", "Final Recommendation")}</Label>
              <Select value={recommendation || undefined} onValueChange={setRecommendation}>
                <SelectTrigger><SelectValue placeholder={t("wajib saat submit", "required on submit")} /></SelectTrigger>
                <SelectContent>
                  {(tplApi.data?.recommendations ?? []).map((r) => (
                    <SelectItem key={r} value={r}>{t(
                      r === "StrongHire" ? "Sangat Rekomendasi" : r === "Hire" ? "Rekomendasi" : r === "NoHire" ? "Tidak Rekomendasi" : "Sangat Tidak Rekomendasi",
                      r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Feedback Keseluruhan", "Overall Feedback")}</Label>
              <Textarea rows={2} value={overall} onChange={(e) => setOverall(e.target.value)}
                placeholder={t("wajib saat submit (gate naik tahap)", "required on submit (advance gate)")} />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <p className="text-[11px] text-slate-400">
            {t("Draft bisa disimpan sebagian; submit menuntut semua skor + feedback + rekomendasi.", "A draft can be partial; submit requires all scores + feedback + recommendation.")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => save(false)} disabled={busy}>{t("Simpan Draf", "Save Draft")}</Button>
            <Button onClick={() => save(true)} disabled={busy} className="ov-fill">{busy ? t("Menyimpan…", "Saving…") : t("Submit", "Submit")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Manager template rubrik scorecard
// ============================================================

interface RubricForm {
  id: string | null;
  name: string;
  selectionProcessId: string;
  description: string;
  comps: { name: string; weight: string }[];
}

export function RubricManagerDialog({ open, onClose, stages }: { open: boolean; onClose: () => void; stages: ProcessOpt[] }) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [tick, setTick] = useState(0);
  const tplApi = useApi<{ templates: TemplateRow[] }>(open ? `${SELECTION_API}?templates=1` : null, [open, tick]);
  const templates = tplApi.data?.templates ?? [];
  const [form, setForm] = useState<RubricForm | null>(null);
  const [busy, setBusy] = useState(false);

  const canCreate = perms.can("recruitment", "selection", "create");
  const canUpdate = perms.can("recruitment", "selection", "update");

  const openNew = () => setForm({ id: null, name: "", selectionProcessId: "", description: "", comps: [{ name: "", weight: "1" }] });
  const openEdit = (tpl: TemplateRow) => setForm({
    id: tpl.id, name: tpl.name, selectionProcessId: tpl.selectionProcessId ?? "",
    description: tpl.description ?? "",
    comps: tpl.competencies.map((c) => ({ name: c.name, weight: String(c.weight) })),
  });

  const save = async () => {
    if (!form) return;
    const comps = form.comps.filter((c) => c.name.trim());
    if (!form.name.trim()) { toast.error(t("Nama template wajib diisi", "Template name is required")); return; }
    if (comps.length === 0) { toast.error(t("Minimal satu kompetensi rubrik diperlukan", "At least one rubric competency is required")); return; }
    setBusy(true);
    try {
      await apiSend(SELECTION_API, "POST", {
        action: "template-upsert",
        id: form.id,
        name: form.name.trim(),
        selectionProcessId: form.selectionProcessId || null,
        description: form.description || null,
        active: true,
        competencies: comps.map((c, i) => ({ name: c.name.trim(), weight: c.weight === "" ? 1 : Number(c.weight), orderNo: i + 1 })),
      });
      toast.success(form.id ? t(`Template "${form.name}" diperbarui`, `Template "${form.name}" updated`) : t(`Template "${form.name}" dibuat`, `Template "${form.name}" created`));
      setForm(null);
      setTick((x) => x + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan template", "Failed to save the template"));
    } finally { setBusy(false); }
  };

  const toggleActive = async (tpl: TemplateRow) => {
    if (!canUpdate) return;
    if (tpl.active) {
      if (!window.confirm(t(`Nonaktifkan template "${tpl.name}"? Scorecard terpakai tetap utuh utk audit.`, `Deactivate template "${tpl.name}"? Existing scorecards stay intact for audit.`))) return;
      setBusy(true);
      try {
        await apiSend(SELECTION_API, "POST", { action: "template-deactivate", id: tpl.id });
        toast.success(t(`Template "${tpl.name}" dinonaktifkan`, `Template "${tpl.name}" deactivated`));
        setTick((x) => x + 1);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("Gagal menonaktifkan", "Failed to deactivate"));
      } finally { setBusy(false); }
    } else {
      setBusy(true);
      try {
        await apiSend(SELECTION_API, "POST", {
          action: "template-upsert",
          id: tpl.id, name: tpl.name,
          selectionProcessId: tpl.selectionProcessId,
          description: tpl.description,
          active: true,
          competencies: tpl.competencies.map((c, i) => ({ name: c.name, description: c.description, weight: c.weight, orderNo: c.orderNo || i + 1, anchors: c.anchors })),
        });
        toast.success(t(`Template "${tpl.name}" diaktifkan kembali`, `Template "${tpl.name}" reactivated`));
        setTick((x) => x + 1);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("Gagal mengaktifkan", "Failed to activate"));
      } finally { setBusy(false); }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setForm(null); } }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Rubrik Scorecard", "Scorecard Rubrics")}
          </DialogTitle>
        </DialogHeader>

        {form ? (
          // ---------- form buat/ubah template ----------
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Nama Template *", "Template Name *")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Tahap Terikat", "Bound Stage")}</Label>
                <Select value={form.selectionProcessId || "none"} onValueChange={(v) => setForm({ ...form, selectionProcessId: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="none">{t("Umum (semua tahap)", "General (any stage)")}</SelectItem>
                    {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Deskripsi", "Description")}</Label>
                <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Kompetensi Rubrik", "Rubric Competencies")}</h4>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1"
                  onClick={() => setForm({ ...form, comps: [...form.comps, { name: "", weight: "1" }] })}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah baris", "Add row")}
                </Button>
              </div>
              <div className="space-y-2">
                {form.comps.map((c, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <div className="w-14 shrink-0 pb-1 text-center text-[11px] font-bold text-slate-400">#{i + 1}</div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Input value={c.name} onChange={(e) => setForm({ ...form, comps: form.comps.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x) })}
                        placeholder={t("nama kompetensi", "competency name")} />
                    </div>
                    <div className="w-24 shrink-0 space-y-1">
                      <Input type="number" min={0.5} step={0.5} value={c.weight}
                        onChange={(e) => setForm({ ...form, comps: form.comps.map((x, xi) => xi === i ? { ...x, weight: e.target.value } : x) })} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-rose-600 dark:text-rose-400"
                      onClick={() => setForm({ ...form, comps: form.comps.filter((_, xi) => xi !== i) })} aria-label={t("Hapus baris", "Remove row")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {t("Urutan otomatis mengikuti baris; bobot dipakai utk skor tertimbang. Anchor 1–5 memakai skala default.", "Order follows the rows; weights drive the weighted score. Anchors 1–5 use the default scale.")}
              </p>
            </div>
          </div>
        ) : (
          // ---------- daftar template ----------
          <>
            {tplApi.loading && !tplApi.data ? <LoadingRows rows={3} /> : templates.length === 0 ? (
              <EmptyState title={t("Belum ada template rubrik", "No rubric templates yet")}
                description={t("Buat template kompetensi 1–5 utk dipakai evaluator saat mengisi scorecard.", "Create a 1–5 competency template for evaluators to use on scorecards.")} />
            ) : (
              <div className="space-y-2">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-50">{tpl.name}</span>
                        {canUpdate ? (
                          <button type="button" onClick={() => toggleActive(tpl)} disabled={busy}
                            className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors",
                              tpl.active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                                : "border-zinc-200 bg-zinc-100 text-zinc-500 hover:border-zinc-400 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-400")}
                            title={t("klik utk aktif/nonaktif", "click to toggle active")}>
                            {tpl.active ? t("AKTIF", "ACTIVE") : t("NONAKTIF", "INACTIVE")}
                          </button>
                        ) : (
                          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold",
                            tpl.active ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400" : "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-400")}>
                            {tpl.active ? t("AKTIF", "ACTIVE") : t("NONAKTIF", "INACTIVE")}
                          </span>
                        )}
                      </div>
                      {tpl.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{tpl.description}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{tpl.stageName ?? t("Umum (semua tahap)", "General (any stage)")}</Badge>
                        <Badge variant="secondary">{tpl.competencies.length} {t("kompetensi", "competencies")}</Badge>
                        <Badge variant="outline">{t("dipakai {n}×", "used {n}×", { n: String(tpl.usedCount) })}</Badge>
                      </div>
                    </div>
                    {canUpdate && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(tpl)} aria-label={t("Ubah template", "Edit template")}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {!form && canCreate && (
              <Button variant="outline" onClick={openNew} className="gap-1.5">
                <Plus className="h-4 w-4" aria-hidden /> {t("Template Baru", "New Template")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {form ? (
              <>
                <Button variant="outline" onClick={() => setForm(null)}>{t("Kembali", "Back")}</Button>
                <Button onClick={save} disabled={busy} className="ov-fill">{busy ? t("Menyimpan…", "Saving…") : t("Simpan Template", "Save Template")}</Button>
              </>
            ) : (
              <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// SB-RC-BL — dialog Tahapan Seleksi PR (user-defined per rekrutmen)
// ============================================================

/** Badge kecil utk baris katalog tahap (resultType / SLA / sumber). */
function StageMetaBadges({ s }: { s: PrStageCatalogRow }) {
  const { t } = useI18n();
  return (
    <>
      <Badge variant="outline" className="text-[10px]">
        {s.resultType === "Quantitative" ? t("Kuantitatif", "Quantitative") : t("Kualitatif", "Qualitative")}
      </Badge>
      {s.slaDays != null && (
        <Badge variant="secondary" className="text-[10px]">{t("SLA {n} hr", "SLA {n} d", { n: String(s.slaDays) })}</Badge>
      )}
      <Badge variant="outline" className="text-[10px]">
        {s.appliesInternal && s.appliesExternal
          ? t("Semua sumber", "All sources")
          : s.appliesInternal
            ? t("Internal saja", "Internal only")
            : t("Eksternal saja", "External only")}
      </Badge>
      {!s.active && (
        <Badge className="bg-zinc-100 text-zinc-500 border-zinc-200 text-[10px] hover:bg-zinc-100 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/30">
          {t("NONAKTIF", "INACTIVE")}
        </Badge>
      )}
    </>
  );
}

export function PrStageConfigDialog({ open, onClose, prId, prNo, onDone }: {
  open: boolean; onClose: () => void; prId: string | null; prNo: string | null; onDone: () => void;
}) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const cfgApi = useApi<{ config: PrStageConfig }>(open && prId ? `${SELECTION_API}?prStages=1&prId=${prId}` : null, [open, prId]);
  const config = cfgApi.data?.config ?? null;

  // state edit (di-sync dari server tiap config termuat; null = belum diubah)
  const [edited, setEdited] = useState<{ custom: boolean; picked: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (config) setEdited({ custom: config.customized, picked: [...config.stageIds] });
  }, [cfgApi.data]);

  const canSave = perms.can("recruitment", "selection", "update");
  const useCustom = edited?.custom ?? config?.customized ?? false;
  const pickedIds = edited?.picked ?? config?.stageIds ?? [];
  const pickedSet = useMemo(() => new Set(pickedIds), [pickedIds]);
  const byId = useMemo(() => new Map((config?.catalog ?? []).map((c) => [c.id, c])), [config?.catalog]);

  const toggleStage = (id: string) => {
    setEdited((prev) => {
      const base = prev ?? { custom: config?.customized ?? false, picked: [...(config?.stageIds ?? [])] };
      const has = base.picked.includes(id);
      return { ...base, custom: true, picked: has ? base.picked.filter((x) => x !== id) : [...base.picked, id] };
    });
  };

  const moveStage = (i: number, dir: -1 | 1) => {
    setEdited((prev) => {
      const base = prev ?? { custom: config?.customized ?? false, picked: [...(config?.stageIds ?? [])] };
      const j = i + dir;
      if (j < 0 || j >= base.picked.length) return prev;
      const next = [...base.picked];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...base, picked: next };
    });
  };

  const save = async () => {
    if (!prId) return;
    if (useCustom && pickedIds.length === 0) {
      toast.error(t("Pilih minimal satu tahap utk daftar kustom", "Pick at least one stage for the custom list"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ customized: boolean; count: number }>(SELECTION_API, "POST", {
        action: "pr-stages-save",
        prId,
        processIds: useCustom ? pickedIds : [],
      });
      toast.success(res.customized
        ? t(`Tahapan PR ${prNo} disimpan — ${res.count} tahap kustom (nominasi berikutnya memakai urutan ini)`, `PR ${prNo} stages saved — ${res.count} custom stages (the next nominations follow this order)`)
        : t(`Tahapan PR ${prNo} direset ke standar tenant`, `PR ${prNo} stages reset to the tenant standard`));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan tahapan", "Failed to save the stages"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Tahapan Seleksi PR", "PR Selection Stages")}
            {prNo && <span className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">{prNo}</span>}
          </DialogTitle>
        </DialogHeader>

        {cfgApi.loading && !cfgApi.data ? (
          <LoadingRows rows={4} />
        ) : cfgApi.error ? (
          <EmptyState title={t("Gagal memuat tahapan", "Failed to load the stages")} description={cfgApi.error} />
        ) : !config ? null : (
          <div className="space-y-4">
            {/* peringatan kandidat existing — snapshot rantai tidak berubah */}
            {config.candidateCount > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" role="status">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {t(
                    "{n} kandidat sudah dinominasikan di PR ini — perubahan hanya berlaku untuk nominasi BARU; rantai tahap kandidat yang sudah berjalan tidak diubah.",
                    "{n} candidates have already been nominated to this PR — changes only apply to NEW nominations; step chains already in progress stay unchanged.",
                    { n: String(config.candidateCount) },
                  )}
                </span>
              </div>
            )}

            {/* pilihan mode */}
            <RadioGroup
              value={useCustom ? "custom" : "standard"}
              onValueChange={(v) => setEdited((prev) => {
                const base = prev ?? { custom: config.customized, picked: [...config.stageIds] };
                return { ...base, custom: v === "custom" };
              })}
              className="gap-3"
              disabled={!canSave}
            >
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <RadioGroupItem value="standard" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{t("Standar tenant", "Tenant standard")}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {t("Semua tahap aktif di katalog Master Rekrutmen, urut standar — dipakai bila PR tidak punya daftar kustom.", "All active stages in the Recruitment Master catalog, in standard order — used when the PR has no custom list.")}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <RadioGroupItem value="custom" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{t("Kustom utk PR ini", "Custom for this PR")}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {t("Pilih tahap + urutannya khusus utk rekrutmen ini (mis. rekrutmen manajer vs staf bisa berbeda).", "Pick the stages & their order specifically for this recruitment (e.g. manager vs staff hiring can differ).")}
                  </span>
                </span>
              </label>
            </RadioGroup>

            {useCustom ? (
              <div className="space-y-3">
                {/* daftar terpilih (urutan) */}
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t("Urutan tahap ({n})", "Stage order ({n})", { n: String(pickedIds.length) })}
                  </h4>
                  {pickedIds.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">
                      {t("Centang tahap di katalog di bawah — tahap terpilih muncul di sini dan bisa diurutkan.", "Tick stages in the catalog below — selected stages appear here and can be ordered.")}
                    </p>
                  ) : (
                    <ol className="space-y-1.5">
                      {pickedIds.map((id, i) => {
                        const s = byId.get(id);
                        if (!s) return null;
                        return (
                          <li key={id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold ov-text-accent">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-50">{s.name}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={!canSave || i === 0}
                                onClick={() => moveStage(i, -1)} aria-label={t("Naikkan urutan", "Move up")}>
                                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                              <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={!canSave || i === pickedIds.length - 1}
                                onClick={() => moveStage(i, 1)} aria-label={t("Turunkan urutan", "Move down")}>
                                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-600" disabled={!canSave}
                                onClick={() => toggleStage(id)} aria-label={t("Hapus dari daftar", "Remove from list")}>
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>

                {/* katalog tahap */}
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t("Katalog tahap (Master Rekrutmen)", "Stage catalog (Recruitment Masters)")}
                  </h4>
                  <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {config.catalog.map((s) => {
                      const on = pickedSet.has(s.id);
                      return (
                        <label key={s.id} className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-colors",
                          on ? "border-brand/40 bg-brand/5 dark:border-brand/40" : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600",
                          !s.active && "opacity-60",
                        )}>
                          <Checkbox checked={on} onCheckedChange={() => toggleStage(s.id)} disabled={!canSave || !s.active} className="mt-0.5" aria-label={s.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                              {s.name}
                              {!s.active && <span className="ml-1.5 align-middle"><StageMetaBadges s={s} /></span>}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5">
                              {s.active && <StageMetaBadges s={s} />}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
                    <Info className="h-3 w-3 shrink-0" aria-hidden />
                    {t("Tahap tetap difilter utk sumber kandidat (Internal/Eksternal) sesuai setelan master — kandidat internal tidak akan menerima tahap khusus eksternal.", "Stages are still filtered by candidate source (Internal/External) per the master setting — internal candidates won't receive external-only stages.")}
                  </p>
                </div>
              </div>
            ) : (
              /* pratinjau standar tenant */
              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t("Urutan standar (pratinjau)", "Standard order (preview)")}
                </h4>
                <ol className="space-y-1.5">
                  {config.catalog.filter((s) => s.active).map((s, i) => (
                    <li key={s.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-50">{s.name}</span>
                      <span className="hidden flex-wrap items-center gap-1.5 sm:flex"><StageMetaBadges s={s} /></span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="hidden text-[10px] text-slate-400 sm:block">
            {t("Rantai tahap kandidat yang sudah berjalan tersimpan sebagai snapshot — aman untuk audit.", "Step chains already in progress are stored as snapshots — audit safe.")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
            {canSave && (
              <Button onClick={save} disabled={busy} className="ov-fill ov-glow">
                {busy ? t("Menyimpan…", "Saving…") : t("Simpan Tahapan", "Save Stages")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog transfer kandidat (nominasi pelamar / karyawan internal)
// ============================================================

function PersonPicker({ items, selectedId, onSelect, rowOf, searchOf, placeholder }: {
  items: { id: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  rowOf: (it: { id: string }) => ReactNode;
  searchOf: (it: { id: string }) => string;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = items.find((x) => x.id === selectedId) ?? null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-10 w-full justify-between font-normal">
          {selected ? <span className="min-w-0 truncate text-left">{rowOf(selected)}</span> : <span className="text-slate-400">{placeholder}</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter>
          <CommandInput placeholder={t("Ketik nama / nomor…", "Type a name / number…")} />
          <CommandList className="max-h-64">
            <CommandEmpty>{t("Tidak ditemukan.", "No results found.")}</CommandEmpty>
            <CommandGroup>
              {items.map((it) => (
                <CommandItem key={it.id} value={searchOf(it)} onSelect={() => { onSelect(it.id); setOpen(false); }}>
                  <span className="min-w-0 flex-1">{rowOf(it)}</span>
                  <Check className={cn("h-4 w-4 shrink-0", selectedId === it.id ? "opacity-100 ov-text-accent" : "opacity-0")} aria-hidden />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function TransferDialog({ open, onClose, prs, employees, defaultPrId, onDone }: {
  open: boolean;
  onClose: () => void;
  prs: PrOpt[];
  employees: EmployeeOpt[];
  defaultPrId: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  // FIX: dulu limit=100 sort applicantNo ASC → bila talent pool >100, pelamar
  // TERBARU hilang duluan dari picker (senyap). Kini urut TERBARU dulu + info
  // jumlah bila terpotong (clamp layanan memang 100 — jujur di UI).
  const appApi = useApi<{ rows: ApplicantOpt[]; total: number }>(open ? "/api/rekankerja/recruitment/applicants?status=Active&limit=100&sortBy=applicantNo&sortDir=desc" : null, [open]);
  const applicants = appApi.data?.rows ?? [];
  const [prId, setPrId] = useState(defaultPrId);
  const [kind, setKind] = useState<"applicant" | "employee">("applicant");
  const [applicantId, setApplicantId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setPrId(defaultPrId); setKind("applicant"); setApplicantId(""); setEmployeeId(""); setNote(""); }
  }, [open, defaultPrId]);

  const submit = async () => {
    if (!prId) { toast.error(t("Pilih PR tujuan", "Pick the target PR")); return; }
    if (kind === "applicant" && !applicantId) { toast.error(t("Pilih pelamar talent pool", "Pick a talent pool applicant")); return; }
    if (kind === "employee" && !employeeId) { toast.error(t("Pilih karyawan internal", "Pick an internal employee")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ id: string; prNo: string; fullName: string; source: string; stepsCreated: number }>(CANDIDATES_API, "POST", {
        prId,
        applicantId: kind === "applicant" ? applicantId : null,
        employeeId: kind === "employee" ? employeeId : null,
        note: note || null,
      });
      toast.success(t(`${res.fullName} masuk ${res.prNo} — ${res.stepsCreated} tahap seleksi dibuat`, `${res.fullName} added to ${res.prNo} — ${res.stepsCreated} selection stages created`));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menominasikan kandidat", "Failed to nominate the candidate"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Transfer Kandidat", "Transfer Candidate")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("Permintaan Karyawan (PR) *", "Personnel Requisition (PR) *")}</Label>
            <Select value={prId || undefined} onValueChange={setPrId}>
              <SelectTrigger><SelectValue placeholder={t("Pilih PR Approved/OnHold", "Pick an Approved/OnHold PR")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {prs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.prNo} — {p.positionTitle ?? t("tanpa posisi", "no position")} · {t("kebutuhan {n} org", "{n} headcount", { n: String(p.requiredNo) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("Sumber Kandidat *", "Candidate Source *")}</Label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v === "employee" ? "employee" : "applicant")} className="grid grid-cols-2 gap-2">
              <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm font-medium",
                kind === "applicant" ? "ov-border-accent ov-soft" : "border-slate-200 dark:border-slate-700")}>
                <RadioGroupItem value="applicant" /> {t("Pelamar Talent Pool", "Talent Pool Applicant")}
              </label>
              <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm font-medium",
                kind === "employee" ? "ov-border-accent ov-soft" : "border-slate-200 dark:border-slate-700")}>
                <RadioGroupItem value="employee" /> {t("Karyawan Internal", "Internal Employee")}
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-1.5">
            <Label>{kind === "applicant" ? t("Pelamar *", "Applicant *") : t("Karyawan *", "Employee *")}</Label>
            {appApi.loading && !appApi.data ? (
              <LoadingRows rows={1} />
            ) : kind === "applicant" ? (
              <>
                <PersonPicker
                  items={applicants}
                  selectedId={applicantId}
                  onSelect={setApplicantId}
                  rowOf={(it) => {
                    const a = it as ApplicantOpt;
                    return <>{a.applicantNo} — <b>{a.fullName}</b> ({a.sourceLabel ?? a.source ?? "—"})</>;
                  }}
                  searchOf={(it) => `${(it as ApplicantOpt).fullName} ${(it as ApplicantOpt).applicantNo}`}
                  placeholder={t("Cari pelamar aktif talent pool…", "Search active talent pool applicants…")}
                />
                {(appApi.data?.total ?? 0) > applicants.length && (
                  <p className="text-[10px] text-slate-400">
                    {t("Menampilkan 100 pelamar terbaru dari {n} aktif — persempit lewat halaman Pelamar bila tidak ditemukan.", "Showing the 100 newest of {n} active applicants — narrow down via the Applicants page if not found.", { n: appApi.data?.total ?? 0 })}
                  </p>
                )}
              </>
            ) : (
              <PersonPicker
                items={employees}
                selectedId={employeeId}
                onSelect={setEmployeeId}
                rowOf={(it) => {
                  const e = it as EmployeeOpt;
                  return <>{e.employeeNo} — <b>{e.fullName}</b>{e.positionTitle ? ` (${e.positionTitle})` : ""}</>;
                }}
                searchOf={(it) => `${(it as EmployeeOpt).fullName} ${(it as EmployeeOpt).employeeNo}`}
                placeholder={t("Cari karyawan internal…", "Search internal employees…")}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t("Catatan Kandidat", "Candidate Note")}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t("opsional — mis. prioritas dari officer PR", "optional — e.g. priority from the PR officer")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy} className="ov-fill">{busy ? t("Menyimpan…", "Saving…") : t("Nominasikan", "Nominate")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog event kalender per hari
// ============================================================

export function DayEventsDialog({ day, events, onClose, onOpenCandidate }: {
  day: string | null;
  events: CalendarEvent[];
  onClose: () => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <Dialog open={day != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4 ov-text-accent" aria-hidden />
            {day ? new Date(`${day}T00:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {events.length === 0 && <p className="text-sm text-slate-500">{t("Tidak ada jadwal.", "No schedules.")}</p>}
          {events.map((e) => (
            <button key={e.stepId} type="button"
              onClick={() => { onClose(); onOpenCandidate(e.candidateId); }}
              className="flex w-full items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-900/60">
              <span className="mt-0.5 font-mono text-[11px] font-semibold text-slate-400">
                {new Date(e.planDate).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <b className="text-sm">{e.candidateName}</b>
                  <StepPill status={e.status} />
                  {e.overdue && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                      <AlarmClock className="h-3 w-3" aria-hidden /> {daysLateOf(e.dueDate)} {t("hari", "days")}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  {e.stageName} · {e.prNo}{e.positionTitle ? ` — ${e.positionTitle}` : ""}{e.performerName ? ` · ${t("evaluator", "evaluator")}: ${e.performerName}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Dialog detail kandidat (multi-tab)
// ============================================================

export function CandidateDetailDialog({ candidateId, employees, stages, blind = false, displayName = null, onClose, onMutated, onScored }: {
  candidateId: string | null;
  employees: EmployeeOpt[];
  stages: ProcessOpt[];
  /** F6c mode buta — sembunyikan nama & detail identitas (display-only). */
  blind?: boolean;
  /** nama tampil (Mode Buta → "Kandidat #n") — null = pakai nama asli. */
  displayName?: string | null;
  onClose: () => void;
  onMutated: () => void;
  /** F6b — dipanggil setelah skor AI baru digenerate (refresh badge board). */
  onScored?: () => void;
}) {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [reloadTick, setReloadTick] = useState(0);
  const detailApi = useApi<{ row: CandidateDetail }>(
    candidateId ? `${SELECTION_API}?candidateId=${candidateId}` : null,
    [candidateId, reloadTick],
  );
  const row = detailApi.data?.row ?? null;

  const [tab, setTab] = useState("steps");
  const [scheduleStep, setScheduleStep] = useState<StepRow | null>(null);
  const [cancelStep, setCancelStep] = useState<StepRow | null>(null);
  const [resultStep, setResultStep] = useState<StepRow | null>(null);
  const [fillStep, setFillStep] = useState<StepRow | null>(null);
  const [invite, setInvite] = useState<InvitationResult | null>(null);
  const [inviteBusyFor, setInviteBusyFor] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [addStepId, setAddStepId] = useState("");
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);

  const canSchedule = perms.canOp("recruitment", "selection", "schedule");
  const canResult = perms.canOp("recruitment", "selection", "result");
  const canInvite = perms.canOp("recruitment", "selection", "invite");
  const canScorecard = perms.can("recruitment", "selection", "update");
  const canNote = perms.can("recruitment", "candidates", "update");
  const canWithdraw = perms.canOp("recruitment", "candidates", "withdraw");
  // F6b — skor AI kandidat (generate + breakdown) — op:score.
  const canScore = perms.canOp("recruitment", "selection", "score");

  // nama tampil — Mode Buta mengganti identitas dgn nomor anonim per PR.
  const shownName = row ? (displayName ?? row.card.fullName) : "…";

  useEffect(() => { setTab("steps"); setNoteDraft(null); setAddStepId(""); }, [candidateId]);

  const currentStep = row?.steps.find((s) => s.isCurrent) ?? null;
  const panelApi = useApi<{ panel: PanelResult }>(
    row && tab === "scorecard" && currentStep ? `${SELECTION_API}?stepId=${currentStep.id}&scorecards=1` : null,
    [currentStep?.id, tab, reloadTick],
  );
  const panel = panelApi.data?.panel ?? null;

  const refreshAll = () => { setReloadTick((x) => x + 1); onMutated(); };

  // ---------- aksi ----------

  const doAck = async (step: StepRow) => {
    try {
      await apiSend(SELECTION_API, "POST", { action: "ack", stepId: step.id, onBehalf: true });
      toast.success(t(`${step.stageName} di-acknowledge (atas nama kandidat)`, `${step.stageName} acknowledged (on behalf of the candidate)`));
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal acknowledge", "Failed to acknowledge"));
    }
  };

  const doInvite = async (step: StepRow) => {
    setInviteBusyFor(step.id);
    try {
      const res = await apiSend<InvitationResult>(SELECTION_API, "POST", { action: "invite", stepId: step.id });
      toast.success(t(`Surat undangan ${res.letterNo} terbit`, `Invitation letter ${res.letterNo} issued`));
      setInvite(res);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menerbitkan undangan", "Failed to issue the invitation"));
    } finally { setInviteBusyFor(null); }
  };

  const doAddStep = async () => {
    if (!row || !addStepId) return;
    try {
      await apiSend(SELECTION_API, "POST", { action: "add-step", candidateId: row.card.id, selectionProcessId: addStepId });
      const st = stages.find((s) => s.id === addStepId);
      toast.success(t(`Tahap ${st?.name ?? ""} ditambahkan ke rantai kandidat`, `Stage ${st?.name ?? ""} added to the candidate chain`));
      setAddStepId("");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menambah tahap", "Failed to add the stage"));
    }
  };

  const saveNote = async () => {
    if (!row || noteDraft == null) return;
    setNoteBusy(true);
    try {
      await apiSend(CANDIDATES_API, "PATCH", { id: row.card.id, action: "note", note: noteDraft || null });
      toast.success(t("Catatan kandidat disimpan", "Candidate note saved"));
      setNoteDraft(null);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan catatan", "Failed to save the note"));
    } finally { setNoteBusy(false); }
  };

  const doDelete = async () => {
    if (!row) return;
    if (!window.confirm(t(`Hapus kandidat ${shownName} dari ${row.pr.prNo}? Hanya bisa bila belum ada tahap yang dilaksanakan.`, `Delete candidate ${shownName} from ${row.pr.prNo}? Only possible when no stage has been performed yet.`))) return;
    try {
      await apiSend(`${CANDIDATES_API}?id=${row.card.id}`, "DELETE");
      toast.success(t(`${shownName} dihapus dari proses`, `${shownName} removed from the process`));
      onMutated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus kandidat", "Failed to delete the candidate"));
    }
  };

  const availableStages = stages.filter((s) => !row?.steps.some((x) => x.stageId === s.id));
  const stepActions = (s: StepRow) => {
    const terminal = ["Passed", "Failed", "Cancelled"].includes(s.status);
    if (terminal || !s.isCurrent) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
        {canSchedule && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2" onClick={() => setScheduleStep(s)}>
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> {t("Jadwalkan", "Schedule")}
          </Button>
        )}
        {canInvite && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={!s.planDate || inviteBusyFor === s.id}
            title={!s.planDate ? t("Jadwalkan tahap terlebih dahulu", "Schedule the stage first") : undefined}
            onClick={() => doInvite(s)}>
            <MailCheck className="h-3.5 w-3.5" aria-hidden /> {inviteBusyFor === s.id ? t("Menerbitkan…", "Issuing…") : t("Terbitkan Undangan", "Issue Invitation")}
          </Button>
        )}
        {canSchedule && s.needAck && s.status === "Planned" && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2" onClick={() => doAck(s)}>
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> {t("Ack", "Ack")}
          </Button>
        )}
        {canResult && (
          <Button size="sm" className="ov-fill h-7 gap-1 px-2" onClick={() => setResultStep(s)}>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> {t("Catat Hasil", "Record Result")}
          </Button>
        )}
        {canResult && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => setCancelStep(s)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("Batalkan Tahap", "Cancel Stage")}
          </Button>
        )}
      </div>
    );
  };

  return (
    <>
      <Dialog open={candidateId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          {detailApi.loading && !detailApi.data ? (
            <LoadingRows rows={5} />
          ) : !row ? (
            <EmptyState title={t("Kandidat tidak ditemukan", "Candidate not found")} description={detailApi.error ?? undefined} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{shownName}</span>
                  {row.card.source === "Internal"
                    ? <Pill tone="brand">{t("Internal", "Internal")}</Pill>
                    : <Pill tone="slate">{t("Eksternal", "External")}</Pill>}
                  <CandPill status={row.card.status} />
                  <span className="font-mono text-xs font-normal text-slate-400">{row.pr.prNo}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-normal text-slate-500 dark:text-slate-400">
                    {row.pr.positionTitle ?? t("tanpa posisi", "no position")} · {t("kebutuhan {n} org", "{n} headcount", { n: String(row.pr.requiredNo) })}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <Tabs value={tab} onValueChange={setTab} className="w-full">
                <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
                  <TabsTrigger value="steps">{t("Tahapan", "Stages")}</TabsTrigger>
                  <TabsTrigger value="scorecard">{t("Scorecard", "Scorecard")}</TabsTrigger>
                  {canScore && <TabsTrigger value="aiscore">{t("Skor AI", "AI Score")}</TabsTrigger>}
                  <TabsTrigger value="profile">{t("Profil", "Profile")}</TabsTrigger>
                </TabsList>
              </Tabs>

              {/* ============ TAB TAHAPAN ============ */}
              {tab === "steps" && (
                <div className="space-y-3">
                  {row.steps.map((s, i) => {
                    const terminal = ["Passed", "Failed", "Cancelled"].includes(s.status);
                    const seqTone = s.isCurrent ? "ov-fill" : s.status === "Passed" ? "bg-emerald-500 text-white"
                      : s.status === "Failed" ? "bg-rose-500 text-white" : s.status === "Cancelled" ? "bg-zinc-300 text-zinc-700 dark:bg-zinc-600 dark:text-zinc-200"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400";
                    const late = daysLateOf(s.dueDate);
                    return (
                      <div key={s.id} className="flex gap-3">
                        {/* timeline rail */}
                        <div className="flex flex-col items-center">
                          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", seqTone)}>{s.seqNo}</span>
                          {i < row.steps.length - 1 && <span className="w-px flex-1 bg-slate-200 dark:bg-slate-800" />}
                        </div>
                        {/* kartu tahap */}
                        <div className={cn("mb-1 min-w-0 flex-1 rounded-xl border p-3",
                          s.isCurrent ? "ov-border-accent bg-white dark:bg-slate-900" : "border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40")}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-50">{s.stageName}</span>
                            <StepPill status={s.status} />
                            {s.isCurrent && !terminal && <Badge className="ov-fill font-bold">{t("TAHAP AKTIF", "CURRENT STAGE")}</Badge>}
                            {s.slaDays != null && <span className="text-[10px] text-slate-400" title={t("SLA master tahap", "Stage master SLA")}>SLA {s.slaDays}{t("h", "d")}</span>}
                            {s.needAck && (
                              <span title={t("perlu acknowledgement kandidat", "candidate acknowledgement required")}>
                                <BadgeCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                              </span>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                            <Field label={t("Rencana", "Planned")} value={s.planDate ? fmtDateTime(s.planDate) : "—"} />
                            <Field label={t("Batas SLA", "SLA Due")} value={s.dueDate ? fmtDate(s.dueDate) : "—"}
                              danger={s.overdue} title={s.overdue ? t("lewat {n} hari", "{n} days overdue", { n: String(late) }) : undefined} />
                            <Field label={t("Panel Evaluator", "Evaluator Panel")} value={
                              s.evaluators.length > 0 ? (
                                <span className="flex flex-wrap items-center gap-1" title={t("Panel: {names}", "Panel: {names}", { names: s.evaluators.map((e) => e.name).join(", ") })}>
                                  {s.evaluators.map((e, i) => (
                                    <span key={e.id} className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium dark:border-slate-700 dark:bg-slate-800/60">
                                      <Users className="h-2.5 w-2.5 text-slate-400" aria-hidden />
                                      {e.name}{i === 0 ? ` (${t("Lead", "Lead")})` : ""}
                                    </span>
                                  ))}
                                </span>
                              ) : (s.performerName ?? "—")} />
                            <Field label={t("Ack", "Acknowledged")} value={s.acknowledgedAt ? fmtDate(s.acknowledgedAt) : "—"} />
                            <Field label={t("Skor / Hasil", "Score / Result")} value={
                              <span className="flex flex-wrap items-center gap-1.5">
                                {s.score != null && <b className="tabular-nums">{s.score}</b>}
                                {s.result && <span>{s.result}</span>}
                                {s.score == null && !s.result && "—"}
                              </span>} />
                            <Field label={t("Surat Undangan", "Invitation")} value={s.letters.length > 0 ? (
                              <button type="button" className="inline-flex items-center gap-1 font-mono text-[11px] text-teal-700 hover:underline dark:text-teal-400"
                                onClick={() => window.open(`${SELECTION_API}?letterPdf=${s.letters[0].id}`, "_blank")}>
                                <FileText className="h-3.5 w-3.5" aria-hidden />{s.letters[0].letterNo}
                              </button>
                            ) : "—"} />
                            <Field label={t("Link Meeting", "Meeting Link")} value={s.meetingUrl ? (
                              <a href={s.meetingUrl} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-400"
                                title={s.meetingUrl}>
                                <Video className="h-3.5 w-3.5" aria-hidden />
                                {t("Buka Meeting", "Open Meeting")}
                              </a>
                            ) : "—"} />
                            <Field label={t("Dilaksanakan", "Performed")} value={s.performedAt ? fmtDate(s.performedAt) : "—"} />
                            <Field label={t("Panel Scorecard", "Scorecard Panel")} value={
                              <span className="flex items-center gap-1">
                                <ClipboardCheck className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                                {s.scorecardPanel.submitted}/{s.scorecardPanel.count}
                                {s.scorecardPanel.divergence && (
                                  <span title={t("Panel divergen >2 — perlu kalibrasi", "Panel divergent >2 — calibration needed")}>
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                                  </span>
                                )}
                              </span>} />
                          </div>
                          {s.comment && <p className="mt-1.5 text-xs italic text-slate-500 dark:text-slate-400">“{s.comment}”</p>}
                          {/* P2.3 — slot jadwal mandiri + status booked */}
                          {s.slots.length > 0 && (
                            <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-900/40">
                              <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                <CalendarPlus className="h-3 w-3" aria-hidden /> {t("Slot jadwal mandiri", "Self-schedule slots")}
                              </div>
                              <ul className="space-y-1">
                                {s.slots.map((sl) => (
                                  <li key={sl.id} className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="min-w-0 truncate">{fmtDateTime(sl.startAt)} · {sl.durationMin} {t("mnt", "min")}</span>
                                    <Pill tone={sl.status === "Booked" ? "emerald" : sl.status === "Open" ? "amber" : "zinc"}>
                                      {sl.status === "Booked" ? t("Terpilih kandidat", "Booked") : sl.status === "Open" ? t("Tersedia", "Open") : t("Ditutup", "Closed")}
                                    </Pill>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {s.overdue && (
                            <p className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                              <AlarmClock className="h-3 w-3" aria-hidden /> {t("TERLAMBAT {n} hari", "{n} DAYS OVERDUE", { n: String(late) })}
                            </p>
                          )}
                          {stepActions(s)}
                        </div>
                      </div>
                    );
                  })}

                  {/* tambah tahap */}
                  {canResult && !["Passed", "Withdrawn"].includes(row.card.status) && (
                    <div className="flex items-end gap-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label>{t("Tambah Tahap (di luar rantai standar)", "Add Stage (outside the standard chain)")}</Label>
                        <Select value={addStepId || undefined} onValueChange={setAddStepId}>
                          <SelectTrigger><SelectValue placeholder={t("Pilih tahap yang belum ada di rantai…", "Pick a stage not yet in the chain…")} /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            {availableStages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="outline" className="gap-1.5" onClick={doAddStep} disabled={!addStepId}>
                        <Plus className="h-4 w-4" aria-hidden /> {t("Tambah", "Add")}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ============ TAB SCORECARD ============ */}
              {tab === "scorecard" && (
                <div className="space-y-3">
                  {!currentStep ? (
                    <EmptyState title={t("Tidak ada tahap aktif", "No active stage")}
                      description={t("Proses kandidat sudah berakhir — scorecard tersimpan tetap bisa dilihat pada tab Tahapan.", "The candidate's process has ended — saved scorecards remain visible on the Stages tab.")} />
                  ) : panelApi.loading && !panelApi.data ? (
                    <LoadingRows rows={3} />
                  ) : !panel ? (
                    <EmptyState title={t("Panel scorecard tidak termuat", "Scorecard panel unavailable")} />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            {t("Panel tahap aktif", "Active stage panel")} — {currentStep.stageName}
                          </div>
                          <div className="mt-0.5 flex items-baseline gap-2">
                            <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                              {panel.panelAvg != null ? panel.panelAvg.toFixed(2) : "—"}
                            </span>
                            <span className="text-xs text-slate-400">{t("rata-rata tertimbang", "weighted average")}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <Pill tone="slate">{t("{n} terkirim", "{n} submitted", { n: String(panel.scorecards.filter((x) => x.submittedAt).length) })}</Pill>
                            <Pill tone={panel.feedbackOk ? "emerald" : "amber"}>
                              {panel.feedbackOk ? t("feedback gate OK", "feedback gate OK") : t("feedback belum ada", "feedback missing")}
                            </Pill>
                            <span className="text-slate-400">{t("gap {n} poin", "gap {n} pts", { n: String(panel.divergenceGap) })}</span>
                          </div>
                        </div>
                        {canScorecard && !["Passed", "Failed", "Cancelled"].includes(currentStep.status) && (
                          <Button className="ov-fill gap-1.5" onClick={() => setFillStep(currentStep)}>
                            <ListChecks className="h-4 w-4" aria-hidden /> {t("Isi Scorecard", "Fill Scorecard")}
                          </Button>
                        )}
                      </div>

                      {panel.divergence && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <span>
                            {t("⚠ Divergensi panel {n} poin > 2 — lakukan kalibrasi.", "⚠ Panel divergence of {n} pts > 2 — run a calibration.", { n: String(panel.divergenceGap) })}
                          </span>
                        </div>
                      )}

                      {panel.scorecards.length === 0 ? (
                        <EmptyState title={t("Belum ada scorecard", "No scorecards yet")}
                          description={t("Panel scorecard tahap ini masih kosong — isi lewat tombol di kanan atas.", "This stage's scorecard panel is empty — fill one via the button at the top right.")} />
                      ) : panel.scorecards.map((sc) => (
                        <div key={sc.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                                {sc.evaluatorName} <span className="font-mono text-[11px] font-normal text-slate-400">{sc.evaluatorNo}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {sc.templateName} · {sc.submittedAt ? fmtDate(sc.submittedAt) : t("draf — belum disubmit", "draft — not submitted")}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                                {sc.weightedScore != null ? sc.weightedScore.toFixed(2) : "—"}
                              </span>
                              {sc.recommendation && <RecPill rec={sc.recommendation} />}
                            </div>
                          </div>
                          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t("Kompetensi", "Competency")}</TableHead>
                                  <TableHead className="w-14">{t("Bobot", "Weight")}</TableHead>
                                  <TableHead className="w-14">{t("Skor", "Score")}</TableHead>
                                  <TableHead>{t("Komentar", "Comment")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {sc.items.map((it) => (
                                  <TableRow key={it.competencyId}>
                                    <TableCell className="text-xs font-medium">{it.name}</TableCell>
                                    <TableCell className="text-xs tabular-nums text-slate-500">×{it.weight}</TableCell>
                                    <TableCell className="text-xs font-bold tabular-nums">{it.score}</TableCell>
                                    <TableCell className="text-xs text-slate-500 dark:text-slate-400">{it.comment ?? "—"}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {sc.overallComment && (
                            <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400">“{sc.overallComment}”</p>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* ============ TAB SKOR AI (F6b) ============ */}
              {tab === "aiscore" && row && (
                <AiScorePanel
                  candidateId={row.card.id}
                  displayName={shownName}
                  canGenerate={canScore}
                  onScored={onScored}
                />
              )}

              {/* ============ TAB PROFIL ============ */}
              {tab === "profile" && row && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    <Field label={t("Jenis Kandidat", "Candidate Type")} value={row.profile.kind === "Internal" ? t("Karyawan Internal", "Internal Employee") : t("Pelamar Eksternal", "External Applicant")} />
                    <Field label={t("Nomor", "Number")} value={
                      row.profile.kind === "Internal" ? (row.profile.employeeNo ?? "—") : (row.profile.applicantNo ?? "—")} />
                    <Field label={t("Dinominasikan", "Nominated")} value={
                      <span>{fmtDate(row.card.nominatedAt)}{row.card.nominatedByName ? ` · ${row.card.nominatedByName}` : ""}</span>} />
                    <Field label={t("Email", "Email")} value={row.profile.email ?? "—"} />
                    <Field label={t("Telepon", "Phone")} value={row.profile.phone ?? "—"} />
                    <Field label={t("Kota", "City")} value={row.profile.city ?? "—"} />
                    <Field label={t("Pendidikan", "Education")} value={
                      blind
                        ? <span className="italic text-slate-400" title={t("disembunyikan Mode Buta", "hidden by Blind Mode")}>—{t("disembunyikan", "hidden")}—</span>
                        : row.profile.educationLevel
                          ? `${row.profile.educationLevel}${row.profile.gpa != null ? ` · IPK ${row.profile.gpa.toFixed(2)}` : ""}`
                          : "—"} />
                    <Field label={t("Pengalaman", "Experience")} value={monthsLabel(row.profile.totalExpMonths, locale === "en-US")} />
                    <Field label={t("Ekspektasi Gaji", "Expected Salary")}
                      value={row.profile.expectedSalary == null
                        ? <span title={t("disembunyikan vault uang / kosong", "hidden by the money vault / empty")}>—</span>
                        : fmtIDR(row.profile.expectedSalary)} />
                    <Field label={t("Sumber", "Source")} value={row.profile.sourceLabel ?? "—"} />
                    <Field label={t("Referensi", "Referral")} value={row.profile.referralName ?? "—"} />
                    <Field label={t("Officer PR", "PR Officer")} value={row.pr.officerName ?? "—"} />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>{t("Catatan Kandidat", "Candidate Note")}</Label>
                      {canNote && noteDraft != null && (
                        <Button size="sm" className="h-7 ov-fill" onClick={saveNote} disabled={noteBusy}>{t("Simpan Catatan", "Save Note")}</Button>
                      )}
                    </div>
                    <Textarea rows={2} disabled={!canNote}
                      value={noteDraft ?? row.card.note ?? ""}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder={t("catatan internal HR tentang kandidat ini…", "internal HR note about this candidate…")} />
                    {canNote && noteDraft == null && <p className="text-[11px] text-slate-400">{t("ketik untuk mengubah catatan…", "type to edit the note…")}</p>}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t("Status: {s} — tahap {a}/{b}.", "Status: {s} — stage {a}/{b}.", {
                        s: row.card.status, a: String(row.card.currentSeqNo ?? row.card.totalSteps), b: String(row.card.totalSteps),
                      })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {canWithdraw && row.card.status !== "Withdrawn" && (
                        <Button variant="outline" className="gap-1.5 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => setWithdrawOpen(true)}>
                          <UserRoundX className="h-4 w-4" aria-hidden /> {t("Tarik Kandidat", "Withdraw Candidate")}
                        </Button>
                      )}
                      {canWithdraw && (
                        <Button variant="outline" className="gap-1.5 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={doDelete}>
                          <Trash2 className="h-4 w-4" aria-hidden /> {t("Hapus", "Delete")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* sub-dialog tahap (dipakai tab Tahapan) */}
      <ScheduleDialog step={scheduleStep} employees={employees} onClose={() => setScheduleStep(null)} onDone={refreshAll} />
      <CancelStepDialog step={cancelStep} onClose={() => setCancelStep(null)} onDone={refreshAll} />
      <InvitePreviewDialog letter={invite} onClose={() => setInvite(null)} />
      <ScorecardFillDialog step={fillStep} employees={employees} onClose={() => setFillStep(null)} onDone={refreshAll} />
      <WithdrawDialog candidateId={withdrawOpen ? (row?.card.id ?? null) : null} name={shownName} onClose={() => setWithdrawOpen(false)} onDone={() => { refreshAll(); }} />
      <ResultAdvanceDialog
        target={resultStep ? {
          mode: "result",
          stepId: resultStep.id,
          cards: [{ id: row?.card.id ?? "", fullName: shownName }],
          evaluatedStageName: resultStep.stageName,
          resultType: resultStep.resultType,
          minResultPass: resultStep.minResultPass,
        } : null}
        employees={employees}
        onClose={() => setResultStep(null)}
        onDone={refreshAll}
      />
    </>
  );
}
