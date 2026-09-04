"use client";
// OneVity App Shell — obsidian sidebar (module dropdown + nav per modul) + topbar + command palette
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNav, SectionId, ModuleId, MODULE_LABEL, moduleOfSection } from "@/onevity/shared/lib/store";
import { useApi, initials, fmtDateTime } from "@/onevity/shared/lib/api";
import { useSession } from "@/onevity/shared/lib/session-store";
import { MenuPermsProvider } from "@/onevity/shared/lib/menu-perms-context";
import { actionAllowed, type MenusMap } from "@/onevity/shared/lib/menu-perms";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CommandInput, CommandEmpty, CommandGroup, CommandItem, CommandList, Command } from "@/components/ui/command";
import {
  LayoutDashboard, Users, Workflow, Settings2, ChevronDown, Check,
  Network, Landmark, BriefcaseBusiness, GraduationCap, UserPlus, Inbox, Coins, Calculator, Building2,
  Scale, ShieldCheck, ShieldOff, Layers, Bell, Moon, Sun, Search, Command as CommandIcon, Plus, LogOut,
  UserCog, Menu, X, ChevronRight, Activity, Clock, CheckCircle2, FileText, Trash2, Pencil, Waypoints, XCircle, HeartHandshake,
  Wallet, CalendarRange, PlayCircle, LayoutTemplate, IdCard, ArrowLeftRight, Percent,
  CalendarClock, Palmtree, Plane, HeartPulse, Boxes, Sparkles, FileSpreadsheet, BookOpen, BarChart3,
  Hospital, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  id: string; // view id
  label: string;
  icon: React.ElementType;
  badge?: "pending" | "runsDraft" | "benefitPending";
}

interface NavGroup {
  section: SectionId;
  label?: string; // undefined = item mandiri tanpa grup (Dashboard / Ringkasan)
  children: NavItem[];
  matchViews?: string[]; // view tambahan yang tetap men-highlight grup ini (mis. detail run)
}

// ============ MODULE REGISTRY ============
export const MODULES: { id: ModuleId; label: string; short: string; icon: React.ElementType; ready: boolean }[] = [
  { id: "hr", label: "Human Resource Base", short: "HR Base", icon: Users, ready: true },
  { id: "payroll", label: "Payroll", short: "Payroll", icon: Coins, ready: true },
  { id: "attendance", label: "Attendance", short: "Attendance", icon: CalendarClock, ready: true },
  { id: "leave", label: "Leave", short: "Leave", icon: Palmtree, ready: true },
  { id: "travel", label: "Travel", short: "Travel", icon: Plane, ready: true },
  { id: "medical", label: "Medical", short: "Medical", icon: HeartPulse, ready: true },
];

// ============ NAV PER MODULE ============
// Struktur menu stabil: semua grup & item selalu tampil dalam modul aktif.

const HR_NAV: NavGroup[] = [
  { section: "dashboard", children: [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  ] },
  { section: "org", label: "Perusahaan & Organisasi", children: [
    { id: "companies", label: "Perusahaan", icon: Landmark },
    { id: "offices", label: "Kantor & Lokasi Kerja", icon: Building2 },
    { id: "tree", label: "Unit Organisasi", icon: Network },
    { id: "chart", label: "Peta Organisasi", icon: Waypoints },
  ] },
  { section: "position", label: "Posisi & Jabatan", children: [
    { id: "list", label: "Daftar Posisi", icon: BriefcaseBusiness },
    { id: "jobs", label: "Katalog Jabatan", icon: FileText },
    { id: "grades", label: "Grade & Level", icon: GraduationCap },
    { id: "levels", label: "Level Jabatan", icon: TrendingUp },
  ] },
  { section: "employee", label: "Karyawan", children: [
    { id: "directory", label: "Direktori Karyawan", icon: Users },
    { id: "wizard", label: "Onboarding Karyawan", icon: UserPlus },
    { id: "disciplinary", label: "Catatan Disiplin", icon: Scale },
  ] },
  { section: "actions", label: "Pengajuan & Persetujuan", children: [
    { id: "inbox", label: "Menunggu Persetujuan", icon: Inbox, badge: "pending" },
    { id: "all", label: "Semua Pengajuan", icon: Workflow },
  ] },
];

