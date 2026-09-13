"use client";
// OneVity ESS Shell — pengalaman Employee Self-Service SEPENUHNYA terpisah
// dari shell admin (Task T8). REFACTOR (permintaan user): navigasi TIDAK
// memakai sidebar seperti admin — desktop memakai TOPNAV horizontal
// (menu pill aktif amber), mobile tetap bottom tab + sheet "Lainnya".
// Fitur dipertahankan: bell notifikasi ESS, language switcher, theme toggle,
// avatar menu (Mode Admin / Ganti Kata Sandi / Keluar), jam live, layar
// 403 akun tanpa data karyawan. Konten = view-state internal (tanpa route).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  LayoutDashboard, UserRound, Palmtree, Fingerprint, ReceiptText, HeartPulse, ClipboardList, FileText,
  Bell, Moon, Sun, LogOut, KeyRound, X, CheckCheck, MoreHorizontal, ArrowRight, Check,
  Waypoints, ChevronDown, Building2, Clock as ClockIcon, UserRoundSearch,
  AlertTriangle, Loader2, LayoutTemplate, Megaphone, ArrowLeftRight, Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, initials, fmtDateTime } from "@/onevity/shared/lib/api";
import { useSession } from "@/onevity/shared/lib/session-store";
import { useUiMode } from "@/onevity/shared/lib/store";
import { useI18n, locActivity } from "@/onevity/shared/lib/i18n";
import { LanguageSwitcher } from "@/onevity/shared/components/shell/language-switcher";
import { ChangePasswordDialog } from "@/onevity/shared/components/shell/change-password-dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ESS_BASE, markNotifRead, useEssMe } from "./ess-api";
import type { EssMe, EssNotificationsData, EssView } from "./ess-types";
import { EssDashboard } from "./ess-dashboard";
import { EssProfile } from "./ess-profile";
import { EssLeavePage } from "./ess-leave";
import { EssAttendance } from "./ess-attendance";
import { EssPayslips } from "./ess-payslips";
import { EssClaims } from "./ess-claims";
import { EssRequests } from "./ess-requests";
import { EssLetters } from "./ess-letters";
// wave 27 stub — diisi Task 27-f (pengumuman), 27-g (tukar shift), 27-b (aset saya)
import { EssAnnouncements } from "./ess-announcements";
import { EssSwap } from "./ess-swap";
import { EssAssets } from "./ess-assets";
// Task 52-f — kanal whistleblowing TPKS (anonim) utk semua pekerja.
import { WhistleblowForm } from "@/onevity/whistleblow/components/whistleblow-form";
import { Siren } from "lucide-react";

// ============ NAVIGASI ESS ============
interface EssNavItem { id: EssView; label: string; en: string; short: string; shortEn: string; icon: React.ElementType }

const ESS_NAV: EssNavItem[] = [
  { id: "dashboard", label: "Dashboard", en: "Dashboard", short: "Dashboard", shortEn: "Home", icon: LayoutDashboard },
  { id: "leave", label: "Cuti Saya", en: "My Leave", short: "Cuti", shortEn: "Leave", icon: Palmtree },
  { id: "attendance", label: "Presensi Saya", en: "My Attendance", short: "Presensi", shortEn: "Time", icon: Fingerprint },
  { id: "payslips", label: "Slip Gaji", en: "Payslips", short: "Slip", shortEn: "Pay", icon: ReceiptText },
  { id: "claims", label: "Klaim Saya", en: "My Claims", short: "Klaim", shortEn: "Claims", icon: HeartPulse },
  { id: "requests", label: "Pengajuan", en: "Requests", short: "Ajukan", shortEn: "Requests", icon: ClipboardList },
  // 26-a — permintaan surat layanan (dua arah dgn HR Template Surat → Permintaan Masuk)
  { id: "letters", label: "Surat", en: "Letters", short: "Surat", shortEn: "Letters", icon: FileText },
  // wave 27 — pengumuman / tukar shift / aset saya (stub → Task 27-f/27-g/27-b)
  { id: "announcements", label: "Pengumuman", en: "Announcements", short: "Pengumuman", shortEn: "News", icon: Megaphone },
  { id: "swap", label: "Tukar Shift", en: "Shift Swap", short: "Tukar Shift", shortEn: "Swap", icon: ArrowLeftRight },
  { id: "assets", label: "Aset Saya", en: "My Assets", short: "Aset", shortEn: "Assets", icon: Package },
  // Task 52-f — kanal pelaporan pelanggaran/TPKS (anonim, semua pekerja)
  { id: "whistleblow", label: "Laporkan Pelanggaran", en: "Report a Violation", short: "Lapor", shortEn: "Report", icon: Siren },
  { id: "profile", label: "Profil Saya", en: "My Profile", short: "Profil", shortEn: "Profile", icon: UserRound },
];

