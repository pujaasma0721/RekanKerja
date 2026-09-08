"use client";
// OneVity — KONFIGURASI WHATSAPP (Task 28-a) ============================
// =======================================================================
// Menu Pengaturan → "Notifikasi WhatsApp". Kanal notifikasi kedua (selain
// email): sistem mengirim pesan WA otomatis saat ada pengajuan cuti,
// terbit slip gaji, permintaan/terbit surat, pengumuman & tukar shift.
// 3 tab: Konfigurasi · Template · Riwayat Kirim. (Menyalin struktur
// email-config-view.tsx Task 34 — arsitektur + aksen amber/ov-*)
// =======================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/onevity/shared/lib/api";
import { PageHeader, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  MessageCircle, Send, Zap, FileText, History, CheckCircle2, XCircle, MinusCircle,
  Pencil, Save, RotateCcw, AlertTriangle, Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { waPlaceholdersOf, WA_DEFAULT_TEMPLATES } from "@/onevity/shared/services/wa-defaults";
import { useI18n } from "@/onevity/shared/lib/i18n";

// ---------- tipe ----------

interface WaConfigPublic {
  active: boolean;
  provider: string; // Fonnte | Wablas | Custom
  endpoint: string;
  sender: string;
  hasToken: boolean;
  last4: string;
  ready: boolean;
  lastTestOk: boolean | null; lastTestAt: string | null; lastTestMessage: string | null;
  updatedAt: string;
}

interface WaTemplateRow {
  id: string; event: string; label: string; active: boolean;
  body: string; updatedAt: string;
}

interface WaLogRow {
  id: string; event: string; toPhone: string; body?: string | null;
  status: string; error?: string | null; createdAt: string;
}

// endpoint default per provider (mengikuti konstanta server WA_PROVIDER_ENDPOINTS)
const PROVIDER_ENDPOINT_HINT: Record<string, string> = {
  Fonnte: "https://api.fonnte.com/send",
  Wablas: "",
  Custom: "",
};

// scrollbar tipis (pola activity-log-view)
const SCROLL_CLS = "overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700";

// ---------- halaman utama ----------

export function WhatsAppConfigView() {
  const { t } = useI18n();
  const [tab, setTab] = useState("config");
  const tabCls = "gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800";

  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("Notifikasi WhatsApp")}
        description={t("Kanal notifikasi WhatsApp (Fonnte / Wablas / Custom) — sistem mengirim pesan saat ada pengajuan cuti, slip gaji terkirim, permintaan & terbit surat, pengumuman, dan tukar shift.", "WhatsApp notification channel (Fonnte / Wablas / Custom) — the system sends messages for leave requests, payslip delivery, letter requests & issuance, announcements, and shift swaps.")}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto max-w-full overflow-x-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
          <TabsTrigger value="config" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <Smartphone className="h-3.5 w-3.5" /> {t("Konfigurasi", "Configuration")}
          </TabsTrigger>
          <TabsTrigger value="templates" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <FileText className="h-3.5 w-3.5" /> {t("Template")}
          </TabsTrigger>
          <TabsTrigger value="logs" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <History className="h-3.5 w-3.5" /> {t("Riwayat Kirim", "Send History")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config"><ConfigPanel onSaved={() => setTab("templates")} /></TabsContent>
        <TabsContent value="templates"><TemplatesPanel /></TabsContent>
        <TabsContent value="logs"><LogsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// ================= TAB 1: KONFIGURASI =================

function ConfigPanel({ onSaved }: { onSaved?: () => void }) {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ config: WaConfigPublic }>("/api/onevity/wa-config");
  const cfg = data?.config;

  const [form, setForm] = useState({ provider: "Fonnte", endpoint: "", token: "", sender: "", active: false });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    if (cfg && !loaded) {
      setForm((f) => ({
        ...f,
        provider: cfg.provider, endpoint: cfg.endpoint,
        token: "", // kosong = pertahankan
        sender: cfg.sender, active: cfg.active,
      }));
      setLoaded(true);
    }
  }, [cfg, loaded]);

  // ganti provider → auto-isi endpoint default (tetap bisa diedit)
  const changeProvider = (provider: string) => {
    setForm((f) => ({ ...f, provider, endpoint: PROVIDER_ENDPOINT_HINT[provider] ?? "" }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiSend("/api/onevity/wa-config", "PUT", form);
      toast.success(t("Konfigurasi WhatsApp disimpan{s}", "WhatsApp configuration saved{s}", { s: form.active ? t(" — kanal notifikasi aktif", " — notification channel enabled") : "" }));
      setForm((f) => ({ ...f, token: "" }));
      setLoaded(false);
      refresh();
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  };

  const test = async () => {
    if (!testTo.trim()) { toast.error(t("Isi nomor HP tujuan uji (contoh: 081234567899)", "Enter a destination phone number (e.g. 081234567899)")); return; }
    setTesting(true);
    try {
      const res = await apiSend("/api/onevity/wa-config", "POST", { toPhone: testTo }) as { ok?: boolean; message?: string };
      if (res?.ok) { toast.success(res.message ?? t("Pesan uji terkirim", "Test message sent")); setTestOpen(false); }
      else toast.error(res?.message ?? t("Pengiriman gagal", "Send failed"));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    } finally { setTesting(false); }
  };

  if (loading && !cfg) return <LoadingRows rows={5} />;

  const tokenEmpty = !cfg?.hasToken && !form.token;
  const statusBadge = cfg?.active
    ? <Badge className="gap-1 rounded-full bg-emerald-100 px-2 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" /> {t("AKTIF", "ACTIVE")}</Badge>
    : <Badge className="gap-1 rounded-full bg-stone-100 px-2 text-[10px] font-extrabold text-stone-500 dark:bg-stone-800 dark:text-stone-400"><MinusCircle className="h-3 w-3" /> {t("NONAKTIF", "INACTIVE")}</Badge>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <MessageCircle className="h-4 w-4 ov-text-accent" /> {t("Provider & Pengirim", "Provider & Sender")}
          </CardTitle>
          {statusBadge}
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <div className="flex items-start gap-3">
              <Zap className="mt-0.5 h-4 w-4 text-amber-500" />
              <div>
                <p className="text-[13px] font-bold">{t("Kirim WhatsApp Otomatis", "Automatic WhatsApp Sending")}</p>
                <p className="text-xs text-stone-500">{t("Sistem mengirim WA tiap ada pengajuan / keputusan (cuti, slip gaji, surat, pengumuman, tukar shift)", "The system sends a WhatsApp message for every request / decision (leave, payslips, letters, announcements, shift swaps)")}</p>
              </div>
            </div>
            <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} aria-label={t("Aktifkan kanal WhatsApp", "Enable WhatsApp channel")} />
          </div>

          {form.active && tokenEmpty && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-bold">{t("Kanal aktif tetapi token provider kosong", "Channel enabled but the provider token is empty")}</p>
                <p className="mt-0.5 font-normal opacity-90">{t("Semua pemicu akan tercatat Skipped di Riwayat Kirim sampai token diisi (proses bisnis tetap berjalan normal).", "Every trigger will be recorded as Skipped in the Send History until a token is entered (business processes continue normally).")}</p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{t("Provider *", "Provider *")}</Label>
              <Select value={form.provider} onValueChange={changeProvider}>
                <SelectTrigger className="text-[13px]" aria-label={t("Pilih provider", "Select provider")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Fonnte" className="text-[13px]">Fonnte</SelectItem>
                  <SelectItem value="Wablas" className="text-[13px]">Wablas</SelectItem>
                  <SelectItem value="Custom" className="text-[13px]">Custom</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] leading-relaxed text-stone-400">
                {form.provider === "Fonnte" && t("API resmi Fonnte — token dari dashboard fonnte.com (menu Device).", "Official Fonnte API — token from the fonnte.com dashboard (Device menu).")}
                {form.provider === "Wablas" && t("Gateway Wablas — token dari menu Device → Settings; endpoint per-region.", "Wablas gateway — token from Device → Settings; region-specific endpoint.")}
                {form.provider === "Custom" && t("Gateway WhatsApp sendiri / internal (endpoint bebas).", "Your own / internal WhatsApp gateway (any endpoint).")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                {t("Endpoint Kirim *", "Send Endpoint *")}
                {form.provider !== "Custom" && <span className="ml-1 font-normal text-stone-400">{t("(boleh dikosongkan → default provider)", "(can be empty → provider default)")}</span>}
              </Label>
              <Input
                value={form.endpoint}
                onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
                placeholder={form.provider === "Fonnte" ? "https://api.fonnte.com/send" : form.provider === "Wablas" ? "https://<region>.wablas.com/api/send-message" : "https://gateway.internal/send"}
                className="text-[13px]"
                inputMode="url"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                {t("Token Provider *", "Provider Token *")}
                {cfg?.hasToken && <span className="ml-1 font-normal text-emerald-600">{t("(tersimpan — kosongkan agar tetap)", "(saved — leave empty to keep it)")}</span>}
              </Label>
              <Input
                type="password"
                value={form.token}
                onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
                placeholder={cfg?.hasToken ? `•••• tersimpan (${cfg.last4})` : t("token API provider", "provider API token")}
                className="text-[13px]"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{t("Nama Pengirim (label)", "Sender Name (label)")}</Label>
              <Input value={form.sender} onChange={(e) => setForm((f) => ({ ...f, sender: e.target.value }))} placeholder="OneVity HRIS" className="text-[13px]" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={save} disabled={saving} className="gap-2 font-bold">
              <Save className="h-4 w-4" /> {saving ? t("Menyimpan…") : t("Simpan Konfigurasi", "Save Configuration")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold"><Send className="h-4 w-4 ov-text-accent" /> {t("Tes Kirim WhatsApp", "Send a Test WhatsApp")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <Button onClick={() => setTestOpen(true)} disabled={testing} className="w-full gap-2 font-bold">
              <Send className="h-4 w-4" /> {testing ? t("Mengirim…", "Sending…") : t("Kirim Pesan Uji", "Send Test Message")}
            </Button>
            <p className="text-[11px] leading-relaxed text-stone-500">
              {t("Butuh hak aksi khusus (op:test pada menu Notifikasi WhatsApp) — kirim pesan pendek ke nomor HP mana pun untuk memverifikasi token & endpoint.", "Requires a special action right (op:test on the WhatsApp Notification menu) — sends a short message to any phone number to verify the token & endpoint.")}
            </p>
            {cfg?.lastTestAt && (
              <div className={cn(
                "rounded-xl border p-3 text-xs",
                cfg.lastTestOk
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
              )}>
                <p className="flex items-center gap-1.5 font-bold">
                  {cfg.lastTestOk ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {t("Tes terakhir {d}", "Last test {d}", { d: fmtDate(cfg.lastTestAt) })}
                </p>
                {cfg.lastTestMessage && <p className="mt-1 break-words opacity-80">{cfg.lastTestMessage}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-stone-200/80 bg-stone-50/60 shadow-sm dark:border-stone-800 dark:bg-stone-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold"><MessageCircle className="h-4 w-4 ov-text-accent" /> {t("Petunjuk Cepat", "Quick Guide")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
            <p><b className="text-stone-700 dark:text-stone-300">Fonnte:</b> {t("daftar di fonnte.com, hubungkan perangkat WhatsApp, salin token (Device). Endpoint sudah terisi default.", "register at fonnte.com, connect your WhatsApp device, copy the token (Device). The endpoint is pre-filled by default.")}</p>
            <p><b className="text-stone-700 dark:text-stone-300">Wablas:</b> {t("token di menu Device → Settings; endpoint ikut region akun Anda, mis.", "token in Device → Settings; the endpoint follows your account region, e.g.")} <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">https://jkt.wablas.com/api/send-message</code>.</p>
            <p><b className="text-stone-700 dark:text-stone-300">Custom:</b> {t("isi endpoint gateway internal Anda — sistem POST JSON {target, phone, message, event} + header Authorization.", "enter your internal gateway endpoint — the system POSTs JSON {target, phone, message, event} + Authorization header.")}</p>
            <p>{t("Selama kanal nonaktif / token kosong, setiap pemicu tercatat ", "While the channel is disabled / token empty, every trigger is recorded as ")}<i>Skipped</i>{t(" di Riwayat Kirim — proses bisnis tetap normal.", " in the Send History — business processes continue normally.")}</p>
          </CardContent>
        </Card>
      </div>

      {/* dialog tes kirim */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4 ov-text-accent" /> {t("Tes Kirim WhatsApp", "Send Test WhatsApp")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs font-semibold">{t("Nomor HP Tujuan Uji", "Test Destination Phone")}</Label>
            <Input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="081234567899"
              className="text-[13px]"
              inputMode="tel"
              autoFocus
            />
            <p className="text-[11px] text-stone-500">
              {t("Pesan pendek dikirim langsung (tanpa template) ke provider aktif.", "A short message is sent directly (no template) to the active provider.")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>{t("Batal")}</Button>
            <Button onClick={test} disabled={testing} className="gap-2 font-bold">
              <Send className="h-4 w-4" /> {testing ? t("Mengirim…", "Sending…") : t("Kirim", "Send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ================= TAB 2: TEMPLATE =================

function TemplatesPanel() {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ templates: WaTemplateRow[] }>("/api/onevity/wa-templates");
  const [editing, setEditing] = useState<WaTemplateRow | null>(null);

  const templates = data?.templates ?? [];

  const toggleActive = async (tpl: WaTemplateRow) => {
    try {
      await apiSend("/api/onevity/wa-templates", "PATCH", { id: tpl.id, active: !tpl.active });
      toast.success(t(`Template "${tpl.label}" ${!tpl.active ? "diaktifkan" : "dinonaktifkan"}`, `Template "${tpl.label}" ${!tpl.active ? "enabled" : "disabled"}`));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  if (loading && !data) return <LoadingRows rows={5} />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="rounded-full font-mono text-[10px]">{t("{n} template", "{n} templates", { n: templates.length })}</Badge>
        <Badge className="rounded-full bg-emerald-100 px-2 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          {t("{n} aktif", "{n} active", { n: templates.filter((tpl) => tpl.active).length })}
        </Badge>
        <p className="ml-auto hidden text-[11px] text-stone-400 sm:block">
          {t("Placeholder {{key}} diisi otomatis dari data pengajuan saat pesan dikirim.", "{{key}} placeholders are filled automatically from request data when the message is sent.")}
        </p>
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                  <TableHead className="text-[11px] font-bold">{t("Event", "Event")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Label")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Pratinjau Pesan", "Message Preview")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Aktif", "Active")}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((tpl) => (
                  <TableRow key={tpl.id} className={cn("hover:bg-stone-50 dark:hover:bg-stone-900/60", !tpl.active && "opacity-60")}>
                    <TableCell className="whitespace-nowrap font-mono text-[10px] text-stone-400">{tpl.event}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-[13px] font-semibold">{tpl.label}</TableCell>
                    <TableCell className="max-w-[420px]">
                      <p className="line-clamp-2 whitespace-pre-wrap text-[12px] text-stone-600 dark:text-stone-400" title={tpl.body}>{tpl.body}</p>
                    </TableCell>
                    <TableCell>
                      <Switch checked={tpl.active} onCheckedChange={() => toggleActive(tpl)} aria-label={t(`Aktifkan template ${tpl.label}`, `Enable template ${tpl.label}`)} />
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => setEditing(tpl)}
                        className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
                        aria-label={t(`Edit template ${tpl.label}`, `Edit template ${tpl.label}`)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TemplateDialog
        tpl={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh(); }}
      />
    </div>
  );
}

function TemplateDialog({ tpl, onClose, onSaved }: { tpl: WaTemplateRow | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const key = tpl?.id ?? "none";

  // katalog placeholder spesifik event ini (akurat sesuai hook backend)
  const phDefs = useMemo(() => waPlaceholdersOf(tpl?.event ?? ""), [tpl?.event]);
  const defaultTpl = useMemo(() => WA_DEFAULT_TEMPLATES.find((d) => d.event === tpl?.event), [tpl?.event]);

  useEffect(() => {
    if (tpl) {
      setLabel(tpl.label); setBody(tpl.body);
      setPreview(false);
    }
  }, [key, tpl]);

  // nilai contoh per placeholder → untuk pratinjau
  const contoh = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of phDefs) m[p.key] = p.contoh;
    return m;
  }, [phDefs]);

  const render = (text: string) => text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => contoh[k] ?? `{{${k}}}`);

  // sisipkan {{key}} pada posisi kursor textarea
  const insertAtCursor = (snippet: string) => {
    const el = bodyRef.current;
    if (!el) { setBody((b) => b + snippet); return; }
    const s = el.selectionStart ?? body.length;
    const e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + snippet + body.slice(e));
    requestAnimationFrame(() => { el.focus(); const pos = s + snippet.length; el.setSelectionRange(pos, pos); });
  };

  const save = async () => {
    if (!tpl) return;
    if (!body.trim()) { toast.error(t("Isi pesan tidak boleh kosong", "The message body cannot be empty")); return; }
    setSaving(true);
    try {
      await apiSend("/api/onevity/wa-templates", "PATCH", { id: tpl.id, label, body });
      toast.success(t("Template disimpan", "Template saved"));
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const fillDefault = () => {
    if (!defaultTpl) { toast.error(t("Tidak ada template default untuk event ini", "No default template for this event")); return; }
    setLabel(defaultTpl.label); setBody(defaultTpl.body);
    toast.info(t("Template default dimuat — periksa lalu tekan Simpan Template", "Default template loaded — review it then press Save Template"));
  };

  return (
    <Dialog open={!!tpl} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] sm:max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <FileText className="h-4 w-4 ov-text-accent" /> {t("Edit Template", "Edit Template")} — {tpl?.label}
            {defaultTpl && (
              <Button type="button" variant="outline" size="sm" onClick={fillDefault} className="ml-auto h-7 gap-1.5 rounded-full px-3 text-[11px] font-bold">
                <RotateCcw className="h-3.5 w-3.5" /> {t("Isi Default", "Load Default")}
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{t("Label")}</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">{t("Isi Pesan (maks 1.000 karakter)", "Message Body (max 1,000 chars)")}</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreview((p) => !p)} className="h-7 gap-1.5 rounded-full px-2.5 text-[11px] font-bold ov-text-accent hover:ov-soft">
                {preview ? t("Mode Edit", "Edit Mode") : t("Pratinjau", "Preview")}
              </Button>
            </div>
            {preview ? (
              <div className={cn("max-h-72 whitespace-pre-wrap rounded-lg border ov-border-accent ov-soft px-3 py-2.5 text-[13px] leading-relaxed", SCROLL_CLS)}>
                {render(body) || <span className="italic text-stone-400">{t("(isi kosong)", "(empty)")}</span>}
              </div>
            ) : (
              <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={1000} className="text-[13px] leading-relaxed" />
            )}
            <p className="text-right font-mono text-[10px] text-stone-400">{body.length}/1000</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/60">
            <p className="font-bold text-stone-600 dark:text-stone-300">{t("Variabel untuk event ini — klik untuk menyisipkan ke kursor:", "Variables for this event — click to insert at the cursor:")}</p>
            {phDefs.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {phDefs.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    title={`${p.label} · ${t("contoh", "e.g.")}: ${p.contoh}`}
                    onClick={() => insertAtCursor(`{{${p.key}}}`)}
                    disabled={preview}
                    className="rounded-full border border-stone-300 bg-white px-2.5 py-1 font-mono text-[11px] font-bold text-stone-700 transition-colors hover:ov-soft hover:ov-border-accent disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                  >
                    {`{{${p.key}}}`}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-stone-500">{t("Event ini tidak memiliki variabel dinamis.", "This event has no dynamic variables.")}</p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-stone-500 dark:text-stone-400">
              {t("Nilai variabel diisi otomatis dari data pengajuan saat pesan dikirim. Variabel tak dikenal tampil apa adanya.", "Variable values are filled automatically from request data when the message is sent. Unknown variables appear as-is.")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={save} disabled={saving} className="gap-2 font-bold">
            <Save className="h-4 w-4" /> {saving ? t("Menyimpan…") : t("Simpan Template", "Save Template")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= TAB 3: RIWAYAT KIRIM =================

function LogsPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState("all");
  const [event, setEvent] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE = 50;
  const url = `/api/onevity/wa-logs?limit=${PAGE}&offset=${page * PAGE}&status=${status === "all" ? "" : status}&event=${encodeURIComponent(event === "all" ? "" : event)}`;
  const { data, loading, refresh } = useApi<{ logs: WaLogRow[]; total: number; stats: Record<string, number>; events: string[] }>(url);

  const stats = data?.stats ?? {};
  const logs = data?.logs ?? [];
  const events = data?.events ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ["Sent", "Terkirim", "Sent", CheckCircle2, "text-emerald-600"],
          ["Failed", "Gagal", "Failed", XCircle, "text-rose-500"],
          ["Skipped", "Dilewati", "Skipped", MinusCircle, "text-stone-400"],
        ] as const).map(([key, label, labelEn, Icon, cls]) => (
          <Card key={key} className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={cn("rounded-xl bg-stone-50 p-2.5 dark:bg-stone-900", cls)}>
                <Icon className="h-5 w-5" />
              </div>
              <div aria-live="polite">
                <p className="text-xl font-extrabold tabular-nums">{stats[key] ?? 0}</p>
                <p className="text-[11px] font-semibold text-stone-500">{t(label, labelEn)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4 ov-text-accent" /> {t("Riwayat Pengiriman WhatsApp", "WhatsApp Delivery History")}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
              <SelectTrigger className="h-8 w-[130px] rounded-lg text-xs" aria-label={t("Filter status", "Filter by status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">{t("Semua Status", "All Statuses")}</SelectItem>
                <SelectItem value="Sent" className="text-xs">Sent</SelectItem>
                <SelectItem value="Failed" className="text-xs">Failed</SelectItem>
                <SelectItem value="Skipped" className="text-xs">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Select value={event} onValueChange={(v) => { setEvent(v); setPage(0); }}>
              <SelectTrigger className="h-8 w-[160px] rounded-lg text-xs" aria-label={t("Filter event", "Filter by event")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={cn(SCROLL_CLS, "max-h-72")}>
                <SelectItem value="all" className="text-xs">{t("Semua Event", "All Events")}</SelectItem>
                {events.map((e) => (
                  <SelectItem key={e} value={e} className="font-mono text-xs">{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="rounded-full font-mono text-[10px]">total {data?.total ?? 0}</Badge>
            <Button variant="outline" size="sm" onClick={refresh} className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold">
              <History className="h-3 w-3" /> {t("Muat Ulang")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading && !data ? (
            <LoadingRows rows={6} />
          ) : logs.length === 0 ? (
            <div className="py-10 text-center">
              <MessageCircle className="mx-auto h-10 w-10 text-stone-300 dark:text-stone-600" />
              <p className="mt-3 text-sm font-bold text-stone-500">{t("Belum ada pesan WhatsApp terkirim", "No WhatsApp messages sent yet")}</p>
              <p className="mt-1 text-xs text-stone-400">{t("Pengiriman tercatat di sini setelah kanal diaktifkan dan pengajuan / keputusan terjadi.", "Deliveries appear here once the channel is enabled and requests / decisions happen.")}</p>
            </div>
          ) : (
            <>
              <div className={cn("max-h-96", SCROLL_CLS)}>
                <Table>
                  <TableHeader className="sticky top-0 z-10">
                    <TableRow className="bg-stone-50 dark:bg-stone-900">
                      <TableHead className="text-[11px] font-bold">{t("Waktu", "Time")}</TableHead>
                      <TableHead className="text-[11px] font-bold">Event</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Nomor", "Number")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Pesan / Error", "Message / Error")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((l) => (
                      <TableRow key={l.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                        <TableCell className="whitespace-nowrap text-[11px] text-stone-500">{fmtDate(l.createdAt)}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-[10px] text-stone-500">{l.event}</TableCell>
                        <TableCell className="whitespace-nowrap text-[12px] font-semibold tabular-nums">{l.toPhone}</TableCell>
                        <TableCell>
                          {l.status === "Sent" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" /> Sent
                            </span>
                          ) : l.status === "Failed" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-extrabold text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                              <XCircle className="h-3 w-3" /> {t("Gagal")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-extrabold text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                              <MinusCircle className="h-3 w-3" /> Skipped
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[360px]">
                          <p className="line-clamp-2 text-[12px] text-stone-600 dark:text-stone-400" title={l.error ?? l.body ?? ""}>
                            {l.error ?? l.body ?? "—"}
                          </p>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] text-stone-400">
                    {t("Halaman {p} dari {n}", "Page {p} of {n}", { p: page + 1, n: totalPages })}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="h-7 rounded-lg text-[11px] font-bold">
                      {t("Sebelumnya", "Previous")}
                    </Button>
                    <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="h-7 rounded-lg text-[11px] font-bold">
                      {t("Berikutnya", "Next")}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
