"use client";
// =====================================================================
// RekanKerja — PENGATURAN AI (Task 96) ===============================
// =====================================================================
// Dua halaman (menu Pengaturan Sistem → AI & Pengetahuan):
//   • AiProviderView  — Provider AI per tenant: bawaan RekanKerja ATAU
//     endpoint OpenAI-compatible milik perusahaan sendiri (baseUrl +
//     model + API key TERENKRIPSI — key tidak pernah dikirim balik ke
//     client, hanya penanda sudah/tidak disetel). Tombol Tes Koneksi.
//   • AiKnowledgeView — Basis Pengetahuan AI: dokumen kebijakan internal
//     (SOP, kebijakan cuti, panduan klaim…) yang diinjeksi ke system
//     prompt chatbot (RAG skor kata-kunci) agar jawaban makin smart.
import { useEffect, useState } from "react";
import { useApi, apiSend, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { PageHeader, StatusPill, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Bot, BookOpen, FlaskConical, Headset, KeyRound, Plus, Pencil, Trash2, Loader2, Sparkles, FileText } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

// ================= PROVIDER AI =================

interface ProviderConfig {
  provider: "builtin" | "openai";
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  updatedAt: string;
}

export function AiProviderView() {
  const { t } = useI18n();
  const cfg = useApi<{ config: ProviderConfig }>("/api/rekankerja/ai/provider-config");
  const [provider, setProvider] = useState<"builtin" | "openai">("builtin");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (cfg.data?.config && !loaded) {
      const c = cfg.data.config;
      setProvider(c.provider);
      setBaseUrl(c.baseUrl ?? "");
      setModel(c.model ?? "");
      setEnabled(c.enabled);
      setLoaded(true);
    }
  }, [cfg.data, loaded]);

  const save = async () => {
    setSaving(true);
    try {
      await apiSend("/api/rekankerja/ai/provider-config", "PUT", {
        provider, baseUrl, model, enabled,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      toast.success(t("Konfigurasi provider AI tersimpan", "AI provider configuration saved"));
      setApiKey("");
      cfg.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await apiSend<{ ok: boolean; reply: string }>("/api/rekankerja/ai/provider-config?action=test", "GET");
      toast.success(res.reply);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Tes koneksi gagal", "Connection test failed"));
    } finally {
      setTesting(false);
    }
  };

  const c = cfg.data?.config;

  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("Provider AI", "AI Provider")}
        description={t(
          "Pilih penyedia AI untuk seluruh fitur chat RekanKerja tenant ini — setiap perusahaan boleh memakai provider sendiri.",
          "Choose the AI provider for all RekanKerja chat features of this tenant — each company may use its own provider.",
        )}
      />
      <div className="mx-auto max-w-3xl space-y-4 px-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <Sparkles className="h-4 w-4 text-brand" aria-hidden />
              {t("Penyedia", "Provider")}
              {c && <StatusPill status={c.enabled ? "Active" : "Inactive"} />}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {cfg.loading ? (
              <LoadingRows rows={3} />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={() => setProvider("builtin")}
                    className={`rounded-xl border p-3.5 text-left transition ${provider === "builtin" ? "border-brand bg-brand/5 ring-2 ring-brand/30" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"}`}
                  >
                    <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800 dark:text-slate-100">
                      <Bot className="h-4 w-4 text-brand" aria-hidden /> {t("Bawaan RekanKerja", "RekanKerja Built-in")}
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
                      {t("Cepat & tanpa setup — LLM terkelola RekanKerja (data tetap di sesi Anda).", "Fast & zero-setup — RekanKerja managed LLM (data stays in your session).")}
                    </p>
                  </button>
                  <button
                    onClick={() => setProvider("openai")}
                    className={`rounded-xl border p-3.5 text-left transition ${provider === "openai" ? "border-brand bg-brand/5 ring-2 ring-brand/30" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"}`}
                  >
                    <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800 dark:text-slate-100">
                      <KeyRound className="h-4 w-4 text-brand" aria-hidden /> {t("OpenAI-Compatible", "OpenAI-Compatible")}
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
                      {t("Endpoint & API key milik perusahaan Anda sendiri (OpenAI, Azure, Groq, Ollama, vLLM…).", "Your own company endpoint & API key (OpenAI, Azure, Groq, Ollama, vLLM…).")}
                    </p>
                  </button>
                </div>

                {provider === "openai" && (
                  <div className="space-y-3.5 rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="ai-base-url">Base URL</Label>
                        <Input id="ai-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ai-model">Model</Label>
                        <Input id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ai-key">API Key {c?.hasApiKey && <span className="ml-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600">{"· " + t("tersimpan (terenkripsi)", "stored (encrypted)")}</span>}</Label>
                      <Input id="ai-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={c?.hasApiKey ? "•••••••• (isi untuk mengganti)" : "sk-…"} autoComplete="new-password" />
                      <p className="text-[11px] text-slate-400">
                        {t("Dienkripsi per-tenant (AES-256-GCM) — tidak pernah ditampilkan kembali.", "Encrypted per-tenant (AES-256-GCM) — never shown again.")}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
                  <div>
                    <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{t("Aktifkan AI", "Enable AI")}</p>
                    <p className="text-[11.5px] text-slate-500">{t("Matikan untuk menonaktifkan semua chat AI sementara.", "Turn off to temporarily disable all AI chat.")}</p>
                  </div>
                  <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t("Aktifkan AI", "Enable AI")} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void save()} disabled={saving || cfg.loading}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t("Simpan Konfigurasi", "Save Configuration")}
                  </Button>
                  <Button variant="outline" onClick={() => void test()} disabled={testing || cfg.loading}>
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                    {t("Tes Koneksi", "Test Connection")}
                  </Button>
                </div>
                {c && (
                  <p className="text-[11px] text-slate-400">
                    {t("Terakhir diperbarui", "Last updated")}: {fmtDateTime(c.updatedAt)}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* FEAT-SUPPORT-P2 — sakelar alat baca agen Online Support (L2). */}
        <SupportAgentCard />
      </div>
    </div>
  );
}

// ================= AGEN SUPPORT (FEAT-SUPPORT-P2 · P3 · P4) =================

interface SupportAgentConfig {
  toolsEnabled: boolean;
  browserEnabled: boolean;
  patchEnabled: boolean;
  browserLoginEmail: string | null;
  hasBrowserLoginPass: boolean;
}

/** Kartu tata kelola agen Online Support — sakelar alat baca (L2 ⇄ L1),
 *  sakelar reproduksi browser (L3) + akun uji reproduksi (kata sandi
 *  write-only, terenkripsi field-crypto), sakelar usulan patch (L4 — penerapan
 *  tetap butuh persetujuan developer manusia). Tampil di halaman Provider AI. */
function SupportAgentCard() {
  const { t } = useI18n();
  const cfg = useApi<{ config: SupportAgentConfig }>("/api/rekankerja/support/agent-config");
  const [enabled, setEnabled] = useState(true);
  const [browser, setBrowser] = useState(true);
  const [patch, setPatch] = useState(true);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [hasPass, setHasPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAcc, setSavingAcc] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (cfg.data?.config && !loaded) {
      setEnabled(cfg.data.config.toolsEnabled);
      setBrowser(cfg.data.config.browserEnabled);
      setPatch(cfg.data.config.patchEnabled);
      setEmail(cfg.data.config.browserLoginEmail ?? "");
      setHasPass(cfg.data.config.hasBrowserLoginPass);
      setLoaded(true);
    }
  }, [cfg.data, loaded]);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    setSaving(true);
    try {
      await apiSend("/api/rekankerja/support/agent-config", "PUT", { toolsEnabled: next });
      toast.success(
        next
          ? t("Mode diagnosis agen diaktifkan", "Agent diagnosis mode enabled")
          : t("Agen kembali ke mode percakapan murni", "Agent back to pure conversation mode"),
      );
      cfg.refresh();
    } catch (e) {
      setEnabled(!next);
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setSaving(false);
    }
  };

  const toggleBrowser = async (next: boolean) => {
    setBrowser(next);
    setSaving(true);
    try {
      await apiSend("/api/rekankerja/support/agent-config", "PUT", { browserEnabled: next });
      toast.success(
        next
          ? t("Reproduksi browser otomatis diaktifkan", "Automatic browser reproduction enabled")
          : t("Reproduksi browser dimatikan", "Browser reproduction disabled"),
      );
      cfg.refresh();
    } catch (e) {
      setBrowser(!next);
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setSaving(false);
    }
  };

  const togglePatch = async (next: boolean) => {
    setPatch(next);
    setSaving(true);
    try {
      await apiSend("/api/rekankerja/support/agent-config", "PUT", { patchEnabled: next });
      toast.success(
        next
          ? t("Usulan patch agen diaktifkan — penerapan tetap butuh persetujuan developer", "Agent patch proposals enabled — applying still requires developer approval")
          : t("Usulan patch agen dimatikan", "Agent patch proposals disabled"),
      );
      cfg.refresh();
    } catch (e) {
      setPatch(!next);
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setSaving(false);
    }
  };

  const saveAccount = async () => {
    setSavingAcc(true);
    try {
      const res = await apiSend<{ config: SupportAgentConfig }>(
        "/api/rekankerja/support/agent-config",
        "PUT",
        { browserLoginEmail: email.trim(), ...(pass ? { browserLoginPass: pass } : {}) },
      );
      setEmail(res.config.browserLoginEmail ?? "");
      setHasPass(res.config.hasBrowserLoginPass);
      setPass("");
      toast.success(t("Akun uji browser tersimpan — kata sandi dienkripsi", "Browser test account saved — password encrypted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setSavingAcc(false);
    }
  };

  const clearAccount = async () => {
    setSavingAcc(true);
    try {
      await apiSend("/api/rekankerja/support/agent-config", "PUT", { clearBrowserLogin: true });
      setEmail("");
      setPass("");
      setHasPass(false);
      toast.success(t("Akun uji browser dihapus", "Browser test account removed"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setSavingAcc(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Headset className="h-4 w-4 text-brand" aria-hidden />
          {t("Agen Support (Online Support)", "Support Agent (Online Support)")}
          {loaded && <StatusPill status={enabled || browser || patch ? "Active" : "Inactive"} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
              {t("Mode diagnosis (alat baca read-only)", "Diagnosis mode (read-only tools)")}
            </p>
            <p className="text-[11.5px] leading-relaxed text-slate-500">
              {t(
                "Izinkan Support AI memeriksa kode sumber, basis data perusahaan (dengan penyensoran data sensitif), dan log server saat mendiagnosa laporan pengguna. Tanpa ini, agen hanya menjawab dari pengetahuan umum.",
                "Allow the Support AI to inspect source code, company database (with sensitive data masking), and server logs while diagnosing user reports. Without this, the agent answers from general knowledge only.",
              )}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void toggle(v)}
            disabled={saving || cfg.loading}
            aria-label={t("Mode diagnosis agen support", "Support agent diagnosis mode")}
          />
        </div>

        {/* FEAT-SUPPORT-P3 — sakelar reproduksi browser headless (L3). */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
              {t("Reproduksi browser otomatis (L3)", "Automatic browser reproduction (L3)")}
            </p>
            <p className="text-[11.5px] leading-relaxed text-slate-500">
              {t(
                "Izinkan Support AI menjalankan browser internal (headless) untuk membuktikan laporan bug secara langsung: masuk dengan akun uji, membuka halaman terkait, dan mengambil tangkapan layar bukti yang dilampirkan ke percakapan.",
                "Allow the Support AI to drive an internal headless browser to verify bug reports first-hand: sign in with a test account, open the relevant page, and capture screenshot evidence attached to the conversation.",
              )}
            </p>
          </div>
          <Switch
            checked={browser}
            onCheckedChange={(v) => void toggleBrowser(v)}
            disabled={saving || cfg.loading}
            aria-label={t("Mode reproduksi browser agen support", "Support agent browser reproduction mode")}
          />
        </div>

        {/* FEAT-SUPPORT-P4 — sakelar usulan patch (L4 — approval tetap manusia). */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
              {t("Usulan patch kode (L4)", "Code patch proposals (L4)")}
            </p>
            <p className="text-[11.5px] leading-relaxed text-slate-500">
              {t(
                "Izinkan Support AI mengusulkan perbaikan kode (diff) saat akar masalah bug ditemukan. Usulan TIDAK pernah mengubah file — developer manusia harus menyetujui lewat kartu usulan di percakapan sebelum perubahan diterapkan.",
                "Allow the Support AI to propose code fixes (diffs) once a root cause is found. A proposal never changes any file — a human developer must approve it from the proposal card in the conversation before anything is applied.",
              )}
            </p>
          </div>
          <Switch
            checked={patch}
            onCheckedChange={(v) => void togglePatch(v)}
            disabled={saving || cfg.loading}
            aria-label={t("Mode usulan patch agen support", "Support agent patch proposal mode")}
          />
        </div>

        {/* FEAT-SUPPORT-P3 — akun uji reproduksi (browser bertindak sebagai akun ini). */}
        <div className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
            {t("Akun uji browser", "Browser test account")}
          </p>
          <p className="text-[11.5px] leading-relaxed text-slate-500">
            {t(
              "Browser reproduksi bertindak sebagai akun uji ini — bukan akun pengguna pelapor. Gunakan akun khusus dengan hak secukupnya (mis. role HR, tanpa MFA). Kata sandi disimpan terenkripsi dan tidak pernah dibagikan ke model AI.",
              "The reproduction browser acts as this test account — not the reporting user's account. Use a dedicated account with just enough rights (e.g. an HR role, without MFA). The password is stored encrypted and is never shared with the AI model.",
            )}
          </p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sb-email">{t("Email akun uji", "Test account email")}</Label>
              <Input
                id="sb-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@perusahaan.id"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sb-pass">{t("Kata sandi", "Password")}</Label>
              <Input
                id="sb-pass"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder={hasPass ? "•••••••• (tersimpan — isi untuk mengganti)" : t("minimal 6 karakter", "at least 6 characters")}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void saveAccount()} disabled={savingAcc || saving || cfg.loading}>
              {savingAcc && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t("Simpan Akun Uji", "Save Test Account")}
            </Button>
            {(hasPass || email) && (
              <Button size="sm" variant="outline" onClick={() => void clearAccount()} disabled={savingAcc || saving}>
                {t("Hapus Akun Uji", "Remove Test Account")}
              </Button>
            )}
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-400">
          {t(
            "Seluruh pemeriksaan bersifat hanya-baca dan diguard berlapis: query tulis ditolak, tabel kredensial/privasi diblokir, nilai gaji & kredensial disensor otomatis, dan jejak pemeriksaan dicatat di tiap percakapan. Browser reproduksi terkurung di aplikasi ini saja (tidak bisa membuka situs lain), dibatasi jumlah aksi/tangkapan layar, dan selalu ditutup otomatis. Usulan patch hanya berupa diff — file tidak pernah berubah sebelum developer menyetujuinya, dan usulan otomatis ditandai konflik bila file berubah sejak usulan dibuat.",
            "All inspections are read-only and guarded in layers: write queries are rejected, credential/privacy tables are blocked, salary & credential values are masked automatically, and an inspection note is recorded in each conversation. The reproduction browser is confined to this application only (cannot open other sites), capped in actions/screenshots, and always closed automatically. Patch proposals are diffs only — files never change before a developer approves, and proposals are automatically flagged as conflicting if the file changed since the proposal.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}

// ================= BASIS PENGETAHUAN =================

interface KbDoc {
  id: string; title: string; content: string; active: boolean;
  updatedBy: string | null; createdAt: string; updatedAt: string;
}

export function AiKnowledgeView() {
  const { t } = useI18n();
  const list = useApi<{ docs: KbDoc[] }>("/api/rekankerja/ai/knowledge");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KbDoc | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<KbDoc | null>(null);

  const openNew = () => {
    setEditing(null);
    setTitle("");
    setContent("");
    setActive(true);
    setOpen(true);
  };

  const openEdit = (d: KbDoc) => {
    setEditing(d);
    setTitle(d.title);
    setContent(d.content);
    setActive(d.active);
    setOpen(true);
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error(t("Judul dan isi wajib diisi", "Title and content are required"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/ai/knowledge", editing ? "PATCH" : "POST", {
        ...(editing ? { id: editing.id } : {}),
        title: title.trim(),
        content: content.trim(),
        active,
      });
      toast.success(editing ? t("Dokumen diperbarui", "Document updated") : t("Dokumen ditambahkan", "Document added"));
      setOpen(false);
      list.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (d: KbDoc) => {
    try {
      await apiSend("/api/rekankerja/ai/knowledge", "PATCH", { id: d.id, active: !d.active });
      list.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/rekankerja/ai/knowledge?id=${deleting.id}`, "DELETE");
      toast.success(t("Dokumen dihapus", "Document deleted"));
      setDeleting(null);
      list.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const docs = list.data?.docs ?? [];

  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("Basis Pengetahuan AI", "AI Knowledge Base")}
        description={t(
          "Dokumen kebijakan internal (SOP, kebijakan cuti, panduan klaim…) yang dipakai AI saat menjawab — semakin lengkap, semakin smart jawabannya.",
          "Internal policy documents (SOP, leave policy, claim guides…) used by the AI when answering — the more complete, the smarter the answers.",
        )}
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> {t("Dokumen Baru", "New Document")}</Button>}
      />
      <div className="space-y-2.5">
        {list.loading && <LoadingRows rows={4} />}
        {!list.loading && docs.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/30">
            <FileText className="h-6 w-6 text-slate-400" aria-hidden />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t("Belum ada dokumen", "No documents yet")}</p>
            <p className="max-w-md text-[12px] leading-relaxed text-slate-500">
              {t("Tambahkan kebijakan/SOP perusahaan agar AI menjawab sesuai aturan internal Anda.", "Add company policies/SOPs so the AI answers per your internal rules.")}
            </p>
            <Button variant="outline" onClick={openNew}><Plus className="h-4 w-4" /> {t("Tambah Dokumen", "Add Document")}</Button>
          </div>
        )}
        {docs.map((d) => (
          <Card key={d.id} className="transition hover:shadow-md">
            <CardContent className="flex items-start gap-3.5 p-4">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${d.active ? "bg-brand/10 text-brand-deep" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
                <FileText className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13.5px] font-bold text-slate-800 dark:text-slate-100">{d.title}</p>
                  <StatusPill status={d.active ? "Active" : "Inactive"} />
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{d.content}</p>
                <p className="mt-1.5 text-[10.5px] text-slate-400">
                  {t("Diperbarui", "Updated")} {fmtDateTime(d.updatedAt)}{d.updatedBy ? ` · ${d.updatedBy}` : ""} · {Math.ceil(d.content.length / 1000)}k {t("karakter", "chars")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch checked={d.active} onCheckedChange={() => void toggleActive(d)} aria-label={t("Aktif/nonaktif", "Toggle active")} />
                <Button size="icon" variant="ghost" onClick={() => openEdit(d)} aria-label={t("Ubah", "Edit")}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="text-rose-500 hover:text-rose-600" onClick={() => setDeleting(d)} aria-label={t("Hapus", "Delete")}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* dialog tambah/ubah */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("Ubah Dokumen", "Edit Document") : t("Dokumen Baru", "New Document")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="kb-title">{t("Judul", "Title")}</Label>
              <Input id="kb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("mis. Kebijakan Cuti Tahunan 2026", "e.g. Annual Leave Policy 2026")} maxLength={160} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-content">{t("Isi (teks polos — maks 8.000 karakter)", "Content (plain text — max 8,000 chars)")}</Label>
              <Textarea id="kb-content" value={content} onChange={(e) => setContent(e.target.value)} rows={12} placeholder={t("Tulis kebijakan/SOP…", "Write the policy/SOP…")} className="font-mono text-[12px]" maxLength={8000} />
              <p className="text-right text-[10.5px] text-slate-400">{content.length}/8000</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
              <p className="text-[12.5px] font-medium">{t("Aktif (dipakai AI)", "Active (used by AI)")}</p>
              <Switch checked={active} onCheckedChange={setActive} aria-label={t("Aktif", "Active")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("Simpan", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* konfirmasi hapus */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus dokumen ini?", "Delete this document?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`"${deleting?.title ?? ""}" akan dihapus permanen dari basis pengetahuan AI.`, `"${deleting?.title ?? ""}" will be permanently removed from the AI knowledge base.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => void remove()}>{t("Hapus", "Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