// tab mobile: 4 item pertama + "Lainnya" (bottom sheet sisanya)
const ESS_TABS: EssView[] = ["dashboard", "leave", "attendance", "payslips"];

const subscribeNoop = () => () => {};

// ============ LOGO ESS (pola lockup editorial: kotak tinta + aksen amber "Vity") ============
function EssLogo({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl bg-stone-900 text-white shadow-[0_10px_28px_-12px_rgba(28,25,23,0.7)] dark:bg-stone-100 dark:text-stone-900 dark:shadow-none",
          compact ? "h-9 w-9" : "h-10 w-10",
        )}
      >
        <Waypoints className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden />
      </div>
      <div className="min-w-0">
        <p className={cn("font-extrabold tracking-tight text-stone-900 dark:text-stone-100", compact ? "text-[15px]" : "text-base")}>
          One<span className="text-amber-700 dark:text-amber-500">Vity</span>
        </p>
        <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-stone-400 dark:text-stone-500">
          {t("Self Service", "Self Service")}
        </p>
      </div>
    </div>
  );
}

// ============ JAM KECIL TOPNAV (mutakhir tiap 30 detik) ============
function LiveClock() {
  const { locale } = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="hidden items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] font-bold tabular-nums text-stone-600 xl:inline-flex dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
      <ClockIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden />
      {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(now)}
    </span>
  );
}

