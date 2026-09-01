"use client";
// OneVity App Shell — obsidian sidebar (module dropdown + nav per modul) + topbar + command palette
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNav, SectionId, ModuleId, MODULE_LABEL, moduleOfSection } from "@/lib/onevity/store";
import { useApi, initials, fmtDateTime } from "@/lib/onevity/api";
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
  Network, Landmark, BriefcaseBusiness, GraduationCap, UserPlus, Inbox, Coins, Calculator,
  Scale, ShieldCheck, Layers, Bell, Moon, Sun, Search, Command as CommandIcon, Plus, LogOut,
  UserCog, Menu, X, ChevronRight, Activity, Clock, CheckCircle2, FileText, Trash2, Pencil, Waypoints, XCircle, HeartHandshake,
  Wallet, CalendarRange, PlayCircle, LayoutTemplate, IdCard, ArrowLeftRight, Percent,
  CalendarClock, Palmtree, Plane, HeartPulse, Boxes, Sparkles, FileSpreadsheet, BookOpen,
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
  { id: "attendance", label: "Attendance", short: "Attendance", icon: CalendarClock, ready: false },
  { id: "leave", label: "Leave", short: "Leave", icon: Palmtree, ready: false },
  { id: "travel", label: "Travel", short: "Travel", icon: Plane, ready: false },
  { id: "medical", label: "Medical", short: "Medical", icon: HeartPulse, ready: false },
];

// ============ NAV PER MODULE ============
// Struktur menu stabil: semua grup & item selalu tampil dalam modul aktif.

const HR_NAV: NavGroup[] = [
  { section: "dashboard", children: [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  ] },
  { section: "org", label: "Perusahaan & Organisasi", children: [
    { id: "companies", label: "Perusahaan", icon: Landmark },
    { id: "tree", label: "Unit Organisasi", icon: Network },
    { id: "chart", label: "Peta Organisasi", icon: Waypoints },
  ] },
  { section: "position", label: "Posisi & Jabatan", children: [
    { id: "list", label: "Daftar Posisi", icon: BriefcaseBusiness },
    { id: "jobs", label: "Katalog Jabatan", icon: FileText },
    { id: "grades", label: "Grade & Level", icon: GraduationCap },
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

// Modul berikutnya: struktur menu direncanakan dari studi oranHR — tampil sebagai placeholder.
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
    { id: "leave-info", label: "Informasi Cuti", icon: Palmtree },
    { id: "leave-request", label: "Permintaan Cuti", icon: Inbox },
    { id: "leave-approval", label: "Persetujuan", icon: CheckCircle2 },
  ] },
  { section: "leave", label: "Pengaturan Cuti", children: [
    { id: "leave-type", label: "Jenis Cuti", icon: Layers },
    { id: "leave-encashment", label: "Uang Pengganti Cuti", icon: Wallet },
  ] },
];

const TRAVEL_NAV: NavGroup[] = [
  { section: "travel", children: [{ id: "requests", label: "Ringkasan", icon: LayoutDashboard }] },
  { section: "travel", label: "Perjalanan Dinas", children: [
    { id: "travel-request", label: "Permintaan Travel", icon: Plane },
    { id: "travel-claim", label: "Klaim & Settlement", icon: FileText },
    { id: "travel-budget", label: "Budget Travel", icon: Wallet },
    { id: "travel-approval", label: "Persetujuan", icon: CheckCircle2 },
  ] },
];

const MEDICAL_NAV: NavGroup[] = [
  { section: "medical", children: [{ id: "claims", label: "Ringkasan", icon: LayoutDashboard }] },
  { section: "medical", label: "Benefit Medis", children: [
    { id: "medical-info", label: "Info Medis Karyawan", icon: HeartPulse },
    { id: "medical-claim", label: "Klaim Medis", icon: Activity },
    { id: "medical-approval", label: "Persetujuan Klaim", icon: CheckCircle2 },
    { id: "medical-benefit-type", label: "Jenis Benefit", icon: Boxes },
  ] },
];