const PAYROLL_NAV: NavGroup[] = [
  { section: "payroll", children: [
    { id: "overview", label: "Ringkasan", icon: LayoutDashboard },
  ] },
  { section: "payroll", label: "Periode & Proses", children: [
    { id: "periods", label: "Periode Payroll", icon: CalendarRange },
    { id: "runs", label: "Proses & Hasil", icon: PlayCircle, badge: "runsDraft" },
  ], matchViews: ["run"] },
  { section: "payroll", label: "Master Data", children: [
    { id: "components", label: "Komponen Upah", icon: Coins },
    { id: "templates", label: "Template Upah", icon: LayoutTemplate },
    { id: "profiles", label: "Data Gaji Karyawan", icon: IdCard },
  ] },
  { section: "payroll", label: "Transaksi", children: [
    { id: "transactions", label: "Transaksi & Rapel", icon: ArrowLeftRight },
    { id: "benefits", label: "Benefit Karyawan", icon: HeartHandshake, badge: "benefitPending" },
  ] },
  { section: "payroll", label: "Laporan Tahunan", children: [
    { id: "spt", label: "SPT & Pajak (1721-A1)", icon: FileSpreadsheet },
  ] },
  { section: "payroll", label: "Parameter", children: [
    { id: "parameters", label: "Parameter Pajak", icon: Percent },
    { id: "accounting", label: "Akun & Posting", icon: Calculator },
    { id: "journals", label: "Jurnal Payroll", icon: BookOpen },
  ] },
];

// Modul Attendance — terinspirasi struktur menu Time Attendance oranHR (28 halaman → 8 view).
const ATTENDANCE_NAV: NavGroup[] = [
  { section: "attendance", children: [{ id: "schedules", label: "Ringkasan", icon: LayoutDashboard }] },
  { section: "attendance", label: "Jadwal & Shift", children: [
    { id: "templates-schedule", label: "Template Jadwal", icon: CalendarClock },
    { id: "assignment-schedule", label: "Assign Jadwal", icon: CalendarRange },
    { id: "matrix", label: "Matriks Jadwal", icon: Layers },
  ] },
  { section: "attendance", label: "Kehadiran", children: [
    { id: "clocking", label: "Data Clocking", icon: Activity },
    { id: "absence", label: "Absensi & Izin", icon: XCircle },
    { id: "overtime", label: "Lembur (Overtime)", icon: Clock },
    { id: "workoff", label: "Work Off Permission", icon: CheckCircle2 },
  ] },
];

const LEAVE_NAV: NavGroup[] = [
  { section: "leave", children: [{ id: "balances", label: "Ringkasan", icon: LayoutDashboard }] },
  { section: "leave", label: "Cuti Karyawan", children: [
    { id: "leave-info", label: "Informasi Cuti (Saldo)", icon: Palmtree },
    { id: "leave-request", label: "Permintaan Cuti", icon: Inbox },
    { id: "leave-approval", label: "Persetujuan", icon: CheckCircle2 },
    { id: "leave-mass", label: "Cuti Massal (SKB)", icon: Users },
  ] },
  { section: "leave", label: "Pengaturan & Integrasi", children: [
    { id: "leave-type", label: "Jenis Cuti", icon: Layers },
    { id: "leave-encashment", label: "Uang Pengganti Cuti", icon: Wallet },
    { id: "leave-reports", label: "Laporan Cuti", icon: BarChart3 },
  ] },
];

const TRAVEL_NAV: NavGroup[] = [
  { section: "travel", children: [{ id: "requests", label: "Ringkasan", icon: LayoutDashboard }] },
  { section: "travel", label: "Perjalanan Dinas", children: [
    { id: "travel-request", label: "Permintaan Travel", icon: Plane },
    { id: "travel-approval", label: "Persetujuan", icon: CheckCircle2 },
    { id: "travel-claim", label: "Klaim & Settlement", icon: FileText },
    { id: "travel-claim-approval", label: "Approval Klaim & Transfer", icon: Landmark },
    { id: "travel-budget", label: "Budget Travel", icon: Wallet },
  ] },
  { section: "travel", label: "Master & Laporan", children: [
    { id: "travel-templates", label: "Master Travel", icon: Boxes },
    { id: "travel-reports", label: "Laporan Travel", icon: BarChart3 },
  ] },
];

