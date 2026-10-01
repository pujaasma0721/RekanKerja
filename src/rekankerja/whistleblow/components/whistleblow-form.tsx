"use client";
// Task 52-f — form pelaporan whistleblowing (TPKS UU 12/2022 Ps.22-24).
// Dipakai DUA konteks: modul admin (whistleblow-module) & portal ESS
// (ess-shell view "whistleblow") — komponen murni, state lokal.
//
// Jaminan anonimitas ditampilkan EKSPLISIT (UU 12/2022 Ps.23 perlindungan
// pelapor): mode anonim default — identitas tidak disimpan; server juga
// membuktikannya dengan tidak menulis appUserId/employeeId.
import { useState } from "react";
import { Loader2, Send, ShieldCheck, Siren, EyeOff, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { apiSend } from "@/rekankerja/shared/lib/api";

export const WB_CATEGORIES: { value: string; id: string; en: string }[] = [
  { value: "KEKERASAN_SEKSUAL", id: "Kekerasan Seksual", en: "Sexual Violence" },
  { value: "PELECEHAN", id: "Pelecehan / Kekerasan Lain", en: "Harassment / Other Violence" },
  { value: "BULLYING", id: "Perundungan (Bullying)", en: "Bullying" },
  { value: "RETALIASI", id: "Retaliasi terhadap Pelapor", en: "Retaliation against Reporter" },
  { value: "FRAUD", id: "Penipuan / Kecurangan", en: "Fraud" },
  { value: "KESELAMATAN", id: "Keselamatan & Kesehatan Kerja", en: "Workplace Safety & Health" },
  { value: "LAINNYA", id: "Pelanggaran Lainnya", en: "Other Violations" },
];

interface SubmitOk {
  ok: boolean;
  ticketNo: string;
  message: string;
}

export function WhistleblowForm({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [location, setLocation] = useState("");
  const [involvedHint, setInvolvedHint] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [reporterContact, setReporterContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SubmitOk | null>(null);

  const submit = async () => {
    if (!category) { toast.error(t("Pilih kategori laporan", "Choose a report category")); return; }
    if (description.trim().length < 20) {
      toast.error(t("Uraian kejadian minimal 20 karakter", "Incident description needs at least 20 characters"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<SubmitOk>("/api/rekankerja/whistleblowing/report", "POST", {
        category,
        description: description.trim(),
        incidentDate: incidentDate || undefined,
        location: location.trim() || undefined,
        involvedHint: involvedHint.trim() || undefined,
        anonymous,
        reporterContact: anonymous ? reporterContact.trim() || undefined : reporterContact.trim() || undefined,
      });
      setDone(res);
      toast.success(t("Laporan terkirim — {ticket}", "Report submitted — {ticket}", { ticket: res.ticketNo }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-brand/25 bg-brand/10 p-5 dark:border-brand/30 dark:bg-brand/10">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-brand dark:text-brand/85" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-bold text-brand-deep dark:text-brand/75">
              {t("Laporan tercatat", "Report recorded")} — <span className="font-mono">{done.ticketNo}</span>
            </p>
            <p className="text-xs leading-relaxed text-brand-deep dark:text-brand/85">{done.message}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(
                "Simpan nomor tiket ini. Laporan ditangani tim yang berwenang; pelapor anonim dilindungi UU 12/2022 Ps.23.",
                "Keep this ticket number. The report is handled by the authorized team; anonymous reporters are protected under Law 12/2022 Art.23.",
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-8 text-xs font-bold"
              onClick={() => { setDone(null); setCategory(""); setDescription(""); setIncidentDate(""); setLocation(""); setInvolvedHint(""); setReporterContact(""); }}
            >
              {t("Buat laporan lain", "File another report")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* jaminan perlindungan */}
      <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 dark:border-rose-500/30 dark:bg-rose-500/10">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
        <p className="text-[11px] leading-relaxed text-rose-800 dark:text-rose-300">
          {t(
            "Kanal pelaporan pelanggaran & kekerasan seksual di tempat kerja (UU 12/2022 tentang TPKS). Pelapor yang melapor dengan itikad baik DILINDUNGI dari ancaman, retaliasi, atau pemutusan hubungan kerja (Ps.23). Identitas pelapor mode ANONIM tidak disimpan sama sekali.",
            "Reporting channel for workplace violence & violations (Law 12/2022 on Sexual Violence Crimes). Good-faith reporters are PROTECTED from threats, retaliation, or termination (Art.23). Anonymous reporter identity is never stored.",
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-bold">{t("Kategori *", "Category *")}</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={t("Pilih kategori", "Select category")} /></SelectTrigger>
            <SelectContent>
              {WB_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{t(c.id, c.en)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-bold">{t("Tanggal Kejadian", "Incident Date")}</Label>
          <Input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} className="h-9 text-xs" max={new Date().toISOString().slice(0, 10)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-bold">{t("Uraian Kronologi *", "Incident Description *")}</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-28 text-xs"
          placeholder={t(
            "Ceritakan kronologi: apa yang terjadi, kapan, siapa yang terlibat, apakah ada saksi. Minimal 20 karakter.",
            "Describe what happened, when, who was involved, and any witnesses. At least 20 characters.",
          )}
          maxLength={4000}
        />
        <p className="text-right text-[10px] text-slate-400">{description.length}/4000</p>
      </div>

      {!compact && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("Lokasi Kejadian", "Incident Location")}</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} className="h-9 text-xs" placeholder={t("mis. Gudang B / Kantor Cabang", "e.g. Warehouse B / Branch office")} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("Pihak Terlibat (opsional)", "Involved Parties (optional)")}</Label>
            <Input value={involvedHint} onChange={(e) => setInvolvedHint(e.target.value)} className="h-9 text-xs" placeholder={t("deskriptif, tanpa harus nama persis", "descriptive, exact names not required")} maxLength={300} />
          </div>
        </div>
      )}

      {/* mode anonim */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
        <Checkbox checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} className="mt-0.5 h-4 w-4" />
        <span className="space-y-0.5">
          <span className="flex items-center gap-1.5 text-xs font-bold">
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
            {t("Kirim secara ANONIM (disarankan)", "Submit ANONYMOUSLY (recommended)")}
          </span>
          <span className="block text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
            {t(
              "Identitas Anda TIDAK disimpan — hanya konteks laporan yang terekam.",
              "Your identity is NOT stored — only the report context is recorded.",
            )}
          </span>
        </span>
      </label>
      {!anonymous && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          {t(
            "Mode teridentifikasi: identitas akun Anda dicatat agar tim penangan dapat menghubungi untuk klarifikasi & perlindungan lebih lanjut.",
            "Identified mode: your account identity is recorded so the handling team can contact you for clarification and further protection.",
          )}
        </p>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs font-bold">{t("Kontak Dapat Dihubungi (opsional)", "Contact Channel (optional)")}</Label>
        <Input
          value={reporterContact}
          onChange={(e) => setReporterContact(e.target.value)}
          className="h-9 text-xs"
          placeholder={t("mis. email pribadi / no. WA — boleh untuk mode anonim", "e.g. personal email / WA number — allowed even when anonymous")}
          maxLength={120}
        />
      </div>

      <Button onClick={submit} disabled={busy} className="h-10 w-full gap-2 font-bold">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {t("Kirim Laporan", "Submit Report")}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
        <Siren className="h-3 w-3" aria-hidden />
        {t("Batas 3 laporan per 15 menit per sesi — mencegah spam kanal.", "Limit 3 reports per 15 minutes per session — prevents channel spam.")}
      </p>
    </div>
  );
}
