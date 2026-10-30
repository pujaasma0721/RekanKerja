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
  Activity, ShieldOff, FileText, Save, ChevronRight, LogOut, Lock,
  Bug, FileDiff, CheckCheck, Check, X, Inbox,
  Github, GitBranch, ArrowUpToLine, ArrowDownToLine, History, AlertTriangle, Zap,
  Headset, Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  // P10 — sakelar alat agen (kewenangan pemilik aplikasi, per tenant).
  agent: { toolsEnabled: boolean; browserEnabled: boolean; patchEnabled: boolean };
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
  id: string; ticketNo: string; llmSteps: number; tokensIn: number; tokensOut: number; provider: string; billable: boolean; createdAt: string;
}
interface UsageDetail {
  tenant: { id: string; name: string; slug: string };
  month: string;
  summary: { turns: number; llmSteps: number; tokensIn: number; tokensOut: number };
  logs: UsageLogRow[];
}

// P7.2 — bentuk JSON dari /api/rekankerja/platform/admin/support-queue
interface QueueAlert {
  id: string;
  type: "BUG_CONFIRMED" | "PATCH_PROPOSED";
  tenantName: string;
  ticketNo: string;
  subject: string;
  priority: string;
  message: string;
  read: boolean;
  createdAt: string;
}
interface QueueBug {
  tenantId: string; tenantName: string; id: string; ticketNo: string; subject: string;
  priority: string; createdByName: string | null; lastMessageAt: string; messages: number;
}
interface QueuePatch {
  tenantId: string; tenantName: string; id: string; ticketId: string; ticketNo: string;
  ticketSubject: string; filePath: string; description: string; diffText: string;
  createdAt: string;
}
interface SupportQueueData {
  alerts: QueueAlert[];
  unreadCount: number;
  bugs: QueueBug[];
  patches: QueuePatch[];
}
interface PlatformAdminSession {
  admin: { email: string; name: string; lastLoginAt: string | null } | null;
}

