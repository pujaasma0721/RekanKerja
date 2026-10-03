"use client";
// RekanKerja ESS Shell — pengalaman Employee Self-Service SEPENUHNYA terpisah
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
  AlertTriangle, Loader2, LayoutTemplate, Megaphone, ArrowLeftRight, Package, CalendarPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, initials, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { useUiMode } from "@/rekankerja/shared/lib/store";
import { useAccentTheme, applyAccentTheme } from "@/rekankerja/shared/lib/accent-theme";
import { useI18n, locActivity } from "@/rekankerja/shared/lib/i18n";
import { LanguageSwitcher } from "@/rekankerja/shared/components/shell/language-switcher";
import { ChangePasswordDialog } from "@/rekankerja/shared/components/shell/change-password-dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ESS_BASE, markNotifRead, useEssMe } from "./ess-api";
import { StatusPill } from "@/rekankerja/shared/components/ui-kit";
import type { EssMe, EssNotificationsData, EssView } from "./ess-types";
import { EssDashboard } from "./ess-dashboard";
import { EssProfile } from "./ess-profile";
import { EssLeavePage } from "./ess-leave";
import { EssAttendance } from "./ess-attendance";
import { EssPayslips } from "./ess-payslips";
import { EssClaims } from "./ess-claims";
import { EssRequests } from "./ess-requests";
import { EssLetters } from "./ess-letters";
// Task 27-f/g/b — pengumuman, tukar shift, aset saya (semuanya sudah terimplementasi)
import { EssAnnouncements } from "./ess-announcements";
import { EssSwap } from "./ess-swap";
import { EssAssets } from "./ess-assets";
// Task 100 F1 (G19) — marketplace open shift
import { EssOpenShift } from "./ess-open-shift";
// Task 52-f — kanal whistleblowing TPKS (anonim) utk semua pekerja.
import { WhistleblowForm, WB_CATEGORIES } from "@/rekankerja/whistleblow/components/whistleblow-form";
import { Siren, Ticket } from "lucide-react";

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
  // Task 27-f/g/b — pengumuman / tukar shift / aset saya
  { id: "announcements", label: "Pengumuman", en: "Announcements", short: "Pengumuman", shortEn: "News", icon: Megaphone },
  { id: "swap", label: "Tukar Shift", en: "Shift Swap", short: "Tukar Shift", shortEn: "Swap", icon: ArrowLeftRight },
  // Task 100 F1 (G19) — marketplace open shift (klaim shift tambahan)
  { id: "open-shift", label: "Open Shift", en: "Open Shift", short: "Open Shift", shortEn: "Open Shift", icon: CalendarPlus },
  { id: "assets", label: "Aset Saya", en: "My Assets", short: "Aset", shortEn: "Assets", icon: Package },
  // Task 52-f — kanal pelaporan pelanggaran/TPKS (anonim, semua pekerja)
  { id: "whistleblow", label: "Laporkan Pelanggaran", en: "Report a Violation", short: "Lapor", shortEn: "Report", icon: Siren },
  { id: "profile", label: "Profil Saya", en: "My Profile", short: "Profil", shortEn: "Profile", icon: UserRound },
];

// tab mobile: 4 item pertama + "Lainnya" (bottom sheet sisanya)
const ESS_TABS: EssView[] = ["dashboard", "leave", "attendance", "payslips"];

// Task 94 — tab desktop (topnav): 6 item frekuensi-tinggi + dropdown "Lainnya"
// untuk sisanya. Sebelumnya 12 item horizontal (~1670px) → overflow & scroll
// horizontal di SEMUA lebar desktop (1024/1280/1440) — tidak proporsional dengan
// konten max-w-7xl. Pola cermin mobile (4 tab + sheet): 6 tab + dropdown.
const ESS_TABS_DESKTOP: EssView[] = ["dashboard", "leave", "attendance", "payslips", "claims", "requests"];
const ESS_OVERFLOW_DESKTOP = ESS_NAV.filter((n) => !ESS_TABS_DESKTOP.includes(n.id));

const subscribeNoop = () => () => {};

