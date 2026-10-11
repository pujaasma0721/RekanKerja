"use client";
// RekanKerja Recruitment F7 — view "Pengaturan" (recruitment:settings):
//   · Webhook Outbound — CRUD endpoint (secret terenkripsi, hanya hint 6 kar),
//     kirim tes, tabel delivery terbaru (queue DB-backed + retry backoff).
//   · Otomasi Rekrutmen — toggle 5 kunci auto.* (auto-reply, reminder
//     seleksi/offer, eskalasi SLA, email undangan kandidat).
//   · Preferensi Notifikasi Saya — in-app / email / ringkasan harian
//     (NotificationPref — pref-set selalu untuk aktor sendiri).
//   · E-sign Kandidat — permintaan tanda tangan kandidat eksternal (tautan
//     portal + OTP email, hash PDF tamper-evident), kirim ulang OTP, batalkan.
// Kontrak API: src/rekankerja/recruitment/api/recruitment-settings.ts (F7).
// Tipe mirror serializer — komponen client TIDAK meng-import file service.
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, fmtDate, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { OFFERS_API } from "./offer-dialogs";
import {
  AlertTriangle, Check, Copy, FileSignature, Info, KeyRound, Loader2, Pencil, PenLine,
  Plus, RefreshCw, Send, Trash2, Webhook,
} from "lucide-react";

export const SETTINGS_API = "/api/rekankerja/recruitment/settings";
/** Base portal kandidat (dev sandbox) — dipakai tombol salin tautan dev-only. */
export const ESIGN_PORTAL_DEV = "http://127.0.0.1:3010";

// ============ tipe (mirror JSON API F7) ============

