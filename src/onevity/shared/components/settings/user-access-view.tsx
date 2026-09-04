"use client";
// OneVity — Settings: HAK AKSES PER PENGGUNA (Task 31)
// =====================================================================
// Hak akses MENU dan DATA KARYAWAN diatur PER PENGGUNA (bukan per grup/
// role — tiap pengguna bisa haknya berbeda meski levelnya sama):
//   • Akses Menu: mode "Semua menu" (default) ↔ "pilih manual" —
//     checklist per modul (HR/Payroll/Attendance/Leave/Travel/Medical
//     + Pengaturan Sistem), tersimpan sebagai kunci "module:view".
//   • Akses Data Karyawan: rule parametrik subjek pengguna (7 kriteria
//     penempatan AND; kosong semua = akses penuh) — pola approval
//     berjenjang.
//   • Akses OTOMATIS tanpa setting (hanya info): super admin (role
//     Admin / workspace OWNER|ADMIN) semua menu & data; atasan langsung
//     data bawahannya; tiap pengguna data dirinya.
//   • Simulasi: cakupan efektif pengguna terpilih (sumber + jumlah +
//     contoh karyawan).
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, initials } from "@/onevity/shared/lib/api";
import { EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { MODULES, navOfModule, SETTINGS_NAV } from "@/onevity/shared/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Crown, UserCheck, UserRound, ShieldCheck, SlidersHorizontal, Plus, Pencil, Trash2, Loader2, Wand2,
  CircleAlert, Building2, MapPin, Network, BriefcaseBusiness, GraduationCap, TrendingUp, BadgeCheck,
  Users, Search, Check, UserCog, LayoutGrid, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ================= katalog menu (selaras nav AppShell — sumber tunggal) =================

interface CatalogGroup { label: string | null; items: { key: string; label: string }[] }
interface CatalogModule { id: string; label: string; groups: CatalogGroup[] }

const MENU_CATALOG: CatalogModule[] = [
  ...MODULES.map((m) => ({
    id: m.id,
    label: m.label,
    groups: navOfModule(m.id).map((g) => ({
      label: g.label ?? null,
      items: g.children.map((c) => ({ key: `${m.id}:${c.id}`, label: c.label })),
    })),
  })),
  {
    id: "settings",
    label: "Pengaturan Sistem",
    groups: SETTINGS_NAV.map((g) => ({
      label: g.label ?? null,
      items: g.children.map((c) => ({ key: `settings:${c.id}`, label: c.label })),
    })),
  },
];

// ================= types =================

interface AccessUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: string;
  active: boolean;
  employee: { id: string; fullName: string; employeeNo: string } | null;
  isSuperAdmin: boolean;
  subordinateCount: number;
  menuMode: "ALL" | "CUSTOM";
  menus: string[];
  ruleCount: number;
}

interface AccessResp {
  users: AccessUser[];
  stats: { total: number; restricted: number; superAdmins: number; rules: number };
}

interface Rule {
  id: string;
  code: string;
  name: string;
  description: string | null;
  appUserId: string | null;
  companyOfficeId: string | null;
  companyOffice: { code: string; name: string } | null;
  workLocationId: string | null;
  workLocation: { code: string; name: string } | null;
  orgUnitId: string | null;
  orgUnit: { code: string; name: string } | null;
  positionId: string | null;
  position: { code: string; title: string } | null;
  gradeId: string | null;
  grade: { code: string; name: string } | null;
  positionLevelId: string | null;
  positionLevel: { code: string; name: string } | null;
  employmentStatus: string | null;
  priority: number;
  active: boolean;
}

interface RulesResp {
  rules: Rule[];
  users: { id: string; username: string; fullName: string; role: string; active: boolean }[];
  employmentStatuses: string[];
  references: {
    offices: { id: string; code: string; name: string; city: string | null }[];
    locations: { id: string; code: string; name: string; city: string | null }[];
    units: { id: string; code: string; name: string }[];
    positions: { id: string; code: string; title: string }[];
    grades: { id: string; code: string; name: string }[];
    levels: { id: string; code: string; name: string }[];
  };
}

interface Preview {
  all: boolean;
  sources: string[];
  subordinateCount: number;
  filterCount: number;
  accessibleCount: number;
  sample: { id: string; employeeNo: string; fullName: string }[];
}