// ============ TEMA (pola admin — mounted guard via useSyncExternalStore) ============
function EssThemeToggle() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const dark = theme === "dark";
  return (
    <button
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="rounded-xl p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
      aria-label={t("Ganti tema", "Toggle theme")}
    >
      {mounted && dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

// ============ BELL NOTIFIKASI ESS (feed + tandai dibaca) ============
function EssNotificationBell() {
  const { t } = useI18n();
  const notif = useApi<EssNotificationsData>(`${ESS_BASE}/notifications`);
  const unread = notif.data?.unread ?? 0;
  const items = notif.data?.items ?? [];

  const markOne = async (id: string) => {
    try {
      await markNotifRead({ id });
      notif.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menandai notifikasi", "Failed to mark notification"));
    }
  };
  const markAll = async () => {
    try {
      await markNotifRead({ all: true });
      notif.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menandai semua notifikasi", "Failed to mark all notifications"));
    }
  };

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) notif.refresh(); }}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative rounded-xl p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          aria-label={t("Notifikasi", "Notifications")}
        >
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-extrabold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 dark:border-stone-800">
          <div>
            <p className="text-sm font-bold">{t("Notifikasi", "Notifications")}</p>
            <p className="text-[11px] text-stone-400">
              {unread > 0
                ? t("{n} belum dibaca", "{n} unread", { n: unread })
                : t("Semua sudah dibaca", "All read")}
            </p>
          </div>
          {unread > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void markAll()} className="h-7 gap-1.5 px-2 text-[11px] font-bold text-amber-700 hover:text-amber-800 dark:text-amber-400">
              <CheckCheck className="h-3.5 w-3.5" /> {t("Tandai semua", "Mark all")}
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-stone-400">{t("Belum ada notifikasi", "No notifications yet")}</p>
          ) : (
            items.slice(0, 12).map((n) => {
              const isUnread = !n.readAt;
              return (
                <button
                  key={n.id}
                  onClick={() => { if (isUnread) void markOne(n.id); }}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-xl p-3 text-left transition",
                    isUnread ? "bg-amber-50/70 hover:bg-amber-100/70 dark:bg-amber-500/10 dark:hover:bg-amber-500/15" : "hover:bg-stone-100 dark:hover:bg-stone-800/60",
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isUnread ? "bg-amber-500" : "bg-transparent")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-stone-800 dark:text-stone-100">{locActivity(n.title)}</span>
                    {n.body && <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">{locActivity(n.body)}</span>}
                    <span className="mt-1 block text-[10px] font-medium text-stone-400">{fmtDateTime(n.createdAt)}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============ SHELL UTAMA — TOPNAV TANPA SIDEBAR ============
export function EssShell() {
  const { t } = useI18n();
  const session = useSession();
  const setUiMode = useUiMode((s) => s.setUiMode);
  const { state: meState, retry } = useEssMe();
  const [view, setView] = useState<EssView>("dashboard");
  const [intent, setIntent] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false); // bottom sheet mobile "Lainnya"
  const [pwOpen, setPwOpen] = useState(false);

  // Aksen ESS = amber — set token modul "payroll" (set amber di globals.css)
  // agar seluruh komponen shadcn (Button/Tabs/Checkbox/dialog via portal) ikut
  // amber; dibersihkan saat unmount agar tidak bocor ke layar lain.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.module = "payroll";
    return () => { delete root.dataset.module; };
  }, []);

  // lock scroll + Escape saat bottom sheet mobile terbuka (pola admin)
  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(false); };
    if (sheet) window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      if (sheet) window.removeEventListener("keydown", onKey);
    };
  }, [sheet]);

  /** Navigasi view-state internal; intent = aksi lintas halaman (buka dialog/detail). */
  const go = useCallback((v: EssView, nextIntent?: string | null) => {
    setView(v);
    setIntent(nextIntent ?? null);
    setSheet(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  // ===== /ess/me belum siap → splash / error / 403 =====
  if (meState.phase === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#faf8f3] dark:bg-stone-950">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-900 text-white shadow-[0_10px_28px_-12px_rgba(28,25,23,0.7)] dark:bg-stone-100 dark:text-stone-900 dark:shadow-none">
            <Waypoints className="h-7 w-7" aria-hidden />
          </div>
          <div className="flex items-center gap-2 text-[13px] font-medium text-stone-500 dark:text-stone-400">
            <Loader2 className="h-4 w-4 animate-spin text-amber-700 dark:text-amber-500" aria-hidden />
            {t("Memuat profil karyawan…", "Loading employee profile…")}
          </div>
        </div>
      </div>
    );
  }

  if (meState.phase === "no-employee") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border border-stone-200/80 bg-white p-8 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-500/15">
            <UserRoundSearch className="h-7 w-7 text-amber-700 dark:text-amber-400" aria-hidden />
          </div>
          <p className="mt-4 text-base font-bold text-stone-900 dark:text-stone-50">
            {t("Akun belum terhubung ke data karyawan", "This account is not linked to an employee record")}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
            {t(
              "Mode Karyawan memerlukan akun yang terhubung dengan profil karyawan. Hubungi admin HR untuk menghubungkan akun Anda.",
              "Employee Mode requires an account linked to an employee profile. Contact your HR admin to link your account.",
            )}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={retry} variant="outline" className="gap-2 rounded-xl font-bold">
              <Loader2 className="h-4 w-4" /> {t("Coba Lagi", "Try Again")}
            </Button>
            {meState.canAdmin && (
              <Button onClick={() => setUiMode("admin")} className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
                <LayoutTemplate className="h-4 w-4" /> {t("Kembali ke Mode Admin", "Back to Admin Mode")}
              </Button>
            )}
            {/* pintasan keluar — akun ESS tanpa data karyawan tetap bisa kembali ke layar masuk */}
            <Button onClick={() => void session.logout()} variant="outline" className="gap-2 rounded-xl font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10">
              <LogOut className="h-4 w-4" /> {t("Keluar")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (meState.phase === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border border-stone-200/80 bg-white p-8 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 dark:bg-rose-500/10">
            <AlertTriangle className="h-7 w-7 text-rose-500 dark:text-rose-400" aria-hidden />
          </div>
          <p className="mt-4 text-base font-bold text-stone-900 dark:text-stone-50">{t("Gagal memuat data karyawan", "Failed to load employee data")}</p>
          <p className="mt-1.5 break-words text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
            {meState.message ?? t("Server tidak dapat dijangkau. Pastikan koneksi lalu coba lagi.", "The server could not be reached. Check your connection and try again.")}
          </p>
          <Button onClick={retry} className="mt-5 gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
            <Loader2 className="h-4 w-4" /> {t("Coba Lagi", "Try Again")}
          </Button>
        </div>
      </div>
    );
  }

  const me: EssMe = meState.me;
  const sessionTenant = session.info?.tenant;
  const activeItem = ESS_NAV.find((n) => n.id === view) ?? ESS_NAV[0];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ============ TOPNAV (desktop & mobile) — TANPA SIDEBAR ============ */}
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-white/90 backdrop-blur-xl dark:border-stone-800 dark:bg-stone-950/85">
        {/* baris 1: brand + aksi */}
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2.5 px-4 sm:px-6">
          <button className="flex items-center gap-3 text-left" onClick={() => go("dashboard")} aria-label={t("Ke Dashboard", "Go to Dashboard")}>
            <EssLogo compact />
          </button>

          <span className="flex-1" />

          {/* workspace */}
          <span
            title={sessionTenant?.name ?? me.companyName ?? ""}
            className="hidden max-w-[180px] items-center gap-1.5 truncate rounded-xl border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-stone-600 lg:flex dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
          >
            <Building2 className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden />
            <span className="truncate">{sessionTenant?.name ?? me.companyName ?? t("tanpa workspace", "no workspace")}</span>
          </span>

          <LiveClock />
          <EssNotificationBell />
          <LanguageSwitcher />
          <EssThemeToggle />

          {/* avatar menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 flex items-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("Menu akun", "Account menu")}>
                <Avatar className="h-8 w-8 ring-2 ring-amber-500/30">
                  {me.employee.photoUrl && <AvatarImage src={me.employee.photoUrl} alt={me.employee.fullName} />}
                  <AvatarFallback className="bg-amber-100 text-[10px] font-extrabold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                    {initials(me.employee.fullName)}
                  </AvatarFallback>
                </Avatar>
                <ChevronDown className="hidden h-3.5 w-3.5 text-stone-400 sm:block" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-xs">
                <p className="truncate font-bold text-stone-800 dark:text-stone-100">{me.employee.fullName}</p>
                <p className="mt-0.5 truncate font-medium text-stone-400">
                  {me.employee.email ?? me.employee.employeeNo}
                  {me.role ? ` · ${me.role}` : ""}
                </p>
                <p className="mt-0.5 truncate font-normal text-stone-400">
                  {me.employee.positionTitle ?? me.employee.employeeNo}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {me.canAdmin && (
                <DropdownMenuItem onClick={() => setUiMode("admin")}>
                  <LayoutTemplate className="h-4 w-4" /> {t("Mode Admin", "Admin Mode")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setPwOpen(true)}>
                <KeyRound className="h-4 w-4" /> {t("Ganti Kata Sandi", "Change Password")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => void session.logout()}>
                <LogOut className="h-4 w-4" /> {t("Keluar")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* baris 2 (desktop): menu horizontal — pengganti sidebar */}
        <nav className="hidden border-t border-stone-100/80 dark:border-stone-800/60 md:block" aria-label={t("Navigasi utama Self Service", "Self Service main navigation")}>
          <div className="mx-auto flex w-full max-w-7xl items-center gap-1 px-4 sm:px-6">
            {ESS_NAV.map((item) => {
              const active = view === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => go(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-bold transition-colors",
                    active
                      ? "text-amber-800 dark:text-amber-400"
                      : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="ov-ess-active-pill"
                      className="absolute inset-0 rounded-t-xl border-b-2 border-amber-500 bg-amber-50/70 dark:bg-amber-500/10"
                      transition={{ type: "spring", stiffness: 400, damping: 34 }}
                    />
                  )}
                  <Icon className={cn("relative h-[15px] w-[15px] shrink-0", active ? "text-amber-600 dark:text-amber-400" : "text-stone-400")} aria-hidden />
                  <span className="relative truncate">{t(item.label, item.en)}</span>
                </button>
              );
            })}
            {/* identitas view aktif ringan di ujung kanan */}
            <span className="flex-1" />
            <span className="hidden items-center gap-1.5 text-[11px] font-medium text-stone-400 xl:flex">
              <Waypoints className="h-3 w-3 text-amber-500" aria-hidden />
              {t("OneVity Employee Self Service", "OneVity Employee Self Service")}
            </span>
          </div>
        </nav>
      </header>

      {/* ============ KONTEN — view-state internal ESS ============ */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {/* judul view untuk mobile (desktop sudah punya menu aktif di topnav) */}
        <p className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-500 md:hidden">
          {t(activeItem.label, activeItem.en)}
        </p>
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {view === "dashboard" && <EssDashboard me={me} go={go} />}
            {view === "profile" && <EssProfile me={me} />}
            {view === "leave" && <EssLeavePage intent={intent} />}
            {view === "attendance" && <EssAttendance />}
            {view === "payslips" && <EssPayslips intent={intent} />}
            {view === "claims" && <EssClaims />}
            {view === "requests" && <EssRequests intent={intent} />}
            {view === "letters" && <EssLetters />}
            {/* wave 27 stub — pengumuman / tukar shift / aset saya */}
            {view === "announcements" && <EssAnnouncements />}
            {view === "swap" && <EssSwap />}
            {view === "assets" && <EssAssets />}
            {view === "whistleblow" && (
              <div className="mx-auto max-w-2xl">
                <div className="mb-4 flex items-start gap-3 border-b border-stone-200/70 pb-4 dark:border-stone-800/70">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-[0_10px_28px_-12px_rgba(225,29,72,0.7)]">
                    <Siren className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <h1 className="text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-50">{t("Laporkan Pelanggaran", "Report a Violation")}</h1>
                    <p className="text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
                      {t(
                        "Kanal pelaporan kekerasan seksual & pelanggaran di tempat kerja (UU 12/2022). Anonim & dilindungi undang-undang.",
                        "Channel for reporting sexual violence & workplace violations (Law 12/2022). Anonymous & protected by law.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                  <WhistleblowForm compact />
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ============ FOOTER ============ */}
      <footer className="mt-auto border-t border-stone-200/70 py-4 dark:border-stone-800/70">
        <p className="text-center text-[11px] text-stone-400 dark:text-stone-500">
          © 2026 <span className="font-bold text-amber-700 dark:text-amber-500">OneVity</span> · {t("Employee Self Service", "Employee Self Service")}
          {me.companyName ? ` · ${me.companyName}` : ""}
        </p>
      </footer>

      {/* spacer — jaga konten & footer tidak tertutup tab bar mobile */}
      <div className="h-[84px] shrink-0 md:hidden" aria-hidden="true" />

      {/* ============ NAVIGASI MOBILE: bottom tab + sheet "Lainnya" ============ */}
      <nav className="fixed inset-x-0 bottom-0 z-50 md:hidden" aria-label={t("Navigasi Self Service", "Self Service navigation")}>
        <div
          className="flex items-stretch justify-around border-t border-stone-200 bg-white/95 pt-1 backdrop-blur-xl dark:border-stone-800 dark:bg-stone-900/95"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.375rem)" }}
        >
          {ESS_TABS.map((id) => {
            const item = ESS_NAV.find((n) => n.id === id)!;
            const active = view === id;
            const Icon = item.icon;
            return (
              <button
                key={id}
                onClick={() => go(id)}
                aria-label={t(item.label, item.en)}
                aria-current={active ? "page" : undefined}
                className="relative flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5 transition-transform active:scale-95"
              >
                <span className="relative flex h-7 w-11 items-center justify-center rounded-md">
                  {active && (
                    <motion.span
                      layoutId="ov-ess-mtab"
                      className="absolute inset-0 rounded-md bg-amber-500/15"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <Icon className={cn("relative h-[18px] w-[18px]", active ? "text-amber-700 dark:text-amber-400" : "text-stone-400 dark:text-stone-500")} aria-hidden />
                </span>
                <span className={cn("max-w-[64px] truncate text-[9px] font-bold", active ? "text-amber-800 dark:text-amber-400" : "text-stone-400 dark:text-stone-500")}>
                  {t(item.short, item.shortEn)}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setSheet(true)}
            aria-label={t("Menu lainnya, profil, dan akun", "More menu, profile, and account")}
            aria-current={!ESS_TABS.includes(view) ? "page" : undefined}
            className="relative flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5 transition-transform active:scale-95"
          >
            <span className="relative flex h-7 w-11 items-center justify-center rounded-md">
              {!ESS_TABS.includes(view) && (
                <motion.span
                  layoutId="ov-ess-mtab"
                  className="absolute inset-0 rounded-md bg-amber-500/15"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <MoreHorizontal className={cn("relative h-[18px] w-[18px]", ESS_TABS.includes(view) ? "text-stone-400 dark:text-stone-500" : "text-amber-700 dark:text-amber-400")} aria-hidden />
            </span>
            <span className={cn("text-[9px] font-bold", ESS_TABS.includes(view) ? "text-stone-400 dark:text-stone-500" : "text-amber-800 dark:text-amber-400")}>
              {t("Lainnya", "More")}
            </span>
          </button>
        </div>
      </nav>

      {/* bottom sheet mobile — halaman lain + akun */}
      <AnimatePresence>
        {sheet && (
          <>
            <motion.div
              className="fixed inset-0 z-[60] bg-black/40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheet(false)}
              aria-hidden
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={t("Menu lainnya", "More menu")}
              className="fixed inset-x-0 bottom-0 z-[70] max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl md:hidden dark:bg-stone-900 dark:text-stone-100"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300 dark:bg-stone-700" aria-hidden />
              <div className="mb-2 flex items-center justify-between">
                <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-stone-400">{t("Menu Lainnya", "More Menu")}</p>
                <button className="rounded-full p-1.5 transition hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => setSheet(false)} aria-label={t("Tutup")}>
                  <X className="h-4 w-4 text-stone-400" />
                </button>
              </div>
              <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}>
                {ESS_NAV.map((item) => {
                  const current = view === item.id;
                  const Icon = item.icon;
                  return (
                    <motion.button
                      key={item.id}
                      variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-stone-100 dark:hover:bg-stone-800"
                      onClick={() => go(item.id)}
                    >
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", current ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-stone-100 text-stone-500 dark:bg-stone-800")}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-[13px] font-bold text-stone-700 dark:text-stone-200">{t(item.label, item.en)}</span>
                      {current ? <Check className="h-4 w-4 shrink-0 text-amber-600" /> : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-stone-300 dark:text-stone-600" />}
                    </motion.button>
                  );
                })}
              </motion.div>

              {/* akun */}
              <div className="mt-4 rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-8 w-8 ring-2 ring-amber-500/25">
                    {me.employee.photoUrl && <AvatarImage src={me.employee.photoUrl} alt={me.employee.fullName} />}
                    <AvatarFallback className="bg-amber-100 text-[10px] font-extrabold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                      {initials(me.employee.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-stone-800 dark:text-stone-100">{me.employee.fullName}</p>
                    <p className="truncate text-[10px] text-stone-400">{me.employee.employeeNo}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => { setSheet(false); setPwOpen(true); }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-200 py-2 text-[11px] font-bold text-stone-600 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                  >
                    <KeyRound className="h-3.5 w-3.5" /> {t("Ganti Sandi")}
                  </button>
                  <button
                    onClick={() => { setSheet(false); void session.logout(); }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 py-2 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    <LogOut className="h-3.5 w-3.5" /> {t("Keluar")}
                  </button>
                </div>
                {me.canAdmin && (
                  <button
                    onClick={() => { setSheet(false); setUiMode("admin"); }}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 py-2 text-[11px] font-bold text-amber-800 transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/15"
                  >
                    <LayoutTemplate className="h-3.5 w-3.5" /> {t("Mode Admin", "Admin Mode")}
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ChangePasswordDialog open={pwOpen} setOpen={setPwOpen} />
    </div>
  );
}