export interface WebhookEndpointUI {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  note: string | null;
  hasSecret: boolean;
  secretHint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryUI {
  id: string;
  endpointId: string;
  endpointUrl: string;
  event: string;
  status: string;
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface EsignRequestUI {
  id: string;
  offerNo: string | null;
  signerName: string;
  status: string;
  purpose: string;
  signedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface RecruitmentSettingsResp {
  webhooks: WebhookEndpointUI[];
  events: { key: string; label: string }[];
  deliveries: WebhookDeliveryUI[];
  settings: Record<string, string>;
  settingKeys: string[];
  myPref: { inApp: boolean; email: boolean; digest: boolean };
  esignRequests: EsignRequestUI[];
}

// ============ kunci otomasi (5 — retention.* sengaja TIDAK tampil: F9) ============

const AUTO_KEYS: { key: string; label: string; labelEn: string; desc: string; descEn: string }[] = [
  {
    key: "auto.reply.public-application",
    label: "Email konfirmasi otomatis saat lamaran publik diterima",
    labelEn: "Automatic confirmation email when a public application arrives",
    desc: "Setiap lamaran publik baru dari portal mendapat balasan otomatis (nama + posisi + perusahaan).",
    descEn: "Every new public portal application gets an automatic reply (name + position + company).",
  },
  {
    key: "auto.reminder.selection",
    label: "Pengingat jadwal seleksi H-3 & terlambat",
    labelEn: "Selection schedule reminders 3 days before & overdue",
    desc: "Kandidat diingatkan H-3 sebelum jadwal seleksi, plus notifikasi ulang saat terlewat.",
    descEn: "Candidates are reminded 3 days before selection schedules, plus repeated notices when overdue.",
  },
  {
    key: "auto.reminder.offer",
    label: "Pengingat offer mendekati kedaluwarsa",
    labelEn: "Offer expiry reminders",
    desc: "Offer terkirim yang mendekati tanggal kedaluwarsa dipinggatkan ke HR (expiry tetap berjalan).",
    descEn: "Sent offers approaching their expiry date are flagged to HR (expiry itself still runs).",
  },
  {
    key: "auto.escalate.sla",
    label: "Eskalasi tahap terlambat 3/7/14 hari",
    labelEn: "Escalate stages overdue 3/7/14 days",
    desc: "Tahap seleksi melewati SLA dieskalasi ke officer & admin rekrutmen sesuai tingkat keterlambatan.",
    descEn: "Selection stages past SLA are escalated to the officer & recruitment admins by lateness level.",
  },
  {
    key: "auto.ack.email.candidate",
    label: "Email kandidat saat tahap dijadwalkan",
    labelEn: "Email candidates when a stage is scheduled",
    desc: "Penjadwalan tahap baru otomatis mengirim email undangan + surat PDF ke kandidat.",
    descEn: "Scheduling a new stage automatically sends an invitation email + PDF letter to the candidate.",
  },
];

// ============ pill kecil ============

function DeliveryStatusPill({ status }: { status: string }) {
  const cls = status === "Success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
    : status === "Pending"
      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
      : status === "Failed"
        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
        : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400";
  return <span className={cn("inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold", cls)}>{status}</span>;
}

function EsignStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, { id: string; en: string; cls: string }> = {
    Pending: { id: "Menunggu", en: "Pending", cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400" },
    Signed: { id: "Ditandatangani", en: "Signed", cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400" },
    Cancelled: { id: "Dibatalkan", en: "Cancelled", cls: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400" },
    Expired: { id: "Kedaluwarsa", en: "Expired", cls: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400" },
  };
  const m = map[status] ?? { id: status, en: status, cls: "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-400" };
  return <span className={cn("inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold", m.cls)}>{t(m.id, m.en)}</span>;
}

function PurposePill({ purpose }: { purpose: string }) {
  const { t } = useI18n();
  const isOffer = purpose === "offer";
  return (
    <span className={cn(
      "inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold",
      isOffer
        ? "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-400"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
    )}>
      {isOffer ? t("Penawaran", "Offer") : t("Pengangkatan", "Appointment")}
    </span>
  );
}

// ============ dialog: form endpoint webhook ============

function WebhookFormDialog({
  target, events, onClose, onDone,
}: {
  target: WebhookEndpointUI | "new";
  events: { key: string; label: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const isNew = target === "new";
  const row = isNew ? null : target;
  const [url, setUrl] = useState(row?.url ?? "");
  const [selected, setSelected] = useState<string[]>(row?.events ?? []);
  const [active, setActive] = useState(row?.active ?? true);
  const [note, setNote] = useState(row?.note ?? "");
  const [rotateSecret, setRotateSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleEvent = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const save = async () => {
    setBusy(true);
    try {
      await apiSend(SETTINGS_API, "POST", {
        action: "webhook-save",
        id: row?.id ?? undefined,
        url, events: selected, active, note: note || undefined, rotateSecret,
      });
      toast.success(t(
        isNew ? "Endpoint webhook ditambahkan — secret dibuat otomatis (lihat hint)." : "Endpoint webhook disimpan.",
        isNew ? "Webhook endpoint added — secret generated automatically (see hint)." : "Webhook endpoint saved.",
      ));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan endpoint", "Failed to save the endpoint"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4" aria-hidden />
            {isNew ? t("Tambah Endpoint Webhook", "Add Webhook Endpoint") : t("Edit Endpoint Webhook", "Edit Webhook Endpoint")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wh-url">{t("URL Endpoint (http/https)", "Endpoint URL (http/https)")}</Label>
            <Input id="wh-url" className="font-mono text-[13px]" placeholder="https://contoh.co.id/hooks/rekankerja"
              value={url} onChange={(e) => setUrl(e.target.value)} />
            <p className="text-[11px] text-slate-400">{t("RekanKerja melakukan POST JSON ke URL ini saat event terjadi.", "RekanKerja POSTs JSON to this URL when events occur.")}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t("Event yang dilanggan", "Subscribed events")}</Label>
            <div className="space-y-1.5 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              {events.map((ev) => (
                <label key={ev.key} className="flex cursor-pointer items-start gap-2">
                  <Checkbox checked={selected.includes(ev.key)} onCheckedChange={() => toggleEvent(ev.key)}
                    className="mt-0.5" aria-label={ev.key} />
                  <span className="min-w-0">
                    <span className="font-mono text-xs font-semibold">{ev.key}</span>
                    {ev.key === "*" && <span className="ml-1.5 text-[11px] text-amber-600 dark:text-amber-400">{t("(semua event)", "(all events)")}</span>}
                    <span className="block text-[11px] leading-tight text-slate-500 dark:text-slate-400">{ev.label}</span>
                  </span>
                </label>
              ))}
              {selected.length === 0 && (
                <p className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> {t("Pilih minimal satu event", "Pick at least one event")}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
            <div>
              <Label className="text-[13px]">{t("Aktif", "Active")}</Label>
              <p className="text-[11px] text-slate-400">{t("Endpoint nonaktif tidak menerima event.", "Inactive endpoints receive no events.")}</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label={t("Aktif", "Active")} />
          </div>
          {!isNew && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
              <div>
                <Label className="text-[13px]">{t("Rotasi secret", "Rotate secret")}</Label>
                <p className="text-[11px] text-slate-400">{t("Ganti secret baru — pemakai lama harus memverifikasi ulang.", "Generate a new secret — receivers must re-verify.")}</p>
              </div>
              <Switch checked={rotateSecret} onCheckedChange={setRotateSecret} aria-label={t("Rotasi secret", "Rotate secret")} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="wh-note">{t("Catatan (opsional)", "Note (optional)")}</Label>
            <Textarea id="wh-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={save} disabled={busy || selected.length === 0 || url.trim() === ""}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t("Simpan", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ dialog: minta tanda tangan (dipakai juga view Offer) ============

export interface EsignableOffer {
  id: string;
  offerNo: string;
  candidateName: string;
  positionTitle?: string | null;
}

/**
 * Dialog minta tanda tangan kandidat eksternal (POST esign-request).
 * `preselect` = offer asal (dipakai tombol aksi baris di view Offer);
 * `offers` = daftar pilihan offer status Sent|Viewed kandidat eksternal.
 */
export function EsignRequestDialog({
  offers, preselect, offersLoading, onClose, onDone,
}: {
  offers: EsignableOffer[];
  preselect?: EsignableOffer | null;
  offersLoading?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [offerId, setOfferId] = useState(preselect?.id ?? offers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ token: string; expiresAt: string; purpose: string; offerNo: string; candidateName: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (preselect) setOfferId(preselect.id); }, [preselect]);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ id: string; token: string; status: string; purpose: string; expiresAt: string }>(
        SETTINGS_API, "POST", { action: "esign-request", offerId },
      );
      const off = offers.find((o) => o.id === offerId);
      setResult({
        token: res.token, expiresAt: res.expiresAt, purpose: res.purpose,
        offerNo: off?.offerNo ?? "-", candidateName: off?.candidateName ?? "-",
      });
      toast.success(t(
        `Permintaan e-sign ${off?.offerNo ?? ""} dibuat — tautan + kode OTP dikirim ke email kandidat ${off?.candidateName ?? ""}.`,
        `E-sign request ${off?.offerNo ?? ""} created — link + OTP code sent to candidate ${off?.candidateName ?? ""}'s email.`,
      ), { duration: 8000 });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membuat permintaan e-sign", "Failed to create the e-sign request"));
    } finally {
      setBusy(false);
    }
  };

  const fullLink = result ? `${ESIGN_PORTAL_DEV}/sign/${result.token}` : "";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(fullLink);
      setCopied(true);
      toast.success(t("Tautan dev sandbox tersalin", "Dev sandbox link copied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("Gagal menyalin — salin manual dari kotak tautan", "Copy failed — copy manually from the link box"));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-4 w-4" aria-hidden />
            {t("Minta Tanda Tangan Kandidat", "Request Candidate Signature")}
          </DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <div className="min-w-0 text-[13px]">
                <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                  {t("Permintaan dibuat — status Pending", "Request created — status Pending")}
                </p>
                <p className="mt-0.5 leading-snug text-slate-600 dark:text-slate-300">
                  {t(
                    `Tautan tanda tangan aktif dikirim via email kandidat ${result.candidateName} (portal /sign/<token>). Kandidat memasukkan kode OTP + mengetik nama lengkap, lalu surat ditandatangani dengan hash PDF.`,
                    `The active signing link was sent to candidate ${result.candidateName}'s email (portal /sign/<token>). The candidate enters the OTP code + types their full name, then the letter is signed with a PDF hash.`,
                  )}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {t("Berlaku s.d.", "Valid until")} {fmtDate(result.expiresAt)} · {t("tujuan", "purpose")}: <PurposePill purpose={result.purpose} />
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <KeyRound className="h-3 w-3" aria-hidden /> {t("token (dev-only)", "token (dev-only)")}
              </p>
              <p className="break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">{result.token.slice(0, 16)}…</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-800" title={fullLink}>{fullLink}</code>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={copyLink}>
                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {copied ? t("Tersalin", "Copied") : t("Salin tautan dev sandbox", "Copy dev sandbox link")}
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                {t("Tautan dev sandbox — di produksi kandidat hanya menerima tautan via email.", "Dev sandbox link — in production the candidate only receives the link via email.")}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("Offer (Terkirim / Dilihat — kandidat eksternal)", "Offer (Sent / Viewed — external candidate)")}</Label>
              {offersLoading ? (
                <div className="py-2"><Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden /></div>
              ) : offers.length === 0 ? (
                <EmptyState
                  icon={FileSignature}
                  title={t("Tidak ada offer yang bisa ditandatangani", "No signable offers")}
                  description={t(
                    "E-sign diajukan untuk offer berstatus Terkirim/Dilihat milik kandidat eksternal (punya email pelamar).",
                    "E-sign is requested for Sent/Viewed offers of external candidates (with an applicant email).",
                  )}
                />
              ) : (
                <Select value={offerId} onValueChange={setOfferId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {offers.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.offerNo} — {o.candidateName}{o.positionTitle ? ` · ${o.positionTitle}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <p className="flex items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 text-[11px] leading-snug text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t(
                "Kandidat menerima email berisi tautan portal /sign/<token> dan kode OTP (berlaku 5 menit per pengiriman). Setelah menandatangani, status offer di sini otomatis diberi tanda hijau.",
                "The candidate receives an email with the portal /sign/<token> link and an OTP code (valid 5 minutes per send). After signing, the offer row here automatically gets a green badge.",
              )}
            </p>
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={onClose}>{t("Tutup", "Close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
              <Button onClick={submit} disabled={busy || offers.length === 0}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                <Send className="h-4 w-4" aria-hidden />
                {t("Kirim Permintaan", "Send Request")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ halaman utama ============

export function RecruitmentSettingsPage() {
  const { t } = useI18n();
  const perms = useMenuPerms();

  const api = useApi<RecruitmentSettingsResp>(SETTINGS_API);
  const refresh = () => api.refresh();

  const webhooks = api.data?.webhooks ?? [];
  const deliveries = api.data?.deliveries ?? [];
  const esignReqs = api.data?.esignRequests ?? [];
  const events = api.data?.events ?? [];

  // ---------- gating (mirror guard server: op webhook/esign + aksi update) ----------
  const canWebhook = perms.canOp("recruitment", "settings", "webhook");
  const canEsign = perms.canOp("recruitment", "settings", "esign");
  const canUpdate = perms.can("recruitment", "settings", "update");

  // offer yang bisa dimintai tanda tangan (Sent|Viewed + kandidat eksternal)
  // — dipakai dialog “Minta Tanda Tangan” (pola lazy fetch F6b).
  const offersApi = useApi<{ rows: { id: string; offerNo: string; status: string; candidateName: string; candidateSource: string; positionTitle: string | null }[] }>(
    canEsign ? `${OFFERS_API}?list=1` : null, [canEsign],
  );
  const esignableOffers: EsignableOffer[] = (offersApi.data?.rows ?? [])
    .filter((r) => (r.status === "Sent" || r.status === "Viewed") && r.candidateSource !== "Internal")
    .map((r) => ({ id: r.id, offerNo: r.offerNo, candidateName: r.candidateName, positionTitle: r.positionTitle }));

  const defaultTab = canWebhook ? "webhook" : canUpdate ? "automation" : "prefs";

  // ---------- dialog state ----------
  const [formTarget, setFormTarget] = useState<WebhookEndpointUI | "new" | null>(null);
  const [esignOpen, setEsignOpen] = useState(false);
  const [busyTest, setBusyTest] = useState<string | null>(null);
  const [busyEsign, setBusyEsign] = useState<string | null>(null);

  // ---------- otomasi: state lokal di atas snapshot server ----------
  const settingsMap = api.data?.settings ?? null;
  const [autoOverride, setAutoOverride] = useState<Record<string, boolean>>({});
  const autoOn = (key: string): boolean | null => {
    if (key in autoOverride) return autoOverride[key];
    if (!settingsMap) return null;
    return settingsMap[key] !== "false"; // default ON
  };
  const toggleAuto = async (key: string, next: boolean) => {
    setAutoOverride((p) => ({ ...p, [key]: next }));
    try {
      await apiSend(SETTINGS_API, "POST", { action: "automation-set", key, value: next ? "true" : "false" });
      const meta = AUTO_KEYS.find((k) => k.key === key);
      toast.success(t(
        `Otomasi ${next ? "diaktifkan" : "dimatikan"} — ${meta?.label ?? key}.`,
        `Automation ${next ? "enabled" : "disabled"} — ${meta?.labelEn ?? key}.`,
      ));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan pengaturan", "Failed to save the setting"));
    } finally {
      setAutoOverride((p) => { const q = { ...p }; delete q[key]; return q; });
    }
  };

  // ---------- preferensi notifikasi saya ----------
  const myPref = api.data?.myPref ?? null;
  const [prefOverride, setPrefOverride] = useState<Partial<{ inApp: boolean; email: boolean; digest: boolean }>>({});
  const prefOf = (k: "inApp" | "email" | "digest"): boolean | null =>
    (k in prefOverride ? prefOverride[k] : myPref ? myPref[k] : null) ?? null;
  const setPref = async (k: "inApp" | "email" | "digest", next: boolean) => {
    setPrefOverride((p) => ({ ...p, [k]: next }));
    try {
      await apiSend(SETTINGS_API, "POST", { action: "pref-set", [k]: next });
      toast.success(next
        ? t("Preferensi diaktifkan", "Preference enabled")
        : t("Preferensi dimatikan", "Preference disabled"));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan preferensi", "Failed to save the preference"));
    } finally {
      setPrefOverride((p) => { const q = { ...p }; delete q[k]; return q; });
    }
  };

  // ---------- statistik delivery per endpoint (dari 30 terbaru) ----------
  const delStats = useMemo(() => {
    const m: Record<string, { ok: number; fail: number; pend: number; dead: number }> = {};
    for (const d of deliveries) {
      const s = m[d.endpointId] ?? (m[d.endpointId] = { ok: 0, fail: 0, pend: 0, dead: 0 });
      if (d.status === "Success") s.ok++;
      else if (d.status === "Pending") s.pend++;
      else if (d.status === "Failed") s.fail++;
      else s.dead++;
    }
    return m;
  }, [deliveries]);

  // ---------- aksi webhook ----------
  const toggleActive = async (row: WebhookEndpointUI, next: boolean) => {
    try {
      await apiSend(SETTINGS_API, "POST", {
        action: "webhook-save", id: row.id, url: row.url, events: row.events, active: next, note: row.note ?? undefined,
      });
      toast.success(next
        ? t(`Endpoint diaktifkan — ${row.url}`, `Endpoint enabled — ${row.url}`)
        : t(`Endpoint dinonaktifkan — ${row.url}`, `Endpoint disabled — ${row.url}`));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengubah endpoint", "Failed to update the endpoint"));
    }
  };

  const doTest = async (row: WebhookEndpointUI) => {
    setBusyTest(row.id);
    try {
      const res = await apiSend<{ deliveryId: string; summary: { sent: number; failed: number; dead: number } }>(
        SETTINGS_API, "POST", { action: "webhook-test", id: row.id },
      );
      if (res.summary.sent > 0) {
        toast.success(t(
          `Tes terkirim — antrean diproses: ${res.summary.sent} sukses${res.summary.failed ? `, ${res.summary.failed} gagal` : ""}.`,
          `Test delivered — queue processed: ${res.summary.sent} sent${res.summary.failed ? `, ${res.summary.failed} failed` : ""}.`,
        ), { duration: 8000 });
      } else {
        toast.error(t(
          "Tes gagal terkirim — cek tabel delivery (percobaan berikutnya otomatis sesuai backoff).",
          "Test delivery failed — check the deliveries table (retried automatically per backoff).",
        ), { duration: 8000 });
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengirim tes", "Failed to send the test"));
    } finally {
      setBusyTest(null);
    }
  };

  const doDelete = async (row: WebhookEndpointUI) => {
    if (!window.confirm(t(
      `Hapus endpoint webhook ${row.url}? Riwayat delivery ikut terhapus.`,
      `Delete webhook endpoint ${row.url}? Delivery history is deleted as well.`,
    ))) return;
    try {
      await apiSend(SETTINGS_API, "POST", { action: "webhook-delete", id: row.id });
      toast.success(t(`Endpoint webhook dihapus — ${row.url}`, `Webhook endpoint deleted — ${row.url}`));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus endpoint", "Failed to delete the endpoint"));
    }
  };

  // ---------- aksi e-sign ----------
  const doResend = async (row: EsignRequestUI) => {
    setBusyEsign(row.id);
    try {
      await apiSend(SETTINGS_API, "POST", { action: "esign-resend", id: row.id });
      toast.success(t(
        `OTP baru dikirim ke email ${row.signerName} (berlaku 5 menit).`,
        `A new OTP was sent to ${row.signerName}'s email (valid 5 minutes).`,
      ), { duration: 8000 });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengirim ulang OTP", "Failed to resend the OTP"));
    } finally {
      setBusyEsign(null);
    }
  };

  const doCancel = async (row: EsignRequestUI) => {
    if (!window.confirm(t(
      `Batalkan permintaan e-sign ${row.offerNo ?? ""} (${row.signerName})? Tautan lama jadi tidak berlaku.`,
      `Cancel the e-sign request ${row.offerNo ?? ""} (${row.signerName})? The old link becomes invalid.`,
    ))) return;
    setBusyEsign(row.id);
    try {
      await apiSend(SETTINGS_API, "POST", { action: "esign-cancel", id: row.id });
      toast.success(t("Permintaan e-sign dibatalkan", "E-sign request cancelled"));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membatalkan permintaan", "Failed to cancel the request"));
    } finally {
      setBusyEsign(null);
    }
  };

  // ---------- render ============

  const errBox = api.error ? (
    <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="pt-6">
        <EmptyState title={t("Gagal memuat pengaturan", "Failed to load settings")} description={api.error} />
      </CardContent>
    </Card>
  ) : null;

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · F7")}
        title={t("Pengaturan", "Settings")}
        description={t(
          "Otomasi rekrutmen, integrasi webhook outbound (signature HMAC terverifikasi), preferensi notifikasi pribadi, dan e-sign kandidat eksternal dengan OTP + hash PDF.",
          "Recruitment automation, outbound webhook integration (verified HMAC signature), personal notification preferences, and external candidate e-sign with OTP + PDF hash.",
        )}
      />

      {api.loading && !api.data ? (
        <LoadingRows rows={5} />
      ) : errBox ? (
        errBox
      ) : (
        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
            {canWebhook && <TabsTrigger value="webhook">{t("Webhook Outbound", "Outbound Webhooks")}</TabsTrigger>}
            {canUpdate && <TabsTrigger value="automation">{t("Otomasi Rekrutmen", "Recruitment Automation")}</TabsTrigger>}
            <TabsTrigger value="prefs">{t("Preferensi Notifikasi Saya", "My Notification Preferences")}</TabsTrigger>
            {canEsign && <TabsTrigger value="esign">{t("E-sign Kandidat", "Candidate E-sign")}</TabsTrigger>}
          </TabsList>

          {/* ==================== TAB: WEBHOOK ==================== */}
          {canWebhook && (
            <TabsContent value="webhook" className="mt-4 space-y-4">
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Webhook className="h-4 w-4 ov-text-accent" aria-hidden />
                    {t("Endpoint Webhook", "Webhook Endpoints")}
                    <Badge variant="secondary" className="font-mono">{webhooks.length}</Badge>
                    <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={() => setFormTarget("new")}>
                      <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah Endpoint", "Add Endpoint")}
                    </Button>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {t(
                      "Endpoint aktif menerima POST JSON saat event rekrutmen terjadi. Secret disimpan terenkripsi — hanya hint 6 karakter yang ditampilkan.",
                      "Active endpoints receive JSON POSTs when recruitment events occur. Secrets are stored encrypted — only a 6-character hint is shown.",
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {webhooks.length === 0 ? (
                    <EmptyState
                      icon={Webhook}
                      title={t("Belum ada endpoint webhook", "No webhook endpoints yet")}
                      description={t(
                        "Tambahkan endpoint untuk menerima event PR disetujui, lamaran masuk, offer diterima, dan kandidat diangkat.",
                        "Add an endpoint to receive PR approved, application received, offer accepted, and candidate hired events.",
                      )}
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[860px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("URL Endpoint", "Endpoint URL")}</TableHead>
                            <TableHead>{t("Event", "Events")}</TableHead>
                            <TableHead>{t("Aktif", "Active")}</TableHead>
                            <TableHead className="hidden md:table-cell">Secret</TableHead>
                            <TableHead className="hidden lg:table-cell">{t("Delivery (30 terakhir)", "Deliveries (last 30)")}</TableHead>
                            <TableHead className="w-40 text-right">{t("Aksi", "Actions")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {webhooks.map((w) => {
                            const st = delStats[w.id] ?? { ok: 0, fail: 0, pend: 0, dead: 0 };
                            return (
                              <TableRow key={w.id}>
                                <TableCell>
                                  <div className="max-w-[280px]">
                                    <span className="block truncate font-mono text-xs font-semibold" title={w.url}>{w.url}</span>
                                    {w.note && <span className="block max-w-[260px] truncate text-[10px] italic text-slate-400" title={w.note}>“{w.note}”</span>}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex max-w-[220px] flex-wrap gap-1">
                                    {w.events.map((ev) => (
                                      <span key={ev} className={cn(
                                        "rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                                        ev === "*"
                                          ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                                          : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300",
                                      )}>{ev}</span>
                                    ))}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Switch checked={w.active} onCheckedChange={(v) => toggleActive(w, v)} aria-label={t("aktif", "active")} />
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400" title={t("hint secret — 6 karakter pertama", "secret hint — first 6 characters")}>
                                    {w.secretHint ? `${w.secretHint}…` : "—"}
                                  </span>
                                </TableCell>
                                <TableCell className="hidden tabular-nums lg:table-cell">
                                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                                    {st.ok > 0 && <span className="text-emerald-600 dark:text-emerald-400">✓ {st.ok}</span>}
                                    {st.pend > 0 && <span className="text-amber-600 dark:text-amber-400">… {st.pend}</span>}
                                    {st.fail > 0 && <span className="text-rose-600 dark:text-rose-400">✗ {st.fail}</span>}
                                    {st.dead > 0 && <span className="text-zinc-500 dark:text-zinc-400">† {st.dead}</span>}
                                    {st.ok + st.pend + st.fail + st.dead === 0 && <span className="text-slate-300 dark:text-slate-600">—</span>}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={() => setFormTarget(w)}>
                                      <Pencil className="h-3.5 w-3.5" aria-hidden /> {t("Edit", "Edit")}
                                    </Button>
                                    <Button variant="outline" size="sm" className="h-8 gap-1 px-2" disabled={busyTest === w.id} onClick={() => doTest(w)}>
                                      {busyTest === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
                                      {t("Kirim Tes", "Send Test")}
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => doDelete(w)}>
                                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("Hapus", "Delete")}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* info verifikasi signature */}
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <KeyRound className="h-3 w-3" aria-hidden /> {t("Verifikasi signature di sisi penerima", "Verify the signature on the receiver side")}
                    </p>
                    <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                      {"X-RekanKerja-Signature: sha256=HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)"}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                      {t(
                        "id = header X-RekanKerja-Delivery, timestamp = header X-RekanKerja-Timestamp (ISO), body = byte mentah permintaan. Tolak bila selisih timestamp > 5 menit.",
                        "id = X-RekanKerja-Delivery header, timestamp = X-RekanKerja-Timestamp header (ISO), body = the raw request bytes. Reject if the timestamp skew > 5 minutes.",
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* tabel delivery terbaru */}
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Send className="h-4 w-4 ov-text-accent" aria-hidden />
                    {t("Delivery Terbaru", "Recent Deliveries")}
                    <Badge variant="secondary" className="font-mono">{deliveries.length}</Badge>
                    <Button size="sm" variant="ghost" className="ml-auto gap-1.5 px-2" onClick={refresh} aria-label={t("Muat ulang", "Reload")}>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t("Muat ulang", "Reload")}
                    </Button>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {t(
                      "Antrean terkirim job scheduler. Gagal diulur otomatis (5 mnt → 30 mnt → 2 j → 8 j → 24 j); ≥6 percobaan menjadi Dead.",
                      "Queue drained by the scheduler job. Failures back off automatically (5 m → 30 m → 2 h → 8 h → 24 h); ≥6 attempts become Dead.",
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {deliveries.length === 0 ? (
                    <EmptyState
                      icon={Send}
                      title={t("Belum ada delivery", "No deliveries yet")}
                      description={t("Kirim tes dari tabel endpoint di atas untuk melihat delivery pertama.", "Send a test from the endpoints table above to see the first delivery.")}
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[900px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("Waktu", "Time")}</TableHead>
                            <TableHead>{t("Event", "Event")}</TableHead>
                            <TableHead className="hidden md:table-cell">{t("Endpoint", "Endpoint")}</TableHead>
                            <TableHead>{t("Status", "Status")}</TableHead>
                            <TableHead className="tabular-nums">#</TableHead>
                            <TableHead className="hidden lg:table-cell">{t("Coba Lagi", "Next Retry")}</TableHead>
                            <TableHead className="hidden lg:table-cell">{t("Error Terakhir", "Last Error")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deliveries.map((d) => (
                            <TableRow key={d.id}>
                              <TableCell className="whitespace-nowrap text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{fmtDateTime(d.createdAt)}</TableCell>
                              <TableCell>
                                <span className="rounded-full border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold dark:border-slate-700" title={d.event}>{d.event}</span>
                              </TableCell>
                              <TableCell className="hidden max-w-[220px] md:table-cell">
                                <span className="block truncate font-mono text-[11px]" title={d.endpointUrl}>{d.endpointUrl}</span>
                              </TableCell>
                              <TableCell><DeliveryStatusPill status={d.status} /></TableCell>
                              <TableCell className="tabular-nums">{d.attempts}</TableCell>
                              <TableCell className="hidden whitespace-nowrap text-[11px] tabular-nums text-slate-500 dark:text-slate-400 lg:table-cell">
                                {d.status === "Success" ? "—" : d.nextRetryAt ? fmtDateTime(d.nextRetryAt) : "—"}
                              </TableCell>
                              <TableCell className="hidden max-w-[200px] lg:table-cell">
                                {d.lastError
                                  ? <span className="block truncate text-[11px] text-rose-600 dark:text-rose-400" title={d.lastError}>{d.lastError}</span>
                                  : <span className="text-slate-300 dark:text-slate-600">—</span>}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ==================== TAB: OTOMASI ==================== */}
          {canUpdate && (
            <TabsContent value="automation" className="mt-4">
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <RefreshCw className="h-4 w-4 ov-text-accent" aria-hidden />
                    {t("Otomasi Rekrutmen", "Recruitment Automation")}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {t(
                      "Perubahan langsung berefek pada job scheduler (email, pengingat, eskalasi). Default semua aktif.",
                      "Changes take effect immediately on the scheduler jobs (emails, reminders, escalations). All default to on.",
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {AUTO_KEYS.map((k) => {
                    const on = autoOn(k.key);
                    return (
                      <div key={k.key} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold leading-snug">{t(k.label, k.labelEn)}</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{t(k.desc, k.descEn)}</p>
                          <p className="mt-1 font-mono text-[10px] text-slate-400">{k.key}</p>
                        </div>
                        <Switch
                          checked={on ?? false}
                          disabled={on == null}
                          onCheckedChange={(v) => toggleAuto(k.key, v)}
                          aria-label={t(k.label, k.labelEn)}
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ==================== TAB: PREFERENSI ==================== */}
          <TabsContent value="prefs" className="mt-4">
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PenLine className="h-4 w-4 ov-text-accent" aria-hidden />
                  {t("Preferensi Notifikasi Saya", "My Notification Preferences")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t(
                    "Berlaku untuk akun Anda sendiri — memengaruhi kanal notifikasi rekrutmen yang ditujukan kepada Anda.",
                    "Applies to your own account — controls which recruitment notification channels reach you.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-snug">{t("Notifikasi dalam aplikasi", "In-app notifications")}</p>
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium leading-snug text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      {t("disarankan aktif — notifikasi penting approval", "recommended to keep on — important approval notices")}
                    </p>
                  </div>
                  <Switch checked={prefOf("inApp") ?? true} disabled aria-label={t("Notifikasi dalam aplikasi (disarankan aktif)", "In-app notifications (recommended on)")} />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-snug">{t("Notifikasi email", "Email notifications")}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                      {t("Peristiwa rekrutmen penting dikirim ke email akun/karyawan Anda.", "Important recruitment events are sent to your account/employee email.")}
                    </p>
                  </div>
                  <Switch
                    checked={prefOf("email") ?? true}
                    disabled={prefOf("email") == null}
                    onCheckedChange={(v) => setPref("email", v)}
                    aria-label={t("Notifikasi email", "Email notifications")}
                  />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-snug">{t("Ringkasan harian (digest)", "Daily digest")}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                      {t(
                        "Satu email ringkasan per hari berisi notifikasi belum dibaca 24 jam terakhir (maks 8 baris).",
                        "One summary email per day with your last 24 hours of unread notifications (max 8 lines).",
                      )}
                    </p>
                  </div>
                  <Switch
                    checked={prefOf("digest") ?? false}
                    disabled={prefOf("digest") == null}
                    onCheckedChange={(v) => setPref("digest", v)}
                    aria-label={t("Ringkasan harian (digest)", "Daily digest")}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ==================== TAB: E-SIGN ==================== */}
          {canEsign && (
            <TabsContent value="esign" className="mt-4">
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <FileSignature className="h-4 w-4 ov-text-accent" aria-hidden />
                    {t("Permintaan Tanda Tangan Kandidat", "Candidate Signature Requests")}
                    <Badge variant="secondary" className="font-mono">{esignReqs.length}</Badge>
                    <Button size="sm" className="ov-fill ml-auto gap-1.5" onClick={() => setEsignOpen(true)}>
                      <PenLine className="h-3.5 w-3.5" aria-hidden /> {t("Minta Tanda Tangan", "Request Signature")}
                    </Button>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {t(
                      "Kandidat eksternal menandatangani surat via portal (/sign/<token>) dengan kode OTP email + nama terketik — hash PDF tercatat tamper-evident.",
                      "External candidates sign letters via the portal (/sign/<token>) with an emailed OTP code + typed name — the PDF hash is recorded tamper-evident.",
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {esignReqs.length === 0 ? (
                    <EmptyState
                      icon={FileSignature}
                      title={t("Belum ada permintaan e-sign", "No e-sign requests yet")}
                      description={t(
                        "Ajukan dari tombol “Minta Tanda Tangan” atau dari aksi baris offer berstatus Terkirim/Dilihat.",
                        "Request one via “Request Signature” or from the action on Sent/Viewed offer rows.",
                      )}
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[880px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("Offer", "Offer")}</TableHead>
                            <TableHead>{t("Penanda", "Signer")}</TableHead>
                            <TableHead>{t("Tujuan", "Purpose")}</TableHead>
                            <TableHead>{t("Status", "Status")}</TableHead>
                            <TableHead className="hidden md:table-cell">{t("Ditandatangani", "Signed At")}</TableHead>
                            <TableHead className="hidden md:table-cell">{t("Berlaku S.d.", "Valid Until")}</TableHead>
                            <TableHead className="w-56 text-right">{t("Aksi", "Actions")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {esignReqs.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell><span className="font-mono text-xs font-semibold">{r.offerNo ?? "—"}</span></TableCell>
                              <TableCell><span className="text-[13px] font-semibold">{r.signerName}</span></TableCell>
                              <TableCell><PurposePill purpose={r.purpose} /></TableCell>
                              <TableCell><EsignStatusPill status={r.status} /></TableCell>
                              <TableCell className="hidden whitespace-nowrap text-[11px] tabular-nums text-slate-500 dark:text-slate-400 md:table-cell">
                                {r.signedAt ? fmtDateTime(r.signedAt) : "—"}
                              </TableCell>
                              <TableCell className="hidden whitespace-nowrap text-[11px] tabular-nums text-slate-500 dark:text-slate-400 md:table-cell">{fmtDate(r.expiresAt)}</TableCell>
                              <TableCell className="text-right">
                                {r.status === "Pending" ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <Button variant="outline" size="sm" className="h-8 gap-1 px-2" disabled={busyEsign === r.id} onClick={() => doResend(r)}>
                                      {busyEsign === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
                                      {t("Kirim Ulang OTP", "Resend OTP")}
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-rose-600 hover:text-rose-700 dark:text-rose-400" disabled={busyEsign === r.id} onClick={() => doCancel(r)}>
                                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("Batalkan", "Cancel")}
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>
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
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* dialog */}
      {formTarget && (
        <WebhookFormDialog target={formTarget} events={events} onClose={() => setFormTarget(null)} onDone={refresh} />
      )}
      {esignOpen && (
        <EsignRequestDialog
          offers={esignableOffers}
          offersLoading={offersApi.loading && !offersApi.data}
          onClose={() => setEsignOpen(false)}
          onDone={() => { refresh(); offersApi.refresh(); }}
        />
      )}
    </div>
  );
}