const EMPLOYMENT_STATUS_LABEL: Record<string, string> = {
  Permanent: "Tetap", Contract: "Kontrak", Probation: "Percobaan", Outsourcing: "Outsourcing",
};

const ROLE_TONE: Record<string, string> = {
  Admin: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
  "HR Manager": "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400",
  Approver: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
  Viewer: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400",
};

// =================================================================
export function UserAccessView({ focusUserId, onFocusConsumed }: { focusUserId?: string | null; onFocusConsumed?: () => void }) {
  const { data, loading, error, refresh } = useApi<AccessResp>("/api/onevity/user-menu-access");
  const rulesResp = useApi<RulesResp>("/api/onevity/data-access-rules");
  const [selectedId, setSelectedId] = useState<string | null>(focusUserId ?? null);
  const [search, setSearch] = useState("");

  // fokus dari tab Pengguna ("Atur Hak Akses") — pilih lalu konsumsi
  useEffect(() => {
    if (focusUserId) {
      setSelectedId(focusUserId);
      onFocusConsumed?.();
    }
  }, [focusUserId, onFocusConsumed]);

  const users = data?.users ?? [];
  const selected = users.find((u) => u.id === selectedId) ?? users[0] ?? null;
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
  }, [users, search]);

  // ===== simulasi =====
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ===== draft hak akses menu (per pengguna terpilih) =====
  const [draftMode, setDraftMode] = useState<"ALL" | "CUSTOM">("ALL");
  const [draftMenus, setDraftMenus] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [savingMenu, setSavingMenu] = useState(false);

  const selKey = selected?.id ?? "none";
  const [initKey, setInitKey] = useState("");
  if (initKey !== selKey) {
    setInitKey(selKey);
    setDraftMode(selected?.menuMode ?? "ALL");
    setDraftMenus(new Set(selected?.menus ?? []));
    setDirty(false);
    setPreview(null);
  }

  const toggleMenu = (key: string) => {
    setDraftMenus((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
    setDirty(true);
  };
  const setModuleAll = (modId: string, on: boolean) => {
    const keys = MENU_CATALOG.find((m) => m.id === modId)?.groups.flatMap((g) => g.items.map((i) => i.key)) ?? [];
    setDraftMenus((prev) => {
      const n = new Set(prev);
      for (const k of keys) { if (on) n.add(k); else n.delete(k); }
      return n;
    });
    setDirty(true);
  };

  const saveMenu = async () => {
    if (!selected) return;
    if (draftMode === "CUSTOM" && draftMenus.size === 0) { toast.error("Pilih minimal satu menu, atau gunakan mode Semua Menu"); return; }
    setSavingMenu(true);
    try {
      await apiSend("/api/onevity/user-menu-access", "POST", { appUserId: selected.id, mode: draftMode, menus: [...draftMenus] });
      toast.success(`Hak akses menu ${selected.fullName} disimpan`, { description: draftMode === "CUSTOM" ? `${draftMenus.size} menu diizinkan` : "Semua menu diizinkan" });
      setDirty(false);
      refresh();
    } catch (e) {
      toast.error("Gagal menyimpan hak akses menu", { description: (e as Error).message });
    } finally {
      setSavingMenu(false);
    }
  };

  const resetMenu = async () => {
    if (!selected) return;
    try {
      await apiSend(`/api/onevity/user-menu-access?userId=${selected.id}`, "DELETE");
      toast.success(`Batasan menu ${selected.fullName} dihapus — kembali ke default semua menu`);
      setDraftMode("ALL");
      setDraftMenus(new Set());
      setDirty(false);
      refresh();
    } catch (e) {
      toast.error("Gagal menghapus batasan menu", { description: (e as Error).message });
    }
  };

  // ===== rule akses data =====
  const userRules = useMemo(
    () => (rulesResp.data?.rules ?? []).filter((r) => r.appUserId === selected?.id),
    [rulesResp.data, selected?.id],
  );
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: Rule | null }>({ open: false, rule: null });
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const toggleRule = async (r: Rule, active: boolean) => {
    setToggling(r.id);
    try {
      await apiSend(`/api/onevity/data-access-rules?id=${r.id}`, "PATCH", { active });
      toast.success(`Rule ${r.code} ${active ? "diaktifkan" : "dinonaktifkan"}`);
      rulesResp.refresh();
      refresh();
    } catch (e) {
      toast.error("Gagal mengubah status rule", { description: (e as Error).message });
    } finally {
      setToggling(null);
    }
  };

  const removeRule = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/onevity/data-access-rules?id=${deleting.id}`, "DELETE");
      toast.success(`Rule ${deleting.code} dihapus`);
      setDeleting(null);
      rulesResp.refresh();
      refresh();
    } catch (e) {
      toast.error("Gagal menghapus rule", { description: (e as Error).message });
    }
  };

  // ===== simulasi (aksi) =====
  const runPreview = async () => {
    if (!selected) return;
    setPreviewLoading(true);
    try {
      const r = await apiSend<{ preview: Preview }>(`/api/onevity/data-access-rules?action=preview&userId=${encodeURIComponent(selected.id)}`, "GET");
      setPreview(r.preview);
    } catch (e) {
      toast.error("Gagal menjalankan simulasi", { description: (e as Error).message });
    } finally {
      setPreviewLoading(false);
    }
  };

  const stats = data?.stats;

  return (
    <div className="space-y-5">
      {/* ringkasan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Pengguna", value: stats?.total ?? 0, icon: UserCog },
          { label: "Menu Dibatasi", value: stats?.restricted ?? 0, icon: LayoutGrid },
          { label: "Rule Data Pengguna", value: stats?.rules ?? 0, icon: SlidersHorizontal },
          { label: "Super Admin (otomatis)", value: stats?.superAdmins ?? 0, icon: Crown },
        ].map((c) => (
          <Card key={c.label} className="rounded-2xl border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800">
                <c.icon className="h-5 w-5 text-stone-600 dark:text-stone-300" />
              </div>
              <div>
                <div className="text-lg font-bold text-stone-900 dark:text-stone-50">{c.value}</div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{c.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* catatan: per pengguna + akses otomatis */}
      <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-teal-50/40 p-4 dark:border-emerald-500/25 dark:from-emerald-500/10 dark:to-teal-500/5">
        <p className="flex items-center gap-2 text-[13px] font-bold text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4" /> Hak akses diatur <b>per pengguna</b> — bukan per grup; pengguna dengan role sama bisa haknya berbeda
        </p>
        <div className="mt-2.5 grid gap-2 text-[13px] leading-relaxed text-stone-600 dark:text-stone-300 sm:grid-cols-3">
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-stone-900/50">
            <Crown className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span><b>Super Admin</b> otomatis akses semua menu &amp; data — tanpa diatur.</span>
          </span>
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-stone-900/50">
            <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span><b>Atasan langsung</b> otomatis mengakses data seluruh bawahannya.</span>
          </span>
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-stone-900/50">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
            <span><b>Setiap pengguna</b> selalu dapat mengakses data dirinya.</span>
          </span>
        </div>
      </div>

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : error ? (
        <EmptyState title="Gagal memuat" description={error} icon={CircleAlert} />
      ) : users.length === 0 ? (
        <EmptyState title="Belum ada pengguna aplikasi" description="Pengguna tenant belum dibuat." icon={UserCog} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* ============ daftar pengguna ============ */}
          <Card className="h-fit rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <Users className="h-4 w-4 text-emerald-600" /> Pengguna ({users.length})
              </CardTitle>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama / username / role…" className="h-9 rounded-xl pl-8 text-xs" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="max-h-[620px] space-y-1 overflow-y-auto pr-1">
                {filteredUsers.map((u) => {
                  const active = selected?.id === u.id;
                  return (
                    <button
                      key={u.id}
                      onClick={() => setSelectedId(u.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition",
                        active ? "bg-emerald-600 shadow-md shadow-emerald-600/20" : "hover:bg-stone-100 dark:hover:bg-stone-800",
                      )}
                    >
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold",
                        active ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400")}>
                        {initials(u.fullName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("flex items-center gap-1 truncate text-[13px] font-bold", active ? "text-white" : "text-stone-900 dark:text-stone-100")}>
                          {u.fullName}
                          {u.isSuperAdmin && <Crown className="h-3 w-3 shrink-0 text-amber-400" />}
                        </span>
                        <span className={cn("block truncate text-[10px]", active ? "text-emerald-100" : "text-stone-400")}>
                          @{u.username} · {u.role}
                          {u.menuMode === "CUSTOM" ? ` · ${u.menus.length} menu` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        {u.menuMode === "CUSTOM" && (
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold", active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400")}>dibatasi</span>
                        )}
                        {u.ruleCount > 0 && (
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold", active ? "bg-white/20 text-white" : "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300")}>{u.ruleCount} rule</span>
                        )}
                      </span>
                    </button>
                  );
                })}
                {filteredUsers.length === 0 && <p className="px-2 py-6 text-center text-xs text-stone-400">Tidak ada pengguna cocok.</p>}
              </div>
            </CardContent>
          </Card>

          {/* ============ detail pengguna terpilih ============ */}
          {selected && (
            <div className="min-w-0 space-y-4">
              {/* identitas + akses otomatis */}
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-extrabold text-white shadow">
                      {initials(selected.fullName)}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[15px] font-bold text-stone-900 dark:text-stone-50">
                        {selected.fullName}
                        {selected.isSuperAdmin && (
                          <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                            <Crown className="h-3 w-3" /> Super Admin
                          </Badge>
                        )}
                      </p>
                      <p className="text-[11px] text-stone-400">
                        @{selected.username} · {selected.email ?? "tanpa email"}
                        {selected.employee ? ` · ${selected.employee.employeeNo} — ${selected.employee.fullName}` : ""}
                      </p>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn("text-[10px] font-bold", ROLE_TONE[selected.role] ?? "")}>{selected.role}</Badge>
                      {selected.subordinateCount > 0 && (
                        <Badge variant="outline" className="gap-1 border-teal-200 bg-teal-50 text-[10px] font-bold text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300">
                          <UserCheck className="h-3 w-3" /> {selected.subordinateCount} bawahan
                        </Badge>
                      )}
                      <Badge variant="outline" className="gap-1 border-stone-200 text-[10px] font-bold text-stone-500 dark:border-stone-700 dark:text-stone-400">
                        <UserRound className="h-3 w-3" /> akses data diri
                      </Badge>
                    </div>
                  </div>
                  {selected.isSuperAdmin && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      <Crown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Super admin otomatis membuka <b>semua menu</b> dan mengakses <b>seluruh data karyawan</b> — tidak perlu (dan tidak bisa) dibatasi di menu ini.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* ============ akses menu ============ */}
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <LayoutGrid className="h-4 w-4 text-emerald-600" /> Akses Menu
                    {selected.menuMode === "CUSTOM" && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                        dibatasi — {selected.menus.length} menu
                      </Badge>
                    )}
                  </CardTitle>
                  {dirty && <Badge variant="secondary" className="text-[10px] font-bold">ada perubahan belum disimpan</Badge>}
                </CardHeader>
                <CardContent className="pt-0">
                  {selected.isSuperAdmin ? (
                    <p className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-3 text-[13px] text-stone-500 dark:bg-stone-900/40 dark:text-stone-400">
                      <Crown className="h-4 w-4 shrink-0 text-amber-500" /> Semua menu terbuka otomatis (super admin).
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {/* mode */}
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50 p-1 dark:border-stone-700 dark:bg-stone-900">
                          {([
                            { v: "ALL", label: "Semua Menu (default)" },
                            { v: "CUSTOM", label: "Batasi — pilih menu" },
                          ] as const).map((m) => (
                            <button
                              key={m.v}
                              onClick={() => { setDraftMode(m.v); setDirty(true); }}
                              className={cn(
                                "rounded-lg px-3 py-1.5 text-[12px] font-bold transition",
                                draftMode === m.v ? "bg-emerald-600 text-white shadow-sm" : "text-stone-500 hover:text-stone-700 dark:hover:text-stone-300",
                              )}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                        {draftMode === "CUSTOM" && (
                          <span className="text-[11px] text-stone-400">{draftMenus.size} menu dipilih</span>
                        )}
                      </div>

                      {draftMode === "CUSTOM" ? (
                        <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                          {MENU_CATALOG.map((mod) => {
                            const modKeys = mod.groups.flatMap((g) => g.items.map((i) => i.key));
                            const onCount = modKeys.filter((k) => draftMenus.has(k)).length;
                            const allOn = onCount === modKeys.length && modKeys.length > 0;
                            return (
                              <div key={mod.id} className="rounded-xl border border-stone-200 dark:border-stone-800">
                                <button
                                  onClick={() => setModuleAll(mod.id, !allOn)}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                                  aria-label={`Pilih semua menu ${mod.label}`}
                                >
                                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
                                    allOn ? "border-emerald-600 bg-emerald-600" : "border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900")}>
                                    {allOn && <Check className="h-3 w-3 text-white" />}
                                  </span>
                                  <span className="flex-1 text-[12px] font-bold text-stone-700 dark:text-stone-200">{mod.label}</span>
                                  <span className="text-[10px] font-bold text-stone-400">{onCount}/{modKeys.length}</span>
                                </button>
                                <div className="grid gap-1 border-t border-stone-100 px-3 py-2 dark:border-stone-800/60 sm:grid-cols-2">
                                  {mod.groups.map((g) => (
                                    <div key={g.label ?? "root"} className={g.label ? "sm:col-span-2" : ""}>
                                      {g.label && <p className="px-1 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400">{g.label}</p>}
                                      <div className="grid gap-1 sm:grid-cols-2">
                                        {g.items.map((it) => {
                                          const on = draftMenus.has(it.key);
                                          return (
                                            <button
                                              key={it.key}
                                              onClick={() => toggleMenu(it.key)}
                                              aria-pressed={on}
                                              className={cn(
                                                "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition",
                                                on
                                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                                                  : "border-stone-200 text-stone-500 hover:border-stone-300 dark:border-stone-800 dark:text-stone-400",
                                              )}
                                            >
                                              <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition",
                                                on ? "border-emerald-600 bg-emerald-600" : "border-stone-300 dark:border-stone-600")}>
                                                {on && <Check className="h-2.5 w-2.5 text-white" />}
                                              </span>
                                              <span className="truncate">{it.label}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="rounded-xl bg-stone-50 px-3 py-3 text-[13px] text-stone-500 dark:bg-stone-900/40 dark:text-stone-400">
                          Semua menu di seluruh modul terbuka untuk pengguna ini (default). Pilih <b>&ldquo;Batasi — pilih menu&rdquo;</b> untuk mengatur menu yang tersedia secara individual.
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button onClick={saveMenu} disabled={savingMenu || !dirty} className="h-9 gap-2 rounded-xl bg-emerald-700 font-bold hover:bg-emerald-800">
                          {savingMenu && <Loader2 className="h-4 w-4 animate-spin" />} Simpan Hak Akses Menu
                        </Button>
                        <Button
                          variant="outline"
                          onClick={resetMenu}
                          disabled={selected.menuMode !== "CUSTOM" || savingMenu}
                          className="h-9 gap-2 rounded-xl"
                          title="Hapus konfigurasi — kembali ke default semua menu"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Kembalikan ke Default
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ============ akses data karyawan ============ */}
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <SlidersHorizontal className="h-4 w-4 text-emerald-600" /> Akses Data Karyawan
                    <Badge variant="outline" className="text-[10px] font-bold text-stone-400">{userRules.filter((r) => r.active).length} rule aktif</Badge>
                  </CardTitle>
                  <Button onClick={() => setRuleDialog({ open: true, rule: null })} className="h-9 gap-1.5 rounded-xl bg-emerald-700 text-xs font-bold hover:bg-emerald-800">
                    <Plus className="h-3.5 w-3.5" /> Rule Baru
                  </Button>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-3 flex items-start gap-2 rounded-xl bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-500 dark:bg-stone-900/40 dark:text-stone-400">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    Rule parametrik <b>untuk {selected.fullName}</b> — karyawan yang dapat diakses sesuai penempatan (semua kriteria terpilih = AND). Tanpa kriteria = akses penuh. Bawahan langsung &amp; data diri selalu otomatis.
                  </p>
                  {rulesResp.loading && !rulesResp.data ? (
                    <LoadingRows rows={3} />
                  ) : userRules.length === 0 ? (
                    <EmptyState
                      title="Belum ada rule akses data"
                      description={`${selected.fullName} hanya dapat mengakses data dirinya${selected.subordinateCount > 0 ? ` dan ${selected.subordinateCount} bawahannya (otomatis)` : ""}${selected.isSuperAdmin ? ", serta seluruh data sebagai super admin" : ""}. Buat rule parametrik untuk memperluas cakupan.`}
                      icon={SlidersHorizontal}
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {userRules.map((r) => (
                        <UserRuleCard key={r.id} r={r} busy={toggling === r.id} onToggle={(v) => toggleRule(r, v)} onEdit={() => setRuleDialog({ open: true, rule: r })} onDelete={() => setDeleting(r)} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ============ simulasi ============ */}
              <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <Wand2 className="h-4 w-4 text-emerald-600" /> Simulasi Akses Efektif
                  </CardTitle>
                  <Button variant="outline" onClick={runPreview} disabled={previewLoading} className="h-9 gap-2 rounded-xl text-xs font-bold">
                    {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Jalankan Simulasi
                  </Button>
                </CardHeader>
                <CardContent className="pt-0">
                  {!preview ? (
                    <p className="rounded-xl bg-stone-50 px-3 py-3 text-[13px] text-stone-500 dark:bg-stone-900/40 dark:text-stone-400">
                      Lihat cakupan efektif {selected.fullName} — gabungan akses otomatis (super admin, atasan langsung, diri sendiri) dan rule parametriknya.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className={cn(
                        "flex items-center gap-3 rounded-2xl border px-4 py-3",
                        preview.all
                          ? "border-amber-200 bg-amber-50/70 dark:border-amber-500/25 dark:bg-amber-500/10"
                          : "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/25 dark:bg-emerald-500/10",
                      )}>
                        {preview.all ? <Crown className="h-5 w-5 text-amber-500" /> : <ShieldCheck className="h-5 w-5 text-emerald-600" />}
                        <div>
                          <p className="text-sm font-bold text-stone-900 dark:text-stone-50">
                            {preview.all ? "Akses penuh — seluruh data karyawan" : `${preview.accessibleCount} karyawan dapat diakses`}
                          </p>
                          <p className="text-xs text-stone-500 dark:text-stone-400">
                            {preview.all ? "Semua karyawan terlihat di direktori & detail." : "Hanya karyawan dalam cakupan ini yang terlihat di direktori & detail."}
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-stone-400">
                          <Network className="h-3.5 w-3.5" /> Sumber akses
                        </p>
                        <div className="max-h-40 space-y-1.5 overflow-y-auto">
                          {preview.sources.length === 0 && (
                            <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-500 dark:bg-stone-900/40 dark:text-stone-400">
                              Tidak ada akses data karyawan lain — hanya data diri (tanpa bawahan/rule/super admin).
                            </p>
                          )}
                          {preview.sources.map((s, i) => (
                            <p key={i} className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2 text-xs font-medium text-stone-600 dark:bg-stone-900/40 dark:text-stone-300">
                              <UserCog className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> {s}
                            </p>
                          ))}
                        </div>
                      </div>

                      {!preview.all && preview.sample.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-stone-400">Contoh karyawan dalam cakupan</p>
                          <div className="flex flex-wrap gap-1.5">
                            {preview.sample.map((e) => (
                              <Badge key={e.id} variant="outline" className="rounded-lg border-stone-200 text-[11px] text-stone-600 dark:border-stone-700 dark:text-stone-300">
                                {e.fullName} · {e.employeeNo}
                              </Badge>
                            ))}
                            {preview.accessibleCount > preview.sample.length && (
                              <Badge variant="outline" className="rounded-lg border-stone-200 text-[11px] text-stone-400 dark:border-stone-700">
                                +{preview.accessibleCount - preview.sample.length} lainnya
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* dialog create/edit rule (subjek = pengguna terpilih, fixed) */}
      {ruleDialog.open && selected && rulesResp.data && (
        <UserRuleFormDialog
          user={selected}
          rule={ruleDialog.rule}
          suggestedCode={`ACC-${selected.username}-R${userRules.length + 1}`}
          resp={rulesResp.data}
          onClose={() => setRuleDialog({ open: false, rule: null })}
          onDone={() => { setRuleDialog({ open: false, rule: null }); rulesResp.refresh(); refresh(); }}
        />
      )}

      {/* konfirmasi hapus rule */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus rule {deleting?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Rule &ldquo;{deleting?.name}&rdquo; untuk {selected?.fullName} akan dihapus. Pengguna kembali hanya memiliki akses otomatis (diri sendiri, bawahan langsung, atau semua bila super admin).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={removeRule} className="bg-rose-600 hover:bg-rose-700">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ================= kartu rule (per pengguna) =================

function UserRuleCard({ r, busy, onToggle, onEdit, onDelete }: {
  r: Rule; busy: boolean;
  onToggle: (v: boolean) => void; onEdit: () => void; onDelete: () => void;
}) {
  const criteria: { label: string; icon: React.ElementType }[] = [];
  if (r.companyOffice) criteria.push({ label: `Kantor: ${r.companyOffice.name}`, icon: Building2 });
  if (r.workLocation) criteria.push({ label: `Lokasi: ${r.workLocation.name}`, icon: MapPin });
  if (r.orgUnit) criteria.push({ label: `Unit: ${r.orgUnit.name}`, icon: Network });
  if (r.position) criteria.push({ label: `Posisi: ${r.position.title}`, icon: BriefcaseBusiness });
  if (r.grade) criteria.push({ label: `Grade: ${r.grade.code} — ${r.grade.name}`, icon: GraduationCap });
  if (r.positionLevel) criteria.push({ label: `Level: ${r.positionLevel.code} — ${r.positionLevel.name}`, icon: TrendingUp });
  if (r.employmentStatus) criteria.push({ label: `Status: ${EMPLOYMENT_STATUS_LABEL[r.employmentStatus] ?? r.employmentStatus}`, icon: BadgeCheck });

  return (
    <Card className={cn("rounded-2xl border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900", !r.active && "opacity-60")}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-stone-100 px-2 py-0.5 font-mono text-[11px] font-bold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{r.code}</span>
              <span className="font-semibold text-stone-900 dark:text-stone-50">{r.name}</span>
              {!r.active && <Badge variant="secondary" className="rounded-lg text-[10px]">Nonaktif</Badge>}
            </div>
            {r.description && <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-stone-500 dark:text-stone-400">{r.description}</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {criteria.length === 0 ? (
                <Badge variant="outline" className="gap-1 rounded-lg border-emerald-200 bg-emerald-50 text-[11px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" /> Akses penuh — semua karyawan (tanpa kriteria)
                </Badge>
              ) : criteria.map((c, i) => (
                <Badge key={i} variant="outline" className="gap-1 rounded-lg border-amber-200 bg-amber-50 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <c.icon className="h-3 w-3" /> {c.label}
                </Badge>
              ))}
              <Badge variant="outline" className="rounded-lg border-stone-300 text-[10px] text-stone-400 dark:border-stone-600">prioritas {r.priority}</Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch checked={r.active} disabled={busy} onCheckedChange={onToggle} aria-label="Aktifkan rule" />
            <Button size="icon" variant="ghost" onClick={onEdit} className="h-8 w-8 rounded-lg" aria-label="Ubah">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete} className="h-8 w-8 rounded-lg text-rose-600 hover:text-rose-700" aria-label="Hapus">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ================= dialog form rule (subjek fixed = pengguna terpilih) =================

interface RuleDraft {
  code: string;
  name: string;
  description: string;
  companyOfficeId: string;
  workLocationId: string;
  orgUnitId: string;
  positionId: string;
  gradeId: string;
  positionLevelId: string;
  employmentStatus: string;
  priority: string;
  active: boolean;
}

function draftFrom(r: Rule | null, suggested: string): RuleDraft {
  return {
    code: r?.code ?? suggested,
    name: r?.name ?? "",
    description: r?.description ?? "",
    companyOfficeId: r?.companyOfficeId ?? "",
    workLocationId: r?.workLocationId ?? "",
    orgUnitId: r?.orgUnitId ?? "",
    positionId: r?.positionId ?? "",
    gradeId: r?.gradeId ?? "",
    positionLevelId: r?.positionLevelId ?? "",
    employmentStatus: r?.employmentStatus ?? "",
    priority: String(r?.priority ?? 100),
    active: r?.active ?? true,
  };
}

function UserRuleFormDialog({ user, rule, suggestedCode, resp, onClose, onDone }: {
  user: AccessUser; rule: Rule | null; suggestedCode: string; resp: RulesResp;
  onClose: () => void; onDone: () => void;
}) {
  const [d, setD] = useState<RuleDraft>(draftFrom(rule, suggestedCode));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<RuleDraft>) => setD((cur) => ({ ...cur, ...patch }));

  const anyCriteria = !!(d.companyOfficeId || d.workLocationId || d.orgUnitId || d.positionId || d.gradeId || d.positionLevelId || d.employmentStatus);

  const save = async () => {
    if (!d.code.trim() || !d.name.trim()) { toast.error("Kode & nama rule wajib diisi"); return; }
    setSaving(true);
    try {
      const body = {
        ...d,
        appUserId: user.id, // subjek FIXED = pengguna terpilih (per pengguna)
        priority: d.priority === "" ? 100 : Number(d.priority),
        companyOfficeId: d.companyOfficeId || null,
        workLocationId: d.workLocationId || null,
        orgUnitId: d.orgUnitId || null,
        positionId: d.positionId || null,
        gradeId: d.gradeId || null,
        positionLevelId: d.positionLevelId || null,
        employmentStatus: d.employmentStatus || null,
      };
      await apiSend(rule ? `/api/onevity/data-access-rules?id=${rule.id}` : "/api/onevity/data-access-rules", rule ? "PATCH" : "POST", body);
      toast.success(rule ? `Rule ${d.code} diperbarui` : `Rule ${d.code} dibuat untuk ${user.fullName}`);
      onDone();
    } catch (e) {
      toast.error("Gagal menyimpan rule", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const refs = resp.references;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? `Ubah Rule ${rule.code}` : `Rule Akses Data Baru — ${user.fullName}`}</DialogTitle>
          <DialogDescription>
            Rule ini milik <b>{user.fullName}</b> (@{user.username}) — hak akses diatur per pengguna. Karyawan yang dapat diakses sesuai penempatan (semua terpilih = AND); kosongkan semua kriteria untuk akses penuh.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">{initials(user.fullName)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-stone-900 dark:text-stone-50">Subjek: {user.fullName}</p>
              <p className="text-[10px] text-stone-400">@{user.username} · {user.role} — tetap, tidak bisa diubah</p>
            </div>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">per pengguna</Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ra-code">Kode</Label>
              <Input id="ra-code" value={d.code} onChange={(e) => set({ code: e.target.value })} placeholder="ACC-MII000006-R1" className="rounded-xl" disabled={!!rule} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ra-name">Nama Rule</Label>
              <Input id="ra-name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Operasional Produksi — Kantor Surabaya" className="rounded-xl" />
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50/50 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <p className="flex items-center gap-2 text-[13px] font-bold text-stone-800 dark:text-stone-100">
              <SlidersHorizontal className="h-4 w-4 text-emerald-600" /> Kriteria sasaran — karyawan yang dapat diakses {user.fullName}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {([
                { key: "companyOfficeId" as const, label: "Kantor", items: (refs?.offices ?? []).map((o) => ({ value: o.id, label: `${o.name}${o.city ? ` — ${o.city}` : ""}` })) },
                { key: "workLocationId" as const, label: "Lokasi Kerja", items: (refs?.locations ?? []).map((l) => ({ value: l.id, label: `${l.name}${l.city ? ` — ${l.city}` : ""}` })) },
                { key: "orgUnitId" as const, label: "Unit Organisasi", items: (refs?.units ?? []).map((u) => ({ value: u.id, label: u.name })) },
                { key: "positionId" as const, label: "Posisi", items: (refs?.positions ?? []).map((p) => ({ value: p.id, label: p.title })) },
                { key: "gradeId" as const, label: "Grade", items: (refs?.grades ?? []).map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` })) },
                { key: "positionLevelId" as const, label: "Level Jabatan", items: (refs?.levels ?? []).map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })) },
                { key: "employmentStatus" as const, label: "Status Kerja", items: (resp?.employmentStatuses ?? []).map((s) => ({ value: s, label: EMPLOYMENT_STATUS_LABEL[s] ?? s })) },
              ]).map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-xs text-stone-500">{f.label}</Label>
                  <Select value={d[f.key] || "__all"} onValueChange={(v) => set({ [f.key]: v === "__all" ? "" : v } as Partial<RuleDraft>)}>
                    <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-stone-900"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">Semua (tanpa filter)</SelectItem>
                      {f.items.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {!anyCriteria && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Tanpa kriteria apa pun, rule ini memberi <b>akses penuh</b> ke seluruh data karyawan bagi {user.fullName}.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ra-priority">Prioritas (urutan evaluasi)</Label>
              <Input id="ra-priority" type="number" value={d.priority} onChange={(e) => set({ priority: e.target.value })} className="rounded-xl" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={d.active} onCheckedChange={(v) => set({ active: v })} id="ra-active" />
              <Label htmlFor="ra-active">Rule aktif</Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ra-desc">Deskripsi (opsional)</Label>
            <Textarea id="ra-desc" value={d.description} onChange={(e) => set({ description: e.target.value })} rows={2} className="rounded-xl" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="h-10 rounded-xl">Batal</Button>
          <Button onClick={save} disabled={saving} className="h-10 gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Simpan Rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