// P8 — bentuk JSON dari /api/rekankerja/platform/admin/github-sync
interface GitSyncDirtyFile {
  path: string;
  status: string;
  staged: boolean;
  untracked: boolean;
}
interface GitSyncCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}
interface GitSyncStatus {
  ok: boolean;
  error?: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  remotes: Array<{ name: string; url: string }>;
  dirtyFiles: GitSyncDirtyFile[];
  dirtyCount: number;
  recentCommits: GitSyncCommit[];
}
interface GitSyncHistoryRow {
  id: string;
  action: "PUSH" | "PULL" | "AUTO_PUSH";
  status: "OK" | "GAGAL";
  branch: string;
  message: string;
  detail: string;
  byName: string;
  createdAt: string;
}
interface GitSyncData {
  status: GitSyncStatus;
  autoPush: boolean;
  history: GitSyncHistoryRow[];
}
interface GitPushResultView {
  committed: boolean;
  commitHash: string | null;
  commitMessage: string;
  filesCommitted: number;
  nothingToDo: boolean;
  remotes: Array<{ name: string; ok: boolean; detail: string }>;
}
interface GitPullResultView {
  updated: boolean;
  newCommits: GitSyncCommit[];
  output: string;
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
  const [toolsOpen, setToolsOpen] = useState(false);

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
  // P10 — indikator ringkas alat agen aktif utk tenant ini (L2/L3/L4).
  const agentOn = Number(row.agent.toolsEnabled) + Number(row.agent.browserEnabled) + Number(row.agent.patchEnabled);

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
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button
            variant="outline" size="sm" className="h-8 px-2.5 text-[12px]"
            onClick={() => setToolsOpen(true)}
            aria-label={t(`Alat agen ${row.name}`, `${row.name} agent tools`)}
          >
            <Wrench className="mr-1 h-3.5 w-3.5" aria-hidden />
            {t("Alat Agen", "Agent Tools")}
            <Badge
              variant="outline"
              className={cn(
                "ml-1.5 h-4 min-w-4 border-0 px-1 text-[9.5px] tabular-nums",
                agentOn === 3 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : agentOn === 0 ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
              )}
            >
              {agentOn}/3
            </Badge>
          </Button>
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
      <AgentToolsDialog open={toolsOpen} onOpenChange={setToolsOpen} tenant={row} onSaved={onSaved} />
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
                    <TableCell className="text-[12px] font-medium">
                      {l.ticketNo}
                      {!l.billable && (
                        <span
                          className="ml-1 rounded bg-amber-100 px-1 py-px text-[9px] font-bold uppercase text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          title={t("giliran gagal — token tercatat untuk biaya, tidak memakan kuota", "failed turn — tokens recorded for cost, quota not consumed")}
                        >
                          gagal
                        </span>
                      )}
                    </TableCell>
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

/**
 * P10 — Dialog sakelar ALAT AGEN support untuk satu tenant (L2/L3/L4).
 * Kewenangan pemilik aplikasi: alat agen menyentuh kode aplikasi &
 * infrastruktur platform (bukan ranah tenant). Perubahan langsung
 * menulis supportAgentConfig pada schema tenant terkait.
 */
function AgentToolsDialog({
  open, onOpenChange, tenant, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; tenant: AdminTenantRow; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [tools, setTools] = useState(tenant.agent.toolsEnabled);
  const [browser, setBrowser] = useState(tenant.agent.browserEnabled);
  const [patch, setPatch] = useState(tenant.agent.patchEnabled);
  const [busy, setBusy] = useState(false);

  // sinkronkan editor tiap dialog dibuka / data server berubah.
  useEffect(() => {
    setTools(tenant.agent.toolsEnabled);
    setBrowser(tenant.agent.browserEnabled);
    setPatch(tenant.agent.patchEnabled);
  }, [open, tenant.agent.toolsEnabled, tenant.agent.browserEnabled, tenant.agent.patchEnabled]);

  const dirty =
    tools !== tenant.agent.toolsEnabled ||
    browser !== tenant.agent.browserEnabled ||
    patch !== tenant.agent.patchEnabled;

  const save = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/platform/admin/support", "PUT", {
        tenantId: tenant.id,
        agentTools: { toolsEnabled: tools, browserEnabled: browser, patchEnabled: patch },
      });
      toast.success(t(`Alat agen ${tenant.name} disimpan`, `Agent tools for ${tenant.name} saved`));
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const rows: Array<{ key: "tools" | "browser" | "patch"; on: boolean; set: (v: boolean) => void; title: string; titleEn: string; desc: string; descEn: string }> = [
    {
      key: "tools", on: tools, set: setTools,
      title: "Mode diagnosis — alat baca read-only (L2)",
      titleEn: "Diagnosis mode — read-only tools (L2)",
      desc: "Izinkan agen support tenant ini memeriksa kode sumber, basis data tenant (dengan penyensoran data sensitif), dan log server saat mendiagnosa laporan pengguna.",
      descEn: "Allow this tenant's support agent to inspect source code, tenant database (with sensitive data masking), and server logs while diagnosing user reports.",
    },
    {
      key: "browser", on: browser, set: setBrowser,
      title: "Reproduksi browser otomatis (L3)",
      titleEn: "Automatic browser reproduction (L3)",
      desc: "Izinkan agen menjalankan browser headless untuk membuktikan laporan bug: masuk dengan akun uji milik tenant, membuka halaman terkait, dan mengambil tangkapan layar bukti.",
      descEn: "Allow the agent to drive a headless browser to verify bug reports: sign in with the tenant's test account, open the relevant page, and capture screenshot evidence.",
    },
    {
      key: "patch", on: patch, set: setPatch,
      title: "Usulan patch kode (L4)",
      titleEn: "Code patch proposals (L4)",
      desc: "Izinkan agen mengusulkan perbaikan kode (diff) saat akar masalah ditemukan. Usulan tidak pernah mengubah file — pemilik aplikasi menyetujui lewat tab Bug & Patch.",
      descEn: "Allow the agent to propose code fixes (diffs) once a root cause is found. A proposal never changes any file — the app owner approves it from the Bug & Patch tab.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Headset className="h-4 w-4" aria-hidden />
            {t(`Alat Agen Support — ${tenant.name}`, `Support Agent Tools — ${tenant.name}`)}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Otorisasi alat agen untuk tenant ini — kewenangan pemilik aplikasi (admin tenant hanya mengelola akun uji browsernya sendiri). Efek langsung tanpa restart.",
              "Agent tool authorization for this tenant — app owner authority (tenant admins only manage their own browser test account). Takes effect immediately without restart.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.key} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700">
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{t(r.title, r.titleEn)}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{t(r.desc, r.descEn)}</p>
              </div>
              <Switch
                checked={r.on}
                onCheckedChange={r.set}
                disabled={busy}
                aria-label={t(r.title, r.titleEn)}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Batal", "Cancel")}</Button>
          <Button onClick={() => void save()} disabled={!dirty || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1 h-4 w-4" aria-hidden />}
            {t("Simpan Alat Agen", "Save Agent Tools")}
          </Button>
        </DialogFooter>
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

/** Kartu LOGIN realm platform (P5-SEC) — kredensial PlatformAdmin di public
 *  schema, SEPENUHNYA terpisah dari login tenant: akun tenant (termasuk
 *  OWNER/superadmin tenant) tidak bisa masuk lewat sini tanpa kredensial
 *  pemilik aplikasi yang sah. */
function PlatformLoginCard({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error(t("Isi email dan kata sandi pemilik aplikasi", "Enter the app owner's email and password"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/platform/admin/session", "POST", { email: email.trim(), password });
      toast.success(t("Selamat datang, pemilik aplikasi", "Welcome, application owner"));
      setPassword("");
      onLoggedIn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <form
        onSubmit={submit}
        className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        aria-labelledby="platform-login-title"
      >
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-700 text-white shadow-lg shadow-teal-900/20">
            <Lock className="h-6 w-6" aria-hidden />
          </span>
          <h2 id="platform-login-title" className="mt-3 flex items-center gap-2 text-[16px] font-semibold text-slate-900 dark:text-slate-50">
            {t("Konsol Pemilik Aplikasi", "Application Owner Console")}
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
            {t(
              "Masuk dengan akun pemilik aplikasi — kredensial terpisah dari akun tenant/karyawan mana pun.",
              "Sign in with your application-owner account — credentials separate from any tenant/employee account.",
            )}
          </p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="platform-login-email" className="text-[12px]">{t("Email", "Email")}</Label>
            <Input
              id="platform-login-email" type="email" required autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@rekankerja.id" className="h-10 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="platform-login-password" className="text-[12px]">{t("Kata sandi", "Password")}</Label>
            <Input
              id="platform-login-password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="h-10 text-[13px]"
            />
          </div>
        </div>
        <Button type="submit" className="mt-5 h-10 w-full text-[13px]" disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-1 h-4 w-4" aria-hidden />}
          {t("Masuk Konsol Platform", "Sign in to Platform Console")}
        </Button>
        <p className="mt-3 text-center text-[10.5px] leading-relaxed text-slate-400">
          {t(
            "Sesi konsol terpisah penuh dari sesi aplikasi tenant (cookie berbeda, hanya berlaku di API platform) dan berakhir otomatis dalam 8 jam.",
            "The console session is fully separate from your tenant app session (different cookie, platform APIs only) and expires automatically after 8 hours.",
          )}
        </p>
      </form>
    </div>
  );
}

/** Tombol keluar realm platform (revokasi sesi server-side). */
function PlatformLogoutButton({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/platform/admin/session", "DELETE");
      toast.success(t("Keluar dari konsol platform", "Signed out of the platform console"));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" className="h-8 text-[12px]" disabled={busy} onClick={() => void logout()}>
      {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <LogOut className="mr-1 h-3.5 w-3.5" aria-hidden />}
      {t("Keluar", "Sign out")}
    </Button>
  );
}

// ---------------------------------------------------------------------------//
// P7.2 — TAB "BUG & PATCH": feed alert + antrean usulan patch + antrean bug. //
// ---------------------------------------------------------------------------//

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  KRITIS: { label: "KRITIS", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
  TINGGI: { label: "TINGGI", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
  SEDANG: { label: "SEDANG", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  RENDAH: { label: "RENDAH", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

/** Feed notifikasi ke pemilik aplikasi (P7.1) — badge belum dibaca + aksi baca. */
function AlertFeed({ alerts, unreadCount, onChanged }: { alerts: QueueAlert[]; unreadCount: number; onChanged: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const markRead = async (ids: string[] | null) => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/platform/admin/support-queue", "POST", {
        action: "read-alerts",
        ...(ids ? { alertIds: ids } : {}),
      });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={t("Belum ada notifikasi", "No notifications yet")}
        description={t(
          "Bug terkonfirmasi prioritas tinggi/kritis dan usulan patch agent akan muncul di sini.",
          "High/critical confirmed bugs and agent patch proposals will appear here.",
        )}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-slate-500 dark:text-slate-400">
          {unreadCount > 0
            ? t(`${unreadCount} belum dibaca`, `${unreadCount} unread`)
            : t("Semua sudah dibaca", "All read")}
        </p>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" disabled={busy} onClick={() => void markRead(null)}>
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
            {t("Tandai semua dibaca", "Mark all as read")}
          </Button>
        )}
      </div>
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {alerts.map((a) => {
          const isBug = a.type === "BUG_CONFIRMED";
          const pm = PRIORITY_META[a.priority] ?? null;
          return (
            <div
              key={a.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3",
                a.read
                  ? "border-slate-200/60 bg-white dark:border-slate-800 dark:bg-slate-900"
                  : "border-teal-300/70 bg-teal-50/50 dark:border-teal-900 dark:bg-teal-950/30",
              )}
            >
              <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", a.read ? "bg-slate-100 dark:bg-slate-800" : "bg-teal-100 dark:bg-teal-900/60")}>
                {isBug ? <Bug className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden /> : <FileDiff className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                    {isBug ? t("Bug terkonfirmasi", "Bug confirmed") : t("Usulan patch", "Patch proposal")}
                  </span>
                  <span className="text-[11px] text-slate-400">·</span>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{a.tenantName}</span>
                  <span className="font-mono text-[10.5px] text-slate-400">{a.ticketNo}</span>
                  {pm && <Badge variant="outline" className={cn("border-0 px-1.5 text-[10px]", pm.cls)}>{pm.label}</Badge>}
                  {!a.read && <span className="h-2 w-2 rounded-full bg-teal-500" aria-label={t("belum dibaca", "unread")} />}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{a.message}</p>
                <p className="mt-0.5 text-[10.5px] text-slate-400">{fmtDateTime(a.createdAt)}</p>
              </div>
              {!a.read && (
                <Button
                  variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" disabled={busy}
                  onClick={() => void markRead([a.id])}
                  aria-label={t("Tandai dibaca", "Mark as read")}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Satu kartu usulan patch: diff bisa dibentangkan + catatan + keputusan. */
function PatchCard({ patch, onDecide }: { patch: QueuePatch; onDecide: (p: QueuePatch, decision: "approve" | "reject") => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">{patch.tenantName}</span>
            <span className="text-[11px] text-slate-400">·</span>
            <span className="font-mono text-[10.5px] text-slate-400">{patch.ticketNo}</span>
            <Badge variant="outline" className="border-amber-200 bg-amber-100 px-1.5 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              {t("MENUNGGU", "PENDING")}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-[11.5px] text-slate-700 dark:text-slate-200">{patch.filePath}</p>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{patch.description}</p>
          <p className="mt-0.5 text-[10.5px] text-slate-400">
            {t("diajukan", "proposed")} {fmtDateTime(patch.createdAt)} · {t("tiket", "ticket")}: {patch.ticketSubject}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <FileDiff className="h-3.5 w-3.5" aria-hidden />
          {open ? t("Sembunyikan diff", "Hide diff") : t("Lihat diff", "View diff")}
        </Button>
      </div>
      {open && (
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-200 [scrollbar-width:thin]">
          <code>{patch.diffText}</code>
        </pre>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="h-8 gap-1 text-[12px]" onClick={() => onDecide(patch, "reject")}>
          <X className="h-3.5 w-3.5" aria-hidden />
          {t("Tolak", "Reject")}
        </Button>
        <Button size="sm" className="h-8 gap-1 bg-teal-700 text-[12px] text-white hover:bg-teal-800" onClick={() => onDecide(patch, "approve")}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          {t("Setujui & Terapkan", "Approve & Apply")}
        </Button>
      </div>
    </div>
  );
}

/** Tab "Bug & Patch" lengkap (P7.2). */
function BugPatchTab({ q, onRefresh }: { q: SupportQueueData | null; loading: boolean; onRefresh: () => void }) {
  const { t } = useI18n();
  const [decide, setDecide] = useState<{ patch: QueuePatch; decision: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submitDecision = async () => {
    if (!decide) return;
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/platform/admin/support-queue", "POST", {
        action: "decide-patch",
        tenantId: decide.patch.tenantId,
        ticketId: decide.patch.ticketId,
        proposalId: decide.patch.id,
        decision: decide.decision,
        note: note.trim() || null,
      });
      toast.success(
        decide.decision === "approve"
          ? t(`Patch DITERAPKAN — verifikasi otomatis sedang berjalan di tiket ${decide.patch.ticketNo}.`, `Patch APPLIED — automatic verification is now running in ticket ${decide.patch.ticketNo}.`)
          : t(`Usulan patch DITOLAK (${decide.patch.ticketNo}).`, `Patch proposal REJECTED (${decide.patch.ticketNo}).`),
      );
      setDecide(null);
      setNote("");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ---- feed notifikasi (P7.1) ---- */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="p7-alerts-title">
        <h2 id="p7-alerts-title" className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
          <Bug className="h-4 w-4" aria-hidden />
          {t("Notifikasi Eskalasi", "Escalation Notifications")}
        </h2>
        <p className="mb-3 text-[12px] text-slate-500 dark:text-slate-400">
          {t(
            "Agent support mengeskalasi dua hal ke Anda: bug terkonfirmasi prioritas TINGGI/KRITIS, dan usulan patch yang menunggu keputusan.",
            "The support agent escalates two things to you: confirmed HIGH/CRITICAL bugs, and patch proposals awaiting a decision.",
          )}
        </p>
        <AlertFeed alerts={q?.alerts ?? []} unreadCount={q?.unreadCount ?? 0} onChanged={onRefresh} />
      </section>

      {/* ---- usulan patch menunggu ---- */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="p7-patches-title">
        <h2 id="p7-patches-title" className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
          <FileDiff className="h-4 w-4" aria-hidden />
          {t("Usulan Patch Menunggu Keputusan", "Patch Proposals Awaiting Decision")}
        </h2>
        <p className="mb-3 text-[12px] text-slate-500 dark:text-slate-400">
          {t(
            "Menyetujui akan MENULIS file aplikasi langsung (kode yang dipakai semua tenant), lalu agent otomatis memverifikasi hasilnya di tiket. Menolak hanya menolak.",
            "Approving will WRITE the application file directly (code shared by all tenants), then the agent automatically verifies the result in the ticket. Rejecting only rejects.",
          )}
        </p>
        {(q?.patches ?? []).length === 0 ? (
          <EmptyState
            icon={FileDiff}
            title={t("Tidak ada usulan menunggu", "No proposals waiting")}
            description={t("Usulan patch agent dari semua tenant akan muncul di sini.", "Agent patch proposals from all tenants will appear here.")}
          />
        ) : (
          <div className="space-y-3">
            {(q?.patches ?? []).map((p) => (
              <PatchCard key={p.id} patch={p} onDecide={(patch, decision) => { setNote(""); setDecide({ patch, decision }); }} />
            ))}
          </div>
        )}
      </section>

      {/* ---- tiket bug aktif lintas tenant ---- */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="p7-bugs-title">
        <h2 id="p7-bugs-title" className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
          <Bug className="h-4 w-4" aria-hidden />
          {t("Tiket Bug Aktif (Semua Tenant)", "Active Bug Tickets (All Tenants)")}
        </h2>
        <p className="mb-3 text-[12px] text-slate-500 dark:text-slate-400">
          {t("Tiket kategori BUG yang masih AKTIF — urut dari prioritas tertinggi.", "BUG-category tickets still ACTIVE — sorted by highest priority.")}
        </p>
        {(q?.bugs ?? []).length === 0 ? (
          <EmptyState
            icon={Bug}
            title={t("Tidak ada bug aktif", "No active bugs")}
            description={t("Tidak ada tiket bug terbuka di tenant mana pun.", "No open bug tickets in any tenant.")}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 [scrollbar-width:thin]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">{t("Tenant", "Tenant")}</TableHead>
                  <TableHead className="text-[11px]">{t("Tiket", "Ticket")}</TableHead>
                  <TableHead className="text-[11px]">{t("Prioritas", "Priority")}</TableHead>
                  <TableHead className="text-[11px]">{t("Pelapor", "Reporter")}</TableHead>
                  <TableHead className="text-[11px]">{t("Aktivitas", "Activity")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q?.bugs ?? []).map((b) => {
                  const pm = PRIORITY_META[b.priority] ?? PRIORITY_META.SEDANG!;
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                          <span className="text-[12px] font-medium text-slate-900 dark:text-slate-100">{b.tenantName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-[11px] text-slate-400">{b.ticketNo}</p>
                        <p className="max-w-[260px] truncate text-[12px] text-slate-700 dark:text-slate-200">{b.subject}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("border-0 text-[10px]", pm.cls)}>{pm.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <p className="text-[12px] text-slate-600 dark:text-slate-300">{b.createdByName ?? "—"}</p>
                        <p className="text-[10.5px] text-slate-400">{b.messages} {t("pesan", "messages")}</p>
                      </TableCell>
                      <TableCell className="text-[11px] text-slate-500 dark:text-slate-400">{fmtDateTime(b.lastMessageAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ---- dialog konfirmasi keputusan ---- */}
      <Dialog open={!!decide} onOpenChange={(o) => { if (!o) { setDecide(null); setNote(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decide?.decision === "approve"
                ? t("Setujui & Terapkan Patch?", "Approve & Apply Patch?")
                : t("Tolak Usulan Patch?", "Reject Patch Proposal?")}
            </DialogTitle>
            <DialogDescription>
              {decide?.decision === "approve"
                ? t(
                    `File "${decide?.patch.filePath}" akan DITULIS langsung ke aplikasi (kode bersama semua tenant). Setelah diterapkan, agent menjalankan verifikasi otomatis di tiket ${decide?.patch.ticketNo}.`,
                    `File "${decide?.patch.filePath}" will be WRITTEN directly to the application (code shared by all tenants). After applying, the agent runs automatic verification in ticket ${decide?.patch.ticketNo}.`,
                  )
                : t(
                    `Usulan patch "${decide?.patch.filePath}" pada tiket ${decide?.patch.ticketNo} akan ditolak dan dicatat di utas.`,
                    `The patch proposal "${decide?.patch.filePath}" in ticket ${decide?.patch.ticketNo} will be rejected and recorded in the thread.`,
                  )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="p7-decide-note">{t("Catatan (opsional)", "Note (optional)")}</Label>
            <Textarea
              id="p7-decide-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="min-h-[70px] text-[12.5px]"
              placeholder={t("Maks 500 karakter — tercatat di utas tiket.", "Max 500 characters — recorded in the ticket thread.")}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDecide(null); setNote(""); }} disabled={busy}>
              {t("Batal", "Cancel")}
            </Button>
            <Button
              onClick={() => void submitDecision()}
              disabled={busy}
              className={cn("gap-1.5 text-white", decide?.decision === "approve" ? "bg-teal-700 hover:bg-teal-800" : "bg-rose-700 hover:bg-rose-800")}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {decide?.decision === "approve" ? t("Setujui & Terapkan", "Approve & Apply") : t("Tolak Usulan", "Reject Proposal")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Tab "Sinkron Git" (P8) — status repo, push, pull, auto-push, riwayat. */
function GitSyncTab({ data, onRefresh }: { data: GitSyncData | null; onRefresh: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<"push" | "pull" | null>(null);
  const [pushMsg, setPushMsg] = useState("");
  const [pullRemote, setPullRemote] = useState("");
  const [autostash, setAutostash] = useState(false);
  const [pushResult, setPushResult] = useState<GitPushResultView | null>(null);
  const [pullResult, setPullResult] = useState<GitPullResultView | null>(null);
  const [autopushBusy, setAutopushBusy] = useState(false);

  const st = data?.status ?? null;
  const remotes = st?.remotes ?? [];
  const effectivePullRemote =
    pullRemote && remotes.some((r) => r.name === pullRemote) ? pullRemote : (remotes[0]?.name ?? "");
  const dirty = st?.dirtyFiles ?? [];
  const dirtyCount = st?.dirtyCount ?? 0;
  const ahead = st?.ahead ?? 0;
  const behind = st?.behind ?? 0;
  const autoPush = data?.autoPush ?? false;
  const history = data?.history ?? [];

  const doPush = async () => {
    setBusy("push");
    setPushResult(null);
    try {
      const r = await apiSend<{ ok: true; result: GitPushResultView }>(
        "/api/rekankerja/platform/admin/github-sync",
        "POST",
        { action: "push", message: pushMsg.trim() },
      );
      setPushResult(r.result);
      if (r.result.nothingToDo) {
        toast.info(t("Tidak ada perubahan untuk dikirim — repo sudah sinkron.", "Nothing to send — the repo is already in sync."));
      } else {
        const okCount = r.result.remotes.filter((x) => x.ok).length;
        toast.success(
          t(
            `Terkirim ke ${okCount}/${r.result.remotes.length} remote — ${r.result.committed ? `commit ${r.result.commitHash ?? "?"} (${r.result.filesCommitted} file)` : "commit tertunda terkirim"}.`,
            `Pushed to ${okCount}/${r.result.remotes.length} remotes — ${r.result.committed ? `commit ${r.result.commitHash ?? "?"} (${r.result.filesCommitted} files)` : "pending commits sent"}.`,
          ),
        );
      }
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  };

  const doPull = async () => {
    if (!effectivePullRemote) return;
    setBusy("pull");
    setPullResult(null);
    try {
      const r = await apiSend<{ ok: true; result: GitPullResultView }>(
        "/api/rekankerja/platform/admin/github-sync",
        "POST",
        { action: "pull", remote: effectivePullRemote, autostash },
      );
      setPullResult(r.result);
      if (r.result.updated) {
        toast.success(
          t(`${r.result.newCommits.length} commit baru ditarik dari ${effectivePullRemote}.`, `${r.result.newCommits.length} new commits pulled from ${effectivePullRemote}.`),
        );
      } else {
        toast.info(t("Sudah terbaru — tidak ada commit baru di remote.", "Already up to date — no new commits on the remote."));
      }
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  };

  const toggleAutoPush = async (enabled: boolean) => {
    setAutopushBusy(true);
    try {
      await apiSend("/api/rekankerja/platform/admin/github-sync", "POST", { action: "set-autopush", enabled });
      toast.success(
        enabled
          ? t("Auto-push AKTIF — patch yang disetujui langsung dikirim ke GitHub.", "Auto-push ON — approved patches are pushed to GitHub immediately.")
          : t("Auto-push dimatikan.", "Auto-push turned off."),
      );
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setAutopushBusy(false);
    }
  };

  if (st && !st.ok) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t("Repositori git tidak terbaca", "Git repository unreadable")}
        description={st.error ?? ""}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* ---- status repositori ---- */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="p8-git-status-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="p8-git-status-title" className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
              <GitBranch className="h-4 w-4" aria-hidden />
              {t("Status Repositori", "Repository Status")}
            </h2>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              {t(
                "Kondisi kode aplikasi di server vs GitHub — file patch yang Anda setujui muncul sebagai file berubah di sini.",
                "The application code on the server vs GitHub — patch files you approve appear here as changed files.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="border-0 bg-slate-100 px-2 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {st?.branch || "—"}
            </Badge>
            {ahead > 0 && (
              <Badge variant="outline" className="border-0 bg-teal-100 px-2 text-[10.5px] text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                {t(`${ahead} commit belum terkirim`, `${ahead} unpushed commits`)}
              </Badge>
            )}
            {behind > 0 && (
              <Badge variant="outline" className="border-0 bg-amber-100 px-2 text-[10.5px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {t(`${behind} commit tertinggal`, `${behind} commits behind`)}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn(
                "border-0 px-2 text-[10.5px]",
                dirtyCount === 0
                  ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
              )}
            >
              {dirtyCount === 0 ? t("Bersih", "Clean") : t(`${dirtyCount} file berubah`, `${dirtyCount} changed files`)}
            </Badge>
          </div>
        </div>

        {/* remote terdaftar (URL dimask) */}
        <div className="mt-3 flex flex-wrap gap-2">
          {remotes.length === 0 ? (
            <span className="text-[11.5px] text-slate-400">{t("Tidak ada remote terdaftar.", "No remotes registered.")}</span>
          ) : (
            remotes.map((r) => (
              <span key={r.name} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/60">
                <Github className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                <span className="shrink-0 text-[11px] font-semibold text-slate-700 dark:text-slate-200">{r.name}</span>
                <span className="max-w-[240px] truncate font-mono text-[10px] text-slate-400" title={r.url}>{r.url}</span>
              </span>
            ))
          )}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* file berubah */}
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              {t("File Berubah (belum di-commit)", "Changed Files (uncommitted)")}
            </p>
            {dirty.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-[12px] text-slate-400 dark:border-slate-700">
                {t("Tidak ada file berubah — kode server sama dengan commit terakhir.", "No changed files — server code matches the last commit.")}
              </div>
            ) : (
              <div className="max-h-64 space-y-1 overflow-x-hidden overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800 [scrollbar-width:thin]">
                {dirty.map((f) => (
                  <div key={f.path} className="flex min-w-0 items-center gap-2 overflow-hidden rounded-md px-1.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 font-mono text-[10px] font-bold",
                        f.untracked
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
                      )}
                    >
                      {f.untracked ? "new" : f.staged ? "stg" : "mod"}
                    </span>
                    <span className="min-w-0 truncate font-mono text-[11px] text-slate-600 dark:text-slate-300" title={f.path}>{f.path}</span>
                  </div>
                ))}
                {dirtyCount > dirty.length && (
                  <p className="px-1.5 text-[10.5px] text-slate-400">+{dirtyCount - dirty.length} {t("file lainnya…", "more files…")}</p>
                )}
              </div>
            )}
          </div>

          {/* commit terakhir */}
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              {t("Commit Terakhir", "Recent Commits")}
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800 [scrollbar-width:thin]">
              {(st?.recentCommits ?? []).length === 0 ? (
                <p className="p-3 text-center text-[12px] text-slate-400">{t("(belum ada commit)", "(no commits yet)")}</p>
              ) : (
                (st?.recentCommits ?? []).map((c) => (
                  <div key={c.hash} className="flex min-w-0 items-baseline gap-2 overflow-hidden px-1.5 py-1">
                    <span className="shrink-0 font-mono text-[10.5px] text-teal-700 dark:text-teal-400">{c.hash}</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-600 dark:text-slate-300" title={c.subject}>{c.subject}</span>
                    <span className="shrink-0 text-[10px] text-slate-400">{c.date}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---- aksi push & pull ---- */}
      <div className="grid gap-5 md:grid-cols-2">
        {/* push */}
        <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="p8-push-title">
          <h2 id="p8-push-title" className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
            <ArrowUpToLine className="h-4 w-4" aria-hidden />
            {t("Kirim ke GitHub (Push)", "Push to GitHub")}
          </h2>
          <p className="mb-3 text-[12px] text-slate-500 dark:text-slate-400">
            {t(
              "Commit SEMUA perubahan tertunda (termasuk file patch yang disetujui), lalu kirim ke semua remote GitHub.",
              "Commit ALL pending changes (including approved patch files), then send to every GitHub remote.",
            )}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="p8-push-msg">{t("Pesan commit", "Commit message")}</Label>
            <Textarea
              id="p8-push-msg"
              value={pushMsg}
              onChange={(e) => setPushMsg(e.target.value)}
              maxLength={300}
              className="min-h-[60px] text-[12.5px]"
              placeholder={dirtyCount > 0 ? `chore: perubahan aplikasi (${dirtyCount} file)` : "chore: perubahan aplikasi"}
            />
          </div>
          <Button
            className="mt-3 w-full gap-1.5 bg-teal-700 text-[12.5px] text-white hover:bg-teal-800"
            disabled={busy !== null || remotes.length === 0}
            onClick={() => void doPush()}
          >
            {busy === "push" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUpToLine className="h-4 w-4" aria-hidden />}
            {busy === "push" ? t("Mengirim…", "Pushing…") : t("Commit & Kirim", "Commit & Push")}
          </Button>
          {pushResult && (
            <div className="mt-3 space-y-1.5">
              {pushResult.committed ? (
                <div className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-[11.5px] text-teal-800 dark:bg-teal-950/50 dark:text-teal-300">
                  {t(`Commit ${pushResult.commitHash ?? "?"} — ${pushResult.filesCommitted} file`, `Commit ${pushResult.commitHash ?? "?"} — ${pushResult.filesCommitted} files`)} · “{pushResult.commitMessage}”
                </div>
              ) : pushResult.nothingToDo ? null : (
                <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11.5px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  {t("Tidak ada file baru untuk di-commit — commit yang tertunda dikirim.", "No new files to commit — pending commits were sent.")}
                </div>
              )}
              {pushResult.remotes.map((r) => (
                <div
                  key={r.name}
                  className={cn(
                    "flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px]",
                    r.ok
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
                  )}
                >
                  {r.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : <X className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
                  <span><span className="font-semibold">{r.name}</span> — {r.detail}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* pull */}
        <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="p8-pull-title">
          <h2 id="p8-pull-title" className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
            <ArrowDownToLine className="h-4 w-4" aria-hidden />
            {t("Tarik dari GitHub (Pull)", "Pull from GitHub")}
          </h2>
          <p className="mb-3 text-[12px] text-slate-500 dark:text-slate-400">
            {t(
              "Ambil commit terbaru dari GitHub ke server (fast-forward saja — tidak pernah menimpa riwayat lokal).",
              "Fetch the latest commits from GitHub onto the server (fast-forward only — never rewrites local history).",
            )}
          </p>
          <div className="space-y-1.5">
            <Label>{t("Remote", "Remote")}</Label>
            <Select value={effectivePullRemote} onValueChange={setPullRemote}>
              <SelectTrigger className="h-9 text-[12.5px]" aria-label={t("remote tujuan pull", "pull remote")}>
                <SelectValue placeholder={t("pilih remote", "pick a remote")} />
              </SelectTrigger>
              <SelectContent>
                {remotes.map((r) => (
                  <SelectItem key={r.name} value={r.name} className="text-[13px]">{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-slate-700 dark:text-slate-200">{t("Simpan sementara (autostash)", "Stash first (autostash)")}</p>
              <p className="text-[10.5px] text-slate-400">
                {t("Bila ada file berubah: simpan dulu, tarik, lalu pulihkan otomatis.", "If files changed: stash, pull, then restore automatically.")}
              </p>
            </div>
            <Switch checked={autostash} onCheckedChange={setAutostash} aria-label={t("autostash", "autostash")} />
          </div>
          <Button
            variant="outline"
            className="mt-3 w-full gap-1.5 text-[12.5px]"
            disabled={busy !== null || !effectivePullRemote}
            onClick={() => void doPull()}
          >
            {busy === "pull" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowDownToLine className="h-4 w-4" aria-hidden />}
            {busy === "pull" ? t("Menarik…", "Pulling…") : t("Tarik Terbaru", "Pull Latest")}
          </Button>
          {pullResult && (
            <div className="mt-3 space-y-1.5">
              {pullResult.updated ? (
                <>
                  <div className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-[11.5px] text-teal-800 dark:bg-teal-950/50 dark:text-teal-300">
                    {t(`${pullResult.newCommits.length} commit baru masuk:`, `${pullResult.newCommits.length} new commits in:`)}
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800 [scrollbar-width:thin]">
                    {pullResult.newCommits.map((c) => (
                      <div key={c.hash} className="flex min-w-0 items-baseline gap-2 overflow-hidden px-1">
                        <span className="shrink-0 font-mono text-[10.5px] text-teal-700 dark:text-teal-400">{c.hash}</span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-600 dark:text-slate-300" title={c.subject}>{c.subject}</span>
                        <span className="shrink-0 text-[10px] text-slate-400">{c.date}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11.5px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  {t("Sudah terbaru — server sejalan dengan remote.", "Up to date — the server matches the remote.")}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ---- auto-push pasca-patch ---- */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="p8-autopush-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="p8-autopush-title" className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
              <Zap className="h-4 w-4" aria-hidden />
              {t("Auto-Push Pasca-Patch", "Post-Patch Auto-Push")}
            </h2>
            <p className="max-w-xl text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
              {t(
                "Saat AKTIF: setiap usulan patch yang Anda SETUJUI (tab Bug & Patch) langsung di-commit & dikirim ke semua remote GitHub dengan pesan fix(nomor tiket). Perubahan lain yang belum di-commit pada saat itu ikut terbawa dalam commit yang sama.",
                "When ON: every patch you APPROVE (Bug & Patch tab) is immediately committed & pushed to all GitHub remotes with a fix(ticket no) message. Other uncommitted changes at that moment are included in the same commit.",
              )}
            </p>
          </div>
          <Switch checked={autoPush} disabled={autopushBusy} onCheckedChange={(v) => void toggleAutoPush(v)} aria-label={t("auto-push", "auto-push")} />
        </div>
      </section>

      {/* ---- riwayat sinkronisasi ---- */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="p8-hist-title">
        <h2 id="p8-hist-title" className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-slate-50">
          <History className="h-4 w-4" aria-hidden />
          {t("Riwayat Sinkronisasi", "Sync History")}
        </h2>
        <p className="mb-3 text-[12px] text-slate-500 dark:text-slate-400">
          {t("Audit 10 operasi terakhir — push, pull, dan auto-push pasca-patch.", "Audit trail of the last 10 operations — push, pull, and post-patch auto-push.")}
        </p>
        {history.length === 0 ? (
          <EmptyState icon={History} title={t("Belum ada riwayat", "No history yet")} description={t("Operasi push/pull akan tercatat di sini.", "Push/pull operations will be recorded here.")} />
        ) : (
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 [scrollbar-width:thin]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">{t("Aksi", "Action")}</TableHead>
                  <TableHead className="text-[11px]">{t("Hasil", "Result")}</TableHead>
                  <TableHead className="text-[11px]">{t("Ringkasan", "Summary")}</TableHead>
                  <TableHead className="text-[11px]">{t("Oleh", "By")}</TableHead>
                  <TableHead className="text-[11px]">{t("Waktu", "Time")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-0 px-1.5 text-[10px]",
                          h.action === "PUSH"
                            ? "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                            : h.action === "PULL"
                              ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                        )}
                      >
                        {h.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={cn("text-[11.5px] font-semibold", h.status === "OK" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                        {h.status}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      <p className="truncate font-mono text-[11px] text-slate-600 dark:text-slate-300" title={h.message}>{h.message || "—"}</p>
                      <p className="line-clamp-2 text-[10.5px] text-slate-400" title={h.detail}>{h.detail}</p>
                    </TableCell>
                    <TableCell className="text-[11px] text-slate-500 dark:text-slate-400">{h.byName || "—"}</TableCell>
                    <TableCell className="text-[11px] text-slate-500 dark:text-slate-400">{fmtDateTime(h.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

export function PlatformAdminModule(_props: { view?: string }) {
  const { t } = useI18n();
  // P5-SEC — realm sesi MANDIRI: whoami lewat cookie platform (path-scoped,
  // kunci tanda tangan berbeda dari sesi tenant). Tanpa sesi platform → kartu
  // login khusus; sesi tenant (apapun role/flag-nya) tidak pernah diperiksa.
  const ps = useApi<PlatformAdminSession>("/api/rekankerja/platform/admin/session");
  const admin = ps.data?.admin ?? null;
  const api = useApi<AdminOverview>(admin ? "/api/rekankerja/platform/admin/support" : null, [!!admin]);
  // P7.2 — antrean Bug & Patch lintas tenant (badge belum-dibaca di tab).
  const qApi = useApi<SupportQueueData>(admin ? "/api/rekankerja/platform/admin/support-queue" : null, [!!admin]);
  // P8 — status sinkronisasi git (badge tab: ada perubahan belum terkirim).
  const gApi = useApi<GitSyncData>(admin ? "/api/rekankerja/platform/admin/github-sync" : null, [!!admin]);
  const [tab, setTab] = useState<"service" | "queue" | "sync">("service");

  // P7.1 — poll ringan utk badge notifikasi (45 dtk; antrean lintas-tenant
  // murah pada jumlah tenant wajar, dan tab aktif apapun tetap ter-update).
  const qRefresh = qApi.refresh;
  const gRefresh = gApi.refresh;
  useEffect(() => {
    if (!admin) return;
    const h = window.setInterval(() => { void qRefresh(); }, 45_000);
    return () => window.clearInterval(h);
  }, [admin, qRefresh]);

  // P8 — poll status git lebih jarang (perintah git lokal, murah).
  useEffect(() => {
    if (!admin) return;
    const h = window.setInterval(() => { void gRefresh(); }, 60_000);
    return () => window.clearInterval(h);
  }, [admin, gRefresh]);

  if (ps.loading && !ps.data) {
    return <LoadingRows rows={6} />;
  }
  if (!admin) {
    return <PlatformLoginCard onLoggedIn={() => ps.refresh()} />;
  }

  const d = api.data;
  const q = qApi.data;
  const unread = q?.unreadCount ?? 0;

  const refreshAll = () => {
    void api.refresh();
    void qApi.refresh();
    void gApi.refresh();
  };

  return (
    <div>
      <PageHeader
        eyebrow="PLATFORM ADMIN"
        title={t("Layanan Support", "Support Service")}
        description={t(
          "Kelola layanan Online Support berbayar: aktivasi per tenant, kuota giliran AI, provider AI platform, pemakaian & estimasi biaya, antrean bug & usulan patch lintas tenant, serta sinkronisasi perubahan kode ke GitHub.",
          "Manage the paid Online Support service: per-tenant activation, AI turn quotas, the platform AI provider, usage & cost estimates, the cross-tenant bug & patch queue, plus syncing code changes to GitHub.",
        )}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={refreshAll} disabled={api.loading || qApi.loading}>
              {api.loading || qApi.loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />}
              {t("Muat ulang", "Refresh")}
            </Button>
            <PlatformLogoutButton onDone={() => ps.refresh()} />
          </div>
        }
      />

      {/* P7.2 — tab konsol: layanan/tenant vs bug/patch */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "service" | "queue" | "sync")}>
        <TabsList className="mb-4 h-9">
          <TabsTrigger value="service" className="gap-1.5 px-3 text-[12px]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {t("Layanan & Tenant", "Service & Tenants")}
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-1.5 px-3 text-[12px]">
            <Bug className="h-3.5 w-3.5" aria-hidden />
            {t("Bug & Patch", "Bug & Patch")}
            {unread > 0 && (
              <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white" aria-label={`${unread} unread`}>
                {unread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-1.5 px-3 text-[12px]">
            <Github className="h-3.5 w-3.5" aria-hidden />
            {t("Sinkron Git", "Git Sync")}
            {(gApi.data?.status.dirtyCount ?? 0) > 0 && (
              <span className="ml-0.5 h-2 w-2 rounded-full bg-teal-500" aria-label={t("ada perubahan belum terkirim", "unpushed changes")} />
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "sync" ? (
        gApi.loading && !gApi.data ? (
          <LoadingRows rows={6} />
        ) : gApi.error ? (
          <EmptyState icon={ShieldOff} title={t("Gagal memuat status git", "Failed to load git status")} description={gApi.error} />
        ) : (
          <GitSyncTab data={gApi.data} onRefresh={() => void gApi.refresh()} />
        )
      ) : tab === "queue" ? (
        qApi.loading && !q ? (
          <LoadingRows rows={6} />
        ) : qApi.error ? (
          <EmptyState icon={ShieldOff} title={t("Gagal memuat antrean", "Failed to load queue")} description={qApi.error} />
        ) : (
          <BugPatchTab q={q} loading={qApi.loading} onRefresh={() => void qApi.refresh()} />
        )
      ) : api.loading && !d ? (
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