const MEDICAL_NAV: NavGroup[] = [
  { section: "medical", children: [{ id: "claims", label: "Ringkasan", icon: LayoutDashboard }] },
  { section: "medical", label: "Benefit Medis", children: [
    { id: "medical-info", label: "Saldo Medis Karyawan", icon: HeartPulse },
    { id: "medical-claim", label: "Klaim Medis", icon: Activity },
    { id: "medical-approval", label: "Persetujuan & Settlement", icon: CheckCircle2 },
    { id: "medical-adjustment", label: "Penyesuaian Saldo", icon: ArrowLeftRight },
  ] },
  { section: "medical", label: "Master & Laporan", children: [
    { id: "medical-benefit-type", label: "Jenis Benefit", icon: Boxes },
    { id: "medical-providers", label: "Rumah Sakit & Asuransi", icon: Hospital },
    { id: "medical-reports", label: "Laporan Medis", icon: BarChart3 },
  ] },
];

// Pengaturan sistem — cross-module, selalu tampil di bagian bawah sidebar semua modul.
export const SETTINGS_NAV: NavGroup[] = [
  { section: "settings", label: "Pengaturan Sistem", children: [
    { id: "lookups", label: "Data Master", icon: Layers },
    { id: "security", label: "Keamanan & Akses", icon: ShieldCheck },
    { id: "approval", label: "Approval Berjenjang", icon: CheckCircle2 },
  ] },
];

