"use client";
// RekanKerja — API & INTEGRASI (T18-API) ===================================
// ========================================================================
// Menu Pengaturan Sistem → "API & Integrasi". 2 seksi:
//   1. API Keys  — kunci Public REST API (x-api-key): buat (scope pilihan,
//      kunci penuh tampil SEKALI dgn peringatan salin), daftar, cabut.
//   2. Webhooks  — endpoint penerima event HRIS: tambah/edit (URL, events
//      multi-check, secret auto-generate, toggle aktif), uji kirim, hapus,
//      + 10 log pengiriman terakhir (Sent/Failed, HTTP status).
// Guard server: menu settings:api + HANYA Admin platform / AppUser Admin.
// ========================================================================
import { useState } from "react";
import { useApi, apiSend, fmtDate, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  KeyRound, Webhook, Plus, Ban, Pencil, Trash2, Send, Copy, Check, Eye, EyeOff,
  RefreshCw, ShieldAlert, Zap, History, Clock3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

// ---------- tipe ----------

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  createdAt: string;
}

interface WebhookLogRow {
  id: string;
  webhookId: string;
  event: string;
  status: string;
  responseStatus: number | null;
  error: string | null;
  // Fix audit 40 M-14 — fields retry/backoff dari webhook-service.
  attempts?: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  createdAt: string;
}

interface EventsResp {
  keys: ApiKeyRow[];
  scopes: string[];
  webhooks: WebhookRow[];
  logs: WebhookLogRow[];
  events: { key: string; label: string }[];
}

const SCOPE_HINT: Record<string, string> = {
  employees: "GET /api/public/employees · /api/public/employees/{id}",
  leave: "GET/POST /api/public/leave-requests · GET /api/public/leave-balances",
  payroll: "GET /api/public/payroll-periods",
};

// ---------- halaman utama ----------