// ============ LOGO ESS (pola lockup editorial: kotak tinta + aksen brand "Kerja") ============
function EssLogo({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_28px_-12px_rgba(37,99,235,0.55)]",
          compact ? "h-9 w-9" : "h-10 w-10",
        )}
      >
        <Waypoints className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden />
      </div>
      <div className="min-w-0">
        <p className={cn("font-extrabold tracking-tight text-slate-900 dark:text-slate-100", compact ? "text-[15px]" : "text-base")}>
          Rekan<span className="text-brand-deep dark:text-brand">Kerja</span>
        </p>
        <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
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
    <span className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-bold tabular-nums text-slate-600 xl:inline-flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
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
      className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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
          className="relative rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div>
            <p className="text-sm font-bold">{t("Notifikasi", "Notifications")}</p>
            <p className="text-[11px] text-slate-400">
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
            <p className="px-3 py-8 text-center text-xs text-slate-400">{t("Belum ada notifikasi", "No notifications yet")}</p>
          ) : (
            items.slice(0, 12).map((n) => {
              const isUnread = !n.readAt;
              return (
                <button
                  key={n.id}
                  onClick={() => { if (isUnread) void markOne(n.id); }}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-xl p-3 text-left transition",
                    isUnread ? "bg-amber-50/70 hover:bg-amber-100/70 dark:bg-amber-500/10 dark:hover:bg-amber-500/15" : "hover:bg-slate-100 dark:hover:bg-slate-800/60",
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isUnread ? "bg-amber-500" : "bg-transparent")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{locActivity(n.title)}</span>
                    {n.body && <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{locActivity(n.body)}</span>}
                    <span className="mt-1 block text-[10px] font-medium text-slate-400">{fmtDateTime(n.createdAt)}</span>
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

// ============ Task 82-c: LAPORAN SAYA (whistleblow non-anonim) ============
// Daftar laporan yang dikirim dgn identitas (reporterEmployeeId = aktor ESS).
// Laporan ANONIM sengaja tidak bisa dilacak siapa pun (by design) — nomor
// tiket satu-satunya penjejak; catatan ini selalu ditampilkan di bawah.
function WhistleblowMyReports() {
  const { t } = useI18n();
  const api = useApi<{ reports: { ticketNo: string; category: string; status: string; createdAt: string }[] }>(
    "/api/rekankerja/whistleblowing/report",
  );
  const catLabel = (value: string) => {
    const c = WB_CATEGORIES.find((x) => x.value === value);
    return t(c?.id ?? value, c?.en ?? value);
  };
  return (
    <section className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-50">
        <Ticket className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
        {t("Laporan Saya", "My Reports")}
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        {t(
          "Hanya laporan yang Anda kirim dengan identitas (non-anonim) yang tampil di sini beserta status penanganannya.",
          "Only reports you submitted with your identity (non-anonymous) are listed here with their handling status.",
        )}
      </p>
      {api.loading && !api.data ? (
        <div className="mt-3 space-y-2">
          <div className="h-9 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="h-9 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        </div>
      ) : api.error ? (
        <p className="mt-3 text-[11px] text-slate-400">{api.error}</p>
      ) : (api.data?.reports ?? []).length === 0 ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          {t("Belum ada laporan teridentifikasi milik Anda.", "You have no identified reports yet.")}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800/70">
          {(api.data?.reports ?? []).map((r) => (
            <li key={r.ticketNo} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-400">{r.ticketNo}</span>
              <span className="text-[12px] font-medium text-slate-700 dark:text-slate-200">{catLabel(r.category)}</span>
              <span className="ml-auto text-[10px] text-slate-400">{fmtDateTime(r.createdAt)}</span>
              <StatusPill status={r.status} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-400">
        <Siren className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {t(
          "Laporan anonim tidak bisa dilacak di sini (by design) — simpan nomor tiket Anda.",
          "Anonymous reports cannot be tracked here (by design) — keep your ticket number.",
        )}
      </p>
    </section>
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

  // Task 64f — tema aksen pilihan pengguna (topbar admin) juga berlaku di ESS:
  // hydrate dari localStorage + terapkan ulang saat tema light/dark berganti.
  const { accent: accentId, hydrate: hydrateAccent } = useAccentTheme();
  const { resolvedTheme: essResolvedTheme } = useTheme();
  useEffect(() => { hydrateAccent(); }, [hydrateAccent]);
  useEffect(() => { if (essResolvedTheme) applyAccentTheme(accentId); }, [essResolvedTheme, accentId]);

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
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_28px_-12px_rgba(37,99,235,0.55)]">
            <Waypoints className="h-7 w-7" aria-hidden />
          </div>
          <div className="flex items-center gap-2 text-[13px] font-medium text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-brand-deep dark:text-brand" aria-hidden />
            {t("Memuat profil karyawan…", "Loading employee profile…")}
          </div>
        </div>
      </div>
    );
  }

  if (meState.phase === "no-employee") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-500/15">
            <UserRoundSearch className="h-7 w-7 text-amber-700 dark:text-amber-400" aria-hidden />
          </div>
          <p className="mt-4 text-base font-bold text-slate-900 dark:text-slate-50">
            {t("Akun belum terhubung ke data karyawan", "This account is not linked to an employee record")}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
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
        <div className="max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 dark:bg-rose-500/10">
            <AlertTriangle className="h-7 w-7 text-rose-500 dark:text-rose-400" aria-hidden />
          </div>
          <p className="mt-4 text-base font-bold text-slate-900 dark:text-slate-50">{t("Gagal memuat data karyawan", "Failed to load employee data")}</p>
          <p className="mt-1.5 break-words text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
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
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
        {/* baris 1: brand + aksi */}
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2.5 px-4 sm:px-6">
          <button className="flex items-center gap-3 text-left" onClick={() => go("dashboard")} aria-label={t("Ke Dashboard", "Go to Dashboard")}>
            <EssLogo compact />
          </button>

          <span className="flex-1" />

          {/* workspace */}
          <span
            title={sessionTenant?.name ?? me.companyName ?? ""}
            className="hidden max-w-[180px] items-center gap-1.5 truncate rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 lg:flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
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
                <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 sm:block" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-xs">
                <p className="truncate font-bold text-slate-800 dark:text-slate-100">{me.employee.fullName}</p>
                <p className="mt-0.5 truncate font-medium text-slate-400">
                  {me.employee.email ?? me.employee.employeeNo}
                  {me.role ? ` · ${me.role}` : ""}
                </p>
                <p className="mt-0.5 truncate font-normal text-slate-400">
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

        {/* baris 2 (desktop): menu horizontal — pengganti sidebar.
            Task 94: 6 tab primer + "Lainnya" dropdown (12 item = overflow di
            semua lebar desktop). Label pendek di md–lg, penuh di lg+. */}
        <nav className="hidden border-t border-slate-100/80 dark:border-slate-800/60 md:block" aria-label={t("Navigasi utama Self Service", "Self Service main navigation")}>
          <div className="mx-auto flex w-full max-w-7xl items-center gap-1 px-4 sm:px-6">
            {ESS_NAV.filter((n) => ESS_TABS_DESKTOP.includes(n.id)).map((item) => {
              const active = view === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => go(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-w-0 items-center gap-1.5 px-2.5 py-2.5 text-[13px] font-bold transition-colors lg:px-3.5",
                    active
                      ? "text-amber-800 dark:text-amber-400"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="ov-ess-active-pill"
                      className="absolute inset-0 rounded-t-xl border-b-2 border-amber-500 bg-amber-50/70 dark:bg-amber-500/10"
                      transition={{ type: "spring", stiffness: 400, damping: 34 }}
                    />
                  )}
                  <Icon className={cn("relative h-[15px] w-[15px] shrink-0", active ? "text-amber-600 dark:text-amber-400" : "text-slate-400")} aria-hidden />
                  <span className="relative truncate lg:hidden">{t(item.short, item.shortEn)}</span>
                  <span className="relative hidden truncate lg:inline">{t(item.label, item.en)}</span>
                </button>
              );
            })}
            {/* Task 94 — "Lainnya": menu sisanya (pola cermin sheet mobile) */}
            {(() => {
              const overflowActive = !ESS_TABS_DESKTOP.includes(view);
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-current={overflowActive ? "page" : undefined}
                      aria-label={t("Menu lainnya", "More menu")}
                      className={cn(
                        "relative flex min-w-0 items-center gap-1.5 rounded-t-xl px-2.5 py-2.5 text-[13px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:px-3.5",
                        overflowActive
                          ? "text-amber-800 dark:text-amber-400"
                          : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                      )}
                    >
                      {overflowActive && (
                        <motion.span
                          layoutId="ov-ess-active-pill"
                          className="absolute inset-0 rounded-t-xl border-b-2 border-amber-500 bg-amber-50/70 dark:bg-amber-500/10"
                          transition={{ type: "spring", stiffness: 400, damping: 34 }}
                        />
                      )}
                      <MoreHorizontal className={cn("relative h-[15px] w-[15px] shrink-0", overflowActive ? "text-amber-600 dark:text-amber-400" : "text-slate-400")} aria-hidden />
                      <span className="relative">{t("Lainnya", "More")}</span>
                      <ChevronDown className={cn("relative h-3.5 w-3.5 shrink-0 transition-transform", overflowActive ? "text-amber-500" : "text-slate-400")} aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      {t("Menu Lainnya", "More Menu")}
                    </DropdownMenuLabel>
                    {ESS_OVERFLOW_DESKTOP.map((item) => {
                      const active = view === item.id;
                      const Icon = item.icon;
                      return (
                        <DropdownMenuItem
                          key={item.id}
                          onClick={() => go(item.id)}
                          className={cn("gap-2.5 py-2.5", active && "bg-amber-50 font-bold text-amber-800 dark:bg-amber-500/10 dark:text-amber-400")}
                        >
                          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", active ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
                            <Icon className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="truncate">{t(item.label, item.en)}</span>
                          {active && <Check className="ml-auto h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })()}
            {/* identitas view aktif ringan di ujung kanan */}
            <span className="flex-1" />
            <span className="hidden items-center gap-1.5 text-[11px] font-medium text-slate-400 xl:flex">
              <Waypoints className="h-3 w-3 text-amber-500" aria-hidden />
              {t("RekanKerja Employee Self Service", "RekanKerja Employee Self Service")}
            </span>
          </div>
        </nav>
      </header>

      {/* ============ KONTEN — view-state internal ESS ============ */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {/* judul view untuk mobile (desktop sudah punya menu aktif di topnav) */}
        <p className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-deep dark:text-brand md:hidden">
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
            {/* Task 27-f/g/b — pengumuman / tukar shift / aset saya */}
            {view === "announcements" && <EssAnnouncements />}
            {view === "swap" && <EssSwap />}
            {/* Task 100 F1 (G19) — marketplace open shift */}
            {view === "open-shift" && <EssOpenShift />}
            {view === "assets" && <EssAssets />}
            {view === "whistleblow" && (
              <div className="mx-auto max-w-2xl">
                <div className="mb-4 flex items-start gap-3 border-b border-slate-200/70 pb-4 dark:border-slate-800/70">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-[0_10px_28px_-12px_rgba(225,29,72,0.7)]">
                    <Siren className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">{t("Laporkan Pelanggaran", "Report a Violation")}</h1>
                    <p className="text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {t(
                        "Kanal pelaporan kekerasan seksual & pelanggaran di tempat kerja (UU 12/2022). Anonim & dilindungi undang-undang.",
                        "Channel for reporting sexual violence & workplace violations (Law 12/2022). Anonymous & protected by law.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <WhistleblowForm compact />
                </div>
                {/* Task 82-c: daftar "Laporan Saya" (non-anonim) + catatan tiket */}
                <WhistleblowMyReports />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ============ FOOTER ============ */}
      <footer className="mt-auto border-t border-slate-200/70 py-4 dark:border-slate-800/70">
        <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
          © 2026 <span className="font-bold text-brand-deep dark:text-brand">RekanKerja</span> · {t("Employee Self Service", "Employee Self Service")}
          {me.companyName ? ` · ${me.companyName}` : ""}
        </p>
      </footer>

      {/* spacer — jaga konten & footer tidak tertutup tab bar mobile */}
      <div className="h-[84px] shrink-0 md:hidden" aria-hidden="true" />

      {/* ============ NAVIGASI MOBILE: bottom tab + sheet "Lainnya" ============ */}
      <nav className="fixed inset-x-0 bottom-0 z-50 md:hidden" aria-label={t("Navigasi Self Service", "Self Service navigation")}>
        <div
          className="flex items-stretch justify-around border-t border-slate-200 bg-white/95 pt-1 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95"
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
                  <Icon className={cn("relative h-[18px] w-[18px]", active ? "text-amber-700 dark:text-amber-400" : "text-slate-400 dark:text-slate-500")} aria-hidden />
                </span>
                <span className={cn("max-w-[64px] truncate text-[9px] font-bold", active ? "text-amber-800 dark:text-amber-400" : "text-slate-400 dark:text-slate-500")}>
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
              <MoreHorizontal className={cn("relative h-[18px] w-[18px]", ESS_TABS.includes(view) ? "text-slate-400 dark:text-slate-500" : "text-amber-700 dark:text-amber-400")} aria-hidden />
            </span>
            <span className={cn("text-[9px] font-bold", ESS_TABS.includes(view) ? "text-slate-400 dark:text-slate-500" : "text-amber-800 dark:text-amber-400")}>
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
              className="fixed inset-x-0 bottom-0 z-[70] max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl md:hidden dark:bg-slate-900 dark:text-slate-100"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden />
              <div className="mb-2 flex items-center justify-between">
                <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("Menu Lainnya", "More Menu")}</p>
                <button className="rounded-full p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setSheet(false)} aria-label={t("Tutup")}>
                  <X className="h-4 w-4 text-slate-400" />
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
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      onClick={() => go(item.id)}
                    >
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", current ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800")}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-[13px] font-bold text-slate-700 dark:text-slate-200">{t(item.label, item.en)}</span>
                      {current ? <Check className="h-4 w-4 shrink-0 text-amber-600" /> : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />}
                    </motion.button>
                  );
                })}
              </motion.div>

              {/* akun */}
              <div className="mt-4 rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-8 w-8 ring-2 ring-amber-500/25">
                    {me.employee.photoUrl && <AvatarImage src={me.employee.photoUrl} alt={me.employee.fullName} />}
                    <AvatarFallback className="bg-amber-100 text-[10px] font-extrabold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                      {initials(me.employee.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-slate-800 dark:text-slate-100">{me.employee.fullName}</p>
                    <p className="truncate text-[10px] text-slate-400">{me.employee.employeeNo}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => { setSheet(false); setPwOpen(true); }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-[11px] font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