export function navOfModule(m: ModuleId): NavGroup[] {
  switch (m) {
    case "payroll": return PAYROLL_NAV;
    case "attendance": return ATTENDANCE_NAV;
    case "leave": return LEAVE_NAV;
    case "travel": return TRAVEL_NAV;
    case "medical": return MEDICAL_NAV;
    default: return HR_NAV;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { section, view, params, module, navigate, setModule, syncFromUrl } = useNav();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const session = useSession();
  const sessionUser = session.info?.user;
  const sessionTenant = session.info?.tenant;
  const meta = useApi<{ pendingActions: number; activeEmployees: number; payrollDraftRuns: number; benefitPendingClaims: number; company: { name: string; shortName: string } | null }>("/api/onevity/meta");

  // ===== hak aksi MENU per pengguna (Task 31 + 32) =====
  // ALL (default/super admin) → semua menu & seluruh aksi; CUSTOM → hanya
  // key "module:view" terdaftar, tiap menu membawa aksi (view/baru/ubah/
  // hapus + operasi khusus). Belum termuat → sementara semua (anti-flicker).
  const meMenu = useApi<{ all: boolean; menus: string[]; perms?: MenusMap; isSuperAdmin: boolean }>("/api/onevity/user-menu-access?action=me");
  const menuAll = meMenu.data ? meMenu.data.all : true;
  const allowedKeys = useMemo(() => (menuAll ? null : new Set(meMenu.data?.menus ?? [])), [menuAll, meMenu.data]);
  // context utk view di bawah shell — tombol aksi (Baru/Ubah/Hapus/operasi)
  // memakai useMenuPerms()
  const permsApi = useMemo(
    () => ({ all: menuAll, isSuperAdmin: meMenu.data?.isSuperAdmin ?? false, ready: !!meMenu.data, perms: meMenu.data?.perms }),
    [menuAll, meMenu.data],
  );

  /** Cek hak AKSI (Baru/Ubah/Hapus) sebuah menu — dipakai quick-create shell. */
  const permsCan = useCallback(
    (mod: string, itemId: string, action: "view" | "create" | "update" | "delete") => {
      if (menuAll || !meMenu.data) return true; // belum termuat / mode semua → boleh
      const p = meMenu.data.perms?.[`${mod}:${itemId}`];
      return !!p && p.view && actionAllowed(p, action);
    },
    [menuAll, meMenu.data],
  );

  /** Apakah item menu boleh diakses pengguna sesi? (mod: "hr"…"medical" | "settings") */
  const itemAllowed = useCallback(
    (mod: string, itemId: string) => allowedKeys == null || allowedKeys.has(`${mod}:${itemId}`),
    [allowedKeys],
  );
  /** Varian per section nav (settings = lintas modul). */
  const menuAllowed = useCallback(
    (sec: SectionId, itemId: string) => itemAllowed(sec === "settings" ? "settings" : moduleOfSection(sec), itemId),
    [itemAllowed],
  );

  useEffect(() => {
    syncFromUrl();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [syncFromUrl]);

  // lock scroll when mobile drawer open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const go = (s: SectionId, v: string) => { navigate(s, v); setMobileOpen(false); };

  // ===== nav per modul, DISARING sesuai hak akses menu pengguna =====
  const nav = navOfModule(module);
  const groups = useMemo(() => {
    const base = [...nav, ...SETTINGS_NAV];
    if (allowedKeys == null) return base;
    return base
      .map((g) => ({ ...g, children: g.children.filter((c) => menuAllowed(g.section, c.id)) }))
      .filter((g) => g.children.length > 0);
    // catatan: bila modul aktif tidak punya menu terizinkan (URL langsung),
    // nav kosong + panel konten terblokir akan mengarahkan pengguna kembali.
  }, [nav, allowedKeys, menuAllowed]);

  // modul yang punya ≥1 menu diizinkan (dropdown switcher)
  const allowedModules = useMemo(() => {
    if (allowedKeys == null) return MODULES;
    const vis = MODULES.filter((m) => navOfModule(m.id).some((g) => g.children.some((c) => itemAllowed(m.id, c.id))));
    return vis.length > 0 ? vis : MODULES; // safety fallback — hindari lockout
  }, [allowedKeys, itemAllowed]);

  // menu pertama yang diizinkan pada suatu modul (untuk home & switch modul)
  const firstAllowedOfModule = useCallback(
    (m: ModuleId): { section: SectionId; view: string } | null => {
      if (allowedKeys == null) return null;
      for (const g of navOfModule(m)) {
        const c = g.children.find((ch) => itemAllowed(m, ch.id));
        if (c) return { section: g.section, view: c.id };
      }
      return null;
    },
    [allowedKeys, itemAllowed],
  );

  // ===== guard view saat ini: view di luar cakupan menu → panel terblokir =====
  // (menangani URL langsung / stale state; sub-view internal tanpa menu sendiri
  // mengikuti menu induknya — view "detail" → directory, "run" → runs)
  const viewAllowed = useMemo(() => {
    if (allowedKeys == null) return true;
    if (section === "settings") return itemAllowed("settings", view);
    const mapped = view === "detail" ? "directory" : view === "run" ? "runs" : view;
    let known = false;
    for (const g of [...navOfModule(module), ...SETTINGS_NAV]) {
      const ownerMod = g.section === "settings" ? "settings" : moduleOfSection(g.section);
      // view persis item nav → cek kunci item
      if (g.children.some((c) => c.id === view)) {
        known = true;
        if (itemAllowed(ownerMod, view)) return true;
      }
      // sub-view dipetakan ke menu induk (detail→directory, run→runs)
      if (mapped !== view && g.children.some((c) => c.id === mapped)) {
        known = true;
        if (itemAllowed(ownerMod, mapped)) return true;
      }
      // grup matchViews (mis. "run" milik grup runs) → boleh bila ≥1 item grup diizinkan
      if (g.matchViews?.includes(view)) {
        known = true;
        if (g.children.some((c) => itemAllowed(ownerMod, c.id))) return true;
      }
    }
    return !known; // view internal tanpa menu sendiri → ikut menu induk (bebas)
  }, [allowedKeys, section, view, module, itemAllowed]);

  const crumbs = useMemo(() => {
    const group = groups.find((g) => g.section === section && (!g.matchViews || g.matchViews.includes(view) || g.children.some((c) => c.id === view)));
    const item = group?.children.find((c) => c.id === view);
    const out: string[] = [MODULE_LABEL[module]];
    if (group?.label) out.push(group.label);
    if (item && item.id !== "overview" && item.id !== view) out.push(item.label);
    if (item && item.id === view && item.id !== "overview") out.push(item.label);
    if (view === "run" && section === "payroll") out.push("Detail Proses");
    if (params.id) out.push(params.id);
    return out.filter(Boolean);
  }, [section, view, params, module, groups]);

  const activeModule = MODULES.find((m) => m.id === module) ?? MODULES[0];
  const ActiveModuleIcon = activeModule.icon;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background">
        {/* ============ SIDEBAR (obsidian, always dark) ============ */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col bg-[oklch(0.185_0.008_240)] text-stone-300 transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
            mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
          )}
          style={{ ["--sidebar" as string]: "oklch(0.185 0.008 240)" }}
        >
          {/* brand */}
          <div className="flex items-center gap-3 px-5 pb-4 pt-5">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-900/40">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="2.6" />
                <circle cx="5" cy="17" r="2.6" />
                <circle cx="19" cy="17" r="2.6" />
                <path d="M12 7.6 6.6 14.6M12 7.6l5.4 7M7.6 17h8.8" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-extrabold leading-tight tracking-tight text-white">
                One<span className="text-emerald-400">Vity</span>
              </p>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-stone-500">HR Suite</p>
            </div>
            <button className="rounded-lg p-1.5 text-stone-500 hover:bg-white/5 hover:text-stone-200 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Tutup menu">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* kartu perusahaan aktif (tampilan info, bukan tombol) */}
          <div className="px-4 pb-2.5">
            <div
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
              aria-label="Perusahaan aktif"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 text-[11px] font-extrabold text-white shadow">
                {(meta.data?.company?.shortName ?? sessionTenant?.name ?? "OneVity").slice(0, 3).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-stone-100">{meta.data?.company?.shortName ?? "—"}</p>
                <p className="truncate text-[10px] text-stone-500">{meta.data?.company?.name ?? (meta.loading ? "Memuat…" : "Belum ada data perusahaan")}</p>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">Aktif</span>
            </div>
          </div>

          {/* ============ MODULE SWITCHER (dropdown modul besar) ============ */}
          <div className="px-4 pb-2.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex w-full items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-2.5 text-left transition hover:border-emerald-500/40 hover:bg-emerald-500/[0.14]"
                  aria-label="Pilih modul"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow">
                    <ActiveModuleIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-stone-500">Modul Aktif</p>
                    <p className="truncate text-[13px] font-bold text-stone-50">{activeModule.label}</p>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-stone-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="w-60">
                <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Modul OneVity</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allowedModules.map((m) => {
                  const Icon = m.icon;
                  const isActive = m.id === module;
                  return (
                    <DropdownMenuItem
                      key={m.id}
                      onClick={() => {
                        // navigasikan ke menu pertama yang diizinkan di modul tsb
                        const target = firstAllowedOfModule(m.id);
                        if (target) navigate(target.section, target.view);
                        else setModule(m.id);
                        setMobileOpen(false);
                      }}
                      className={cn("gap-3 py-2.5", isActive && "bg-emerald-50 dark:bg-emerald-500/10")}
                    >
                      <div className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                        isActive ? "bg-emerald-600 text-white" : m.ready ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300" : "bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500"
                      )}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className={cn("flex-1 text-[13px] font-semibold", isActive ? "text-emerald-700 dark:text-emerald-400" : "text-stone-700 dark:text-stone-200")}>{m.label}</span>
                      {isActive ? (
                        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      ) : m.ready ? null : (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[9px] font-bold uppercase text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">Segera</Badge>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* nav — menu mengikuti modul aktif */}
          <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-0.5" aria-label="Navigasi utama">
            {groups.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-4 text-center">
                <ShieldOff className="mx-auto h-5 w-5 text-stone-500" />
                <p className="mt-2 text-[11px] font-semibold leading-relaxed text-stone-400">
                  Tidak ada menu yang tersedia untuk Anda di modul ini.
                </p>
              </div>
            ) : groups.map((group) => {
              const active =
                section === group.section &&
                (group.children.some((c) => c.id === view) || (group.matchViews?.includes(view) ?? false));
              return (
                <div key={`${group.section}-${group.label ?? "root"}`} className="pb-1">
                  {group.label ? (
                    <button
                      onClick={() => go(group.section, group.children[0].id)}
                      className={cn(
                        "flex w-full items-center px-3 pb-1 pt-2.5 text-[11px] font-semibold text-stone-500 transition-colors hover:text-stone-300",
                        active && "text-emerald-400 hover:text-emerald-400"
                      )}
                    >
                      {group.label}
                    </button>
                  ) : (
                    <div className="h-1" />
                  )}
                  {group.children.map((item) => {
                    const isActive =
                      section === group.section &&
                      (view === item.id ||
                        (item.id === "directory" && view === "detail") ||
                        (item.id === "runs" && view === "run"));
                    const pending =
                      item.badge === "pending" ? meta.data?.pendingActions ?? 0 :
                      item.badge === "runsDraft" ? meta.data?.payrollDraftRuns ?? 0 :
                      item.badge === "benefitPending" ? meta.data?.benefitPendingClaims ?? 0 : 0;
                    const Icon = item.icon;
                    return (
                      <button
                        key={`${group.section}-${item.id}`}
                        onClick={() => go(group.section, item.id)}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all",
                          isActive
                            ? "bg-emerald-500/[0.14] text-white shadow-inner"
                            : "text-stone-400 hover:bg-white/[0.05] hover:text-stone-100"
                        )}
                      >
                        {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-emerald-400" />}
                        <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors", isActive ? "text-emerald-400" : "text-stone-500 group-hover:text-stone-300")} />
                        <span className="flex-1 truncate text-left">{item.label}</span>
                        {pending > 0 && (
                          <Badge className="h-5 min-w-5 rounded-full bg-amber-400/90 px-1.5 text-[10px] font-extrabold text-stone-900 hover:bg-amber-400">
                            {pending}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* sidebar footer: user (session SaaS multi-tenant) */}
          <div className="border-t border-white/10 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 text-xs font-extrabold text-white">{sessionUser ? initials(sessionUser.name) : "?"}</div>
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[oklch(0.185_0.008_240)] bg-emerald-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-stone-100">{sessionUser?.name ?? "—"}</p>
                <p className="truncate text-[10px] text-stone-500">{sessionTenant ? `${sessionTenant.name} · ${sessionTenant.role}` : "tanpa workspace"}</p>
              </div>
              <button
                onClick={() => void session.logout()}
                className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-rose-300"
                aria-label="Keluar dari sesi"
                title="Keluar"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 truncate text-center text-[9px] tracking-wide text-stone-600">OneVity HR Suite v1.0 · {activeModule.label}</p>
          </div>
        </aside>

        {/* mobile backdrop */}
        {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />}

        {/* ============ MAIN COLUMN ============ */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* topbar */}
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-stone-200/80 bg-background/85 px-4 backdrop-blur-xl dark:border-stone-800/80 sm:px-6">
            <button className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Buka menu">
              <Menu className="h-5 w-5" />
            </button>

            {/* breadcrumbs */}
            <nav className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex" aria-label="Breadcrumb">
              <button
                onClick={() => {
                  const target = firstAllowedOfModule(module);
                  if (target) navigate(target.section, target.view);
                  else navigate(module === "hr" ? "dashboard" : defaultSectionOfModuleFor(module));
                }}
                className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >OneVity</button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-stone-300 dark:text-stone-600" />
                  <span className={cn("truncate", i === crumbs.length - 1 ? "font-semibold text-stone-900 dark:text-stone-100" : "text-stone-500")}>{c}</span>
                </span>
              ))}
            </nav>
            <span className="flex-1" />

            {/* workspace switcher (multi-tenant SaaS) */}
            <WorkspaceMenu />

            {/* search trigger */}
            <button
              onClick={() => setCmdOpen(true)}
              className="hidden items-center gap-2.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-[13px] text-stone-400 transition hover:border-emerald-300 hover:text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-emerald-600/50 md:flex"
            >
              <Search className="h-4 w-4" />
              <span>Cari karyawan, dokumen…</span>
              <kbd className="ml-4 flex items-center gap-0.5 rounded-md border border-stone-200 bg-stone-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-stone-400 dark:border-stone-700 dark:bg-stone-800">
                <CommandIcon className="h-2.5 w-2.5" />K
              </kbd>
            </button>
            <button className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 md:hidden" onClick={() => setCmdOpen(true)} aria-label="Cari">
              <Search className="h-5 w-5" />
            </button>

            {/* quick create */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="hidden gap-1.5 bg-emerald-600 px-3.5 font-bold hover:bg-emerald-700 sm:flex">
                  <Plus className="h-4 w-4" /> Buat Baru
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {([
                  { s: "employee" as SectionId, v: "wizard", icon: UserPlus, cls: "text-emerald-600", label: "Onboarding Karyawan" },
                  { s: "payroll" as SectionId, v: "runs", icon: PlayCircle, cls: "text-teal-600", label: "Proses Payroll" },
                  { s: "actions" as SectionId, v: "all", icon: Workflow, cls: "text-amber-600", label: "Pengajuan Karyawan" },
                  { s: "org" as SectionId, v: "tree", icon: Network, cls: "text-teal-600", label: "Unit Organisasi" },
                  { s: "position" as SectionId, v: "list", icon: BriefcaseBusiness, cls: "text-orange-600", label: "Posisi Baru" },
                ] as const).filter((q) => menuAllowed(q.s, q.v) && permsCan(moduleOfSection(q.s), q.v, "create")).map((q) => (
                  <DropdownMenuItem key={q.label} onClick={() => navigate(q.s, q.v)}><q.icon className={cn("h-4 w-4", q.cls)} /> {q.label}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* notifications */}
            <NotificationBell pendingActions={meta.data?.pendingActions ?? 0} />

            {/* theme toggle */}
            <ThemeToggle />
          </header>

          {/* content — view di luar cakupan menu pengguna → panel terblokir (Task 31) */}
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8" id="onevity-main">
            <MenuPermsProvider {...permsApi}>
            {!viewAllowed ? (
              <div className="flex min-h-[50vh] items-center justify-center">
                <div className="max-w-md rounded-2xl border border-stone-200/80 bg-white p-8 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 dark:bg-rose-500/10">
                    <ShieldOff className="h-7 w-7 text-rose-500 dark:text-rose-400" />
                  </div>
                  <p className="mt-4 text-base font-bold text-stone-900 dark:text-stone-50">Menu tidak tersedia</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
                    Anda tidak memiliki hak akses ke menu ini. Hak akses menu diatur per pengguna — hubungi admin bila memerlukan akses.
                  </p>
                  <Button
                    onClick={() => {
                      const target = firstAllowedOfModule(module) ?? (allowedModules.length > 0 ? firstAllowedOfModule(allowedModules[0].id) : null);
                      if (target) navigate(target.section, target.view);
                      else navigate("dashboard", "overview");
                    }}
                    className="mt-5 gap-2 rounded-xl bg-emerald-600 font-bold hover:bg-emerald-700"
                  >
                    <LayoutDashboard className="h-4 w-4" /> Ke Menu yang Tersedia
                  </Button>
                </div>
              </div>
            ) : children}
            </MenuPermsProvider>
          </main>

          {/* footer */}
          <footer className="mt-auto border-t border-stone-200/70 py-4 dark:border-stone-800/70">
            <p className="text-center text-[11px] text-stone-400 dark:text-stone-500">
              © 2026 <span className="font-bold text-emerald-600 dark:text-emerald-400">OneVity</span> HR Suite · Modul {activeModule.label} · dibangun ulang dari studi OranHR
            </p>
          </footer>
        </div>

        {/* command palette */}
        <CommandPalette open={cmdOpen} setOpen={setCmdOpen} onNavigate={go} module={module} menuAllowed={menuAllowed} />
      </div>
    </TooltipProvider>
  );
}

function defaultSectionOfModuleFor(m: ModuleId): SectionId {
  switch (m) {
    case "payroll": return "payroll";
    case "attendance": return "attendance";
    case "leave": return "leave";
    case "travel": return "travel";
    case "medical": return "medical";
    default: return "dashboard";
  }
}

const subscribeNoop = () => () => {};

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // mounted via useSyncExternalStore (server snapshot false, client snapshot true)
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const dark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="rounded-xl p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
      aria-label="Ganti tema"
    >
      {mounted && dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

function NotificationBell({ pendingActions }: { pendingActions: number }) {
  const { navigate } = useNav();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative rounded-xl p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200" aria-label="Notifikasi">
          <Bell className="h-[18px] w-[18px]" />
          {pendingActions > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-extrabold text-stone-900">{pendingActions}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b border-stone-100 px-4 py-3 dark:border-stone-800">
          <p className="text-sm font-bold">Notifikasi</p>
          <p className="text-[11px] text-stone-400">{pendingActions} approval menunggu keputusan Anda</p>
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {pendingActions > 0 ? (
            <button onClick={() => navigate("actions", "inbox")} className="flex w-full items-start gap-3 rounded-xl p-3 text-left transition hover:bg-amber-50 dark:hover:bg-amber-500/10">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/20">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold">Approval Personnel Action</p>
                <p className="text-[11px] leading-relaxed text-stone-500">{pendingActions} dokumen menunggu persetujuan Anda</p>
              </div>
            </button>
          ) : (
            <p className="px-3 py-6 text-center text-xs text-stone-400">Tidak ada notifikasi baru</p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandPalette({ open, setOpen, onNavigate, module, menuAllowed }: {
  open: boolean; setOpen: (v: boolean) => void; onNavigate: (s: SectionId, v: string) => void; module: ModuleId;
  menuAllowed: (s: SectionId, itemId: string) => boolean;
}) {
  const [q, setQ] = useState("");
  const results = useApi<{ employees: { id: string; fullName: string; employeeNo: string; position: { title: string } | null }[] }>(q.length >= 2 ? `/api/onevity/employees?q=${encodeURIComponent(q)}&limit=6` : null);

  const runNav = (s: SectionId, v: string) => { setOpen(false); setQ(""); onNavigate(s, v); };

  const items = useMemo(() => {
    const groups = [...navOfModule(module), ...SETTINGS_NAV];
    return groups.flatMap((g) => g.children.filter((c) => menuAllowed(g.section, c.id)).map((c) => ({ g, c })));
  }, [module, menuAllowed]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 shadow-2xl" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Pencarian global OneVity</DialogTitle>
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-4">
          <div className="flex items-center gap-3 border-b border-stone-100 px-4 dark:border-stone-800">
            <Search className="h-4 w-4 shrink-0 text-stone-400" />
            <CommandInput
              value={q}
              onValueChange={setQ}
              placeholder="Cari karyawan, aksi, atau navigasi…"
              className="h-12 flex-1 border-0 text-sm shadow-none focus:ring-0 dark:bg-transparent"
            />
            <kbd className="rounded border border-stone-200 px-1.5 py-0.5 font-mono text-[10px] text-stone-400 dark:border-stone-700">ESC</kbd>
          </div>
          <CommandList className="max-h-[420px] overflow-y-auto p-2">
            <CommandGroup heading={`Navigasi · ${MODULE_LABEL[module]}`}>
              {items.map(({ g, c }) => {
                const Icon = c.icon;
                return (
                  <CommandItem key={`${g.section}-${c.id}`} value={`${g.label ?? "Beranda"} ${c.label}`} onSelect={() => runNav(g.section, c.id)} className="gap-3 rounded-lg px-3 py-2.5 text-[13px]">
                    <Icon className="h-4 w-4 text-stone-400" />
                    <span>{c.label}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-stone-300 dark:text-stone-600">{g.label ?? "Beranda"}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {q.length >= 2 && (
              <CommandGroup heading="Karyawan">
                <CommandEmpty className="py-6 text-center text-xs text-stone-400">Tidak ditemukan</CommandEmpty>
                {results.loading && <p className="px-3 py-4 text-xs text-stone-400">Mencari…</p>}
                {results.data?.employees?.map((e) => (
                  <CommandItem key={e.id} value={e.employeeNo + e.fullName} onSelect={() => { setOpen(false); setQ(""); useNav.getState().navigate("employee", "detail", { id: e.id }); }} className="gap-3 rounded-lg px-3 py-2.5 text-[13px]">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">{initials(e.fullName)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{e.fullName}</p>
                      <p className="truncate text-[11px] text-stone-400">{e.employeeNo} · {e.position?.title ?? "—"}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-stone-300" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

// ============ Workspace switcher (multi-tenant SaaS) ============
function WorkspaceMenu() {
  const { info, selectTenant, logout } = useSession();
  const [switching, setSwitching] = useState(false);
  const tenant = info?.tenant;
  if (!tenant) return null;

  const switchTo = async (id: string) => {
    if (id === tenant.id) return;
    setSwitching(true);
    const ok = await selectTenant(id);
    if (ok) window.location.reload(); // muat ulang seluruh data di bawah konteks tenant baru
    else setSwitching(false);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={switching}
          aria-label={`Ganti workspace — ${tenant.name}`}
          title={tenant.name}
          className="flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2 py-1.5 text-[12px] font-semibold text-stone-700 transition hover:border-emerald-300 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-emerald-600/50"
        >
          <Building2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="hidden max-w-[160px] truncate sm:inline">{tenant.name}</span>
          <Badge className="hidden rounded-full bg-emerald-100 px-1.5 text-[9px] font-extrabold uppercase text-emerald-700 sm:inline-flex dark:bg-emerald-500/15 dark:text-emerald-300">{tenant.plan}</Badge>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">Workspace</DropdownMenuLabel>
        {(info?.workspaces ?? []).map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => void switchTo(w.id)}>
            <Building2 className="h-4 w-4 shrink-0 text-stone-400" />
            <span className="flex-1 truncate">{w.name}</span>
            {w.id === tenant.id ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <span className="shrink-0 text-[10px] text-stone-400">{w.role}</span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" /> Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
