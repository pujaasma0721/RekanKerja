"use client";
// RekanKerja — Settings: HAK AKSES PER PENGGUNA (Task 31 + 32-b)
// =====================================================================
// Hak akses MENU dan DATA KARYAWAN diatur PER PENGGUNA (bukan per grup/
// role — tiap pengguna bisa haknya berbeda meski levelnya sama):
//   • Akses Menu: mode "Semua menu" (default) ↔ "pilih manual" —
//     checklist per modul (HR/Payroll/Attendance/Leave/Travel/Medical
//     + Pengaturan Sistem), tersimpan sebagai kunci "module:view".
//   • Level AKSI (Task 32-b): menu tercentang = seluruh aksi; tombol
//     "Atur Aksi" per item membuka dialog pembatasan Baru/Ubah/Hapus
//     + operasi khusus menu (katalog opsOf menu-perms.ts).
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
import { useApi, apiSend, initials } from "@/rekankerja/shared/lib/api";
import { EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { MODULES, navOfModule, SETTINGS_NAV } from "@/rekankerja/shared/components/shell/app-shell";
import { MENU_ACTION_DEFS, fullPerm, opsOf, type MenuAction, type MenuPerm, type MenusMap } from "@/rekankerja/shared/lib/menu-perms";
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
import { useI18n } from "@/rekankerja/shared/lib/i18n";
// Task adv-e — Advance Search (client-side, tambahan di atas search lama)
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, num, sel, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";

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

/** Izin penuh sebuah menu: seluruh aksi CRUD + seluruh ops katalognya eksplisit aktif. */
function fullPermOf(menuKey: string): MenuPerm {
  const ops: Record<string, boolean> = {};
  for (const o of opsOf(menuKey)) ops[o.key] = true;
  return fullPerm(ops);
}

/** Apakah perm membawa seluruh aksi (Baru/Ubah/Hapus + semua ops katalog)? */
function isFullPerm(p: MenuPerm, menuKey: string): boolean {
  return p.create && p.update && p.delete && opsOf(menuKey).every((o) => p.ops[o.key] !== false);
}

/** Label tampilan sebuah kunci menu (dari katalog nav). */
function menuLabelOf(key: string): string {
  for (const mod of MENU_CATALOG) for (const g of mod.groups) for (const it of g.items) if (it.key === key) return it.label;
  return key;
}

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
  /** true = role ESS — terkunci portal ESS; editor hak akses menu admin dikunci. */
  essOnly: boolean;
  subordinateCount: number;
  menuMode: "ALL" | "CUSTOM";
  menus: string[];
  /** Peta aksi eksplisit per menu (mode CUSTOM; kosong saat mode ALL). */
  perms: MenusMap;
  ruleCount: number;
}

interface AccessResp {
  users: AccessUser[];
  stats: { total: number; restricted: number; superAdmins: number; rules: number };
}

/** Task adv-e — field Advance Search daftar pengguna hak akses (di atas search fullName/username/role). */
const ACCESS_ADV_FIELDS: AdvFieldDef<AccessUser>[] = [
  txt("username", "Username", "Username"),
  txt("fullName", "Nama", "Name"),
  txt("email", "Email", "Email"),
  sel("role", "Role", "Role", [
    ["Admin", "Admin", "Admin"],
    ["HR Manager", "HR Manager", "HR Manager"],
    ["HR Staff", "HR Staff", "HR Staff"],
    ["Approver", "Approver", "Approver"],
    ["Viewer", "Viewer", "Viewer"],
    ["ESS", "ESS", "ESS"],
  ]),
  txt("employeeNo", "No. Karyawan", "Employee No.", (u) => u.employee?.employeeNo),
  txt("employeeName", "Karyawan", "Employee", (u) => u.employee?.fullName),
  sel("menuMode", "Mode Menu", "Menu Mode", [
    ["ALL", "Semua Menu", "All Menus"],
    ["CUSTOM", "Batasi — pilih menu", "Restrict — select menus"],
  ]),
  num("subordinateCount", "Bawahan", "Subordinates"),
  num("ruleCount", "Rule Data", "Data Rules"),
];

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
// Peta EN paralel EMPLOYMENT_STATUS_LABEL (label ID dipertahankan; render t(MAP[k], MAP_EN[k])).
const EMPLOYMENT_STATUS_LABEL_EN: Record<string, string> = {
  Permanent: "Permanent", Contract: "Contract", Probation: "Probationary", Outsourcing: "Outsourcing",
};

const ROLE_TONE: Record<string, string> = {
  Admin: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
  "HR Manager": "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85",
  Approver: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
  Viewer: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
  ESS: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-400",
};

