"use client";
// OneVity — KONFIGURASI EMAIL (Task 34) =================================
// ========================================================================
// Menu Pengaturan Sistem → "Konfigurasi Email". Sistem mengirim email
// otomatis saat ada pengajuan / persetujuan (cuti, travel, klaim medis,
// payroll). 3 tab: Server SMTP · Template & Pemicu · Riwayat Kirim.
// ========================================================================
import { useEffect, useMemo, useState } from "react";
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
  Pencil, Save, KeyRound, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

// ---------- halaman utama ----------

export function EmailConfigView() {
  const [tab, setTab] = useState("server");
  const tabCls = "gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400";

  return (
    <div>
      <PageHeader
        eyebrow="PENGATURAN"
        title="Konfigurasi Email"
        description="Pengaturan SMTP & notifikasi otomatis — sistem mengirim email saat ada pengajuan cuti, perjalanan dinas, klaim medis, dan konfirmasi payroll."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto max-w-full overflow-x-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
          <TabsTrigger value="server" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <Server className="h-3.5 w-3.5" /> Server SMTP
          </TabsTrigger>
          <TabsTrigger value="templates" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <FileText className="h-3.5 w-3.5" /> Template & Pemicu
          </TabsTrigger>
          <TabsTrigger value="logs" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <History className="h-3.5 w-3.5" /> Riwayat Kirim
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
      toast.success("Konfigurasi email disimpan" + (form.active ? " — notifikasi otomatis aktif" : ""));
      setForm((f) => ({ ...f, smtpPassword: "" }));
      setLoaded(false);
      refresh();
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  };

  const test = async () => {
    if (!testTo.includes("@")) { toast.error("Isi alamat email tujuan uji"); return; }
    setTesting(true);
    try {
      const res = await apiSend("/api/onevity/email-config", "POST", { to: testTo }) as { ok?: boolean; message?: string };
      if (res?.ok) toast.success(res.message ?? "Email uji terkirim");
      else toast.error(res?.message ?? "Pengiriman gagal");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    } finally { setTesting(false); }
  };

  if (loading && !cfg) return <LoadingRows rows={5} />;

  const statusBadge = cfg?.active
    ? <Badge className="gap-1 rounded-full bg-emerald-100 px-2 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" /> AKTIF</Badge>
    : <Badge className="gap-1 rounded-full bg-stone-100 px-2 text-[10px] font-extrabold text-stone-500 dark:bg-stone-800 dark:text-stone-400"><MinusCircle className="h-3 w-3" /> NONAKTIF</Badge>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Server className="h-4 w-4 text-emerald-600" /> Server SMTP & Pengirim
          </CardTitle>
          {statusBadge}
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <div className="flex items-start gap-3">
              <Zap className="mt-0.5 h-4 w-4 text-amber-500" />
              <div>
                <p className="text-[13px] font-bold">Kirim Email Otomatis</p>
                <p className="text-xs text-stone-500">Sistem mengirim email tiap ada pengajuan / persetujuan (cuti, travel, klaim medis, payroll)</p>
              </div>
            </div>
            <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} aria-label="Aktifkan email otomatis" />
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
              <Label className="text-xs font-semibold">Username SMTP</Label>
              <Input value={form.smtpUser} onChange={(e) => setForm((f) => ({ ...f, smtpUser: e.target.value }))} placeholder="user@perusahaan.co.id" className="text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Password SMTP {cfg?.hasPassword && <span className="ml-1 font-normal text-emerald-600">(tersimpan — kosongkan agar tetap)</span>}
              </Label>
              <Input type="password" value={form.smtpPassword} onChange={(e) => setForm((f) => ({ ...f, smtpPassword: e.target.value }))} placeholder={cfg?.hasPassword ? "••••••••••" : "app password / sandi SMTP"} className="text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Email Pengirim (From) *</Label>
              <Input value={form.fromEmail} onChange={(e) => setForm((f) => ({ ...f, fromEmail: e.target.value }))} placeholder="hris@perusahaan.co.id" className="text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Nama Pengirim</Label>
              <Input value={form.fromName} onChange={(e) => setForm((f) => ({ ...f, fromName: e.target.value }))} placeholder="OneVity HRIS" className="text-[13px]" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={form.smtpSecure} onCheckedChange={(v) => setForm((f) => ({ ...f, smtpSecure: v }))} aria-label="Gunakan TLS" />
            <Label className="text-xs">Gunakan TLS implicit (port 465). Port 587 biasanya STARTTLS — biarkan mati.</Label>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={save} disabled={saving} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
              <Save className="h-4 w-4" /> {saving ? "Menyimpan…" : "Simpan Konfigurasi"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold"><Send className="h-4 w-4 text-emerald-600" /> Tes Kirim Email</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Email Tujuan Uji</Label>
              <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="nama@email.com" className="text-[13px]" />
            </div>
            <Button onClick={test} disabled={testing} className="w-full gap-2 bg-teal-600 font-bold hover:bg-teal-700">
              <Send className="h-4 w-4" /> {testing ? "Mengirim…" : "Kirim Email Uji"}
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
                  Tes terakhir {fmtDate(cfg.lastTestAt)}
                </p>
                {cfg.lastTestMessage && <p className="mt-1 break-words opacity-80">{cfg.lastTestMessage}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-stone-200/80 bg-stone-50/60 shadow-sm dark:border-stone-800 dark:bg-stone-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold"><Mail className="h-4 w-4 text-teal-600" /> Petunjuk Cepat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
            <p><b className="text-stone-700 dark:text-stone-300">Gmail:</b> aktifkan 2FA lalu buat <i>App Password</i> (16 huruf) — isi sebagai password SMTP, host <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">smtp.gmail.com</code> port 587.</p>
            <p><b className="text-stone-700 dark:text-stone-300">Office365:</b> host <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">smtp.office365.com</code> port 587.</p>
            <p><b className="text-stone-700 dark:text-stone-300">Relay internal:</b> isi host server email perusahaan.</p>
            <p>Selama SMTP belum diisi, setiap pemicu notifikasi dicatat sebagai <i>Skipped</i> di Riwayat Kirim — proses approval tetap berjalan normal.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ================= TAB 2: TEMPLATE & PEMICU =================

function TemplatesPanel() {
  const { data, loading, refresh } = useApi<{ templates: EmailTemplateRow[] }>("/api/onevity/email-templates");
  const [editing, setEditing] = useState<EmailTemplateRow | null>(null);
  const [search, setSearch] = useState("");

  const templates = data?.templates ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.event.toLowerCase().includes(q) || t.label.toLowerCase().includes(q));
  }, [templates, search]);

  const groups = useMemo(() => {
    const g: Record<string, EmailTemplateRow[]> = {};
    for (const t of filtered) {
      const mod = t.event.split(".")[0];
      (g[mod] ??= []).push(t);
    }
    return g;
  }, [filtered]);

  const MODULE_LABEL: Record<string, string> = { leave: "Cuti", travel: "Perjalanan Dinas", medical: "Klaim Medis", payroll: "Payroll", user: "Pengguna" };

  const toggleActive = async (t: EmailTemplateRow) => {
    try {
      await apiSend("/api/onevity/email-templates", "PUT", { event: t.event, active: !t.active });
      toast.success(`Template "${t.label}" ${!t.active ? "diaktifkan" : "dinonaktifkan"}`);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  if (loading && !data) return <LoadingRows rows={5} />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari event / template…"
          className="h-9 w-full max-w-xs rounded-xl text-[13px]"
        />
        <Badge variant="secondary" className="rounded-full font-mono text-[10px]">{templates.length} template</Badge>
        <Badge className="rounded-full bg-emerald-100 px-2 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          {templates.filter((t) => t.active).length} aktif
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(groups).map(([mod, items]) => (
          <Card key={mod} className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <FileText className="h-4 w-4 text-emerald-600" /> {MODULE_LABEL[mod] ?? mod}
                <Badge variant="secondary" className="ml-auto rounded-full font-mono text-[10px]">{items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {items.map((t) => (
                <div key={t.id} className={cn(
                  "rounded-xl border p-3 transition",
                  t.active ? "border-stone-200 bg-white hover:border-emerald-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-emerald-500/40"
                           : "border-stone-200 bg-stone-50 opacity-70 dark:border-stone-800 dark:bg-stone-900/50",
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold">{t.label}</p>
                      <p className="truncate font-mono text-[10px] text-stone-400">{t.event}</p>
                      <p className="mt-1 truncate text-[11px] text-stone-500">{t.subject}</p>
                    </div>
                    <Switch checked={t.active} onCheckedChange={() => toggleActive(t)} aria-label={`Toggle ${t.label}`} />
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    {t.notifyEmployee && <Badge variant="secondary" className="rounded-full text-[9px] font-bold">Pengaju</Badge>}
                    {t.notifyApprover && <Badge variant="secondary" className="rounded-full text-[9px] font-bold">Approver</Badge>}
                    {t.notifyHrd && <Badge variant="secondary" className="rounded-full text-[9px] font-bold">HRD</Badge>}
                    <button
                      onClick={() => setEditing(t)}
                      className="ml-auto rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
                      aria-label={`Edit template ${t.label}`}
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
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState({ notifyEmployee: true, notifyApprover: true, notifyHrd: false });
  const [saving, setSaving] = useState(false);
  const key = tpl?.id ?? "none";

  useEffect(() => {
    if (tpl) {
      setSubject(tpl.subject); setBody(tpl.body);
      setRecipients({ notifyEmployee: tpl.notifyEmployee, notifyApprover: tpl.notifyApprover, notifyHrd: tpl.notifyHrd });
    }
  }, [key, tpl]);

  const save = async () => {
    if (!tpl) return;
    if (!subject.trim()) { toast.error("Subjek tidak boleh kosong"); return; }
    setSaving(true);
    try {
      await apiSend("/api/onevity/email-templates", "PUT", { event: tpl.event, subject, body, ...recipients });
      toast.success("Template disimpan");
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const placeholders = useMemo(() => {
    const found = [...subject.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
    return [...new Set([...found, ...tpl?.label.toLowerCase().includes("cuti") ? ["nama", "docNo", "periode"] : []])].slice(0, 8);
  }, [subject, tpl]);

  return (
    <Dialog open={!!tpl} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-emerald-600" /> Edit Template — {tpl?.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold">Penerima</Label>
            <div className="mt-2 flex flex-wrap gap-3">
              {([
                ["notifyEmployee", "Pengaju"],
                ["notifyApprover", "Approver"],
                ["notifyHrd", "HRD (CC)"],
              ] as const).map(([k, label]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <Switch checked={recipients[k]} onCheckedChange={(v) => setRecipients((r) => ({ ...r, [k]: v }))} aria-label={label} />
                  <span className="text-xs font-semibold">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Subjek</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Isi Email</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="text-[13px] leading-relaxed" />
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-3 text-[11px] dark:border-stone-800 dark:bg-stone-900/60">
            <p className="font-bold text-stone-600 dark:text-stone-300">Placeholder yang tersedia:</p>
            <p className="mt-1 leading-relaxed text-stone-500">
              <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">{"{{nama}}"}</code>{" "}
              <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">{"{{docNo}}"}</code>{" "}
              <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">{"{{periode}}"}</code>{" "}
              <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">{"{{jumlah}}"}</code>{" "}
              <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">{"{{catatan}}"}</code>{" "}
              <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">{"{{status}}"}</code>
              {" "}— placeholder tak dikenal ditampilkan apa adanya.
            </p>
            {placeholders.length > 0 && (
              <p className="mt-1.5 font-mono text-[10px] text-emerald-600">terpakai: {placeholders.map((p) => `{{${p}}}`).join(" ")}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Save className="h-4 w-4" /> {saving ? "Menyimpan…" : "Simpan Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= TAB 3: RIWAYAT KIRIM =================

function LogsPanel() {
  const { data, loading, refresh } = useApi<{ logs: EmailLogRow[]; total: number; stats: Record<string, number> }>("/api/onevity/email-logs?limit=100");

  const stats = data?.stats ?? {};
  const logs = data?.logs ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ["Sent", "Terkirim", CheckCircle2, "text-emerald-600"],
          ["Failed", "Gagal", XCircle, "text-rose-500"],
          ["Skipped", "Dilewati", MinusCircle, "text-stone-400"],
        ] as const).map(([key, label, Icon, cls]) => (
          <Card key={key} className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={cn("rounded-xl bg-stone-50 p-2.5 dark:bg-stone-900", cls)}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xl font-extrabold tabular-nums">{stats[key] ?? 0}</p>
                <p className="text-[11px] font-semibold text-stone-500">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4 text-emerald-600" /> Riwayat Pengiriman
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="rounded-full font-mono text-[10px]">total {data?.total ?? 0}</Badge>
            <Button variant="outline" size="sm" onClick={refresh} className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold">
              <History className="h-3 w-3" /> Muat Ulang
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading && !data ? (
            <LoadingRows rows={6} />
          ) : logs.length === 0 ? (
            <div className="py-10 text-center">
              <Mail className="mx-auto h-10 w-10 text-stone-300 dark:text-stone-600" />
              <p className="mt-3 text-sm font-bold text-stone-500">Belum ada email terkirim</p>
              <p className="mt-1 text-xs text-stone-400">Notifikasi tercatat di sini setelah SMTP dikonfigurasi & pengajuan/approval terjadi.</p>
            </div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Waktu</TableHead>
                    <TableHead className="text-[11px] font-bold">Event</TableHead>
                    <TableHead className="text-[11px] font-bold">Tujuan</TableHead>
                    <TableHead className="text-[11px] font-bold">Subjek</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
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
                              <XCircle className="h-3 w-3" /> Gagal
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
