"use client";
// RekanKerja — Online Support P5: konsol PEMILIK APLIKASI (Platform Admin). ===
// =====================================================================
// Ketentuan layanan support (FEAT-SUPPORT-P5):
//   · Online Support = layanan BERBAYAR yang diaktifkan pemilik aplikasi per
//     tenant. Halaman ini SATU-SATUNYA tempat mengelolanya: daftar seluruh
//     tenant + status aktivasi (INACTIVE/TRIAL/ACTIVE/SUSPENDED) + kuota
//     giliran AI per bulan + catatan komersial.
//   · Provider AI support = MILIK PLATFORM (melayani semua tenant aktif),
//     terpisah total dari provider AI tenant — dikonfigurasi di sini,
//     termasuk harga per juta token utk estimasi biaya & penagihan.
//   · Pemakaian & biaya: log per giliran (SupportUsageLog) diringkas per
//     tenant per bulan — dasar kuota & invois.
// Guard berlapis: rail hanya tampil utk User.isSuperadmin; komponen cek
// sesi (kartu tolak utk non-pemilik); SETIAP API diguard requirePlatformAdmin.
// =====================================================================
import { useEffect, useState } from "react";
import {
  ShieldCheck, Building2, RefreshCw, Loader2, KeyRound, PlugZap, Coins,
  Activity, ShieldOff, FileText, Save, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useApi, apiSend, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { cn } from "@/lib/utils";

// ---------- tipe (bentuk JSON dari API platform admin) ----------
interface AdminTenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  support: { status: string; monthlyTurnQuota: number; notes: string | null; activatedAt: string | null };
  usage: { turns: number; llmSteps: number; tokensIn: number; tokensOut: number; quotaLeft: number | null };
}
interface AdminProvider {
  provider: "builtin" | "openai";
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  priceInPerM: number;
  priceOutPerM: number;
  updatedAt: string;
}
interface AdminOverview {
  month: string;
  tenants: AdminTenantRow[];
  provider: AdminProvider;
  totals: { tenants: number; activeSupport: number; turns: number; tokensIn: number; tokensOut: number; estCostUsd: number };
}
interface UsageLogRow {
  id: string; ticketNo: string; llmSteps: number; tokensIn: number; tokensOut: number; provider: string; createdAt: string;
}
interface UsageDetail {
  tenant: { id: string; name: string; slug: string };
  month: string;
  summary: { turns: number; llmSteps: number; tokensIn: number; tokensOut: number };
  logs: UsageLogRow[];
}