// Pengaturan sistem — cross-module, selalu tampil di bagian bawah sidebar semua modul.
const SETTINGS_NAV: NavGroup[] = [
  { section: "settings", label: "Pengaturan Sistem", children: [
    { id: "lookups", label: "Data Master", icon: Layers },
    { id: "security", label: "Keamanan & Akses", icon: ShieldCheck },
    { id: "approval", label: "Template Approval", icon: CheckCircle2 },
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
  const meta = useApi<{ pendingActions: number; activeEmployees: number; payrollDraftRuns: number; company: { name: string; shortName: string } | null }>("/api/onevity/meta");

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

  const nav = navOfModule(module);
  const groups = module === "hr" ? [...nav, ...SETTINGS_NAV] : module === "payroll" ? [...nav, ...SETTINGS_NAV] : [...nav, ...SETTINGS_NAV];

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
                {meta.data?.company?.shortName?.slice(0, 3) ?? "MII"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-stone-100">{meta.data?.company?.shortName ?? "—"}</p>
                <p className="truncate text-[10px] text-stone-500">{meta.data?.company?.name ?? "Memuat…"}</p>
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
                {MODULES.map((m) => {
                  const Icon = m.icon;
                  const isActive = m.id === module;
                  return (
                    <DropdownMenuItem
                      key={m.id}
                      onClick={() => { setModule(m.id); setMobileOpen(false); }}
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
            {groups.map((group) => {
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

          {/* sidebar footer: user */}
          <div className="border-t border-white/10 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 text-xs font-extrabold text-white">TH</div>
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[oklch(0.185_0.008_240)] bg-emerald-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-stone-100">Tri Handayani</p>
                <p className="truncate text-[10px] text-stone-500">HR Manager · MII000001</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded-lg p-1.5 text-stone-500 hover:bg-white/5 hover:text-stone-200" aria-label="Menu pengguna">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="w-48">
                  <DropdownMenuLabel className="text-xs">tri.handayani@mii.co.id</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem><UserCog className="h-4 w-4" /> Profil Saya</DropdownMenuItem>
                  <DropdownMenuItem><Settings2 className="h-4 w-4" /> Preferensi</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-rose-600 focus:text-rose-600"><LogOut className="h-4 w-4" /> Keluar</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
              <button onClick={() => navigate(module === "hr" ? "dashboard" : defaultSectionOfModuleFor(module))} className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">OneVity</button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-stone-300 dark:text-stone-600" />
                  <span className={cn("truncate", i === crumbs.length - 1 ? "font-semibold text-stone-900 dark:text-stone-100" : "text-stone-500")}>{c}</span>
                </span>
              ))}
            </nav>
            <span className="flex-1" />

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
                <DropdownMenuItem onClick={() => navigate("employee", "wizard")}><UserPlus className="h-4 w-4 text-emerald-600" /> Onboarding Karyawan</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("payroll", "runs")}><PlayCircle className="h-4 w-4 text-teal-600" /> Proses Payroll</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("actions", "all")}><Workflow className="h-4 w-4 text-amber-600" /> Pengajuan Karyawan</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("org", "tree")}><Network className="h-4 w-4 text-teal-600" /> Unit Organisasi</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("position", "list")}><BriefcaseBusiness className="h-4 w-4 text-orange-600" /> Posisi Baru</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* notifications */}
            <NotificationBell pendingActions={meta.data?.pendingActions ?? 0} />

            {/* theme toggle */}
            <ThemeToggle />
          </header>

          {/* content */}
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8" id="onevity-main">
            {children}
          </main>

          {/* footer */}
          <footer className="mt-auto border-t border-stone-200/70 py-4 dark:border-stone-800/70">
            <p className="text-center text-[11px] text-stone-400 dark:text-stone-500">
              © 2026 <span className="font-bold text-emerald-600 dark:text-emerald-400">OneVity</span> HR Suite · Modul {activeModule.label} · dibangun ulang dari studi OranHR
            </p>
          </footer>
        </div>

        {/* command palette */}
        <CommandPalette open={cmdOpen} setOpen={setCmdOpen} onNavigate={go} module={module} />
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

function CommandPalette({ open, setOpen, onNavigate, module }: { open: boolean; setOpen: (v: boolean) => void; onNavigate: (s: SectionId, v: string) => void; module: ModuleId }) {
  const [q, setQ] = useState("");
  const results = useApi<{ employees: { id: string; fullName: string; employeeNo: string; position: { title: string } | null }[] }>(q.length >= 2 ? `/api/onevity/employees?q=${encodeURIComponent(q)}&limit=6` : null);

  const runNav = (s: SectionId, v: string) => { setOpen(false); setQ(""); onNavigate(s, v); };

  const items = useMemo(() => {
    const groups = [...navOfModule(module), ...SETTINGS_NAV];
    return groups.flatMap((g) => g.children.map((c) => ({ g, c })));
  }, [module]);

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