export function ApiKeysView() {
  const { t } = useI18n();
  const [tab, setTab] = useState("keys");
  const tabCls = "gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill";

  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("API & Integrasi", "API & Integrations")}
        description={t(
          "Kunci Public REST API (header x-api-key, scope employees/leave/payroll, rate limit 60 req/menit) dan webhook event HRIS (cuti, payroll, izin) dengan tanda tangan HMAC-SHA256.",
          "Public REST API keys (x-api-key header, employees/leave/payroll scopes, 60 req/min rate limit) and HRIS event webhooks (leave, payroll, work-off) signed with HMAC-SHA256.",
        )}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto max-w-full overflow-x-auto rounded-2xl ov-tile p-1.5">
          <TabsTrigger value="keys" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <KeyRound className="h-3.5 w-3.5" /> {t("Kunci API", "API Keys")}
          </TabsTrigger>
          <TabsTrigger value="webhooks" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <Webhook className="h-3.5 w-3.5" /> {t("Webhook & Log", "Webhooks & Logs")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="keys"><ApiKeysPanel /></TabsContent>
        <TabsContent value="webhooks"><WebhooksPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// ================= SEKSI 1: API KEYS =================

function ApiKeysPanel() {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ keys: ApiKeyRow[]; scopes: string[] }>("/api/rekankerja/api-keys");
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<{ key: string; record: ApiKeyRow } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const revoke = async (k: ApiKeyRow) => {
    if (revoking) return;
    setRevoking(k.id);
    try {
      await apiSend("/api/rekankerja/api-keys", "PATCH", { id: k.id, action: "revoke" });
      toast.success(t("Kunci {p}… dicabut — request berikutnya ditolak (401)", "Key {p}… revoked — further requests rejected (401)", { p: k.prefix }));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRevoking(null);
    }
  };

  if (loading && !data) return <LoadingRows rows={5} />;
  const keys = data?.keys ?? [];

  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <KeyRound className="h-4 w-4 ov-text-accent" /> {t("Kunci Public API", "Public API Keys")}
        </CardTitle>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 font-bold" size="sm">
          <Plus className="h-4 w-4" /> {t("Kunci Baru", "New Key")}
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {keys.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t("Belum ada kunci API", "No API keys yet")}
            description={t("Buat kunci untuk mengakses Public REST API RekanKerja (GET employees, leave, payroll + POST leave-requests).", "Create a key to access the RekanKerja public REST API (GET employees, leave, payroll + POST leave-requests).")}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                  <TableHead className="text-[11px] font-bold">{t("Nama")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Kunci (prefix)")}</TableHead>
                  <TableHead className="text-[11px] font-bold">Scope</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Terakhir Dipakai", "Last Used")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Dibuat", "Created")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id} className={cn("hover:bg-slate-50 dark:hover:bg-slate-900/60", k.revokedAt && "opacity-60")}>
                    <TableCell className="text-[13px] font-semibold">{k.name}</TableCell>
                    <TableCell className="font-mono text-[11px] text-slate-500">{k.prefix}…</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant="secondary" className="rounded-full px-2 text-[10px] font-bold">{s}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : "—"}</TableCell>
                    <TableCell className="text-xs text-slate-500">{fmtDate(k.createdAt)}</TableCell>
                    <TableCell>
                      {k.revokedAt ? (
                        <Badge className="gap-1 rounded-full bg-rose-100 px-2 text-[10px] font-extrabold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                          <Ban className="h-3 w-3" /> {t("DICABUT", "REVOKED")}
                        </Badge>
                      ) : (
                        <Badge className="gap-1 rounded-full bg-brand/15 px-2 text-[10px] font-extrabold text-brand-deep dark:bg-brand/15 dark:text-brand/75">
                          <Check className="h-3 w-3" /> {t("AKTIF", "ACTIVE")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!k.revokedAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => revoke(k)}
                          disabled={revoking === k.id}
                          className="h-7 gap-1.5 rounded-lg border-rose-200 px-2 text-[11px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                        >
                          <Ban className="h-3.5 w-3.5" /> {revoking === k.id ? t("Mencabut…", "Revoking…") : t("Cabut", "Revoke")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          {t(
            "Kirim header x-api-key pada /api/public/*. Kunci penuh hanya tampil SEKALI saat dibuat — hash SHA-256 yang disimpan, bukan kuncinya.",
            "Send the x-api-key header on /api/public/*. The full key is shown only ONCE at creation — the stored value is its SHA-256 hash, never the key itself.",
          )}
        </p>
      </CardContent>

      <ApiKeyCreateDialog
        open={createOpen}
        setOpen={(v) => { setCreateOpen(v); if (!v) refresh(); }}
        scopes={data?.scopes ?? ["employees", "leave", "payroll"]}
        onCreated={(c) => setCreated(c)}
      />
      <KeyRevealDialog created={created} onClose={() => setCreated(null)} />
    </Card>
  );
}

function ApiKeyCreateDialog({
  open, setOpen, scopes, onCreated,
}: { open: boolean; setOpen: (v: boolean) => void; scopes: string[]; onCreated: (c: { key: string; record: ApiKeyRow }) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>(["employees"]);
  const [saving, setSaving] = useState(false);

  const toggle = (s: string) => {
    setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  };

  const submit = async () => {
    if (!name.trim()) { toast.error(t("Nama kunci wajib diisi", "Key name is required")); return; }
    if (selected.length === 0) { toast.error(t("Pilih minimal satu scope", "Select at least one scope")); return; }
    setSaving(true);
    try {
      const res = await apiSend<{ key: string; record: ApiKeyRow }>("/api/rekankerja/api-keys", "POST", {
        name: name.trim(), scopes: selected,
      });
      onCreated(res);
      setOpen(false);
      setName("");
      setSelected(["employees"]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">{t("Kunci API Baru", "New API Key")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">{t("Nama Kunci *", "Key Name *")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" placeholder={t("cth: Integrasi Absensi", "e.g. Attendance Integration")} />
          </div>
          <div>
            <Label className="text-xs">{t("Scope (hak akses endpoint)", "Scopes (endpoint access)")}</Label>
            <div className="mt-2 space-y-2">
              {scopes.map((s) => (
                <label key={s} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/60">
                  <Checkbox checked={selected.includes(s)} onCheckedChange={() => toggle(s)} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold">{s}</span>
                    <span className="block truncate font-mono text-[10px] text-slate-400">{SCOPE_HINT[s] ?? s}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={saving} className="font-bold">{saving ? t("Membuat…", "Creating…") : t("Buat Kunci", "Create Key")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Kunci penuh tampil SEKALI — dgn peringatan salin (tidak bisa dilihat lagi). */
function KeyRevealDialog({ created, onClose }: { created: { key: string; record: ApiKeyRow } | null; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  // reset state saat kunci baru masuk (pola derived-state LookupDialog)
  const [syncKey, setSyncKey] = useState<string | null>(null);
  if (created && syncKey !== created.key) { setSyncKey(created.key); setCopied(false); setShown(true); }

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      toast.success(t("Kunci disalin ke clipboard", "Key copied to clipboard"));
    } catch {
      toast.error(t("Gagal menyalin — blok & salin manual", "Copy failed — select & copy manually"));
    }
  };

  return (
    <Dialog open={!!created} onOpenChange={(v) => { if (!v) { setSyncKey(null); onClose(); } }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-amber-500" /> {t("Simpan Kunci Ini Sekarang", "Save This Key Now")}
          </DialogTitle>
        </DialogHeader>
        {created && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {t(
                "Kunci penuh hanya ditampilkan SEKALI ini. RekanKerja menyimpan hash SHA-256 saja — kunci yang hilang tidak bisa dilihat kembali; buat kunci baru bila hilang.",
                "This is the only time the full key is shown. RekanKerja stores only its SHA-256 hash — a lost key cannot be recovered; create a new one instead.",
              )}
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label className="text-xs">{created.record.name} — <span className="font-mono">{created.record.prefix}…</span></Label>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setShown((s) => !s)} className="h-7 gap-1 px-2 text-[11px]">
                    {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {shown ? t("Sembunyikan", "Hide") : t("Tampilkan", "Show")}
                  </Button>
                  <Button size="sm" onClick={copy} className="h-7 gap-1 px-2 text-[11px] font-bold">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {t("Salin", "Copy")}
                  </Button>
                </div>
              </div>
              <div className="break-all rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] dark:border-slate-800 dark:bg-slate-900/60">
                {shown ? created.key : `${created.key.slice(0, 12)}${"•".repeat(24)}`}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900/40">
              {t("Contoh pemakaian:", "Usage example:")}{" "}
              <code className="font-mono">curl -H &quot;x-api-key: {created.key.slice(0, 12)}…&quot; {`$BASE/api/public/employees`}</code>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => { setSyncKey(null); onClose(); }} className="font-bold">{t("Saya Sudah Menyimpan", "I Saved It")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= SEKSI 2: WEBHOOKS =================

function newSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `whsec_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function WebhooksPanel() {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<EventsResp>("/api/rekankerja/webhooks?logLimit=10");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookRow | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const test = async (w: WebhookRow) => {
    if (testing) return;
    setTesting(w.id);
    try {
      const res = await apiSend<{ ok: boolean; status: number | null; error: string | null }>("/api/rekankerja/webhooks", "POST", {
        action: "test", id: w.id,
      });
      if (res.ok) toast.success(t("Ping terkirim (HTTP {s})", "Ping sent (HTTP {s})", { s: res.status ?? 200 }));
      else toast.error(t("Ping gagal: {e}", "Ping failed: {e}", { e: res.error ?? `HTTP ${res.status}` }));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    } finally {
      setTesting(null);
    }
  };

  const toggleActive = async (w: WebhookRow) => {
    try {
      await apiSend("/api/rekankerja/webhooks", "PATCH", { id: w.id, isActive: !w.isActive });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (w: WebhookRow) => {
    try {
      await apiSend(`/api/rekankerja/webhooks?id=${w.id}`, "DELETE");
      toast.success(t("Webhook dihapus", "Webhook deleted"));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (loading && !data) return <LoadingRows rows={5} />;
  const webhooks = data?.webhooks ?? [];
  const logs = data?.logs ?? [];
  const events = data?.events ?? [];

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Webhook className="h-4 w-4 ov-text-accent" /> {t("Endpoint Webhook", "Webhook Endpoints")}
          </CardTitle>
          <Button onClick={() => setAddOpen(true)} className="gap-2 font-bold" size="sm">
            <Plus className="h-4 w-4" /> {t("Webhook Baru", "New Webhook")}
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {webhooks.length === 0 ? (
            <EmptyState
              icon={Webhook}
              title={t("Belum ada webhook", "No webhooks yet")}
              description={t("Tambahkan endpoint HTTPS untuk menerima event cuti, payroll & izin secara otomatis (POST + tanda tangan HMAC).", "Add an HTTPS endpoint to automatically receive leave, payroll & work-off events (POST + HMAC signature).")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[11px] font-bold">URL</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Event", "Events")}</TableHead>
                    <TableHead className="text-[11px] font-bold">Secret</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Aktif", "Active")}</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webhooks.map((w) => (
                    <TableRow key={w.id} className={cn("hover:bg-slate-50 dark:hover:bg-slate-900/60", !w.isActive && "opacity-60")}>
                      <TableCell className="max-w-[280px] truncate font-mono text-[11px]" title={w.url}>{w.url}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {w.events.map((e) => (
                            <Badge key={e} variant="secondary" className="rounded-full px-2 font-mono text-[9px] font-bold">{e}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate font-mono text-[10px] text-slate-400" title={`${w.secret.slice(0, 10)}…`}>{w.secret.slice(0, 10)}…</TableCell>
                      <TableCell><Switch checked={w.isActive} onCheckedChange={() => toggleActive(w)} aria-label={t("Toggle aktif", "Toggle active")} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" onClick={() => test(w)} disabled={testing === w.id} className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-bold">
                            <Send className="h-3.5 w-3.5" /> {testing === w.id ? t("Mengirim…", "Sending…") : t("Uji Kirim", "Test Send")}
                          </Button>
                          <button onClick={() => setEditing(w)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => remove(w)} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label={t("Hapus")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            {t(
              "Tiap event dikirim POST JSON dgn header X-RekanKerja-Event & X-RekanKerja-Signature = HMAC-SHA256(secret, body) hex — verifikasi signature di sisi Anda. Timeout 5 detik.",
              "Each event is POSTed as JSON with X-RekanKerja-Event & X-RekanKerja-Signature = HMAC-SHA256(secret, body) hex headers — verify the signature on your side. 5-second timeout.",
            )}
          </p>
        </CardContent>
        <WebhookDialog
          open={addOpen}
          setOpen={(v) => { setAddOpen(v); if (!v) refresh(); }}
          events={events}
          item={null}
        />
        <WebhookDialog
          open={!!editing}
          setOpen={(v) => { if (!v) { setEditing(null); refresh(); } }}
          events={events}
          item={editing}
        />
      </Card>

      {/* log pengiriman terakhir */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4 ov-text-accent" /> {t("Log Pengiriman (10 terakhir)", "Delivery Log (last 10)")}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={refresh} className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-bold">
            <RefreshCw className="h-3.5 w-3.5" /> {t("Muat Ulang", "Reload")}
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {logs.length === 0 ? (
            <EmptyState
              icon={History}
              title={t("Belum ada pengiriman", "No deliveries yet")}
              description={t("Log muncul setelah event webhook terjadi (atau tekan Uji Kirim).", "Logs appear once a webhook event fires (or press Test Send).")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Waktu", "Time")}</TableHead>
                    <TableHead className="text-[11px] font-bold">Event</TableHead>
                    <TableHead className="text-[11px] font-bold">URL</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                    <TableHead className="text-[11px] font-bold">HTTP</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Galat", "Error")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => {
                    const hook = webhooks.find((w) => w.id === l.webhookId);
                    return (
                      <TableRow key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <TableCell className="text-xs text-slate-500">{fmtDateTime(l.createdAt)}</TableCell>
                        <TableCell><Badge variant="secondary" className="rounded-full px-2 font-mono text-[9px] font-bold">{l.event}</Badge></TableCell>
                        <TableCell className="max-w-[200px] truncate font-mono text-[10px] text-slate-400" title={hook?.url ?? l.webhookId}>{hook?.url ?? l.webhookId}</TableCell>
                        <TableCell>
                          {/* Fix audit 40 M-14 — status log webhook kini granular:
                              delivered / failed / dead (max retry) / pending retry /
                              "Sent" (legacy pre-retry era). */}
                          {l.status === "Sent" || l.status === "delivered" ? (
                            <Badge className="gap-1 rounded-full bg-brand/15 px-2 text-[10px] font-extrabold text-brand-deep dark:bg-brand/15 dark:text-brand/75"><Check className="h-3 w-3" /> {l.status === "delivered" ? "Delivered" : "Sent"}</Badge>
                          ) : l.status === "failed" || l.status === "pending" ? (
                            <Badge className="gap-1 rounded-full bg-amber-100 px-2 text-[10px] font-extrabold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"><Clock3 className="h-3 w-3" /> Retry {l.attempts ?? 1}/5</Badge>
                          ) : (
                            <Badge className="gap-1 rounded-full bg-rose-100 px-2 text-[10px] font-extrabold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"><Ban className="h-3 w-3" /> Dead</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-slate-500">{l.responseStatus ?? "—"}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-[11px] text-rose-500" title={l.error ?? ""}>{l.error ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            <Zap className="mr-1 inline h-3 w-3 text-amber-500" />
            {t("Maks 500 baris log disimpan per tenant — terlama dihapus otomatis.", "At most 500 log rows are kept per tenant — oldest trimmed automatically.")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function WebhookDialog({
  open, setOpen, events, item,
}: { open: boolean; setOpen: (v: boolean) => void; events: { key: string; label: string }[]; item: WebhookRow | null }) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [secret, setSecret] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  // sinkron form saat dialog dibuka / item berganti (pola derived-state LookupDialog)
  const [syncKey, setSyncKey] = useState("");
  const itemKey = item?.id ?? "new";
  if (open && syncKey !== itemKey) {
    setSyncKey(itemKey);
    setUrl(item?.url ?? "");
    setSelected(item?.events ?? ["leave.submitted", "leave.approved"]);
    setSecret(item?.secret ?? newSecret());
    setIsActive(item?.isActive ?? true);
  }

  const toggle = (k: string) => {
    setSelected((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  };

  const submit = async () => {
    if (!url.trim()) { toast.error(t("URL webhook wajib diisi", "Webhook URL is required")); return; }
    if (selected.length === 0) { toast.error(t("Pilih minimal satu event", "Select at least one event")); return; }
    setSaving(true);
    try {
      if (item) {
        await apiSend("/api/rekankerja/webhooks", "PATCH", { id: item.id, url: url.trim(), events: selected, secret, isActive });
        toast.success(t("Webhook diperbarui", "Webhook updated"));
      } else {
        await apiSend("/api/rekankerja/webhooks", "POST", { url: url.trim(), events: selected, secret, isActive });
        toast.success(t("Webhook ditambahkan", "Webhook added"));
      }
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{item ? t("Edit Webhook", "Edit Webhook") : t("Webhook Baru", "New Webhook")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">URL *</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1.5 font-mono text-[12px]" placeholder="https://contoh.co.id/rekankerja/hooks" />
          </div>
          <div>
            <Label className="text-xs">{t("Event yang dilanggan *", "Subscribed events *")}</Label>
            <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {events.map((e) => (
                <label key={e.key} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 p-2.5 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/60">
                  <Checkbox checked={selected.includes(e.key)} onCheckedChange={() => toggle(e.key)} />
                  <span className="min-w-0">
                    <span className="block font-mono text-[11px] font-bold">{e.key}</span>
                    <span className="block text-[11px] text-slate-400">{e.label}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-xs">{t("Secret (HMAC)", "Secret (HMAC)")}</Label>
              <Button variant="outline" size="sm" onClick={() => setSecret(newSecret())} className="h-7 gap-1 px-2 text-[11px] font-bold">
                <RefreshCw className="h-3 w-3" /> {t("Buat Baru", "Regenerate")}
              </Button>
            </div>
            <Input value={secret} onChange={(e) => setSecret(e.target.value)} className="font-mono text-[11px]" placeholder="whsec_…" />
            <p className="mt-1.5 text-[11px] text-slate-400">
              {t("Dipakai menghitung X-RekanKerja-Signature = HMAC-SHA256(secret, body). Ganti = penerima harus update verifikasi.", "Used to compute X-RekanKerja-Signature = HMAC-SHA256(secret, body). Changing it requires receivers to update verification.")}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex items-start gap-2.5">
              <Zap className="mt-0.5 h-4 w-4 text-amber-500" />
              <div>
                <p className="text-[13px] font-bold">{t("Webhook Aktif", "Webhook Active")}</p>
                <p className="text-[11px] text-slate-500">{t("Event dikirim hanya saat aktif.", "Events are delivered only when active.")}</p>
              </div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label={t("Toggle aktif", "Toggle active")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={saving} className="font-bold">{saving ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