const SUPPORT_STATUS_META: Record<string, { label: string; cls: string }> = {
  INACTIVE: { label: "Nonaktif", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  TRIAL: { label: "Trial", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  ACTIVE: { label: "Aktif", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  SUSPENDED: { label: "Ditangguhkan", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
};

const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(n);

/** Kartu ringkasan kecil (stat). */
function Stat({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4" aria-hidden />
        <p className="text-[11px] font-bold uppercase tracking-[0.12em]">{label}</p>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-50">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/** Satu baris tenant + editor aktivasi inline (status/kuota/catatan). */
function TenantRow({ row, onSaved }: { row: AdminTenantRow; onSaved: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState(row.support.status);
  const [quota, setQuota] = useState(String(row.support.monthlyTurnQuota));
  const [notes, setNotes] = useState(row.support.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);

  // reset editor saat data server berubah (mis. setelah simpan)
  useEffect(() => {
    setStatus(row.support.status);
    setQuota(String(row.support.monthlyTurnQuota));
    setNotes(row.support.notes ?? "");
  }, [row.support.status, row.support.monthlyTurnQuota, row.support.notes]);

  const dirty =
    status !== row.support.status ||
    quota !== String(row.support.monthlyTurnQuota) ||
    notes !== (row.support.notes ?? "");

  const save = async () => {
    const q = parseInt(quota, 10);
    if (!Number.isFinite(q) || q < 0) {
      toast.error(t("Kuota harus angka ≥ 0 (0 = tanpa batas)", "Quota must be a number ≥ 0 (0 = unlimited)"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/platform/admin/support", "PUT", {
        tenantId: row.id, status, monthlyTurnQuota: q, notes,
      });
      toast.success(t(`Layanan support ${row.name} disimpan`, `Support service for ${row.name} saved`));
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const sm = SUPPORT_STATUS_META[status] ?? SUPPORT_STATUS_META.INACTIVE!;
  const quotaPct = row.support.monthlyTurnQuota > 0
    ? Math.min(100, Math.round((row.usage.turns / row.support.monthlyTurnQuota) * 100))
    : 0;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800">
            <Building2 className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-slate-900 dark:text-slate-100">{row.name}</p>
            <p className="truncate text-[11px] text-slate-400">{row.slug} · {row.plan}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={cn("border-0 text-[11px]", sm.cls)}>{sm.label}</Badge>
        {row.support.activatedAt && (
          <p className="mt-0.5 text-[10px] text-slate-400">{t(`aktif sejak`, `active since`)} {fmtDateTime(row.support.activatedAt)}</p>
        )}
      </TableCell>
      <TableCell>
        <div className="w-[150px] space-y-1">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 text-[12px]" aria-label={t("Status layanan", "Service status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SUPPORT_STATUS_META).map(([k, m]) => (
                <SelectItem key={k} value={k} className="text-[13px]">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={quota}
            onChange={(e) => setQuota(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
            className="h-8 text-[12px]"
            aria-label={t("Kuota giliran AI per bulan", "Monthly AI turn quota")}
          />
          <p className="text-[10px] leading-tight text-slate-400">
            {t("kuota giliran/bulan (0 = tanpa batas)", "turns/month (0 = unlimited)")}
          </p>
        </div>
      </TableCell>
      <TableCell>
        <div className="w-[130px]">
          <p className="text-[12px] font-medium tabular-nums text-slate-700 dark:text-slate-200">
            {fmtNum(row.usage.turns)} {t("giliran", "turns")}
          </p>
          <p className="text-[10px] tabular-nums text-slate-400">{fmtNum(row.usage.tokensIn + row.usage.tokensOut)} tok</p>
          {row.support.monthlyTurnQuota > 0 ? (
            <>
              <Progress value={quotaPct} className="mt-1 h-1.5" aria-label={t("Pemakaian kuota", "Quota usage")} />
              <p className="mt-0.5 text-[10px] text-slate-400">
                {t("sisa", "left")}: {fmtNum(row.usage.quotaLeft ?? 0)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[10px] text-slate-400">{t("tanpa kuota", "no quota")}</p>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1.5">
          <Button
            variant="outline" size="sm" className="h-8 px-2.5 text-[12px]"
            onClick={() => setUsageOpen(true)}
          >
            <Activity className="mr-1 h-3.5 w-3.5" aria-hidden />
            {t("Pemakaian", "Usage")}
          </Button>
          <Button
            size="sm" className="h-8 px-2.5 text-[12px]"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {t("Simpan", "Save")}
          </Button>
        </div>
      </TableCell>
      <UsageDialog open={usageOpen} onOpenChange={setUsageOpen} tenant={row} />
    </TableRow>
  );
}

/** Dialog rincian pemakaian bulan berjalan satu tenant (log per giliran). */
function UsageDialog({ open, onOpenChange, tenant }: { open: boolean; onOpenChange: (v: boolean) => void; tenant: AdminTenantRow }) {
  const { t } = useI18n();
  const api = useApi<UsageDetail>(open ? `/api/rekankerja/platform/admin/support-usage?tenantId=${tenant.id}` : null, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" aria-hidden />
            {t(`Pemakaian ${tenant.name}`, `${tenant.name} usage`)}
          </DialogTitle>
          <DialogDescription>
            {api.data ? t(`Bulan ${api.data.month} — ${fmtNum(api.data.summary.turns)} giliran · ${fmtNum(api.data.summary.llmSteps)} langkah LLM · ${fmtNum(api.data.summary.tokensIn + api.data.summary.tokensOut)} token`, `Month ${api.data.month} — ${fmtNum(api.data.summary.turns)} turns · ${fmtNum(api.data.summary.llmSteps)} LLM steps · ${fmtNum(api.data.summary.tokensIn + api.data.summary.tokensOut)} tokens`) : "…"}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 [scrollbar-width:thin]">
          {api.loading ? (
            <div className="p-3"><LoadingRows rows={4} /></div>
          ) : !api.data || api.data.logs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={t("Belum ada pemakaian bulan ini", "No usage this month yet")}
              description={t("Giliran agent AI akan tercatat di sini.", "AI agent turns will be recorded here.")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Tiket</TableHead>
                  <TableHead className="text-[11px]">Waktu</TableHead>
                  <TableHead className="text-right text-[11px]">Langkah</TableHead>
                  <TableHead className="text-right text-[11px]">Token ↓/↑</TableHead>
                  <TableHead className="text-[11px]">Provider</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {api.data.logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-[12px] font-medium">{l.ticketNo}</TableCell>
                    <TableCell className="text-[11px] text-slate-400">{fmtDateTime(l.createdAt)}</TableCell>
                    <TableCell className="text-right text-[12px] tabular-nums">{l.llmSteps}</TableCell>
                    <TableCell className="text-right text-[12px] tabular-nums">{fmtNum(l.tokensIn)} / {fmtNum(l.tokensOut)}</TableCell>
                    <TableCell className="text-[11px] text-slate-400">{l.provider}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        {api.error && <p className="text-[12px] text-rose-600">{api.error}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** Form konfigurasi provider AI support (platform — melayani semua tenant). */
function ProviderCard({ provider, onSaved }: { provider: AdminProvider; onSaved: () => void }) {
  const { t } = useI18n();
  const [prov, setProv] = useState<"builtin" | "openai">(provider.provider);
  const [enabled, setEnabled] = useState(provider.enabled);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [model, setModel] = useState(provider.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [priceIn, setPriceIn] = useState(provider.priceInPerM ? String(provider.priceInPerM) : "");
  const [priceOut, setPriceOut] = useState(provider.priceOutPerM ? String(provider.priceOutPerM) : "");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setProv(provider.provider);
    setEnabled(provider.enabled);
    setBaseUrl(provider.baseUrl ?? "");
    setModel(provider.model ?? "");
    setPriceIn(provider.priceInPerM ? String(provider.priceInPerM) : "");
    setPriceOut(provider.priceOutPerM ? String(provider.priceOutPerM) : "");
    setApiKey("");
  }, [provider.provider, provider.enabled, provider.baseUrl, provider.model, provider.priceInPerM, provider.priceOutPerM]);

  const save = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/platform/admin/support-provider", "PUT", {
        provider: prov, enabled, baseUrl, model,
        // string kosong → hapus key; undefined → pertahankan (komponen kirim
        // apiKey hanya bila admin MENGETIK sesuatu — input dikosongkan saat load).
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        priceInPerM: parseFloat(priceIn) || 0,
        priceOutPerM: parseFloat(priceOut) || 0,
      });
      toast.success(t("Provider AI support tersimpan", "Support AI provider saved"));
      setApiKey("");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await apiSend<{ reply: string; provider: string }>("/api/rekankerja/platform/admin/support-provider", "POST");
      toast.success(t(`Koneksi berhasil (${r.provider}): ${r.reply.slice(0, 120)}`, `Connection OK (${r.provider}): ${r.reply.slice(0, 120)}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="provider-support-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="provider-support-title" className="flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
            <PlugZap className="h-4 w-4" aria-hidden />
            {t("Provider AI Support (Platform)", "Support AI Provider (Platform)")}
          </h2>
          <p className="mt-0.5 max-w-xl text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
            {t(
              "LLM yang melayani SEMUA tenant berlayanan aktif — terpisah total dari provider AI milik tiap tenant. Kredensial tenant tidak pernah dipakai untuk support; biaya terpusat di platform.",
              "The LLM serving ALL subscribed tenants — fully separate from each tenant's own AI provider. Tenant credentials are never used for support; costs stay centralized on the platform.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t("Aktifkan provider", "Enable provider")} />
          <span className="text-[12px] text-slate-500 dark:text-slate-400">{enabled ? t("Aktif", "Enabled") : t("Nonaktif", "Disabled")}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[12px]">{t("Jenis provider", "Provider type")}</Label>
          <Select value={prov} onValueChange={(v) => setProv(v === "openai" ? "openai" : "builtin")}>
            <SelectTrigger className="h-9 text-[13px]" aria-label={t("Jenis provider", "Provider type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="builtin" className="text-[13px]">{t("Bawaan RekanKerja (ZAI)", "RekanKerja built-in (ZAI)")}</SelectItem>
              <SelectItem value="openai" className="text-[13px]">{t("OpenAI-compatible (milik platform)", "OpenAI-compatible (platform-owned)")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px]">{t("Model", "Model")}</Label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={prov === "openai" ? "gpt-4o-mini" : "—"} disabled={prov === "builtin"} className="h-9 text-[13px]" />
        </div>
        {prov === "openai" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[12px]">{t("Base URL", "Base URL")}</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="h-9 text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">{t("API key", "API key")}</Label>
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <Input
                  type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider.hasApiKey ? t("••• tersimpan (biarkan kosong = tidak diubah)", "••• stored (leave blank to keep)") : "sk-…"}
                  className="h-9 font-mono text-[12px]" autoComplete="off"
                />
              </div>
              <p className="text-[10px] text-slate-400">
                {t("Terenkripsi at-rest (AES-256-GCM) — hanya pemilik aplikasi yang bisa mengubah.", "Encrypted at rest (AES-256-GCM) — only the app owner can change it.")}
              </p>
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label className="text-[12px]">{t("Harga input (USD / 1 juta token)", "Input price (USD / 1M tokens)")}</Label>
          <Input value={priceIn} onChange={(e) => setPriceIn(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.15" className="h-9 text-[13px]" inputMode="decimal" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[12px]">{t("Harga output (USD / 1 juta token)", "Output price (USD / 1M tokens)")}</Label>
          <Input value={priceOut} onChange={(e) => setPriceOut(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.60" className="h-9 text-[13px]" inputMode="decimal" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          {t("Terakhir disimpan", "Last saved")}: {fmtDateTime(provider.updatedAt)}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[12px]" disabled={testing} onClick={() => void test()}>
            {testing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Activity className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {t("Tes koneksi", "Test connection")}
          </Button>
          <Button size="sm" className="h-8 text-[12px]" disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {t("Simpan provider", "Save provider")}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function PlatformAdminModule(_props: { view?: string }) {
  const { t } = useI18n();
  const session = useSession();
  const isAppOwner = session.info?.user?.isSuperadmin === true;
  const api = useApi<AdminOverview>(isAppOwner ? "/api/rekankerja/platform/admin/support" : null, [isAppOwner]);

  // Guard render (defense-in-depth — API tetap pengaman sebenarnya).
  if (!isAppOwner) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <EmptyState
          icon={ShieldOff}
          title={t("Akses ditolak", "Access denied")}
          description={t(
            "Konsol ini hanya untuk pemilik aplikasi. Admin/OWNER tenant tidak dapat mengaksesnya.",
            "This console is for the application owner only. Tenant admins/owners cannot access it.",
          )}
        />
      </div>
    );
  }

  const d = api.data;

  return (
    <div>
      <PageHeader
        eyebrow="PLATFORM ADMIN"
        title={t("Layanan Support", "Support Service")}
        description={t(
          "Kelola layanan Online Support berbayar: aktivasi per tenant, kuota giliran AI, provider AI platform, serta pemakaian & estimasi biaya.",
          "Manage the paid Online Support service: per-tenant activation, AI turn quotas, the platform AI provider, and usage & cost estimates.",
        )}
        actions={
          <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => api.refresh()} disabled={api.loading}>
            {api.loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {t("Muat ulang", "Refresh")}
          </Button>
        }
      />

      {api.loading && !d ? (
        <LoadingRows rows={6} />
      ) : api.error ? (
        <EmptyState icon={ShieldOff} title={t("Gagal memuat data", "Failed to load data")} description={api.error} />
      ) : !d ? null : (
        <div className="space-y-5">
          {/* ---- statistik ringkas bulan berjalan ---- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={ShieldCheck} label={t("Tenant berlayanan", "Subscribed tenants")} value={`${d.totals.activeSupport}/${d.totals.tenants}`} hint={t("TRIAL + AKTIF", "TRIAL + ACTIVE")} />
            <Stat icon={Activity} label={t("Giliran AI bulan ini", "AI turns this month")} value={fmtNum(d.totals.turns)} hint={d.month} />
            <Stat icon={Coins} label={t("Token masuk / keluar", "Tokens in / out")} value={`${fmtNum(d.totals.tokensIn)} / ${fmtNum(d.totals.tokensOut)}`} hint={t("akumulasi semua tenant", "across all tenants")} />
            <Stat icon={Coins} label={t("Estimasi biaya (USD)", "Estimated cost (USD)")} value={`$${d.totals.estCostUsd.toFixed(2)}`} hint={t("berdasar harga provider", "from provider prices")} />
          </div>

          <Alert className="border-teal-200 bg-teal-50/60 text-[12px] dark:border-teal-900 dark:bg-teal-950/40">
            <ShieldCheck className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden />
            <AlertTitle className="text-[12px]">{t("Ketentuan layanan", "Service terms")}</AlertTitle>
            <AlertDescription className="text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              {t(
                "Online Support adalah layanan berbayar per tenant: aktif hanya bila status TRIAL/AKTIF. Tenant yang dinonaktifkan kehilangan menu & API support seketika (tiket lama tetap tersimpan). Kuota membatasi jumlah balasan AI per bulan kalender. Halaman ini tidak dapat diakses admin tenant mana pun.",
                "Online Support is a paid per-tenant service: active only when status is TRIAL/ACTIVE. Deactivated tenants lose the support menu & APIs immediately (past tickets remain stored). Quotas limit AI replies per calendar month. This page cannot be accessed by any tenant admin.",
              )}
            </AlertDescription>
          </Alert>

          {/* ---- daftar tenant + aktivasi ---- */}
          <section className="rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="tenant-list-title">
            <h2 id="tenant-list-title" className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
              <Building2 className="h-4 w-4" aria-hidden />
              {t("Tenant & Aktivasi Layanan", "Tenants & Service Activation")}
            </h2>
            <p className="mb-3 text-[12px] text-slate-500 dark:text-slate-400">
              {t("Ubah status/kuota lalu tekan Simpan — efek langsung (tanpa tunggu).", "Change status/quota then press Save — takes effect immediately.")}
            </p>
            {d.tenants.length === 0 ? (
              <EmptyState icon={Building2} title={t("Belum ada tenant", "No tenants yet")} description={t("Tenant terdaftar akan muncul di sini.", "Registered tenants will appear here.")} />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 [scrollbar-width:thin]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px]">{t("Tenant", "Tenant")}</TableHead>
                      <TableHead className="text-[11px]">{t("Layanan", "Service")}</TableHead>
                      <TableHead className="text-[11px]">{t("Status & Kuota", "Status & Quota")}</TableHead>
                      <TableHead className="text-[11px]">{t(`Pemakaian (${d.month})`, `Usage (${d.month})`)}</TableHead>
                      <TableHead className="text-right text-[11px]">{t("Aksi", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.tenants.map((row) => (
                      <TenantRow key={row.id} row={row} onSaved={() => api.refresh()} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="mt-2 flex items-center gap-1 text-[10.5px] text-slate-400">
              <ChevronRight className="h-3 w-3" aria-hidden />
              {t("SUSPENDED = ditangguhkan (tunggakan) — akses support terputus total hingga diaktifkan kembali.", "SUSPENDED = suspended (unpaid) — support access fully cut off until reactivated.")}
            </p>
          </section>

          {/* ---- provider AI support platform ---- */}
          <ProviderCard provider={d.provider} onSaved={() => api.refresh()} />
        </div>
      )}
    </div>
  );
}
