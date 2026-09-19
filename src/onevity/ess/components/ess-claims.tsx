"use client";
// OneVity ESS — Klaim Saya: 2 tab — Klaim Medis (docNo, jenis, tagihan,
// disetujui, status, tanggal) & Klaim Travel (docNo, tujuan, status,
// advance, settlement) + DIALOG PENGAJUAN:
//  · Medis  — jenis benefit + saldo dari GET /ess/claims/medical; baris
//    perawatan multi (nama/diagnosa/kwitansi/dokter/RS/tanggal/tagihan);
//    guard plafon pool + reservasi menunggu + tanggal dienforce server.
//  · Travel — dasar klaim: pengajuan dinas Approved milik saya yang belum
//    punya klaim aktif (requestId) ATAU klaim mandiri (template); baris
//    biaya multi per jenis; formula settlement (a)/(b)/(c) otoritatif server.
// Kolom riwayat tetap dibaca defensif (nama field backend bisa varian).
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  HeartPulse, Plane, Loader2, AlertTriangle, Plus, Trash2, Send, Info,
} from "lucide-react";
import { useApi, fmtIDR, fmtDate } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ESS_BASE, pickNum, pickStr,
  fetchMedicalClaimForm, submitMedicalClaim,
  fetchTravelClaimForm, submitTravelClaim,
} from "./ess-api";
import type {
  EssClaimsData, EssRecord,
  EssMedicalClaimType,
  EssTravelClaimRequestOption,
  EssTravelTemplateOption,
  EssTravelExpenseTypeOption,
} from "./ess-types";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Sentinel "klaim mandiri" — Radix Select tidak mengizinkan value string kosong. */
const MANDIRI = "__mandiri__";

function ErrorRetry({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-6 py-10 text-center dark:border-stone-700 dark:bg-stone-900/30">
      <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
      <p className="text-[13px] font-semibold text-stone-700 dark:text-stone-300">{t("Gagal memuat klaim", "Failed to load claims")}</p>
      <p className="max-w-sm break-words text-xs text-stone-500">{message ?? t("Server tidak dapat dijangkau.", "The server could not be reached.")}</p>
      <Button onClick={onRetry} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
        <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
      </Button>
    </div>
  );
}

/** Kotak error inline di dalam dialog (error 400 validasi server). */
function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] leading-relaxed text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="break-words">{message}</span>
    </div>
  );
}

/** Baris info kecil (label + nilai) untuk kartu konteks. */
function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[11.5px] font-semibold text-stone-500 dark:text-stone-400">{label}</span>
      <span className="text-right text-[12px] font-bold tabular-nums text-stone-800 dark:text-stone-100">{value}</span>
    </div>
  );
}

// ====================================================================
// Dialog pengajuan klaim MEDIS
// ====================================================================

interface MedLine {
  treatedName: string;
  treatment: string;
  treatmentDate: string;
  receiptNo: string;
  physician: string;
  hospital: string;
  billAmount: string;
}

const emptyMedLine = (): MedLine => ({
  treatedName: "", treatment: "", treatmentDate: todayISO(),
  receiptNo: "", physician: "", hospital: "", billAmount: "",
});