// =================================================================
export function UserAccessView({ focusUserId, onFocusConsumed }: { focusUserId?: string | null; onFocusConsumed?: () => void }) {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<AccessResp>("/api/rekankerja/user-menu-access");
  const rulesResp = useApi<RulesResp>("/api/rekankerja/data-access-rules");
  const [selectedId, setSelectedId] = useState<string | null>(focusUserId ?? null);
  const [search, setSearch] = useState("");
  // Task adv-e — Advance Search (filter tambahan di atas search lama; seleksi & detail tetap dari daftar penuh)
  const [adv, setAdv] = useState<AdvSearch | null>(null);

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
    const advFiltered = filterRowsByAdv(users, adv, ACCESS_ADV_FIELDS);
    const q = search.trim().toLowerCase();
    if (!q) return advFiltered;
    return advFiltered.filter((u) => u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
  }, [users, search, adv]);

  // ===== simulasi =====
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ===== draft hak akses menu (per pengguna terpilih) — level AKSI =====
  const [draftMode, setDraftMode] = useState<"ALL" | "CUSTOM">("ALL");
  const [draftPerms, setDraftPerms] = useState<MenusMap>({});
  const [dirty, setDirty] = useState(false);
  const [savingMenu, setSavingMenu] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null); // dialog "Atur Aksi"

  const selKey = selected?.id ?? "none";
  const [initKey, setInitKey] = useState("");
  if (initKey !== selKey) {
    setInitKey(selKey);
    setDraftMode(selected?.menuMode ?? "ALL");
    // CUSTOM → salin peta aksi eksplisit; ALL → kosong (semua aksi aktif)
    setDraftPerms(selected?.menuMode === "CUSTOM" ? { ...(selected?.perms ?? {}) } : {});
    setDirty(false);
    setActionKey(null);
    setPreview(null);
  }

  const toggleMenu = (key: string) => {
    setDraftPerms((prev) => {
      const n = { ...prev };
      if (key in n) delete n[key];
      else n[key] = fullPermOf(key); // centang = seluruh aksi + ops eksplisit aktif
      return n;
    });
    setDirty(true);
  };
  const setModuleAll = (modId: string, on: boolean) => {
    const keys = MENU_CATALOG.find((m) => m.id === modId)?.groups.flatMap((g) => g.items.map((i) => i.key)) ?? [];
    setDraftPerms((prev) => {
      const n = { ...prev };
      for (const k of keys) {
        if (on) n[k] = fullPermOf(k); // pilih semua = aksi penuh tiap menu
        else delete n[k];
      }
      return n;
    });
    setDirty(true);
  };
  /** Tulis balik hasil dialog "Atur Aksi" ke draft (belum tersimpan ke server). */
  const applyPerm = (key: string, p: MenuPerm) => {
    setDraftPerms((prev) => ({ ...prev, [key]: p }));
    setDirty(true);
  };

  const saveMenu = async () => {
    if (!selected) return;
    const nMenu = Object.keys(draftPerms).length;
    if (draftMode === "CUSTOM" && nMenu === 0) { toast.error(t("Pilih minimal satu menu, atau gunakan mode Semua Menu", "Select at least one menu, or use the All Menus mode")); return; }
    setSavingMenu(true);
    try {
      await apiSend("/api/rekankerja/user-menu-access", "POST", {
        appUserId: selected.id,
        mode: draftMode,
        menus: draftMode === "CUSTOM" ? draftPerms : [], // objek = peta aksi (mode ALL → kosong)
      });
      const nPartial = draftMode === "CUSTOM"
        ? Object.entries(draftPerms).filter(([k, p]) => !isFullPerm(p, k)).length
        : 0;
      toast.success(t("Hak akses menu {name} disimpan", "Menu access rights for {name} saved", { name: selected.fullName }), {
        description: draftMode === "CUSTOM"
          ? (nPartial > 0 ? t("{n} menu · {m} menu tanpa aksi penuh", "{n} menus · {m} menus without full actions", { n: nMenu, m: nPartial }) : t("{n} menu · seluruh aksi penuh", "{n} menus · all actions full", { n: nMenu }))
          : t("Semua menu & seluruh aksi diizinkan", "All menus & all actions allowed"),
      });
      setDirty(false);
      refresh();
    } catch (e) {
      toast.error(t("Gagal menyimpan hak akses menu", "Failed to save menu access rights"), { description: (e as Error).message });
    } finally {
      setSavingMenu(false);
    }
  };

  const resetMenu = async () => {
    if (!selected) return;
    try {
      // M-7 (audit 42): "Kembalikan ke Default" kini menyimpan mode ALL
      // EKSPLISIT (bukan menghapus baris — menghapus konfigurasi berarti
      // default DENY sejak M-7). Tombol tetap berarti apa labelnya.
      await apiSend("/api/rekankerja/user-menu-access", "POST", {
        appUserId: selected.id,
        mode: "ALL",
        menus: [],
      });
      toast.success(t("Hak akses {name} dikembalikan ke semua menu & seluruh aksi", "Access for {name} restored to all menus & all actions", { name: selected.fullName }));
      setDraftMode("ALL");
      setDraftPerms({});
      setDirty(false);
      refresh();
    } catch (e) {
      toast.error(t("Gagal menghapus batasan menu", "Failed to remove menu restrictions"), { description: (e as Error).message });
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
      await apiSend(`/api/rekankerja/data-access-rules?id=${r.id}`, "PATCH", { active });
      toast.success(t("Rule {code} {s}", "Rule {code} {s}", { code: r.code, s: active ? t("diaktifkan", "enabled") : t("dinonaktifkan", "disabled") }));
      rulesResp.refresh();
      refresh();
    } catch (e) {
      toast.error(t("Gagal mengubah status rule", "Failed to change the rule status"), { description: (e as Error).message });
    } finally {
      setToggling(null);
    }
  };

  const removeRule = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/rekankerja/data-access-rules?id=${deleting.id}`, "DELETE");
      toast.success(t("Rule {code} dihapus", "Rule {code} deleted", { code: deleting.code }));
      setDeleting(null);
      rulesResp.refresh();
      refresh();
    } catch (e) {
      toast.error(t("Gagal menghapus rule", "Failed to delete the rule"), { description: (e as Error).message });
    }
  };

  // ===== simulasi (aksi) =====
  const runPreview = async () => {
    if (!selected) return;
    setPreviewLoading(true);
    try {
      const r = await apiSend<{ preview: Preview }>(`/api/rekankerja/data-access-rules?action=preview&userId=${encodeURIComponent(selected.id)}`, "GET");
      setPreview(r.preview);
    } catch (e) {
      toast.error(t("Gagal menjalankan simulasi", "Failed to run the simulation"), { description: (e as Error).message });
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
          { label: t("Pengguna", "Users"), value: stats?.total ?? 0, icon: UserCog },
          { label: t("Menu Dibatasi", "Restricted Menus"), value: stats?.restricted ?? 0, icon: LayoutGrid },
          { label: t("Rule Data Pengguna", "User Data Rules"), value: stats?.rules ?? 0, icon: SlidersHorizontal },
          { label: t("Super Admin (otomatis)", "Super Admins (automatic)"), value: stats?.superAdmins ?? 0, icon: Crown },
        ].map((c) => (
          <Card key={c.label} className="rounded-2xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                <c.icon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              </div>
              <div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-50">{c.value}</div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{c.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* catatan: per pengguna + akses otomatis */}
      <div className="rounded-2xl border ov-border-accent ov-soft p-4">
        <p className="flex items-center gap-2 text-[13px] font-bold">
          <ShieldCheck className="h-4 w-4" /> {t("Hak akses diatur", "Access rights are configured")} <b>{t("per pengguna", "per user")}</b> {t("— bukan per grup; pengguna dengan role sama bisa haknya berbeda", "— not per group; users with the same role can have different rights")}
        </p>
        <div className="mt-2.5 grid gap-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/50">
            <Crown className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span><b>Super Admin</b> {t("otomatis akses semua menu & data — tanpa diatur.", "automatically gets all menus & data — no setup needed.")}</span>
          </span>
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/50">
            <UserCheck className="mt-0.5 h-4 w-4 shrink-0 ov-text-accent" />
            <span><b>{t("Atasan langsung", "Direct superior")}</b> {t("otomatis mengakses data seluruh bawahannya.", "automatically accesses all of their subordinates' data.")}</span>
          </span>
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/50">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <span><b>{t("Setiap pengguna", "Every user")}</b> {t("selalu dapat mengakses data dirinya.", "can always access their own data.")}</span>
          </span>
          <span className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/50">
            <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <span>{t("Hak menu turun ke", "Menu rights go down to")} <b>{t("level aksi", "action level")}</b> {t("— Lihat/Baru/Ubah/Hapus + operasi khusus tiap menu.", "— View/Create/Update/Delete + special operations per menu.")}</span>
          </span>
        </div>
      </div>

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : error ? (
        <EmptyState title={t("Gagal memuat", "Failed to load")} description={error} icon={CircleAlert} />
      ) : users.length === 0 ? (
        <EmptyState title={t("Belum ada pengguna aplikasi", "No application users yet")} description={t("Pengguna tenant belum dibuat.", "No tenant users have been created yet.")} icon={UserCog} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* ============ daftar pengguna ============ */}
          <Card className="h-fit rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <Users className="h-4 w-4 ov-text-accent" /> {t("Pengguna ({n})", "Users ({n})", { n: users.length })}
              </CardTitle>
              <div className="mt-1 flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Cari nama / username / role…", "Search name / username / role…")} className="h-9 rounded-xl pl-8 text-xs" />
                </div>
                <AdvSearchButton fields={ACCESS_ADV_FIELDS} value={adv} onChange={setAdv} />
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
                        active ? "ov-fill shadow-md" : "hover:bg-slate-100 dark:hover:bg-slate-800",
                      )}
                    >
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold",
                        active ? "bg-white/20 text-white" : "ov-tile")}>
                        {initials(u.fullName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("flex items-center gap-1 truncate text-[13px] font-bold", active ? "text-white" : "text-slate-900 dark:text-slate-100")}>
                          {u.fullName}
                          {u.isSuperAdmin && <Crown className="h-3 w-3 shrink-0 text-amber-400" />}
                        </span>
                        <span className={cn("block truncate text-[10px]", active ? "text-white/70" : "text-slate-400")}>
                          @{u.username} · {u.role}
                          {u.menuMode === "CUSTOM" ? t(" · {n} menu", " · {n} menus", { n: u.menus.length }) : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        {u.essOnly && (
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold", active ? "bg-white/20 text-white" : "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400")}>ESS</span>
                        )}
                        {u.menuMode === "CUSTOM" && (
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold", active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400")}>{t("dibatasi", "restricted")}</span>
                        )}
                        {u.ruleCount > 0 && (
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold", active ? "bg-white/20 text-white" : "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/75")}>{t("{n} rule", "{n} rules", { n: u.ruleCount })}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
                {filteredUsers.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">{t("Tidak ada pengguna cocok.", "No matching users.")}</p>}
              </div>
            </CardContent>
          </Card>

          {/* ============ detail pengguna terpilih ============ */}
          {selected && (
            <div className="min-w-0 space-y-4">
              {/* identitas + akses otomatis */}
              <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full ov-fill text-xs font-extrabold shadow">
                      {initials(selected.fullName)}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[15px] font-bold text-slate-900 dark:text-slate-50">
                        {selected.fullName}
                        {selected.isSuperAdmin && (
                          <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                            <Crown className="h-3 w-3" /> Super Admin
                          </Badge>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        @{selected.username} · {selected.email ?? t("tanpa email", "no email")}
                        {selected.employee ? ` · ${selected.employee.employeeNo} — ${selected.employee.fullName}` : ""}
                      </p>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn("text-[10px] font-bold", ROLE_TONE[selected.role] ?? "")}>{selected.role}</Badge>
                      {selected.essOnly && (
                        <Badge variant="outline" className="gap-1 border-violet-200 bg-violet-50 text-[10px] font-bold text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400">
                          <UserRound className="h-3 w-3" /> ESS
                        </Badge>
                      )}
                      {selected.subordinateCount > 0 && (
                        <Badge variant="outline" className="gap-1 border-brand/25 bg-brand/10 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/75">
                          <UserCheck className="h-3 w-3" /> {t("{n} bawahan", "{n} subordinates", { n: selected.subordinateCount })}
                        </Badge>
                      )}
                      <Badge variant="outline" className="gap-1 border-slate-200 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        <UserRound className="h-3 w-3" /> {t("akses data diri", "own data access")}
                      </Badge>
                    </div>
                  </div>
                  {selected.isSuperAdmin && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      <Crown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {t("Super admin otomatis membuka", "Super admins automatically get")} <b>{t("semua menu", "all menus")}</b> {t("dan mengakses", "and access")} <b>{t("seluruh data karyawan", "all employee data")}</b> {t("— tidak perlu (dan tidak bisa) dibatasi di menu ini.", "— no need (and no way) to restrict them here.")}
                    </p>
                  )}
                  {selected.essOnly && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-violet-50/70 px-3 py-2 text-xs leading-relaxed text-violet-800 dark:bg-violet-500/10 dark:text-violet-300">
                      <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {t("Role ESS — terkunci", "ESS role — locked to")} <b>{t("portal ESS (Mode Karyawan) saja", "the ESS portal (Employee Mode) only")}</b>{t("; tanpa menu admin apapun. Ganti rolenya (tab Pengguna) bila perlu akses admin.", "; no admin menus at all. Change the role (Users tab) if admin access is needed.")}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* ============ akses menu ============ */}
              <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <LayoutGrid className="h-4 w-4 ov-text-accent" /> {t("Akses Menu", "Menu Access")}
                    {selected.menuMode === "CUSTOM" && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                        {t("dibatasi — {n} menu", "restricted — {n} menus", { n: selected.menus.length })}
                      </Badge>
                    )}
                  </CardTitle>
                  {dirty && <Badge variant="secondary" className="text-[10px] font-bold">{t("ada perubahan belum disimpan", "unsaved changes")}</Badge>}
                </CardHeader>
                <CardContent className="pt-0">
                  {selected.isSuperAdmin ? (
                    <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-[13px] text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                      <Crown className="h-4 w-4 shrink-0 text-amber-500" /> {t("Semua menu terbuka otomatis (super admin).", "All menus open automatically (super admin).")}
                    </p>
                  ) : selected.essOnly ? (
                    <p className="flex items-start gap-2 rounded-xl bg-violet-50 px-3 py-3 text-[13px] leading-relaxed text-violet-800 dark:bg-violet-500/10 dark:text-violet-300">
                      <UserRound className="mt-0.5 h-4 w-4 shrink-0" />
                      {t("Role ESS — hanya dapat mengakses portal ESS (Mode Karyawan); seluruh menu & aksi admin ditolak server dan tidak dapat dikonfigurasi di sini.", "ESS role — can only access the ESS portal (Employee Mode); all admin menus & actions are rejected by the server and cannot be configured here.")}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {/* mode */}
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
                          {([
                            { v: "ALL", label: t("Semua Menu", "All Menus") },
                            { v: "CUSTOM", label: t("Batasi — pilih menu", "Restrict — select menus") },
                          ] as const).map((m) => (
                            <button
                              key={m.v}
                              onClick={() => { setDraftMode(m.v); setDirty(true); }}
                              className={cn(
                                "rounded-lg px-3 py-1.5 text-[12px] font-bold transition",
                                draftMode === m.v ? "ov-fill shadow-sm" : "ov-tile text-slate-700 dark:text-slate-200",
                              )}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                        {draftMode === "CUSTOM" && (
                          <span className="text-[11px] text-slate-400">{t("{n} menu dipilih", "{n} menus selected", { n: Object.keys(draftPerms).length })}</span>
                        )}
                      </div>

                      {draftMode === "CUSTOM" ? (
                        <>
                        <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 ov-text-accent" />
                          <span>
                            {t("Menu tercentang mendapat", "Checked menus get")} <b>{t("seluruh aksi", "all actions")}</b> {t("(Baru/Ubah/Hapus + operasi khusus). Klik ikon", "(Create/Update/Delete + special operations). Click the")} <SlidersHorizontal className="inline h-3 w-3 -translate-y-px" /> {t("di samping menu untuk membatasi — ikon amber menandai menu dengan aksi terbatas.", "icon next to a menu to restrict it — the amber icon marks menus with limited actions.")}
                          </span>
                        </p>
                        <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                          {MENU_CATALOG.map((mod) => {
                            const modKeys = mod.groups.flatMap((g) => g.items.map((i) => i.key));
                            const onCount = modKeys.filter((k) => k in draftPerms).length;
                            const allOn = onCount === modKeys.length && modKeys.length > 0;
                            return (
                              <div key={mod.id} className="rounded-xl border border-slate-200 dark:border-slate-800">
                                <button
                                  onClick={() => setModuleAll(mod.id, !allOn)}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                                  aria-label={t("Pilih semua menu {label}", "Select all menus in {label}", { label: t(mod.label) })}
                                  title={t("Pilih semua = seluruh menu modul ini dengan seluruh aksi", "Select all = every menu of this module with all actions")}
                                >
                                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
                                    allOn ? "ov-fill" : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900")}>
                                    {allOn && <Check className="h-3 w-3 text-white" />}
                                  </span>
                                  <span className="flex-1 text-[12px] font-bold text-slate-700 dark:text-slate-200">{t(mod.label)}</span>
                                  <span className="text-[10px] font-bold text-slate-400">
                                    {onCount}/{modKeys.length}
                                    <span className="ml-1 font-medium text-slate-300 dark:text-slate-600">{t("· aksi penuh", "· full actions")}</span>
                                  </span>
                                </button>
                                <div className="grid gap-1 border-t border-slate-100 px-3 py-2 dark:border-slate-800/60 sm:grid-cols-2">
                                  {mod.groups.map((g) => (
                                    <div key={g.label ?? "root"} className={g.label ? "sm:col-span-2" : ""}>
                                      {g.label && <p className="px-1 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t(g.label)}</p>}
                                      <div className="grid gap-1 sm:grid-cols-2">
                                        {g.items.map((it) => {
                                          const perm = draftPerms[it.key];
                                          const on = !!perm;
                                          const full = !!perm && isFullPerm(perm, it.key);
                                          return (
                                            <div key={it.key} className="flex items-center gap-1">
                                              <button
                                                onClick={() => toggleMenu(it.key)}
                                                aria-pressed={on}
                                                className={cn(
                                                  "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition",
                                                  on
                                                    ? "ov-soft ov-border-accent"
                                                    : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-800 dark:text-slate-400",
                                                )}
                                              >
                                                <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition",
                                                  on ? "ov-fill" : "border-slate-300 dark:border-slate-600")}>
                                                  {on && <Check className="h-2.5 w-2.5 text-white" />}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate">{t(it.label)}</span>
                                                {perm && <PermSummaryBadge perm={perm} menuKey={it.key} />}
                                              </button>
                                              {on ? (
                                                <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  onClick={() => setActionKey(it.key)}
                                                  className={cn(
                                                    "h-7 w-7 shrink-0 rounded-lg",
                                                    full
                                                      ? "text-slate-400 hover:ov-soft"
                                                      : "text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-500 dark:hover:bg-amber-500/10 dark:hover:text-amber-400",
                                                  )}
                                                  aria-label={t("Atur aksi menu {label}", "Configure actions for {label}", { label: t(it.label) })}
                                                  title={t("Atur aksi — Baru/Ubah/Hapus/operasi khusus", "Configure actions — Create/Update/Delete/special operations")}
                                                >
                                                  <SlidersHorizontal className="h-3.5 w-3.5" />
                                                </Button>
                                              ) : (
                                                <span className="h-7 w-7 shrink-0" aria-hidden="true" />
                                              )}
                                            </div>
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
                        </>
                      ) : (
                        <p className="rounded-xl bg-slate-50 px-3 py-3 text-[13px] text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                          {t("Semua menu di seluruh modul terbuka dengan", "All menus across every module are open with")} <b>{t("seluruh aksi", "all actions")}</b> {t("(Baru/Ubah/Hapus/operasi khusus) untuk pengguna ini (default). Pilih", "(Create/Update/Delete/special operations) for this user (default). Choose")} <b>{t("&ldquo;Batasi — pilih menu&rdquo;", "&ldquo;Restrict — select menus&rdquo;")}</b> {t("untuk mengatur menu & aksinya secara individual.", "to configure menus & their actions individually.")}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button onClick={saveMenu} disabled={savingMenu || !dirty} className="h-9 gap-2 rounded-xl font-bold">
                          {savingMenu && <Loader2 className="h-4 w-4 animate-spin" />} {t("Simpan Hak Akses Menu", "Save Menu Access Rights")}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={resetMenu}
                          disabled={selected.menuMode !== "CUSTOM" || savingMenu}
                          className="h-9 gap-2 rounded-xl"
                          title={t("Kembalikan ke mode Semua Menu (eksplisit — semua aksi diizinkan)", "Restore to the All Menus mode (explicit — all actions allowed)")}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> {t("Kembalikan ke Default", "Restore Default")}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ============ akses data karyawan ============ */}
              <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <SlidersHorizontal className="h-4 w-4 ov-text-accent" /> {t("Akses Data Karyawan", "Employee Data Access")}
                    <Badge variant="outline" className="text-[10px] font-bold text-slate-400">{t("{n} rule aktif", "{n} active rules", { n: userRules.filter((r) => r.active).length })}</Badge>
                  </CardTitle>
                  {!selected.essOnly && (
                    <Button onClick={() => setRuleDialog({ open: true, rule: null })} className="h-9 gap-1.5 rounded-xl text-xs font-bold">
                      <Plus className="h-3.5 w-3.5" /> {t("Rule Baru", "New Rule")}
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {selected.essOnly ? (
                    <p className="flex items-start gap-2 rounded-xl bg-violet-50 px-3 py-3 text-[13px] leading-relaxed text-violet-800 dark:bg-violet-500/10 dark:text-violet-300">
                      <UserRound className="mt-0.5 h-4 w-4 shrink-0" />
                      {t("Role ESS tidak memerlukan rule akses data — di portal ESS pengguna hanya melihat data dirinya sendiri (self-scope, otomatis).", "The ESS role needs no data access rules — in the ESS portal the user only sees their own data (self-scope, automatic).")}
                    </p>
                  ) : (
                    <>
                    <p className="mb-3 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 ov-text-accent" />
                      {t("Rule parametrik", "Parametric rule")} <b>{t("untuk {name}", "for {name}", { name: selected.fullName })}</b> {t("— karyawan yang dapat diakses sesuai penempatan (semua kriteria terpilih = AND). Tanpa kriteria = akses penuh. Bawahan langsung & data diri selalu otomatis.", "— accessible employees follow their placement (all selected criteria = AND). No criteria = full access. Direct subordinates & own data are always automatic.")}
                    </p>
                    {rulesResp.loading && !rulesResp.data ? (
                      <LoadingRows rows={3} />
                    ) : userRules.length === 0 ? (
                      <EmptyState
                        title={t("Belum ada rule akses data", "No data access rules yet")}
                        description={t(
                          "{name} hanya dapat mengakses data dirinya{sub}{sa}. Buat rule parametrik untuk memperluas cakupan.",
                          "{name} can only access their own data{sub}{sa}. Create a parametric rule to widen the scope.",
                          {
                            name: selected.fullName,
                            sub: selected.subordinateCount > 0 ? t(" dan {n} bawahannya (otomatis)", " and their {n} subordinates (automatic)", { n: selected.subordinateCount }) : "",
                            sa: selected.isSuperAdmin ? t(", serta seluruh data sebagai super admin", ", plus all data as a super admin") : "",
                          },
                        )}
                        icon={SlidersHorizontal}
                      />
                    ) : (
                      <div className="space-y-2.5">
                        {userRules.map((r) => (
                          <UserRuleCard key={r.id} r={r} busy={toggling === r.id} onToggle={(v) => toggleRule(r, v)} onEdit={() => setRuleDialog({ open: true, rule: r })} onDelete={() => setDeleting(r)} />
                        ))}
                      </div>
                    )}
                    </>
                  )}
                </CardContent>
              </Card>

              {/* ============ simulasi ============ */}
              <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <Wand2 className="h-4 w-4 ov-text-accent" /> {t("Simulasi Akses Efektif", "Effective Access Simulation")}
                  </CardTitle>
                  <Button variant="outline" onClick={runPreview} disabled={previewLoading} className="h-9 gap-2 rounded-xl text-xs font-bold">
                    {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} {t("Jalankan Simulasi", "Run Simulation")}
                  </Button>
                </CardHeader>
                <CardContent className="pt-0">
                  {!preview ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-3 text-[13px] text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                      {t("Lihat cakupan efektif {name} — gabungan akses otomatis (super admin, atasan langsung, diri sendiri) dan rule parametriknya.", "See {name}'s effective scope — the combination of automatic access (super admin, direct superior, self) and their parametric rules.", { name: selected.fullName })}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className={cn(
                        "flex items-center gap-3 rounded-2xl border px-4 py-3",
                        preview.all
                          ? "border-amber-200 bg-amber-50/70 dark:border-amber-500/25 dark:bg-amber-500/10"
                          : "border-brand/25 bg-brand/10 dark:border-brand/25 dark:bg-brand/10",
                      )}>
                        {preview.all ? <Crown className="h-5 w-5 text-amber-500" /> : <ShieldCheck className="h-5 w-5 text-brand" />}
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-50">
                            {preview.all ? t("Akses penuh — seluruh data karyawan", "Full access — all employee data") : t("{n} karyawan dapat diakses", "{n} employees accessible", { n: preview.accessibleCount })}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {preview.all ? t("Semua karyawan terlihat di direktori & detail.", "All employees are visible in the directory & details.") : t("Hanya karyawan dalam cakupan ini yang terlihat di direktori & detail.", "Only employees within this scope are visible in the directory & details.")}
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                          <Network className="h-3.5 w-3.5" /> {t("Sumber akses", "Access Sources")}
                        </p>
                        <div className="max-h-40 space-y-1.5 overflow-y-auto">
                          {preview.sources.length === 0 && (
                            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                              {t("Tidak ada akses data karyawan lain — hanya data diri (tanpa bawahan/rule/super admin).", "No access to other employees' data — own data only (no subordinates/rules/super admin).")}
                            </p>
                          )}
                          {preview.sources.map((s, i) => (
                            <p key={i} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                              <UserCog className="h-3.5 w-3.5 shrink-0 ov-text-accent" /> {s}
                            </p>
                          ))}
                        </div>
                      </div>

                      {!preview.all && preview.sample.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{t("Contoh karyawan dalam cakupan", "Sample employees in scope")}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {preview.sample.map((e) => (
                              <Badge key={e.id} variant="outline" className="rounded-lg border-slate-200 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                {e.fullName} · {e.employeeNo}
                              </Badge>
                            ))}
                            {preview.accessibleCount > preview.sample.length && (
                              <Badge variant="outline" className="rounded-lg border-slate-200 text-[11px] text-slate-400 dark:border-slate-700">
                                {t("+{n} lainnya", "+{n} more", { n: preview.accessibleCount - preview.sample.length })}
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
            <AlertDialogTitle>{t("Hapus rule {code}?", "Delete rule {code}?", { code: deleting?.code ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Rule &ldquo;{name}&rdquo; untuk {user} akan dihapus. Pengguna kembali hanya memiliki akses otomatis (diri sendiri, bawahan langsung, atau semua bila super admin).", "Rule &ldquo;{name}&rdquo; for {user} will be deleted. The user goes back to automatic access only (self, direct subordinates, or everything if a super admin).", { name: deleting?.name ?? "", user: selected?.fullName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={removeRule} className="bg-rose-600 hover:bg-rose-700">{t("Hapus")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* dialog "Atur Aksi" per menu — draft tidak berubah sampai Simpan */}
      {actionKey && draftPerms[actionKey] && (
        <MenuActionDialog
          menuKey={actionKey}
          menuLabel={menuLabelOf(actionKey)}
          perm={draftPerms[actionKey]}
          onClose={() => setActionKey(null)}
          onSave={(p) => { applyPerm(actionKey, p); setActionKey(null); }}
        />
      )}
    </div>
  );
}

// ================= kartu rule (per pengguna) =================

function UserRuleCard({ r, busy, onToggle, onEdit, onDelete }: {
  r: Rule; busy: boolean;
  onToggle: (v: boolean) => void; onEdit: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const criteria: { label: string; icon: React.ElementType }[] = [];
  if (r.companyOffice) criteria.push({ label: t("Kantor: {v}", "Office: {v}", { v: r.companyOffice.name }), icon: Building2 });
  if (r.workLocation) criteria.push({ label: t("Lokasi: {v}", "Location: {v}", { v: r.workLocation.name }), icon: MapPin });
  if (r.orgUnit) criteria.push({ label: t("Unit: {v}", "Unit: {v}", { v: r.orgUnit.name }), icon: Network });
  if (r.position) criteria.push({ label: t("Posisi: {v}", "Position: {v}", { v: r.position.title }), icon: BriefcaseBusiness });
  if (r.grade) criteria.push({ label: t("Grade: {c} — {v}", "Grade: {c} — {v}", { c: r.grade.code, v: r.grade.name }), icon: GraduationCap });
  if (r.positionLevel) criteria.push({ label: t("Level: {c} — {v}", "Level: {c} — {v}", { c: r.positionLevel.code, v: r.positionLevel.name }), icon: TrendingUp });
  if (r.employmentStatus) criteria.push({ label: t("Status: {v}", "Status: {v}", { v: t(EMPLOYMENT_STATUS_LABEL[r.employmentStatus] ?? r.employmentStatus, EMPLOYMENT_STATUS_LABEL_EN[r.employmentStatus] ?? r.employmentStatus) }), icon: BadgeCheck });

  return (
    <Card className={cn("rounded-2xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900", !r.active && "opacity-60")}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{r.code}</span>
              <span className="font-semibold text-slate-900 dark:text-slate-50">{r.name}</span>
              {!r.active && <Badge variant="secondary" className="rounded-lg text-[10px]">{t("Nonaktif")}</Badge>}
            </div>
            {r.description && <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">{r.description}</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {criteria.length === 0 ? (
                <Badge variant="outline" className="gap-1 rounded-lg border-brand/25 bg-brand/10 text-[11px] text-brand-deep dark:border-brand/70 dark:bg-brand/90 dark:text-brand/75">
                  <ShieldCheck className="h-3 w-3" /> {t("Akses penuh — semua karyawan (tanpa kriteria)", "Full access — all employees (no criteria)")}
                </Badge>
              ) : criteria.map((c, i) => (
                <Badge key={i} variant="outline" className="gap-1 rounded-lg border-amber-200 bg-amber-50 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <c.icon className="h-3 w-3" /> {c.label}
                </Badge>
              ))}
              <Badge variant="outline" className="rounded-lg border-slate-300 text-[10px] text-slate-400 dark:border-slate-600">{t("prioritas {n}", "priority {n}", { n: r.priority })}</Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch checked={r.active} disabled={busy} onCheckedChange={onToggle} aria-label={t("Aktifkan rule", "Enable rule")} />
            <Button size="icon" variant="ghost" onClick={onEdit} className="h-8 w-8 rounded-lg" aria-label={t("Ubah")}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete} className="h-8 w-8 rounded-lg text-rose-600 hover:text-rose-700" aria-label={t("Hapus")}>
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
  const { t } = useI18n();
  const [d, setD] = useState<RuleDraft>(draftFrom(rule, suggestedCode));
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<RuleDraft>) => setD((cur) => ({ ...cur, ...patch }));

  const anyCriteria = !!(d.companyOfficeId || d.workLocationId || d.orgUnitId || d.positionId || d.gradeId || d.positionLevelId || d.employmentStatus);

  const save = async () => {
    if (!d.code.trim() || !d.name.trim()) { toast.error(t("Kode & nama rule wajib diisi", "Rule code & name are required")); return; }
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
      await apiSend(rule ? `/api/rekankerja/data-access-rules?id=${rule.id}` : "/api/rekankerja/data-access-rules", rule ? "PATCH" : "POST", body);
      toast.success(rule ? t("Rule {code} diperbarui", "Rule {code} updated", { code: d.code }) : t("Rule {code} dibuat untuk {name}", "Rule {code} created for {name}", { code: d.code, name: user.fullName }));
      onDone();
    } catch (e) {
      toast.error(t("Gagal menyimpan rule", "Failed to save the rule"), { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const refs = resp.references;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? t("Ubah Rule {code}", "Edit Rule {code}", { code: rule.code }) : t("Rule Akses Data Baru — {name}", "New Data Access Rule — {name}", { name: user.fullName })}</DialogTitle>
          <DialogDescription>
            {t("Rule ini milik", "This rule belongs to")} <b>{user.fullName}</b> (@{user.username}) {t("— hak akses diatur per pengguna. Karyawan yang dapat diakses sesuai penempatan (semua terpilih = AND); kosongkan semua kriteria untuk akses penuh.", "— access rights are configured per user. Accessible employees follow their placement (all selected = AND); leave all criteria empty for full access.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
            <span className="flex h-8 w-8 items-center justify-center rounded-full ov-tile text-[10px] font-extrabold">{initials(user.fullName)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-slate-900 dark:text-slate-50">{t("Subjek: {name}", "Subject: {name}", { name: user.fullName })}</p>
              <p className="text-[10px] text-slate-400">{t("@{u} · {r} — tetap, tidak bisa diubah", "@{u} · {r} — fixed, cannot be changed", { u: user.username, r: user.role })}</p>
            </div>
            <Badge variant="outline" className="ov-soft ov-border-accent text-[10px] font-bold">{t("per pengguna", "per user")}</Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ra-code">{t("Kode")}</Label>
              <Input id="ra-code" value={d.code} onChange={(e) => set({ code: e.target.value })} placeholder="ACC-MII000006-R1" className="rounded-xl" disabled={!!rule} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ra-name">{t("Nama Rule", "Rule Name")}</Label>
              <Input id="ra-name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("Operasional Produksi — Kantor Surabaya", "Production Operations — Surabaya Office")} className="rounded-xl" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800 dark:text-slate-100">
              <SlidersHorizontal className="h-4 w-4 ov-text-accent" /> {t("Kriteria sasaran — karyawan yang dapat diakses {name}", "Target criteria — employees accessible to {name}", { name: user.fullName })}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {([
                { key: "companyOfficeId" as const, label: t("Kantor", "Office"), items: (refs?.offices ?? []).map((o) => ({ value: o.id, label: `${o.name}${o.city ? ` — ${o.city}` : ""}` })) },
                { key: "workLocationId" as const, label: t("Lokasi Kerja", "Work Location"), items: (refs?.locations ?? []).map((l) => ({ value: l.id, label: `${l.name}${l.city ? ` — ${l.city}` : ""}` })) },
                { key: "orgUnitId" as const, label: t("Unit Organisasi"), items: (refs?.units ?? []).map((u) => ({ value: u.id, label: u.name })) },
                { key: "positionId" as const, label: t("Posisi"), items: (refs?.positions ?? []).map((p) => ({ value: p.id, label: p.title })) },
                { key: "gradeId" as const, label: "Grade", items: (refs?.grades ?? []).map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` })) },
                { key: "positionLevelId" as const, label: t("Level Jabatan", "Job Level"), items: (refs?.levels ?? []).map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })) },
                { key: "employmentStatus" as const, label: t("Status Kerja", "Employment Status"), items: (resp?.employmentStatuses ?? []).map((s) => ({ value: s, label: t(EMPLOYMENT_STATUS_LABEL[s] ?? s, EMPLOYMENT_STATUS_LABEL_EN[s] ?? s) })) },
              ]).map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-xs text-slate-500">{f.label}</Label>
                  <Select value={d[f.key] || "__all"} onValueChange={(v) => set({ [f.key]: v === "__all" ? "" : v } as Partial<RuleDraft>)}>
                    <SelectTrigger className="h-10 rounded-xl bg-white dark:bg-slate-900"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">{t("Semua (tanpa filter)", "All (no filter)")}</SelectItem>
                      {f.items.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {!anyCriteria && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-brand/10 px-3 py-2 text-xs leading-relaxed text-brand-deep dark:bg-brand/10 dark:text-brand/75">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("Tanpa kriteria apa pun, rule ini memberi", "With no criteria at all, this rule grants")} <b>{t("akses penuh", "full access")}</b> {t("ke seluruh data karyawan bagi {name}.", "to all employee data for {name}.", { name: user.fullName })}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ra-priority">{t("Prioritas (urutan evaluasi)", "Priority (evaluation order)")}</Label>
              <Input id="ra-priority" type="number" value={d.priority} onChange={(e) => set({ priority: e.target.value })} className="rounded-xl" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={d.active} onCheckedChange={(v) => set({ active: v })} id="ra-active" />
              <Label htmlFor="ra-active">{t("Rule aktif", "Rule active")}</Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ra-desc">{t("Deskripsi (opsional)", "Description (optional)")}</Label>
            <Textarea id="ra-desc" value={d.description} onChange={(e) => set({ description: e.target.value })} rows={2} className="rounded-xl" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="h-10 rounded-xl">{t("Batal")}</Button>
          <Button onClick={save} disabled={saving} className="h-10 gap-2 rounded-xl font-bold">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t("Simpan Rule", "Save Rule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= badge ringkasan aksi (chip menu tercentang) =================

// Peta EN paralel aksi dasar (label & hint ID tetap di lib/menu-perms).
const MENU_ACTION_LABEL_EN: Record<string, string> = {
  view: "View", create: "Create", update: "Update", delete: "Delete",
};
const MENU_ACTION_HINT_EN: Record<string, string> = {
  view: "Open the menu and see its data",
  create: "Add new data (add / submit buttons)",
  update: "Edit existing data",
  delete: "Delete data",
};

// Peta EN paralel katalog operasi khusus menu (label & hint ID tetap di lib/menu-perms).
const MENU_OPS_LABEL_EN: Record<string, string> = {
  "Menyetujui / menolak pengajuan": "Approve / reject requests",
  "Menghitung payroll": "Calculate payroll",
  "Finalisasi run": "Finalize a run",
  "Menandai dibayar": "Mark as paid",
  "Membatalkan run": "Cancel a run",
  "Mengekspor slip & hasil": "Export payslips & results",
  "Menyetujui / menolak klaim benefit": "Approve / reject benefit claims",
  "Menjadwalkan pembayaran": "Schedule payment",
  "Menyetujui / menolak lembur": "Approve / reject overtime",
  "Menyetujui / menolak work off": "Approve / reject work off",
  "Mengakhiri penugasan jadwal": "End schedule assignment",
  "Membatalkan pengajuan cuti": "Cancel leave requests",
  "Menyetujui / menolak cuti": "Approve / reject leave",
  "Menyetujui / menolak encashment": "Approve / reject encashment",
  "Membatalkan permintaan travel": "Cancel travel requests",
  "Menyetujui / menolak travel": "Approve / reject travel",
  "Membatalkan klaim travel": "Cancel travel claims",
  "Menyetujui / menolak klaim": "Approve / reject claims",
  "Transfer dana settlement": "Transfer settlement funds",
  "Mengajukan klaim ke settlement": "Submit a claim to settlement",
  "Membatalkan klaim medis": "Cancel medical claims",
  "Menyetujui / menolak / mengembalikan klaim": "Approve / reject / return claims",
  "Settlement klaim": "Settle claims",
  "Menyetujui / menolak penyesuaian saldo": "Approve / reject balance adjustments",
  "Mengirim email uji": "Send test emails",
};
const MENU_OPS_HINT_EN: Record<string, string> = {
  "Aksi Setujui & Tolak di kotak persetujuan": "The Approve & Reject actions in the approval inbox",
  "Aksi Setujui & Tolak pada daftar semua pengajuan": "The Approve & Reject actions on the all-requests list",
  "Menjalankan kalkulasi run gaji": "Runs the payroll run calculation",
  "Mengunci & memfinalisasi hasil payroll": "Locks & finalizes the payroll results",
  "Menandai run sudah dibayarkan": "Marks the run as paid",
  "Membatalkan run payroll draft": "Cancels a draft payroll run",
  "Mengunduh slip gaji / hasil run": "Downloads payslips / run results",
  "Memutuskan klaim benefit karyawan": "Decides employee benefit claims",
  "Menjadwalkan klaim ke periode bayar": "Schedules a claim into a pay period",
  "Menandai klaim benefit terbayar": "Marks a benefit claim as paid",
  "Memutuskan pengajuan lembur (overtime)": "Decides overtime requests",
  "Memutuskan izin work off": "Decides work-off permits",
  "Mengakhiri assign jadwal karyawan": "Ends an employee's schedule assignment",
  "Membatalkan permintaan cuti (draft/pending)": "Cancels a leave request (draft/pending)",
  "Aksi Setujui & Tolak pada persetujuan cuti": "The Approve & Reject actions on leave approvals",
  "Memutuskan pengajuan uang pengganti cuti": "Decides leave encashment requests",
  "Membatalkan permintaan perjalanan dinas": "Cancels a business travel request",
  "Aksi Setujui & Tolak pada persetujuan travel": "The Approve & Reject actions on travel approvals",
  "Membatalkan klaim & settlement": "Cancels a claim & settlement",
  "Memutuskan klaim & settlement travel": "Decides travel claims & settlements",
  "Menandatangani transfer dana klaim disetujui": "Signs off the fund transfer of an approved claim",
  "Mengirim klaim ke proses persetujuan": "Sends a claim into the approval process",
  "Membatalkan klaim yang belum diputuskan": "Cancels an undecided claim",
  "Memutuskan nasib klaim medis": "Decides the fate of medical claims",
  "Menyelesaikan klaim (dibayarkan ke provider)": "Settles a claim (paid to the provider)",
  "Memutuskan penyesuaian saldo medis": "Decides medical balance adjustments",
  "Tombol Tes Kirim pada konfigurasi SMTP": "The Test Send button in the SMTP configuration",
};

function PermSummaryBadge({ perm, menuKey }: { perm: MenuPerm; menuKey: string }) {
  const { t } = useI18n();
  const ops = opsOf(menuKey);
  const opsOn = ops.filter((o) => perm.ops[o.key] !== false).length;
  const crudOn = (perm.create ? 1 : 0) + (perm.update ? 1 : 0) + (perm.delete ? 1 : 0);
  if (isFullPerm(perm, menuKey)) {
    return (
      <span className="shrink-0 rounded-md border border-slate-300/70 bg-slate-100 px-1 py-px text-[9px] font-bold leading-4 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        {t("semua aksi", "all actions")}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-1 py-px text-[9px] font-bold leading-4 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
      {t("Lihat · {n} aksi{ops}", "View · {n} actions{ops}", { n: crudOn, ops: ops.length > 0 ? ` · ${opsOn}/${ops.length} ops` : "" })}
    </span>
  );
}

// ================= dialog "Atur Aksi" (per menu — level aksi) =================
// State LOKAL: draft di komponen induk tidak disentuh sampai tombol
// "Simpan" ditekan (onSave → applyPerm → dirty).

function MenuActionDialog({ menuKey, menuLabel, perm, onClose, onSave }: {
  menuKey: string; menuLabel: string; perm: MenuPerm;
  onClose: () => void; onSave: (p: MenuPerm) => void;
}) {
  const { t } = useI18n();
  const ops = opsOf(menuKey);
  const [crud, setCrud] = useState<Record<MenuAction, boolean>>({
    view: true, create: perm.create, update: perm.update, delete: perm.delete,
  });
  const [opOn, setOpOn] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    for (const o of ops) s[o.key] = perm.ops[o.key] !== false; // tak disebut = boleh
    return s;
  });

  const setAction = (k: MenuAction, v: boolean) => setCrud((c) => {
    const n: Record<MenuAction, boolean> = { ...c };
    n[k] = v;
    return n;
  });
  const setOp = (k: string, v: boolean) => setOpOn((s) => ({ ...s, [k]: v }));

  /** Reset ke seluruh aksi dasar + seluruh operasi khusus aktif. */
  const setFull = () => {
    setCrud({ view: true, create: true, update: true, delete: true });
    const s: Record<string, boolean> = {};
    for (const o of ops) s[o.key] = true;
    setOpOn(s);
  };

  const save = () => {
    onSave({
      view: true, // menu diizinkan → Lihat terkunci aktif
      create: crud.create,
      update: crud.update,
      delete: crud.delete,
      ops: { ...perm.ops, ...opOn }, // ops non-katalog (data lama) dipertahankan
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Atur Aksi — {label}", "Configure Actions — {label}", { label: t(menuLabel) })}</DialogTitle>
          <DialogDescription>
            {t("Hak aksi pada menu", "Action rights on menu")} <b>{t(menuLabel)}</b> <span className="font-mono text-[11px] text-slate-400">({menuKey})</span> {t("untuk pengguna terpilih. Matikan aksi yang tidak diizinkan —", "for the selected user. Turn off actions that are not allowed —")} <b>{t("Lihat", "View")}</b> {t("selalu aktif selama menu diizinkan.", "stays on as long as the menu is allowed.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* aksi dasar CRUD */}
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800 dark:text-slate-100">
              <ShieldCheck className="h-4 w-4 ov-text-accent" /> {t("Aksi Dasar", "Basic Actions")}
            </p>
            {MENU_ACTION_DEFS.map((d) => {
              const locked = d.key === "view";
              return (
                <div key={d.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="min-w-0">
                    <Label htmlFor={`ma-${menuKey}-${d.key}`} className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
                      {t(d.label, MENU_ACTION_LABEL_EN[d.key] ?? d.label)}
                      {locked && <span className="ml-1.5 rounded-md bg-brand/15 px-1 py-px text-[9px] font-bold text-brand-deep dark:bg-brand/15 dark:text-brand/85">{t("terkunci", "locked")}</span>}
                    </Label>
                    <p className="text-[11px] leading-snug text-slate-400">{locked ? t("Aktif karena menu diizinkan", "On because the menu is allowed") : t(d.hint, MENU_ACTION_HINT_EN[d.key] ?? d.hint)}</p>
                  </div>
                  <Switch
                    id={`ma-${menuKey}-${d.key}`}
                    checked={locked ? true : crud[d.key]}
                    disabled={locked}
                    onCheckedChange={(v) => setAction(d.key, v)}
                    aria-label={t(d.label, MENU_ACTION_LABEL_EN[d.key] ?? d.label)}
                  />
                </div>
              );
            })}
          </div>

          {/* operasi khusus menu */}
          {ops.length > 0 && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800 dark:text-slate-100">
                <SlidersHorizontal className="h-4 w-4 ov-text-accent" /> {t("Operasi Khusus Menu", "Menu Special Operations")}
              </p>
              <p className="text-[11px] leading-snug text-slate-400">{t("Operasi spesifik pada menu ini — masing-masing dapat diizinkan atau dibatasi.", "Operations specific to this menu — each can be allowed or restricted.")}</p>
              {ops.map((o) => (
                <div key={o.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="min-w-0">
                    <Label htmlFor={`mo-${menuKey}-${o.key}`} className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{t(o.label, MENU_OPS_LABEL_EN[o.label] ?? o.label)}</Label>
                    {o.hint && <p className="text-[11px] leading-snug text-slate-400">{t(o.hint, MENU_OPS_HINT_EN[o.hint] ?? o.hint)}</p>}
                  </div>
                  <Switch id={`mo-${menuKey}-${o.key}`} checked={opOn[o.key]} onCheckedChange={(v) => setOp(o.key, v)} aria-label={t(o.label, MENU_OPS_LABEL_EN[o.label] ?? o.label)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={setFull} className="h-10 gap-2 rounded-xl" title={t("Aktifkan seluruh aksi dasar & operasi khusus", "Turn on all basic actions & special operations")}>
            <RotateCcw className="h-3.5 w-3.5" /> {t("Semua Aksi", "All Actions")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="h-10 rounded-xl">{t("Batal")}</Button>
            <Button onClick={save} className="h-10 gap-2 rounded-xl font-bold">{t("Simpan")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
