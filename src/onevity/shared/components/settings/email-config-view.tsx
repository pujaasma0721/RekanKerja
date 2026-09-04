"use client";
// OneVity — KONFIGURASI EMAIL (Task 34) =================================
// ========================================================================
// Menu Pengaturan Sistem → "Konfigurasi Email". Sistem mengirim email
// otomatis saat ada pengajuan / persetujuan (cuti, travel, klaim medis,
// payroll). 3 tab: Server SMTP · Template & Pemicu · Riwayat Kirim.
// ========================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/onevity/shared/lib/api";
import { PageHeader, StatusPill, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Mail, Send, Server, FileText, History, CheckCircle2, XCircle, MinusCircle,
  Pencil, Save, KeyRound, Zap, RotateCcw, Eye, EyeOff, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { placeholdersOf, DEFAULT_TEMPLATES_PLACEHOLDER } from "@/onevity/shared/services/email-defaults";
import { useI18n } from "@/onevity/shared/lib/i18n";

// ---------- tipe ----------

interface EmailConfigPublic {
  active: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string;
  fromEmail: string; fromName: string;
  hasPassword: boolean;
  lastTestOk: boolean | null; lastTestAt: string | null; lastTestMessage: string | null;
}

interface EmailTemplateRow {
  id: string; event: string; label: string; active: boolean;
  notifyEmployee: boolean; notifyApprover: boolean; notifyHrd: boolean;
  subject: string; body: string; updatedAt: string;
}

interface EmailLogRow {
  id: string; event: string; toEmail: string; subject: string;
  status: string; error?: string | null; createdAt: string;
}

// Peta EN paralel label penerima template email (Pengaju/Approver/HRD).
const RECIPIENT_LABEL_EN: Record<string, string> = {
  "Pengaju": "Requester",
  "Approver": "Approver",
  "HRD (CC)": "HRD (CC)",
};

// ---------- halaman utama ----------

export function EmailConfigView() {
  const { t } = useI18n();
  const [tab, setTab] = useState("server");
  const tabCls = "gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800";

  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("Konfigurasi Email")}
        description={t("Pengaturan SMTP & notifikasi otomatis — sistem mengirim email saat ada pengajuan cuti, perjalanan dinas, klaim medis, dan konfirmasi payroll.", "SMTP settings & automatic notifications — the system sends emails for leave requests, business travel, medical claims, and payroll confirmations.")}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto max-w-full overflow-x-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
          <TabsTrigger value="server" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <Server className="h-3.5 w-3.5" /> {t("Server SMTP", "SMTP Server")}
          </TabsTrigger>
          <TabsTrigger value="templates" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <FileText className="h-3.5 w-3.5" /> {t("Template & Pemicu", "Templates & Triggers")}
          </TabsTrigger>
          <TabsTrigger value="logs" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <History className="h-3.5 w-3.5" /> {t("Riwayat Kirim", "Send History")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="server"><SmtpPanel onSaved={() => setTab("templates")} /></TabsContent>
        <TabsContent value="templates"><TemplatesPanel /></TabsContent>
        <TabsContent value="logs"><LogsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// ================= TAB 1: SERVER SMTP =================

function SmtpPanel({ onSaved }: { onSaved?: () => void }) {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ config: EmailConfigPublic }>("/api/onevity/email-config");
  const cfg = data?.config;

  const [form, setForm] = useState({ smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "", smtpPassword: "", fromEmail: "", fromName: "OneVity HRIS", active: false });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    if (cfg && !loaded) {
      setForm((f) => ({
        ...f,
        smtpHost: cfg.smtpHost, smtpPort: cfg.smtpPort, smtpSecure: cfg.smtpSecure,
        smtpUser: cfg.smtpUser, smtpPassword: "", // kosong = pertahankan
        fromEmail: cfg.fromEmail, fromName: cfg.fromName, active: cfg.active,
      }));
      setLoaded(true);
    }
  }, [cfg, loaded]);

  const save = async () => {
    setSaving(true);
    try {
      await apiSend("/api/onevity/email-config", "PUT", form);
      toast.success(t("Konfigurasi email disimpan{s}", "Email configuration saved{s}", { s: form.active ? t(" — notifikasi otomatis aktif", " — automatic notifications enabled") : "" }));
      setForm((f) => ({ ...f, smtpPassword: "" }));
      setLoaded(false);
      refresh();
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  };

  const test = async () => {
    if (!testTo.includes("@")) { toast.error(t("Isi alamat email tujuan uji", "Enter a destination email address for the test")); return; }
    setTesting(true);
    try {
      const res = await apiSend("/api/onevity/email-config", "POST", { to: testTo }) as { ok?: boolean; message?: string };
      if (res?.ok) toast.success(res.message ?? t("Email uji terkirim", "Test email sent"));
      else toast.error(res?.message ?? t("Pengiriman gagal", "Send failed"));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    } finally { setTesting(false); }
  };

  if (loading && !cfg) return <LoadingRows rows={5} />;

  const statusBadge = cfg?.active
    ? <Badge className="gap-1 rounded-full bg-emerald-100 px-2 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" /> {t("AKTIF", "ACTIVE")}</Badge>
    : <Badge className="gap-1 rounded-full bg-stone-100 px-2 text-[10px] font-extrabold text-stone-500 dark:bg-stone-800 dark:text-stone-400"><MinusCircle className="h-3 w-3" /> {t("NONAKTIF", "INACTIVE")}</Badge>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Server className="h-4 w-4 ov-text-accent" /> {t("Server SMTP & Pengirim", "SMTP Server & Sender")}
          </CardTitle>
          {statusBadge}
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <div className="flex items-start gap-3">
              <Zap className="mt-0.5 h-4 w-4 text-amber-500" />
              <div>
                <p className="text-[13px] font-bold">{t("Kirim Email Otomatis", "Automatic Email Sending")}</p>
                <p className="text-xs text-stone-500">{t("Sistem mengirim email tiap ada pengajuan / persetujuan (cuti, travel, klaim medis, payroll)", "The system sends an email for every request / approval (leave, travel, medical claims, payroll)")}</p>
              </div>
            </div>
            <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} aria-label={t("Aktifkan email otomatis", "Enable automatic emails")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">SMTP Host *</Label>
              <Input value={form.smtpHost} onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))} placeholder="smtp.gmail.com" className="text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Port</Label>
              <Input type="number" value={form.smtpPort} onChange={(e) => setForm((f) => ({ ...f, smtpPort: Number(e.target.value) || 587 }))} placeholder="587" className="text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{t("Username SMTP", "SMTP Username")}</Label>
              <Input value={form.smtpUser} onChange={(e) => setForm((f) => ({ ...f, smtpUser: e.target.value }))} placeholder="user@perusahaan.co.id" className="text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Password SMTP {cfg?.hasPassword && <span className="ml-1 font-normal text-emerald-600">{t("(tersimpan — kosongkan agar tetap)", "(saved — leave empty to keep it)")}</span>}
              </Label>
              <Input type="password" value={form.smtpPassword} onChange={(e) => setForm((f) => ({ ...f, smtpPassword: e.target.value }))} placeholder={cfg?.hasPassword ? "••••••••••" : t("app password / sandi SMTP", "app password / SMTP password")} className="text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{t("Email Pengirim (From) *", "Sender Email (From) *")}</Label>
              <Input value={form.fromEmail} onChange={(e) => setForm((f) => ({ ...f, fromEmail: e.target.value }))} placeholder="hris@perusahaan.co.id" className="text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{t("Nama Pengirim", "Sender Name")}</Label>
              <Input value={form.fromName} onChange={(e) => setForm((f) => ({ ...f, fromName: e.target.value }))} placeholder="OneVity HRIS" className="text-[13px]" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={form.smtpSecure} onCheckedChange={(v) => setForm((f) => ({ ...f, smtpSecure: v }))} aria-label={t("Gunakan TLS", "Use TLS")} />
            <Label className="text-xs">{t("Gunakan TLS implicit (port 465). Port 587 biasanya STARTTLS — biarkan mati.", "Use implicit TLS (port 465). Port 587 is usually STARTTLS — leave this off.")}</Label>
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
            <CardTitle className="flex items-center gap-2 text-sm font-bold"><Send className="h-4 w-4 ov-text-accent" /> {t("Tes Kirim Email", "Send a Test Email")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{t("Email Tujuan Uji", "Test Recipient Email")}</Label>
              <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={t("nama@email.com", "name@email.com")} className="text-[13px]" />
            </div>
            <Button onClick={test} disabled={testing} className="w-full gap-2 font-bold">
              <Send className="h-4 w-4" /> {testing ? t("Mengirim…", "Sending…") : t("Kirim Email Uji", "Send Test Email")}
            </Button>
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
            <CardTitle className="flex items-center gap-2 text-sm font-bold"><Mail className="h-4 w-4 ov-text-accent" /> {t("Petunjuk Cepat", "Quick Guide")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
            <p><b className="text-stone-700 dark:text-stone-300">Gmail:</b> {t("aktifkan 2FA lalu buat", "enable 2FA then create")} <i>App Password</i> ({t("16 huruf", "16 letters")}) — {t("isi sebagai password SMTP, host", "use it as the SMTP password, host")} <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">smtp.gmail.com</code> port 587.</p>
            <p><b className="text-stone-700 dark:text-stone-300">Office365:</b> {t("host", "host")} <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">smtp.office365.com</code> port 587.</p>
            <p><b className="text-stone-700 dark:text-stone-300">{t("Relay internal:", "Internal relay:")}</b> {t("isi host server email perusahaan.", "enter the company mail server host.")}</p>
            <p>{t("Selama SMTP belum diisi, setiap pemicu notifikasi dicatat sebagai ", "While SMTP is not configured, every notification trigger is recorded as ")}<i>Skipped</i>{t(" di Riwayat Kirim — proses approval tetap berjalan normal.", " in the Send History — the approval process continues normally.")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ================= TAB 2: TEMPLATE & PEMICU =================

function TemplatesPanel() {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ templates: EmailTemplateRow[] }>("/api/onevity/email-templates");
  const [editing, setEditing] = useState<EmailTemplateRow | null>(null);
  const [search, setSearch] = useState("");

  const templates = data?.templates ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((tpl) => tpl.event.toLowerCase().includes(q) || tpl.label.toLowerCase().includes(q));
  }, [templates, search]);

  const groups = useMemo(() => {
    const g: Record<string, EmailTemplateRow[]> = {};
    for (const tpl of filtered) {
      const mod = tpl.event.split(".")[0];
      (g[mod] ??= []).push(tpl);
    }
    return g;
  }, [filtered]);

  const MODULE_LABEL: Record<string, string> = { leave: "Cuti", travel: "Perjalanan Dinas", medical: "Klaim Medis", payroll: "Payroll", user: "Pengguna" };
  // Peta EN paralel MODULE_LABEL (label ID dipertahankan; render t(MAP[k], MAP_EN[k])).
  const MODULE_LABEL_EN: Record<string, string> = { leave: "Leave", travel: "Business Travel", medical: "Medical Claims", payroll: "Payroll", user: "User" };

  const toggleActive = async (tpl: EmailTemplateRow) => {
    try {
      await apiSend("/api/onevity/email-templates", "PUT", { event: tpl.event, active: !tpl.active });
      toast.success(t(`Template "${tpl.label}" ${!tpl.active ? "diaktifkan" : "dinonaktifkan"}`, `Template "${tpl.label}" ${!tpl.active ? "enabled" : "disabled"}`));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  if (loading && !data) return <LoadingRows rows={5} />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Cari event / template…", "Search events / templates…")}
          className="h-9 w-full max-w-xs rounded-xl text-[13px]"
        />
        <Badge variant="secondary" className="rounded-full font-mono text-[10px]">{t("{n} template", "{n} templates", { n: templates.length })}</Badge>
        <Badge className="rounded-full bg-emerald-100 px-2 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          {t("{n} aktif", "{n} active", { n: templates.filter((tpl) => tpl.active).length })}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(groups).map(([mod, items]) => (
          <Card key={mod} className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <FileText className="h-4 w-4 ov-text-accent" /> {t(MODULE_LABEL[mod] ?? mod, MODULE_LABEL_EN[mod] ?? mod)}
                <Badge variant="secondary" className="ml-auto rounded-full font-mono text-[10px]">{items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {items.map((tpl) => (
                <div key={tpl.id} className={cn(
                  "rounded-xl border p-3 transition",
                  tpl.active ? "border-stone-200 bg-white hover:ov-border-accent dark:border-stone-800 dark:bg-stone-900"
                           : "border-stone-200 bg-stone-50 opacity-70 dark:border-stone-800 dark:bg-stone-900/50",
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold">{tpl.label}</p>
                      <p className="truncate font-mono text-[10px] text-stone-400">{tpl.event}</p>
                      <p className="mt-1 truncate text-[11px] text-stone-500">{tpl.subject}</p>
                    </div>
                    <Switch checked={tpl.active} onCheckedChange={() => toggleActive(tpl)} aria-label={`Toggle ${tpl.label}`} />
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    {tpl.notifyEmployee && <Badge variant="secondary" className="rounded-full text-[9px] font-bold">{t("Pengaju", "Requester")}</Badge>}
                    {tpl.notifyApprover && <Badge variant="secondary" className="rounded-full text-[9px] font-bold">Approver</Badge>}
                    {tpl.notifyHrd && <Badge variant="secondary" className="rounded-full text-[9px] font-bold">HRD</Badge>}
                    <button
                      onClick={() => setEditing(tpl)}
                      className="ml-auto rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
                      aria-label={`Edit template ${tpl.label}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <TemplateDialog
        tpl={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh(); }}
      />
    </div>
  );
}

function TemplateDialog({ tpl, onClose, onSaved }: { tpl: EmailTemplateRow | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState({ notifyEmployee: true, notifyApprover: true, notifyHrd: false });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const key = tpl?.id ?? "none";

  // katalog placeholder spesifik event ini (akurat sesuai hook backend)
  const phDefs = useMemo(() => placeholdersOf(tpl?.event ?? ""), [tpl?.event]);
  const defaultTpl = useMemo(() => DEFAULT_TEMPLATES_PLACEHOLDER.find((d) => d.event === tpl?.event), [tpl?.event]);

  useEffect(() => {
    if (tpl) {
      setSubject(tpl.subject); setBody(tpl.body);
      setRecipients({ notifyEmployee: tpl.notifyEmployee, notifyApprover: tpl.notifyApprover, notifyHrd: tpl.notifyHrd });
      setPreview(false);
    }
  }, [key, tpl]);

  const noRecipient = !recipients.notifyEmployee && !recipients.notifyApprover && !recipients.notifyHrd;

  // nilai contoh per placeholder → untuk pratinjau
  const contoh = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of phDefs) m[p.key] = p.contoh;
    return m;
  }, [phDefs]);

  const render = (text: string) => text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => contoh[k] ?? `{{${k}}}`);

  // sisipkan {{key}} pada posisi kursor textarea isi email
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
    if (!subject.trim()) { toast.error(t("Subjek tidak boleh kosong", "The subject cannot be empty")); return; }
    if (noRecipient) { toast.error(t("Pilih minimal satu penerima (Pengaju/Approver/HRD) — jika tidak, email tidak pernah terkirim", "Select at least one recipient (Requester/Approver/HRD) — otherwise the email will never be sent")); return; }
    setSaving(true);
    try {
      await apiSend("/api/onevity/email-templates", "PUT", { event: tpl.event, subject, body, ...recipients });
      toast.success(t("Template disimpan", "Template saved"));
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const fillDefault = () => {
    if (!defaultTpl) { toast.error(t("Tidak ada template default untuk event ini", "No default template for this event")); return; }
    setSubject(defaultTpl.subject); setBody(defaultTpl.body);
    setRecipients({ notifyEmployee: defaultTpl.notifyEmployee, notifyApprover: defaultTpl.notifyApprover, notifyHrd: defaultTpl.notifyHrd });
    toast.info(t("Template default dimuat — periksa lalu tekan Simpan Template", "Default template loaded — review it then press Save Template"));
  };

  // placeholder yang benar-benar terpakai di subjek+body (bukan cuma subjek)
  const usedKeys = useMemo(() => {
    const found = [...subject.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g), ...body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
    return [...new Set(found)];
  }, [subject, body]);
  const unknownKeys = usedKeys.filter((k) => !contoh[k]);

  return (
    <Dialog open={!!tpl} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <FileText className="h-4 w-4 ov-text-accent" /> {t("Edit Template", "Edit Template")} — {tpl?.label}
            {defaultTpl && (
              <Button type="button" variant="outline" size="sm" onClick={fillDefault} className="ml-auto h-7 gap-1.5 rounded-full px-3 text-[11px] font-bold">
                <RotateCcw className="h-3.5 w-3.5" /> {t("Muat Default", "Load Default")}
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold">{t("Penerima", "Recipients")}</Label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {([
                ["notifyEmployee", "Pengaju"],
                ["notifyApprover", "Approver"],
                ["notifyHrd", "HRD (CC)"],
              ] as const).map(([k, label]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <Switch checked={recipients[k]} onCheckedChange={(v) => setRecipients((r) => ({ ...r, [k]: v }))} aria-label={t(label, RECIPIENT_LABEL_EN[label] ?? label)} />
                  <span className="text-xs font-semibold">{t(label, RECIPIENT_LABEL_EN[label] ?? label)}</span>
                </div>
              ))}
            </div>
            {noRecipient && (
              <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" /> {t("Tidak ada penerima aktif — email event ini tidak akan pernah terkirim.", "No active recipient — emails for this event will never be sent.")}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{t("Subjek", "Subject")}</Label>
            {preview ? (
              <div className="rounded-lg border ov-border-accent ov-soft px-3 py-2 text-[13px] font-semibold">
                {render(subject) || <span className="italic text-stone-400">{t("(subjek kosong)", "(empty subject)")}</span>}
              </div>
            ) : (
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="text-[13px]" />
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">{t("Isi Email", "Email Body")}</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreview((p) => !p)} className="h-7 gap-1.5 rounded-full px-2.5 text-[11px] font-bold ov-text-accent hover:ov-soft">
                {preview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {preview ? t("Mode Edit", "Edit Mode") : t("Pratinjau", "Preview")}
              </Button>
            </div>
            {preview ? (
              <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border ov-border-accent ov-soft px-3 py-2.5 text-[13px] leading-relaxed">
                {render(body) || <span className="italic text-stone-400">{t("(isi kosong)", "(empty)")}</span>}
              </div>
            ) : (
              <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="text-[13px] leading-relaxed" />
            )}
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/60">
            <p className="font-bold text-stone-600 dark:text-stone-300">{t("Variabel untuk event ini — klik untuk menyisipkan ke kursor:", "Variables for this event — click to insert at the cursor:")}</p>
            {phDefs.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {phDefs.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    title={`${p.label} · contoh: ${p.contoh}`}
                    onClick={() => insertAtCursor(`{{${p.key}}}`)}
                    disabled={preview}
                    className="rounded-full border border-stone-300 bg-white px-2.5 py-1 font-mono text-[11px] font-bold text-stone-700 transition-colors hover:ov-soft hover:ov-border-accent disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                  >
                    {`{{${p.key}}}`}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-stone-500">{t("Event ini tidak memiliki variabel dinamis (teks sistem).", "This event has no dynamic variables (system text).")}</p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-stone-500 dark:text-stone-400">
              {t("Nilai variabel diisi otomatis dari data pengajuan saat email dikirim. Variabel tak dikenal tampil apa adanya.", "Variable values are filled automatically from request data when the email is sent. Unknown variables appear as-is.")}
            </p>
            {usedKeys.length > 0 && (
              <p className="mt-1.5 font-mono text-[10px] ov-text-accent">{t("terpakai: {v}", "in use: {v}", { v: usedKeys.map((p) => `{{${p}}}`).join(" ") || "—" })}</p>
            )}
            {unknownKeys.length > 0 && (
              <p className="mt-1 flex items-start gap-1.5 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {t("Variabel berikut tidak dikenali untuk event ini dan akan tampil sebagai teks mentah: {v}", "The following variables are not recognized for this event and will appear as raw text: {v}", { v: unknownKeys.map((p) => `{{${p}}}`).join(" ") })}
              </p>
            )}
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
  const { data, loading, refresh } = useApi<{ logs: EmailLogRow[]; total: number; stats: Record<string, number> }>("/api/onevity/email-logs?limit=100");

  const stats = data?.stats ?? {};
  const logs = data?.logs ?? [];

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
              <div>
                <p className="text-xl font-extrabold tabular-nums">{stats[key] ?? 0}</p>
                <p className="text-[11px] font-semibold text-stone-500">{t(label, labelEn)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4 ov-text-accent" /> {t("Riwayat Pengiriman", "Delivery History")}
          </CardTitle>
          <div className="flex items-center gap-2">
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
              <Mail className="mx-auto h-10 w-10 text-stone-300 dark:text-stone-600" />
              <p className="mt-3 text-sm font-bold text-stone-500">{t("Belum ada email terkirim", "No emails sent yet")}</p>
              <p className="mt-1 text-xs text-stone-400">{t("Notifikasi tercatat di sini setelah SMTP dikonfigurasi & pengajuan/approval terjadi.", "Notifications will appear here once SMTP is configured and requests/approvals happen.")}</p>
            </div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Waktu", "Time")}</TableHead>
                    <TableHead className="text-[11px] font-bold">Event</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Tujuan", "Recipient")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Subjek", "Subject")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell className="whitespace-nowrap text-[11px] text-stone-500">{fmtDate(l.createdAt)}</TableCell>
                      <TableCell className="font-mono text-[10px] text-stone-500">{l.event}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-[12px] font-semibold">{l.toEmail}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-[12px] text-stone-600 dark:text-stone-400">
                        <span title={l.error ?? l.subject}>{l.subject}</span>
                      </TableCell>
                      <TableCell>
                        {l.status === "Sent" ? <StatusPill status="Sent" />
                          : l.status === "Failed" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-extrabold text-rose-600 dark:bg-rose-500/15 dark:text-rose-400" title={l.error ?? undefined}>
                              <XCircle className="h-3 w-3" /> {t("Gagal")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-extrabold text-stone-500 dark:bg-stone-800 dark:text-stone-400" title={l.error ?? undefined}>
                              <MinusCircle className="h-3 w-3" /> Skipped
                            </span>
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
    </div>
  );
}