function MedicalClaimDialog({
  open, onOpenChange, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [types, setTypes] = useState<EssMedicalClaimType[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [typeId, setTypeId] = useState("");
  const [claimDate, setClaimDate] = useState(todayISO());
  const [forDependent, setForDependent] = useState(false);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<MedLine[]>([emptyMedLine()]);

  useEffect(() => {
    if (!open) return;
    setTypes(null);
    setLoadError(null);
    setFormError(null);
    setLines([emptyMedLine()]);
    setForDependent(false);
    fetchMedicalClaimForm()
      .then((d) => {
        setTypes(d.types);
        setTypeId((prev) => (prev && d.types.some((x) => x.typeId === prev) ? prev : (d.types[0]?.typeId ?? "")));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : null));
  }, [open]);

  const selected = useMemo(() => types?.find((x) => x.typeId === typeId) ?? null, [types, typeId]);
  const totalBill = lines.reduce((s, l) => s + (Number(l.billAmount) || 0), 0);
  const overPlafon = !!selected && selected.limitRule !== "UNLIMITED" && totalBill > selected.remainingForClaim;

  const setLine = (i: number, patch: Partial<MedLine>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const submit = async () => {
    if (busy) return;
    if (!typeId) { setFormError(t("Pilih jenis benefit terlebih dahulu.", "Please choose a benefit type first.")); return; }
    if (!claimDate) { setFormError(t("Tanggal klaim wajib diisi.", "The claim date is required.")); return; }
    const clean = lines.filter((l) => l.treatedName.trim() || l.billAmount);
    if (clean.length === 0 || clean.some((l) => !l.treatedName.trim() || !(Number(l.billAmount) > 0))) {
      setFormError(t("Setiap baris perawatan wajib memuat nama yang dirawat & nilai tagihan > 0.", "Each treatment line needs the treated name and a billed amount > 0."));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await submitMedicalClaim({
        typeId,
        claimDate,
        forDependent: forDependent || undefined,
        note: note.trim() || undefined,
        lines: clean.map((l) => ({
          treatedName: l.treatedName.trim(),
          treatment: l.treatment.trim() || undefined,
          treatmentDate: l.treatmentDate || undefined,
          receiptNo: l.receiptNo.trim() || undefined,
          physician: l.physician.trim() || undefined,
          hospital: l.hospital.trim() || undefined,
          billAmount: Number(l.billAmount) || 0,
        })),
      });
      toast.success(
        t("Klaim {doc} diajukan — menunggu persetujuan {who}", "Claim {doc} submitted — awaiting {who}", { doc: res.docNo, who: res.firstApprover ?? "approver" }),
        { description: res.receiptNote },
      );
      onOpenChange(false);
      onDone();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("Gagal mengajukan klaim medis.", "Failed to submit the medical claim."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(560px,94vw)] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-rose-500" aria-hidden />
            {t("Ajukan Klaim Medis", "Submit Medical Claim")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Reimbursement medis Anda — nilai pengajuan diverifikasi approver, kwitansi asli diserahkan ke HR.",
              "Your medical reimbursement — the approver verifies the requested amount; hand the original receipts to HR.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {types === null && !loadError ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("Memuat jenis benefit & saldo…", "Loading benefit types & balance…")}
            </div>
          ) : loadError && !types ? (
            <FormError message={loadError} />
          ) : (types ?? []).length === 0 ? (
            <EmptyState
              title={t("Belum ada jenis benefit aktif", "No active benefit types")}
              description={t("Master benefit medis belum ditetapkan admin.", "Medical benefit master is not configured yet.")}
              icon={HeartPulse}
            />
          ) : (
            <>
              {/* jenis + tanggal */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("Jenis benefit", "Benefit type")}</Label>
                  <Select value={typeId} onValueChange={(v) => { setTypeId(v); setForDependent(false); }}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(types ?? []).map((ty) => (
                        <SelectItem key={ty.typeId} value={ty.typeId}>
                          {ty.name}
                          {ty.limitRule === "UNLIMITED" ? " · ∞" : ` · ${t("sisa", "left")} ${fmtIDR(ty.remainingForClaim)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("Tanggal klaim", "Claim date")}</Label>
                  <Input type="date" max={todayISO()} value={claimDate} onChange={(e) => setClaimDate(e.target.value)} className="rounded-xl" />
                </div>
              </div>

              {/* kartu saldo jenis terpilih */}
              {selected && (
                <div className="rounded-xl border border-stone-200 bg-stone-50/70 px-3.5 py-2.5 dark:border-stone-800 dark:bg-stone-900/40">
                  <InfoLine label={t("Plafon tahun ini", "This year's limit")} value={selected.limitRule === "UNLIMITED" ? "∞" : fmtIDR(selected.benefitAmount)} />
                  <InfoLine label={t("Sisa untuk klaim", "Available to claim")} value={selected.limitRule === "UNLIMITED" ? "∞" : fmtIDR(selected.remainingForClaim)} />
                  {selected.pendingReserved > 0 && (
                    <InfoLine label={t("Reservasi klaim menunggu", "Pending claim reservations")} value={fmtIDR(selected.pendingReserved)} />
                  )}
                  <InfoLine
                    label={t("Frekuensi", "Frequency")}
                    value={selected.freqUnlimited || selected.freqValue === 0
                      ? t("Tak dibatasi", "Unrestricted")
                      : t("{n}× / tahun (terpakai {u})", "{n}× / year ({u} used)", { n: selected.freqValue, u: selected.claimCountYear })}
                  />
                  {selected.needReceipt && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      {t("Jenis ini mewajibkan kwitansi — serahkan kwitansi asli ke HR untuk verifikasi sebelum klaim disetujui.", "This type requires receipts — hand the originals to HR for verification before approval.")}
                    </p>
                  )}
                </div>
              )}

              {/* klaim dependent */}
              {selected?.dependentEnabled && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-stone-200 px-3.5 py-2.5 dark:border-stone-800">
                  <Checkbox
                    checked={forDependent}
                    onCheckedChange={(v) => setForDependent(v === true)}
                    className="mt-0.5"
                  />
                  <span className="text-[12px] leading-relaxed">
                    <span className="font-bold">{t("Klaim untuk keluarga (dependent)", "Claim for a family member (dependent)")}</span>
                    <span className="block text-stone-500">
                      {selected.depRemaining > 0
                        ? t("Memotong plafon dependent terpisah — sisa {n}", "Deducts from a separate dependent pool — {n} left", { n: fmtIDR(selected.depRemaining) })
                        : t("Memotong plafon bersama karyawan", "Deducts from the shared employee pool")}
                    </span>
                  </span>
                </label>
              )}

              {/* baris perawatan */}
              <div className="space-y-2.5">
                {lines.map((l, i) => (
                  <div key={i} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-stone-400">
                        {t("Perawatan #{n}", "Treatment #{n}", { n: i + 1 })}
                      </p>
                      {lines.length > 1 && (
                        <Button
                          type="button" variant="ghost" size="sm"
                          className="h-7 gap-1 rounded-lg px-2 text-[11px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                          onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 className="h-3 w-3" /> {t("Hapus", "Remove")}
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-[11px] font-semibold text-stone-500">
                          {forDependent ? t("Nama keluarga yang dirawat *", "Treated family member's name *") : t("Nama yang dirawat *", "Treated person's name *")}
                        </Label>
                        <Input
                          value={l.treatedName}
                          onChange={(e) => setLine(i, { treatedName: e.target.value })}
                          placeholder={forDependent ? t("mis. Ananda Putri", "e.g. Ananda Putri") : t("Nama lengkap Anda", "Your full name")}
                          className="rounded-lg"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-stone-500">{t("Diagnosa / perawatan", "Diagnosis / treatment")}</Label>
                        <Input value={l.treatment} onChange={(e) => setLine(i, { treatment: e.target.value })} placeholder={t("mis. Scaling & tambal gigi", "e.g. Scaling & filling")} className="rounded-lg" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-stone-500">{t("Tanggal perawatan", "Treatment date")}</Label>
                        <Input type="date" max={todayISO()} value={l.treatmentDate} onChange={(e) => setLine(i, { treatmentDate: e.target.value })} className="rounded-lg" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-stone-500">{t("No. kwitansi", "Receipt no.")}</Label>
                        <Input value={l.receiptNo} onChange={(e) => setLine(i, { receiptNo: e.target.value })} placeholder="RSK-0001" className="rounded-lg" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-stone-500">{t("Dokter / RS / klinik", "Physician / hospital")}</Label>
                        <Input value={[l.physician, l.hospital].filter(Boolean).join(" — ")}
                          onChange={(e) => {
                            const [p, h] = e.target.value.split(" — ");
                            setLine(i, { physician: (p ?? "").trim(), hospital: (h ?? "").trim() });
                          }}
                          placeholder={t("mis. dr. Andi — Klinik Sehat", "e.g. dr. Andi — Healthy Clinic")}
                          className="rounded-lg"
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-[11px] font-semibold text-stone-500">{t("Nilai tagihan (Rp) *", "Billed amount (Rp) *")}</Label>
                        <Input type="number" min={0} step="any" inputMode="numeric" value={l.billAmount} onChange={(e) => setLine(i, { billAmount: e.target.value })} placeholder="450000" className="rounded-lg tabular-nums" />
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  type="button" variant="outline" size="sm"
                  className="gap-1.5 rounded-xl font-bold"
                  onClick={() => setLines((prev) => [...prev, emptyMedLine()])}
                >
                  <Plus className="h-3.5 w-3.5" /> {t("Tambah perawatan", "Add treatment")}
                </Button>
              </div>

              {overPlafon && (
                <p className="flex items-start gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t(
                    "Total tagihan melebihi sisa plafon — server akan menolak. Kurangi nilai atau hubungi HR untuk penyesuaian plafon.",
                    "The total exceeds the remaining limit — the server will reject it. Reduce the amount or ask HR for a limit adjustment.",
                  )}
                </p>
              )}

              <div className="space-y-1">
                <Label className="text-xs font-bold">{t("Catatan (opsional)", "Note (optional)")}</Label>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Info tambahan utk approver…", "Extra info for the approver…")} className="rounded-xl" />
              </div>

              <FormError message={formError} />
            </>
          )}
        </div>

        <DialogFooter className="items-center gap-3">
          <div className="mr-auto text-[12px] font-bold tabular-nums text-stone-600 dark:text-stone-300">
            {t("Total tagihan:", "Total billed:")} <span className="text-stone-900 dark:text-white">{fmtIDR(totalBill)}</span>
          </div>
          <Button variant="outline" className="rounded-xl font-bold" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("Batal", "Cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !types} className="gap-1.5 rounded-xl bg-rose-600 font-bold text-white hover:bg-rose-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("Ajukan Klaim", "Submit Claim")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ====================================================================
// Dialog pengajuan klaim TRAVEL
// ====================================================================

interface TrLine {
  expenseCode: string;
  expenseDate: string;
  description: string;
  amount: string;
}

function TravelClaimDialog({
  open, onOpenChange, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [requests, setRequests] = useState<EssTravelClaimRequestOption[] | null>(null);
  const [templates, setTemplates] = useState<EssTravelTemplateOption[]>([]);
  const [expenseTypes, setExpenseTypes] = useState<EssTravelExpenseTypeOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [basis, setBasis] = useState<string>(""); // requestId | "" (mandiri)
  const [templateCode, setTemplateCode] = useState("");
  const [remark, setRemark] = useState("");
  const [otherCompanyExp, setOtherCompanyExp] = useState("0");
  const [exchangeLoss, setExchangeLoss] = useState("0");
  const [lines, setLines] = useState<TrLine[]>([{ expenseCode: "", expenseDate: todayISO(), description: "", amount: "" }]);

  useEffect(() => {
    if (!open) return;
    setRequests(null);
    setLoadError(null);
    setFormError(null);
    setLines([{ expenseCode: "", expenseDate: todayISO(), description: "", amount: "" }]);
    fetchTravelClaimForm()
      .then((d) => {
        setRequests(d.requests);
        setTemplates(d.templates);
        setExpenseTypes(d.expenseTypes);
        setBasis(d.requests[0]?.requestId ?? "");
        setTemplateCode((prev) => (prev && d.templates.some((x) => x.code === prev) ? prev : (d.templates[0]?.code ?? "")));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : null));
  }, [open]);

  const selectedReq = useMemo(() => requests?.find((r) => r.requestId === basis) ?? null, [requests, basis]);
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const setLine = (i: number, patch: Partial<TrLine>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const submit = async () => {
    if (busy) return;
    const clean = lines.filter((l) => l.expenseCode || l.amount);
    if (clean.length === 0 || clean.some((l) => !l.expenseCode || !(Number(l.amount) > 0))) {
      setFormError(t("Setiap baris biaya wajib memuat jenis biaya & nominal > 0.", "Each expense line needs a type and an amount > 0."));
      return;
    }
    if (!basis && !templateCode) {
      setFormError(t("Klaim mandiri wajib memilih template perjalanan.", "A standalone claim needs a travel template."));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await submitTravelClaim({
        requestId: basis || undefined,
        templateCode: basis ? undefined : templateCode,
        remark: remark.trim() || undefined,
        expenses: clean.map((l) => ({
          expenseCode: l.expenseCode,
          expenseDate: l.expenseDate || undefined,
          description: l.description.trim() || undefined,
          amount: Number(l.amount) || 0,
        })),
        otherCompanyExp: Math.max(0, Number(otherCompanyExp) || 0),
        exchangeLoss: Math.max(0, Number(exchangeLoss) || 0),
      });
      toast.success(
        t("Klaim {doc} diajukan — {who}", "Claim {doc} submitted — {who}", { doc: res.docNo, who: res.firstApprover ?? "awaiting approval" }),
        { description: res.receiptNote },
      );
      onOpenChange(false);
      onDone();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("Gagal mengajukan klaim travel.", "Failed to submit the travel claim."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(560px,94vw)] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plane className="h-4 w-4 text-sky-600" aria-hidden />
            {t("Ajukan Klaim Travel", "Submit Travel Claim")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Settlement perjalanan dinas — rincian biaya vs uang muka dihitung server (lebih biaya dibayar perusahaan).",
              "Business travel settlement — expenses vs advance are computed by the server.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {requests === null && !loadError ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("Memuat pengajuan dinas & jenis biaya…", "Loading trips & expense types…")}
            </div>
          ) : loadError && !requests ? (
            <FormError message={loadError} />
          ) : (
            <>
              {/* dasar klaim */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Dasar klaim", "Claim basis")}</Label>
                <Select value={basis || MANDIRI} onValueChange={(v) => setBasis(v === MANDIRI ? "" : v)}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={MANDIRI}>{t("Klaim mandiri (tanpa pengajuan dinas)", "Standalone claim (no trip request)")}</SelectItem>
                    {(requests ?? []).map((r) => (
                      <SelectItem key={r.requestId} value={r.requestId}>
                        {r.docNo} · {r.destinations.join(" → ") || r.purpose || t("dinas", "trip")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedReq ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-3.5 py-2.5 dark:border-sky-900/50 dark:bg-sky-950/30">
                  <InfoLine label={t("Perjalanan", "Trip")} value={`${fmtDate(selectedReq.dateFrom)} – ${fmtDate(selectedReq.dateTo)} (${selectedReq.days} ${t("hari", "days")})`} />
                  <InfoLine label={t("Tujuan", "Destination")} value={selectedReq.destinations.join(" → ") || "—"} />
                  {selectedReq.purpose && <InfoLine label={t("Keperluan", "Purpose")} value={selectedReq.purpose} />}
                  <InfoLine label={t("Uang muka", "Advance")} value={fmtIDR(selectedReq.advanceAmount)} />
                  <p className="mt-1 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
                    {t("Tanggal tiap baris biaya harus dalam rentang perjalanan.", "Each expense date must fall within the trip range.")}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("Template perjalanan", "Travel template")}</Label>
                  <Select value={templateCode} onValueChange={setTemplateCode}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {templates.map((tp) => (
                        <SelectItem key={tp.code} value={tp.code}>{tp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* baris biaya */}
              <div className="space-y-2.5">
                {lines.map((l, i) => {
                  const et = expenseTypes.find((x) => x.code === l.expenseCode);
                  return (
                    <div key={i} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-stone-400">
                          {t("Biaya #{n}", "Expense #{n}", { n: i + 1 })}
                        </p>
                        {lines.length > 1 && (
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="h-7 gap-1 rounded-lg px-2 text-[11px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                            onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 className="h-3 w-3" /> {t("Hapus", "Remove")}
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-[11px] font-semibold text-stone-500">{t("Jenis biaya *", "Expense type *")}</Label>
                          <Select value={l.expenseCode} onValueChange={(v) => setLine(i, { expenseCode: v })}>
                            <SelectTrigger className="rounded-lg"><SelectValue placeholder={t("Pilih jenis…", "Pick a type…")} /></SelectTrigger>
                            <SelectContent>
                              {expenseTypes.map((x) => (
                                <SelectItem key={x.code} value={x.code}>
                                  {x.name}
                                  {!x.unlimited && x.limitAmount > 0 ? ` · ≤ ${fmtIDR(x.limitAmount)}` : ""}
                                  {x.needDocs ? ` · ${t("perlu kwitansi", "receipt req.")}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-stone-500">{t("Tanggal", "Date")}</Label>
                          <Input
                            type="date"
                            value={l.expenseDate}
                            min={selectedReq ? selectedReq.dateFrom : undefined}
                            max={selectedReq ? selectedReq.dateTo : undefined}
                            onChange={(e) => setLine(i, { expenseDate: e.target.value })}
                            className="rounded-lg"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-stone-500">{t("Nominal (Rp) *", "Amount (Rp) *")}</Label>
                          <Input type="number" min={0} step="any" inputMode="numeric" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="350000" className="rounded-lg tabular-nums" />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-[11px] font-semibold text-stone-500">{t("Keterangan", "Description")}</Label>
                          <Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder={t("mis. Hotel 2 malam", "e.g. Hotel, 2 nights")} className="rounded-lg" />
                        </div>
                      </div>
                      {et && et.needDocs && (
                        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                          <Info className="h-3 w-3 shrink-0" aria-hidden />
                          {t("Jenis biaya ini mewajibkan kwitansi — serahkan ke Finance saat verifikasi.", "This expense type requires receipts — hand them to Finance during verification.")}
                        </p>
                      )}
                    </div>
                  );
                })}
                <Button
                  type="button" variant="outline" size="sm"
                  className="gap-1.5 rounded-xl font-bold"
                  onClick={() => setLines((prev) => [...prev, { expenseCode: "", expenseDate: todayISO(), description: "", amount: "" }])}
                >
                  <Plus className="h-3.5 w-3.5" /> {t("Tambah biaya", "Add expense")}
                </Button>
              </div>

              {/* penyesuaian lanjutan */}
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-dashed border-stone-300 p-3 dark:border-stone-700 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-stone-500">{t("Dibayar pihak lain (Rp)", "Paid by third party (Rp)")}</Label>
                  <Input type="number" min={0} step="any" value={otherCompanyExp} onChange={(e) => setOtherCompanyExp(e.target.value)} className="rounded-lg tabular-nums" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-stone-500">{t("Rugi kurs (Rp)", "Exchange loss (Rp)")}</Label>
                  <Input type="number" min={0} step="any" value={exchangeLoss} onChange={(e) => setExchangeLoss(e.target.value)} className="rounded-lg tabular-nums" />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold">{t("Catatan (opsional)", "Note (optional)")}</Label>
                <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={t("Info tambahan utk approver…", "Extra info for the approver…")} className="rounded-xl" />
              </div>

              <FormError message={formError} />
            </>
          )}
        </div>

        <DialogFooter className="items-center gap-3">
          <div className="mr-auto text-[12px] font-bold tabular-nums text-stone-600 dark:text-stone-300">
            {t("Total rincian:", "Expense total:")} <span className="text-stone-900 dark:text-white">{fmtIDR(total)}</span>
          </div>
          <Button variant="outline" className="rounded-xl font-bold" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("Batal", "Cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !requests} className="gap-1.5 rounded-xl bg-sky-700 font-bold text-white hover:bg-sky-800">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("Ajukan Klaim", "Submit Claim")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ====================================================================
// Halaman utama
// ====================================================================

export function EssClaims() {
  const { t } = useI18n();
  const api = useApi<EssClaimsData>(`${ESS_BASE}/claims`);
  const [medDialog, setMedDialog] = useState(false);
  const [trDialog, setTrDialog] = useState(false);

  const medical: EssRecord[] = api.data?.medical ?? [];
  const travel: EssRecord[] = api.data?.travel ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Klaim Saya", "My Claims")}
        description={t(
          "Ajukan & pantau klaim medis serta settlement perjalanan dinas Anda.",
          "Submit & track your medical claims and business travel settlements.",
        )}
      />

      <Tabs defaultValue="medical">
        <TabsList className="mb-2">
          <TabsTrigger value="medical" className="gap-1.5">
            <HeartPulse className="h-3.5 w-3.5" /> {t("Klaim Medis", "Medical Claims")}
          </TabsTrigger>
          <TabsTrigger value="travel" className="gap-1.5">
            <Plane className="h-3.5 w-3.5" /> {t("Klaim Travel", "Travel Claims")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="medical">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="px-0 pb-2 pt-2">
              <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-2">
                <p className="text-xs text-stone-500">
                  {t("Reimbursement medis Anda — plafon per jenis diaudit server.", "Your medical reimbursements — per-type limits are audited server-side.")}
                </p>
                <Button onClick={() => setMedDialog(true)} className="shrink-0 gap-1.5 rounded-xl bg-rose-600 font-bold text-white hover:bg-rose-700">
                  <Plus className="h-4 w-4" /> {t("Ajukan Klaim Medis", "Submit Medical Claim")}
                </Button>
              </div>
              {api.loading && !api.data ? (
                <div className="px-5"><LoadingRows rows={4} /></div>
              ) : api.error && !api.data ? (
                <div className="px-5 pb-2"><ErrorRetry message={api.error} onRetry={api.refresh} /></div>
              ) : medical.length === 0 ? (
                <div className="px-5 pb-2">
                  <EmptyState title={t("Belum ada klaim medis", "No medical claims yet")} description={t("Klaim medis yang diajukan atas nama Anda tampil di sini.", "Medical claims submitted under your name appear here.")} icon={HeartPulse} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("No. Dokumen", "Document No.")}</TableHead>
                        <TableHead>{t("Jenis", "Type")}</TableHead>
                        <TableHead className="text-right">{t("Tagihan", "Billed")}</TableHead>
                        <TableHead className="text-right">{t("Disetujui", "Approved")}</TableHead>
                        <TableHead>{t("Status", "Status")}</TableHead>
                        <TableHead className="text-right">{t("Tanggal", "Date")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {medical.map((c, i) => {
                        const docNo = pickStr(c, ["docNo", "no", "documentNo", "doc"]) ?? `#${i + 1}`;
                        const date = pickStr(c, ["submittedAt", "date", "createdAt", "dateLabel", "tanggal", "requestDate"]);
                        return (
                          <TableRow key={docNo + i}>
                            <TableCell className="font-mono text-[12px] font-semibold text-stone-600 dark:text-stone-300">{docNo}</TableCell>
                            <TableCell>
                              <span className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                                {pickStr(c, ["typeName", "type", "benefitType", "jenis"]) ?? "—"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-[12.5px] font-bold tabular-nums text-stone-700 dark:text-stone-200">
                              {fmtIDR(pickNum(c, ["bill", "claimAmount", "amount", "billed", "tagihan", "total"]))}
                            </TableCell>
                            <TableCell className="text-right text-[12.5px] font-bold tabular-nums text-brand-deep dark:text-brand/85">
                              {fmtIDR(pickNum(c, ["approvedAmount", "approved", "disetujui", "settled"]))}
                            </TableCell>
                            <TableCell>
                              <StatusPill status={pickStr(c, ["status"]) ?? "—"} />
                            </TableCell>
                            <TableCell className="text-right text-[12px] text-stone-400">{date ? fmtDate(date) : "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="travel">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="px-0 pb-2 pt-2">
              <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-2">
                <p className="text-xs text-stone-500">
                  {t("Settlement biaya perjalanan dinas vs uang muka.", "Business travel expense settlement vs advance.")}
                </p>
                <Button onClick={() => setTrDialog(true)} className="shrink-0 gap-1.5 rounded-xl bg-sky-700 font-bold text-white hover:bg-sky-800">
                  <Plus className="h-4 w-4" /> {t("Ajukan Klaim Travel", "Submit Travel Claim")}
                </Button>
              </div>
              {api.loading && !api.data ? (
                <div className="px-5"><LoadingRows rows={4} /></div>
              ) : api.error && !api.data ? (
                <div className="px-5 pb-2"><ErrorRetry message={api.error} onRetry={api.refresh} /></div>
              ) : travel.length === 0 ? (
                <div className="px-5 pb-2">
                  <EmptyState title={t("Belum ada klaim travel", "No travel claims yet")} description={t("Klaim & settlement perjalanan dinas Anda tampil di sini.", "Your business travel claims & settlements appear here.")} icon={Plane} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("No. Dokumen", "Document No.")}</TableHead>
                        <TableHead>{t("Tujuan", "Destination")}</TableHead>
                        <TableHead>{t("Status", "Status")}</TableHead>
                        <TableHead className="text-right">{t("Advance", "Advance")}</TableHead>
                        <TableHead className="text-right">{t("Settlement", "Settlement")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {travel.map((c, i) => {
                        const docNo = pickStr(c, ["docNo", "no", "documentNo", "doc"]) ?? `#${i + 1}`;
                        return (
                          <TableRow key={docNo + i}>
                            <TableCell className="font-mono text-[12px] font-semibold text-stone-600 dark:text-stone-300">{docNo}</TableCell>
                            <TableCell>
                              <span className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                                {pickStr(c, ["purpose", "destination", "tujuan", "destinationCity", "city", "destinationLabel"]) ?? "—"}
                              </span>
                            </TableCell>
                            <TableCell>
                              <StatusPill status={pickStr(c, ["status"]) ?? "—"} />
                            </TableCell>
                            <TableCell className="text-right text-[12.5px] font-bold tabular-nums text-stone-700 dark:text-stone-200">
                              {fmtIDR(pickNum(c, ["advance", "advanceAmount", "uangMuka"]))}
                            </TableCell>
                            <TableCell className="text-right text-[12.5px] font-bold tabular-nums text-amber-700 dark:text-amber-400">
                              {fmtIDR(pickNum(c, ["settlement", "settlementAmount", "claimAmount", "settled"]))}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <MedicalClaimDialog open={medDialog} onOpenChange={setMedDialog} onDone={api.refresh} />
      <TravelClaimDialog open={trDialog} onOpenChange={setTrDialog} onDone={api.refresh} />
    </div>
  );
}
