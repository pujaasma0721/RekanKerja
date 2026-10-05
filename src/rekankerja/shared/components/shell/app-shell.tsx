"use client";
// RekanKerja App Shell — ★ Rekomendasi Design Lab (A + C + widget hidup):
//   · Rail ikon 72px (6 modul) + panel menu modul 264px — indikator aktif meluncur (spring)
//   · Identitas warna per modul (logo, indikator, CTA ikut berganti aksen)
//   · Widget hidup dengan data nyata: avatar pengaju, ring hari menuju akhir periode, status email
//   · Mobile: bottom tab bar + bottom sheet (pola navigasi native)
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNav, useUiMode, SectionId, ModuleId, MODULE_LABEL, moduleOfSection } from "@/rekankerja/shared/lib/store";
import { useApi, initials } from "@/rekankerja/shared/lib/api";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { MenuPermsProvider } from "@/rekankerja/shared/lib/menu-perms-context";
import { actionAllowed, type MenusMap } from "@/rekankerja/shared/lib/menu-perms";
import { ChangePasswordDialog } from "@/rekankerja/shared/components/shell/change-password-dialog";
import { LanguageSwitcher } from "@/rekankerja/shared/components/shell/language-switcher";
import { AccentSwitcher } from "@/rekankerja/shared/components/shell/accent-switcher";
import { NotificationBell } from "@/rekankerja/shared/components/shell/notification-bell";
import { MoneyVaultButton } from "@/rekankerja/shared/components/shell/money-vault";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useAccentTheme, applyAccentTheme, ACCENT_THEMES } from "@/rekankerja/shared/lib/accent-theme";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
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
  LayoutDashboard, Users, Workflow, Settings2, Check, ChevronDown, UserRound,
  Network, Landmark, BriefcaseBusiness, GraduationCap, UserPlus, Inbox, Coins, Calculator, Building2,
  Scale, ShieldCheck, ShieldOff, Layers, Moon, Sun, Search, Command as CommandIcon, LogOut,
  KeyRound, X, ChevronRight, Activity, Clock, CheckCircle2, FileText, Waypoints, HeartHandshake,
  Wallet, CalendarRange, PlayCircle, LayoutTemplate, IdCard, ArrowLeftRight, Percent,
  CalendarClock, Palmtree, Plane, HeartPulse, Boxes, FileSpreadsheet, BookOpen, BarChart3,
  Hospital, TrendingUp, Mail, MoreHorizontal, ArrowRight, XCircle, ChartNoAxesColumn, CalendarDays, FolderOpen,
  Webhook, ScrollText, Megaphone, Package, Radar, FileUp, MessageCircle, SlidersHorizontal,
  MegaphoneOff, Siren, Eye, ClipboardCheck, Send, FileSignature, Bot, QrCode,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============ UTIL WARNA (aksen dinamis — hex inline, bukan kelas tailwind) ============
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function grad(hex: string): string {
  return `linear-gradient(135deg, ${hex}, ${hexA(hex, 0.7)})`;
}

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

// ============ MODULE REGISTRY (identitas warna — opsi C) ============
export interface ModuleMeta {
  id: ModuleId;
  label: string;
  short: string;
  desc: string;
  icon: React.ElementType;
  ready: boolean;
  hex: string; // aksen modul
}

export const MODULES: ModuleMeta[] = [
  { id: "hr", label: "Human Resource Base", short: "HR", desc: "Inti administrasi karyawan", icon: Users, ready: true, hex: "#10b981" },
  { id: "payroll", label: "Payroll", short: "Payroll", desc: "Periode, proses & kepatuhan pajak", icon: Coins, ready: true, hex: "#f59e0b" },
  { id: "attendance", label: "Attendance", short: "Absensi", desc: "Jadwal, clocking & lembur", icon: CalendarClock, ready: true, hex: "#14b8a6" },
  { id: "leave", label: "Leave", short: "Cuti", desc: "Saldo, permintaan & persetujuan", icon: Palmtree, ready: true, hex: "#06b6d4" },
  { id: "travel", label: "Travel", short: "Travel", desc: "Perjalanan dinas & settlement", icon: Plane, ready: true, hex: "#8b5cf6" },
  { id: "medical", label: "Medical", short: "Medis", desc: "Benefit & klaim kesehatan", icon: HeartPulse, ready: true, hex: "#f43f5e" },
  // Task 52-f — kanal whistleblowing TPKS (UU 12/2022 Ps.22-24): laporan
  // anonim + penanganan (triase) oleh tim yang berwenang.
  { id: "whistleblowing", label: "Whistleblowing", short: "Lapor", desc: "Kanal pelaporan anonim & penanganan (TPKS)", icon: Siren, ready: true, hex: "#e11d48" },
];

export const SETTINGS_META = {
  id: "settings",
  label: "Pengaturan Sistem",
  short: "Pengaturan",
  desc: "Konfigurasi sistem RekanKerja",
  icon: Settings2,
  hex: "#a8a29e",
} as const;

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
    // Task 65 — checklist onboarding per bagian (email + link publik)
    { id: "onboarding-checklist", label: "Checklist Onboarding", icon: ClipboardCheck },
    { id: "disciplinary", label: "Catatan Disiplin", icon: Scale },
    { id: "documents", label: "Dokumen Karyawan", icon: FolderOpen },
    // 27-b — inventaris aset perusahaan (penugasan + pengembalian)
    { id: "assets", label: "Aset Karyawan", icon: Package },
    { id: "offboarding", label: "Offboarding Karyawan", icon: LogOut },
  ] },
  { section: "actions", label: "Pengajuan & Persetujuan", children: [
    { id: "inbox", label: "Menunggu Persetujuan", icon: Inbox, badge: "pending" },
    { id: "all", label: "Semua Pengajuan", icon: Workflow },
  ] },
  { section: "actions", label: "Dokumen & Surat", children: [
    { id: "templates", label: "Template Surat", icon: FileText },
  ] },
  // 27-f — broadcast pengumuman ke seluruh ESS (dengan read-tracking)
  { section: "employee", label: "Komunikasi", children: [
    { id: "announcements", label: "Pengumuman", icon: Megaphone },
  ] },
  { section: "reports", label: "Laporan", children: [
    { id: "reports", label: "Laporan HR", icon: ChartNoAxesColumn },
    // 28-b — report builder kustom (entity + field + filter + ekspor)
    { id: "custom-reports", label: "Laporan Kustom", icon: SlidersHorizontal },
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

// Modul Attendance — terinspirasi struktur menu Time Attendance (28 halaman → 8 view).
const ATTENDANCE_NAV: NavGroup[] = [
  { section: "attendance", children: [{ id: "schedules", label: "Ringkasan", icon: LayoutDashboard }] },
  { section: "attendance", label: "Jadwal & Shift", children: [
    { id: "templates-schedule", label: "Template Jadwal", icon: CalendarClock },
    { id: "assignment-schedule", label: "Assign Jadwal", icon: CalendarRange },
    { id: "matrix", label: "Matriks Jadwal", icon: Layers },
    { id: "holidays", label: "Kalender Libur", icon: CalendarDays },
    // Task 100 F1 (G19, impl-E) — marketplace open shift (posting + klaim)
    { id: "open-shift", label: "Open Shift", icon: Users },
  ] },
  { section: "attendance", label: "Kehadiran", children: [
    { id: "clocking", label: "Data Clocking", icon: Activity },
    // 27-e — papan kehadiran real-time (siapa di kantor sekarang)
    { id: "liveboard", label: "Papan Kehadiran", icon: Radar },
    { id: "absence", label: "Absensi & Izin", icon: XCircle },
    { id: "overtime", label: "Lembur (Overtime)", icon: Clock },
    { id: "workoff", label: "Work Off Permission", icon: CheckCircle2 },
    // 27-g — persetujuan tukar shift antar karyawan (ESS mengajukan)
    { id: "shift-swap", label: "Tukar Shift", icon: ArrowLeftRight },
    // 27-a — import log mesin absen (sidik jari/face) CSV/Excel
    { id: "machine-import", label: "Import Mesin Absen", icon: FileUp },
    // Task 100 F1 (G17, impl-E) — kios QR presensi (mode tampilan sesi admin)
    { id: "kiosk-qr", label: "Kios QR", icon: QrCode },
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
    // W4-1 (fix G-3) — piutang asuransi (padanan oranHR Paid By Insurance %).
    { id: "medical-insurance", label: "Piutang Asuransi", icon: Coins },
  ] },
  { section: "medical", label: "Master & Laporan", children: [
    { id: "medical-benefit-type", label: "Jenis Benefit", icon: Boxes },
    { id: "medical-providers", label: "Rumah Sakit & Asuransi", icon: Hospital },
    { id: "medical-reports", label: "Laporan Medis", icon: BarChart3 },
  ] },
];

// Task 52-f — whistleblowing TPKS (UU 12/2022): kanal laporan (default utk
// semua pengguna terautentikasi — PUBLIC_MENU_KEYS) + triase penanganan
// (whistleblowing:triage — admin/tim yang diberi akses).
const WHISTLEBLOW_NAV: NavGroup[] = [
  { section: "whistleblowing", children: [
    { id: "report", label: "Laporkan Pelanggaran", icon: Siren },
  ] },
  { section: "whistleblowing", label: "Penanganan", children: [
    { id: "triage", label: "Kelola Laporan", icon: ClipboardCheck },
  ] },
];

// Pengaturan sistem — cross-module, tampil di panel semua modul + rail bawah.
export const SETTINGS_NAV: NavGroup[] = [
  { section: "settings", label: "Pengaturan Sistem", children: [
    { id: "lookups", label: "Data Master", icon: Layers },
    { id: "security", label: "Keamanan & Akses", icon: ShieldCheck },
    { id: "approval", label: "Approval Berjenjang", icon: CheckCircle2 },
    { id: "email", label: "Konfigurasi Email", icon: Mail },
    // 28-a — kanal notifikasi WhatsApp (provider Fonnte/Wablas/Custom)
    { id: "whatsapp", label: "Notifikasi WhatsApp", icon: MessageCircle },
    { id: "api", label: "API & Integrasi", icon: Webhook },
    // 26-b P0 — viewer audit trail (data ActivityLog sudah terkumpul sejak lama)
    { id: "audit", label: "Log Aktivitas", icon: ScrollText },
    // 80d — kelola kunci/PIN tanda tangan elektronik + audit rantai
    { id: "esign", label: "eSign", icon: FileSignature },
  ] },
  // Task 96 — AI: provider per-tenant + basis pengetahuan (RAG chatbot)
  { section: "settings", label: "AI & Pengetahuan", children: [
    { id: "ai-provider", label: "Provider AI", icon: Bot },
    { id: "ai-knowledge", label: "Basis Pengetahuan AI", icon: BookOpen },
  ] },
];

export function navOfModule(m: ModuleId): NavGroup[] {
  switch (m) {
    case "payroll": return PAYROLL_NAV;
    case "attendance": return ATTENDANCE_NAV;
    case "leave": return LEAVE_NAV;
    case "travel": return TRAVEL_NAV;
    case "medical": return MEDICAL_NAV;
    case "whistleblowing": return WHISTLEBLOW_NAV;
    default: return HR_NAV;
  }
}

// ============ META SHELL (badge + widget hidup — sinyal nyata dari /api/rekankerja/meta) ============
interface ShellMeta {
  pendingActions: number;
  activeEmployees: number;
  payrollDraftRuns: number;
  benefitPendingClaims: number;
  company: { name: string; shortName: string } | null;
  pendingApprovers?: string[];
  payrollDays?: number | null;
  payrollPeriodEnd?: string | null;
  emailActive?: boolean;
}

const AVA_COLORS = ["#f59e0b", "#06b6d4", "#f43f5e"];
const PANEL_BG = "#232228"; // warna latar panel — dipakai ring avatar agar menyatu

function CountBadge({ hex, n }: { hex: string; n: number }) {
  return (
    <span className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold tabular-nums" style={{ background: hexA(hex, 0.18), color: hex }}>
      {n}
    </span>
  );
}

function AvatarStack({ names }: { names: string[] }) {
  const show = names.slice(0, 3);
  if (show.length === 0) return null;
  return (
    <span className="flex shrink-0 -space-x-1.5" aria-hidden>
      {show.map((n, i) => (
        <span
          key={n + i}
          className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-extrabold text-white"
          style={{ background: AVA_COLORS[i % AVA_COLORS.length], boxShadow: `0 0 0 2px ${PANEL_BG}` }}
        >
          {initials(n)}
        </span>
      ))}
    </span>
  );
}

function PayrollRing({ hex, days }: { hex: string; days: number }) {
  const { t } = useI18n();
  const C = 2 * Math.PI * 13;
  const frac = Math.max(0, Math.min(1, days / 30));
  return (
    <span
      className="relative flex h-[30px] w-[30px] shrink-0 items-center justify-center"
      role="img"
      aria-label={t("Periode payroll aktif berakhir {days} hari lagi", "Active payroll period ends in {days} days", { days })}
      title={t("Periode payroll aktif berakhir {days} hari lagi", "Active payroll period ends in {days} days", { days })}
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="13" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
        <motion.circle
          cx="18" cy="18" r="13" fill="none" stroke={hex} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - frac) }}
          transition={{ duration: 1.1, ease: "easeOut", delay: 0.3 }}
        />
      </svg>
      <span className="text-[8px] font-extrabold tabular-nums" style={{ color: hex }}>D-{days}</span>
    </span>
  );
}

function LiveDot({ hex, label }: { hex: string; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <motion.span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: hex }}
        animate={{ scale: [1, 1.6, 1] }}
        transition={{ duration: 0.6, repeat: 0 }}
      />
      <span className="text-[9px] font-semibold" style={{ color: hex }}>{label}</span>
    </span>
  );
}

/** Widget hidup item menu — HANYA sinyal data nyata (opsi B, versi produksi yang tenang). */
function ItemWidget({ mod, item, meta, accent }: { mod: string; item: NavItem; meta: ShellMeta | null | undefined; accent: string }) {
  const { t } = useI18n();
  if (item.badge === "pending") {
    const n = meta?.pendingActions ?? 0;
    if (n <= 0) return null;
    const names = meta?.pendingApprovers ?? [];
    return (
      <span className="flex items-center gap-2">
        {names.length > 0 && <AvatarStack names={names} />}
        <CountBadge hex={accent} n={n} />
      </span>
    );
  }
  if (item.badge === "runsDraft") {
    const days = meta?.payrollDays;
    if (days != null && days >= 0) return <PayrollRing hex={accent} days={days} />;
    const n = meta?.payrollDraftRuns ?? 0;
    return n > 0 ? <CountBadge hex={accent} n={n} /> : null;
  }
  if (item.badge === "benefitPending") {
    const n = meta?.benefitPendingClaims ?? 0;
    return n > 0 ? <LiveDot hex="#f59e0b" label={t("{n} menunggu", "{n} pending", { n })} /> : null;
  }
  if (mod === "settings" && item.id === "email") {
    return meta?.emailActive ? <LiveDot hex="#10b981" label={t("aktif", "active")} /> : null;
  }
  return null;
}

// ============ LOGO MARK ============
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="2.6" />
      <circle cx="5" cy="17" r="2.6" />
      <circle cx="19" cy="17" r="2.6" />
      <path d="M12 7.6 6.6 14.6M12 7.6l5.4 7M7.6 17h8.8" />
    </svg>
  );
}

// ============ RAIL BUTTON ============
function RailButton({ label, icon: Icon, hex, active, badge, onClick }: {
  label: string; icon: React.ElementType; hex: string; active: boolean; badge?: number; onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className="group relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-brand/10"
        >
          {active && (
            <motion.span
              layoutId="ov-rail-active"
              className="absolute inset-0 rounded-xl"
              style={{ background: `linear-gradient(135deg, ${hex}, ${hexA(hex, 0.6)})`, boxShadow: `0 10px 22px -6px ${hexA(hex, 0.55)}` }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
          <Icon className={cn("relative z-10 h-[18px] w-[18px] transition-all duration-200 group-hover:scale-110", active ? "text-white" : "text-muted-foreground group-hover:text-brand-deep")} aria-hidden />
          {badge != null && badge > 0 && (
            <span className="absolute -right-0.5 -top-0.5 z-20 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[8px] font-extrabold tabular-nums text-white" style={{ background: hex }}>
              {badge > 9 ? "9+" : badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-[11px] font-semibold">{label}</TooltipContent>
    </Tooltip>
  );
}

// ============ JENIS SHEET MOBILE ============
type MobileSheet = null | "all" | ModuleId;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { section, view, params, module, navigate, setModule, syncFromUrl } = useNav();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false); // dialog Ganti Kata Sandi (Task 33)
  const [sheet, setSheet] = useState<MobileSheet>(null); // bottom sheet mobile
  const setUiMode = useUiMode((s) => s.setUiMode); // T8: ganti Mode Karyawan/Mode Admin
  const session = useSession();
  const sessionUser = session.info?.user;
  const sessionTenant = session.info?.tenant;
  const meta = useApi<ShellMeta>("/api/rekankerja/meta");

  const inSettings = section === "settings";

  // Task 33: peringatan umur kata sandi (kedaluwarsa / segera) — sekali per user
  const pwWarnedFor = useRef<string | null>(null);
  useEffect(() => {
    const pw = session.info?.password;
    const uid = session.info?.user?.id;
    if (!pw || !uid || pwWarnedFor.current === uid) return;
    pwWarnedFor.current = uid;
    if (pw.expired) {
      toast.error(t("Kata sandi Anda kedaluwarsa. Silakan ganti lewat tombol kunci di bagian bawah panel menu.", "Your password has expired. Please change it via the key button at the bottom of the menu panel."), { duration: 9000 });
    } else if (pw.warn) {
      toast.warning(t("Kata sandi Anda {status} — pertimbangkan menggantinya (tombol kunci di panel menu).", "Your password is {status} — consider changing it (key button in the menu panel).", { status: pw.label.toLowerCase() }), { duration: 7000 });
    }
  }, [session.info, t]);

  // Task D-3: tema halaman mengikuti modul aktif — <html data-module=…> agar
  // token aksen (ov-* + --primary/--ring) berlaku untuk seluruh konten,
  // termasuk dialog/dropdown/command yang di-render via portal ke body.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.module = inSettings ? "settings" : module;
    return () => { delete root.dataset.module; };
  }, [module, inSettings]);

  // ===== hak aksi MENU per pengguna (Task 31 + 32) =====
  const meMenu = useApi<{ all: boolean; menus: string[]; perms?: MenusMap; isSuperAdmin: boolean }>("/api/rekankerja/user-menu-access?action=me");
  const menuAll = meMenu.data ? meMenu.data.all : true;
  const allowedKeys = useMemo(() => (menuAll ? null : new Set(meMenu.data?.menus ?? [])), [menuAll, meMenu.data]);
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

  // lock scroll + Escape saat bottom sheet mobile terbuka
  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    if (sheet) window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      if (sheet) window.removeEventListener("keydown", onKey);
    };
  }, [sheet]);

  const go = (s: SectionId, v: string) => { navigate(s, v); setSheet(null); };

  // ===== nav per modul, DISARING sesuai hak akses menu pengguna =====
  const nav = navOfModule(module);
  const settingsGroups = useMemo(() => {
    if (allowedKeys == null) return SETTINGS_NAV;
    return SETTINGS_NAV
      .map((g) => ({ ...g, children: g.children.filter((c) => itemAllowed("settings", c.id)) }))
      .filter((g) => g.children.length > 0);
  }, [allowedKeys, itemAllowed]);

  // panel: saat di Pengaturan → hanya menu settings; di modul → HANYA menu modul.
  // (Task 64g — menu settings tidak lagi disisipkan ke panel modul; masuk lewat
  //  ikon Settings di rail / sheet "Semua Modul" di mobile.)
  const groups = useMemo(() => {
    if (inSettings) return settingsGroups;
    const base = [...nav];
    if (allowedKeys == null) return base;
    return base
      .map((g) => ({ ...g, children: g.children.filter((c) => menuAllowed(g.section, c.id)) }))
      .filter((g) => g.children.length > 0);
  }, [inSettings, nav, settingsGroups, allowedKeys, menuAllowed]);

  // modul yang punya ≥1 menu diizinkan (rail + tab mobile + sheet)
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

  const firstSettingsView = settingsGroups[0]?.children[0]?.id ?? "lookups";

  const navigateToModule = useCallback(
    (m: ModuleId) => {
      const target = firstAllowedOfModule(m);
      if (target) navigate(target.section, target.view);
      else setModule(m);
      setSheet(null);
    },
    [firstAllowedOfModule, navigate, setModule],
  );

  const goHome = () => {
    if (inSettings) return;
    const t = firstAllowedOfModule(module);
    if (t) navigate(t.section, t.view);
    else navigate(module === "hr" ? "dashboard" : defaultSectionOfModuleFor(module));
  };

  // ===== guard view saat ini: view di luar cakupan menu → panel terblokir =====
  const viewAllowed = useMemo(() => {
    if (allowedKeys == null) return true;
    if (section === "settings") return itemAllowed("settings", view);
    const mapped = view === "detail" ? "directory" : view === "run" ? "runs" : view;
    let known = false;
    for (const g of [...navOfModule(module), ...SETTINGS_NAV]) {
      const ownerMod = g.section === "settings" ? "settings" : moduleOfSection(g.section);
      if (g.children.some((c) => c.id === view)) {
        known = true;
        if (itemAllowed(ownerMod, view)) return true;
      }
      if (mapped !== view && g.children.some((c) => c.id === mapped)) {
        known = true;
        if (itemAllowed(ownerMod, mapped)) return true;
      }
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
    const out: string[] = [inSettings ? t("Pengaturan") : MODULE_LABEL[module]];
    if (group?.label && !(inSettings && group.section === "settings")) out.push(t(group.label));
    if (item && item.id !== "overview" && item.id !== view) out.push(t(item.label));
    if (item && item.id === view && item.id !== "overview") out.push(t(item.label));
    if (view === "run" && section === "payroll") out.push(t("Detail Proses", "Run Detail"));
    if (params.id) out.push(params.id);
    return out.filter(Boolean);
  }, [section, view, params, module, groups, inSettings, t]);

  const activeModule = MODULES.find((m) => m.id === module) ?? MODULES[0];
  // Task 64f — satu tema aksen global untuk SEMUA modul/halaman (dipilih di topbar).
  const { accent: accentThemeId, hydrate: hydrateAccent } = useAccentTheme();
  const { resolvedTheme } = useTheme();
  useEffect(() => { hydrateAccent(); }, [hydrateAccent]);
  useEffect(() => { if (resolvedTheme) applyAccentTheme(accentThemeId); }, [resolvedTheme, accentThemeId]);
  const accent = (ACCENT_THEMES.find((x) => x.id === accentThemeId) ?? ACCENT_THEMES[0]).hex;
  const panelLabel = inSettings ? t(SETTINGS_META.label) : activeModule.label;
  const panelDesc = inSettings ? t(SETTINGS_META.desc) : t(activeModule.desc);
  const PanelIcon = inSettings ? Settings2 : activeModule.icon;

  /** Badge modul di rail/tab — sinyal nyata dari meta. */
  const railBadge = (m: ModuleId): number => {
    if (m === "hr") return meta.data?.pendingActions ?? 0;
    if (m === "payroll") return meta.data?.payrollDraftRuns ?? 0;
    return 0;
  };

  // tab mobile: 4 modul pertama yang diizinkan + tombol Lainnya
  const tabs = useMemo(() => allowedModules.slice(0, 4), [allowedModules]);
  const moreActive = inSettings || !tabs.some((t) => t.id === module);
  const onTabTap = (m: ModuleId) => {
    if (module === m && !inSettings) setSheet(m); // tap modul aktif → buka sheet menu modul
    else navigateToModule(m);
  };

  // grup menu untuk sheet modul — HANYA menu modul (settings lewat sheet "Semua Modul")
  const sheetGroups = useMemo(() => {
    if (sheet == null || sheet === "all") return [];
    const base = [...navOfModule(sheet)];
    if (allowedKeys == null) return base;
    return base
      .map((g) => ({ ...g, children: g.children.filter((c) => menuAllowed(g.section, c.id)) }))
      .filter((g) => g.children.length > 0);
  }, [sheet, allowedKeys, menuAllowed, settingsGroups]);

  const sheetModule = sheet && sheet !== "all" ? MODULES.find((m) => m.id === sheet) : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background">
        {/* ============ RAIL MODUL (desktop) — ★ opsi A ============ */}
        <aside
          className="hidden w-[72px] shrink-0 flex-col items-center gap-1.5 border-r border-border bg-sidebar py-4 lg:sticky lg:top-0 lg:flex lg:h-screen"
          aria-label={t("Rail modul RekanKerja", "RekanKerja module rail")}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={goHome}
                aria-label={t("RekanKerja — kembali ke beranda modul", "RekanKerja — back to module home")}
                className="group flex h-9 w-9 items-center justify-center rounded-xl transition-transform hover:scale-105"
                style={{ background: grad(accent), boxShadow: `0 8px 20px -6px ${hexA(accent, 0.5)}` }}
              >
                <LogoMark className="h-4 w-4 text-white" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">RekanKerja HR Suite</TooltipContent>
          </Tooltip>
          <div className="my-2 h-px w-8 bg-border" aria-hidden />
          <nav className="flex flex-col items-center gap-1.5" aria-label={t("Pilih modul", "Select module")}>
            {allowedModules.map((m) => (
              <RailButton
                key={m.id}
                label={m.label}
                icon={m.icon}
                hex={accent}
                active={!inSettings && m.id === module}
                badge={railBadge(m.id)}
                onClick={() => navigateToModule(m.id)}
              />
            ))}
          </nav>
          {settingsGroups.length > 0 && (
            <div className="mt-auto">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => navigate("settings", firstSettingsView)}
                    aria-label={t("Pengaturan Sistem")}
                    aria-current={inSettings ? "page" : undefined}
                    className={cn(
                      "group relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors",
                      inSettings ? "bg-brand/15" : "hover:bg-brand/10",
                    )}
                  >
                    <Settings2 className={cn("h-[18px] w-[18px] transition-colors", inSettings ? "text-brand-deep" : "text-muted-foreground group-hover:text-brand-deep")} aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("Pengaturan Sistem")}</TooltipContent>
              </Tooltip>
            </div>
          )}
        </aside>

        {/* ============ PANEL MENU MODUL (desktop) ============ */}
        <aside
          className="hidden w-[264px] shrink-0 flex-col border-l border-border bg-sidebar text-foreground lg:sticky lg:top-0 lg:flex lg:h-screen"
          aria-label={t("Menu modul aktif", "Active module menu")}
        >
          {/* header modul — identitas warna (opsi C) */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow" style={{ background: grad(accent) }}>
              <PanelIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold text-foreground">{panelLabel}</p>
              <p className="truncate text-[10px] text-muted-foreground">{panelDesc}</p>
            </div>
          </div>

          {/* nav — menu mengikuti modul aktif, stagger saat ganti modul */}
          <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-1" aria-label={t("Navigasi utama", "Main navigation")}>
            {groups.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/50 px-3 py-4 text-center">
                <ShieldOff className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-[11px] font-semibold leading-relaxed text-muted-foreground">
                  {t("Tidak ada menu yang tersedia untuk Anda di modul ini.", "No menus are available to you in this module.")}
                </p>
              </div>
            ) : (
              <motion.div
                key={inSettings ? "settings" : module}
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.022 } } }}
              >
                {groups.map((group) => {
                  const active =
                    section === group.section &&
                    (group.children.some((c) => c.id === view) || (group.matchViews?.includes(view) ?? false));
                  const isSettingsGroup = group.section === "settings";
                  return (
                    <motion.div
                      key={`${group.section}-${group.label ?? "root"}`}
                      className="pb-1"
                      variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0, transition: { duration: 0.18 } } }}
                    >
                      {isSettingsGroup && !inSettings && <div className="mx-2 mb-1 mt-3 h-px bg-border" aria-hidden />}
                      {group.label ? (
                        <button
                          onClick={() => go(group.section, group.children[0].id)}
                          className={cn(
                            "flex w-full items-center px-3 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-brand-deep",
                            active && "hover:text-brand-deep",
                          )}
                          style={active ? { color: accent } : undefined}
                        >
                          {group.label ? t(group.label) : ""}
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
                        const Icon = item.icon;
                        return (
                          <button
                            key={`${group.section}-${item.id}`}
                            onClick={() => go(group.section, item.id)}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                              "group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors",
                              isActive ? "bg-brand/15" : "hover:bg-brand/10",
                            )}
                          >
                            {isActive && (
                              <motion.span
                                layoutId="ov-panel-bar"
                                className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
                                style={{ background: accent, boxShadow: `0 0 12px ${hexA(accent, 0.8)}` }}
                                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                              />
                            )}
                            <Icon
                              className={cn("h-[15px] w-[15px] shrink-0 transition-all duration-200", !isActive && "text-muted-foreground group-hover:translate-x-0.5 group-hover:text-brand-deep")}
                              style={isActive ? { color: accent } : undefined}
                              aria-hidden
                            />
                            <span className={cn("flex-1 truncate text-[12.5px] font-medium", isActive ? "text-foreground" : "text-muted-foreground group-hover:text-brand-deep")}>{t(item.label)}</span>
                            <ItemWidget mod={isSettingsGroup ? "settings" : module} item={item} meta={meta.data} accent={accent} />
                          </button>
                        );
                      })}
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </nav>

          {/* footer panel: user (session SaaS multi-tenant) — T8: avatar kini
              membuka dropdown berisi item "Mode Karyawan" (ganti ke shell ESS) */}
          <div className="border-t border-border px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-0.5 text-left transition hover:bg-accent/60"
                    aria-label={t("Menu akun", "Account menu")}
                  >
                    <div className="relative shrink-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-500 to-slate-700 text-[10px] font-extrabold text-white">{sessionUser ? initials(sessionUser.name) : "?"}</div>
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-brand/55" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-bold text-foreground">{sessionUser?.name ?? "—"}</p>
                      <p className="truncate text-[9px] text-muted-foreground">{sessionTenant ? `${sessionTenant.name} · ${sessionTenant.role}` : t("tanpa workspace", "no workspace")}</p>
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-56">
                  <DropdownMenuItem onClick={() => setUiMode("ess")}>
                    <UserRound className="h-4 w-4" /> {t("Mode Karyawan", "Employee Mode")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                onClick={() => setPwOpen(true)}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent/60 hover:ov-text-accent-base"
                aria-label={t("Ganti kata sandi", "Change password")}
                title={t("Ganti kata sandi", "Change password")}
              >
                <KeyRound className="h-4 w-4" />
              </button>
              <button
                onClick={() => void session.logout()}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent/60 hover:text-rose-500 dark:hover:text-rose-400"
                aria-label={t("Keluar dari sesi", "Log out of session")}
                title={t("Keluar")}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 truncate text-center text-[9px] tracking-wide text-muted-foreground/80">RekanKerja HR Suite v1.0 · {inSettings ? t("Pengaturan") : t(activeModule.short)}</p>
          </div>
        </aside>

        {/* ============ MAIN COLUMN ============ */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* topbar — Task 88: gap/padding dirapatkan & kontrol disusun agar
              TIDAK overflow horizontal di layar 320–375px (audit menemukan
              tombol bahasa/tema terdorong keluar viewport 58px di iPhone SE). */}
          <header className="sticky top-0 z-30 flex h-16 items-center gap-1.5 border-b border-slate-200/80 bg-background/85 px-3 backdrop-blur-xl dark:border-slate-800/80 sm:gap-3 sm:px-6">
            {/* brand mobile — di desktop identitas sudah dibawa rail+panel.
                Task 88: nama app disembunyikan < sm agar kontrol topbar muat. */}
            <div className="flex items-center gap-2.5 lg:hidden">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow" style={{ background: grad(accent) }}>
                <LogoMark className="h-4 w-4 text-white" />
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="text-[13px] font-extrabold leading-none tracking-tight text-slate-900 dark:text-slate-50">
                  Rekan<span style={{ color: accent }}>Kerja</span>
                </p>
                <p className="mt-0.5 truncate text-[9px] font-medium uppercase tracking-wider text-slate-400">{inSettings ? t("Pengaturan") : t(activeModule.short)}</p>
              </div>
            </div>

            {/* breadcrumbs */}
            <nav className="hidden min-w-0 items-center gap-1.5 text-[13px] md:flex" aria-label={t("Breadcrumb", "Breadcrumb")}>
              <button
                onClick={() => {
                  if (inSettings) navigate("settings", firstSettingsView);
                  else {
                    const target = firstAllowedOfModule(module);
                    if (target) navigate(target.section, target.view);
                    else navigate(module === "hr" ? "dashboard" : defaultSectionOfModuleFor(module));
                  }
                }}
                className="font-semibold hover:underline"
                style={{ color: accent }}
              >RekanKerja</button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
                  <span className={cn("truncate", i === crumbs.length - 1 ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-500")}>{c}</span>
                </span>
              ))}
            </nav>
            <span className="flex-1" />

            {/* workspace switcher (multi-tenant SaaS) */}
            <WorkspaceMenu />

            {/* search trigger */}
            <button
              onClick={() => setCmdOpen(true)}
              className="hidden items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[13px] text-slate-400 transition hover:border-slate-300 hover:text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500 md:flex"
            >
              <Search className="h-4 w-4" />
              <span>{t("Cari karyawan, dokumen…", "Search employees, documents…")}</span>
              <kbd className="ml-4 flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-800">
                <CommandIcon className="h-2.5 w-2.5" />K
              </kbd>
            </button>
            <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden" onClick={() => setCmdOpen(true)} aria-label={t("Cari")}>
              <Search className="h-5 w-5" />
            </button>

            {/* money vault — kata sandi enkripsi uang (Task 45-c) */}
            <MoneyVaultButton />

            {/* tema warna — satu aksen untuk semua modul & halaman (Task 64f).
                Task 88: disembunyikan < sm agar topbar muat di layar sempit —
                personalisasi warna tetap tersedia di tablet/desktop. */}
            <AccentSwitcher className="hidden sm:flex" />

            {/* notifications — feed nyata per AppUser (T11-NOTIF) */}
            <NotificationBell />

            {/* language switcher (ID/EN) */}
            <LanguageSwitcher />

            {/* theme toggle */}
            <ThemeToggle />
          </header>

          {/* content — view di luar cakupan menu pengguna → panel terblokir (Task 31) */}
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8" id="rekankerja-main">
            <MenuPermsProvider {...permsApi}>
            {!viewAllowed ? (
              <div className="flex min-h-[50vh] items-center justify-center">
                <div className="max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 dark:bg-rose-500/10">
                    <ShieldOff className="h-7 w-7 text-rose-500 dark:text-rose-400" />
                  </div>
                  <p className="mt-4 text-base font-bold text-slate-900 dark:text-slate-50">{t("Menu tidak tersedia", "Menu unavailable")}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {t("Anda tidak memiliki hak akses ke menu ini. Hak akses menu diatur per pengguna — hubungi admin bila memerlukan akses.", "You do not have access to this menu. Menu access is managed per user — contact your admin if you need access.")}
                  </p>
                  <Button
                    onClick={() => {
                      const target = firstAllowedOfModule(module) ?? (allowedModules.length > 0 ? firstAllowedOfModule(allowedModules[0].id) : null);
                      if (target) navigate(target.section, target.view);
                      else navigate("dashboard", "overview");
                    }}
                    className="mt-5 gap-2 rounded-xl font-bold text-white hover:brightness-110"
                    style={{ background: accent }}
                  >
                    <LayoutDashboard className="h-4 w-4" /> {t("Ke Menu yang Tersedia", "Go to Available Menu")}
                  </Button>
                </div>
              </div>
            ) : children}
            </MenuPermsProvider>
          </main>

          {/* footer */}
          <footer className="mt-auto border-t border-slate-200/70 py-4 dark:border-slate-800/70">
            <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
              © 2026 <span className="font-bold" style={{ color: accent }}>RekanKerja</span> HR Suite · {panelLabel}
            </p>
          </footer>

          {/* spacer — jaga konten & footer tidak tertutup tab bar mobile */}
          <div className="h-[84px] shrink-0 lg:hidden" aria-hidden="true" />
        </div>

        {/* ============ NAVIGASI MOBILE: bottom tab + bottom sheet ============ */}
        <nav className="fixed inset-x-0 bottom-0 z-50 lg:hidden" aria-label={t("Navigasi modul", "Module navigation")}>
          <div
            className="flex items-stretch justify-around border-t border-slate-200 bg-white/95 pt-1 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.375rem)" }}
          >
            {tabs.map((m) => {
              const active = !inSettings && m.id === module;
              const b = railBadge(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => onTabTap(m.id)}
                  aria-label={active ? t("{m} — buka menu modul", "{m} — open module menu", { m: m.label }) : m.label}
                  aria-current={active ? "page" : undefined}
                  className="relative flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5 transition-transform active:scale-95"
                >
                  <span className="relative flex h-7 w-11 items-center justify-center rounded-md">
                    {active && (
                      <motion.span
                        layoutId="ov-mtab"
                        className="absolute inset-0 rounded-md"
                        style={{ background: hexA(accent, 0.14) }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <m.icon className={cn("relative h-[18px] w-[18px]", !active && "text-slate-400 dark:text-slate-500")} style={active ? { color: accent } : undefined} aria-hidden />
                    {b > 0 && (
                      <span className="absolute -right-0 -top-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[8px] font-extrabold tabular-nums text-white" style={{ background: accent }}>
                        {b > 9 ? "9+" : b}
                      </span>
                    )}
                  </span>
                  <span className={cn("text-[9px] font-bold", !active && "text-slate-400 dark:text-slate-500")} style={active ? { color: accent } : undefined}>
                    {t(m.short)}
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => setSheet("all")}
              aria-label={t("Modul lainnya, pengaturan, dan akun", "More modules, settings, and account")}
              aria-current={moreActive ? "page" : undefined}
              className="relative flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5 transition-transform active:scale-95"
            >
              <span className="relative flex h-7 w-11 items-center justify-center rounded-md">
                {moreActive && (
                  <motion.span
                    layoutId="ov-mtab"
                    className="absolute inset-0 rounded-md"
                    style={{ background: hexA(accent, 0.14) }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <MoreHorizontal className={cn("relative h-[18px] w-[18px]", !moreActive && "text-slate-400 dark:text-slate-500")} style={moreActive ? { color: accent } : undefined} aria-hidden />
              </span>
              <span className={cn("text-[9px] font-bold", !moreActive && "text-slate-400 dark:text-slate-500")} style={moreActive ? { color: accent } : undefined}>
                {t("Lainnya", "More")}
              </span>
            </button>
          </div>
        </nav>

        {/* bottom sheet mobile */}
        <AnimatePresence>
          {sheet && (
            <>
              <motion.div
                className="fixed inset-0 z-[60] bg-black/40 lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSheet(null)}
                aria-hidden
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={sheet === "all" ? t("Modul lainnya, pengaturan, dan akun", "More modules, settings, and account") : t("Menu {label}", "Menu {label}", { label: sheetModule?.label ?? "" })}
                className="fixed inset-x-0 bottom-0 z-[70] max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl lg:hidden dark:bg-slate-900 dark:text-slate-100"
                style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 36 }}
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden />
                {sheet === "all" ? (
                  <AllModulesSheet
                    allowedModules={allowedModules}
                    settingsGroups={settingsGroups}
                    module={module}
                    inSettings={inSettings}
                    onNavigateModule={navigateToModule}
                    onGoSettings={() => go("settings", firstSettingsView)}
                    sessionUser={sessionUser}
                    sessionTenant={sessionTenant}
                    onPw={() => { setSheet(null); setPwOpen(true); }}
                    onLogout={() => { setSheet(null); void session.logout(); }}
                    onModeEmployee={() => { setSheet(null); setUiMode("ess"); }}
                  />
                ) : sheetModule ? (
                  <ModuleMenuSheet m={sheetModule} groups={sheetGroups} onGo={go} onClose={() => setSheet(null)} />
                ) : null}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* command palette */}
        <CommandPalette open={cmdOpen} setOpen={setCmdOpen} onNavigate={go} module={module} menuAllowed={menuAllowed} />
        <ChangePasswordDialog open={pwOpen} setOpen={setPwOpen} />
      </div>
    </TooltipProvider>
  );
}

// ============ SHEET MOBILE: daftar semua modul + akun ============
interface SessionUser { name: string }
interface SessionTenant { name: string; role: string }

function AllModulesSheet({ allowedModules, settingsGroups, module, inSettings, onNavigateModule, onGoSettings, sessionUser, sessionTenant, onPw, onLogout, onModeEmployee }: {
  allowedModules: ModuleMeta[];
  settingsGroups: NavGroup[];
  module: ModuleId;
  inSettings: boolean;
  onNavigateModule: (m: ModuleId) => void;
  onGoSettings: () => void;
  sessionUser: SessionUser | null | undefined;
  sessionTenant: SessionTenant | null | undefined;
  onPw: () => void;
  onLogout: () => void;
  onModeEmployee: () => void;
}) {
  const { t } = useI18n();
  const { accent: listAccentId } = useAccentTheme();
  const listAccent = (ACCENT_THEMES.find((x) => x.id === listAccentId) ?? ACCENT_THEMES[0]).hex;
  return (
    <div>
      <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("Semua Modul", "All Modules")}</p>
      <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035 } } }}>
        {allowedModules.map((m) => {
          const current = !inSettings && m.id === module;
          return (
            <motion.button
              key={m.id}
              variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
              className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-brand/10"
              onClick={() => onNavigateModule(m.id)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: listAccent }}>
                <m.icon className="h-4 w-4" />
              </span>
              <span className="flex-1 text-[13px] font-bold text-slate-700 transition-colors group-hover:text-brand-deep dark:text-slate-200">{m.label}</span>
              {current ? <Check className="h-4 w-4 shrink-0" style={{ color: listAccent }} /> : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />}
            </motion.button>
          );
        })}
        {settingsGroups.length > 0 && (
          <motion.button
            variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
            className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-brand/10"
            onClick={onGoSettings}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-400 text-white">
              <Settings2 className="h-4 w-4" />
            </span>
            <span className="flex-1 text-[13px] font-bold text-slate-700 transition-colors group-hover:text-brand-deep dark:text-slate-200">{t("Pengaturan Sistem")}</span>
            {inSettings ? <Check className="h-4 w-4 shrink-0 text-slate-400" /> : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" />}
          </motion.button>
        )}
      </motion.div>

      {/* akun pengguna */}
      <div className="mt-4 rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-500 to-slate-700 text-[10px] font-extrabold text-white">
            {sessionUser ? initials(sessionUser.name) : "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold text-slate-800 dark:text-slate-100">{sessionUser?.name ?? "—"}</p>
            <p className="truncate text-[10px] text-slate-400">{sessionTenant ? `${sessionTenant.name} · ${sessionTenant.role}` : t("tanpa workspace", "no workspace")}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={onPw}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-[11px] font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <KeyRound className="h-3.5 w-3.5" /> {t("Ganti Sandi")}
          </button>
          <button
            onClick={onLogout}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 py-2 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            <LogOut className="h-3.5 w-3.5" /> {t("Keluar")}
          </button>
        </div>
        {/* T8: pintasan ganti ke pengalaman Employee Self-Service */}
        <button
          onClick={onModeEmployee}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 py-2 text-[11px] font-bold text-amber-800 transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/15"
        >
          <UserRound className="h-3.5 w-3.5" /> {t("Mode Karyawan", "Employee Mode")}
        </button>
      </div>
    </div>
  );
}

// ============ SHEET MOBILE: menu satu modul ============
function ModuleMenuSheet({ m, groups, onGo, onClose }: {
  m: ModuleMeta;
  groups: NavGroup[];
  onGo: (s: SectionId, v: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const MIcon = m.icon;
  const { accent: sheetAccentId } = useAccentTheme();
  const sheetAccent = (ACCENT_THEMES.find((x) => x.id === sheetAccentId) ?? ACCENT_THEMES[0]).hex;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl text-white" style={{ background: sheetAccent }}>
          <MIcon className="h-4 w-4" />
        </span>
        <p className="flex-1 text-[14px] font-extrabold text-slate-800 dark:text-slate-100">{m.label}</p>
        <button className="rounded-full p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose} aria-label={t("Tutup")}>
          <X className="h-4 w-4 text-slate-400" />
        </button>
      </div>
      <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}>
        {groups.map((g, gi) => (
          <motion.div key={`${gi}-${g.label ?? "root"}`} variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}>
            {g.label ? (
              <p className="px-2 pb-1 pt-2.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t(g.label)}</p>
            ) : (
              <div className="h-1" />
            )}
            {g.children.map((item) => {
              const IIcon = item.icon;
              const c = sheetAccent;
              return (
                <motion.button
                  key={item.id}
                  variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-brand/10 group-hover:text-brand-deep"
                  onClick={() => onGo(g.section, item.id)}
                >
                  <IIcon className="h-4 w-4 shrink-0" style={{ color: c }} aria-hidden />
                  <span className="flex-1 text-[13px] font-semibold text-slate-700 transition-colors group-hover:text-brand-deep dark:text-slate-200">{t(item.label)}</span>
                </motion.button>
              );
            })}
          </motion.div>
        ))}
      </motion.div>
    </div>
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
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  // mounted via useSyncExternalStore (server snapshot false, client snapshot true)
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

function CommandPalette({ open, setOpen, onNavigate, module, menuAllowed }: {
  open: boolean; setOpen: (v: boolean) => void; onNavigate: (s: SectionId, v: string) => void; module: ModuleId;
  menuAllowed: (s: SectionId, itemId: string) => boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const results = useApi<{ employees: { id: string; fullName: string; employeeNo: string; position: { title: string } | null }[] }>(q.length >= 2 ? `/api/rekankerja/employees?q=${encodeURIComponent(q)}&limit=6` : null);

  const runNav = (s: SectionId, v: string) => { setOpen(false); setQ(""); onNavigate(s, v); };

  const items = useMemo(() => {
    const groups = [...navOfModule(module), ...SETTINGS_NAV];
    return groups.flatMap((g) => g.children.filter((c) => menuAllowed(g.section, c.id)).map((c) => ({ g, c })));
  }, [module, menuAllowed]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 shadow-2xl" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t("Pencarian global RekanKerja", "RekanKerja global search")}</DialogTitle>
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-4">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 dark:border-slate-800">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <CommandInput
              value={q}
              onValueChange={setQ}
              placeholder={t("Cari karyawan, aksi, atau navigasi…", "Search employees, actions, or navigation…")}
              className="h-12 flex-1 border-0 text-sm shadow-none focus:ring-0 dark:bg-transparent"
            />
            <kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 dark:border-slate-700">ESC</kbd>
          </div>
          <CommandList className="max-h-[420px] overflow-y-auto p-2">
            <CommandGroup heading={`${t("Navigasi")} · ${MODULE_LABEL[module]}`}>
              {items.map(({ g, c }) => {
                const Icon = c.icon;
                const groupLabel = g.label ? t(g.label) : t("Beranda");
                return (
                  <CommandItem key={`${g.section}-${c.id}`} value={`${g.label ?? "Beranda"} ${c.label}`} onSelect={() => runNav(g.section, c.id)} className="gap-3 rounded-lg px-3 py-2.5 text-[13px]">
                    <Icon className="h-4 w-4 text-slate-400" />
                    <span>{t(c.label)}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-300 dark:text-slate-600">{groupLabel}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {q.length >= 2 && (
              <CommandGroup heading={t("Karyawan")}>
                <CommandEmpty className="py-6 text-center text-xs text-slate-400">{t("Tidak ditemukan", "No results found")}</CommandEmpty>
                {results.loading && <p className="px-3 py-4 text-xs text-slate-400">{t("Mencari…")}</p>}
                {results.data?.employees?.map((e) => (
                  <CommandItem key={e.id} value={e.employeeNo + e.fullName} onSelect={() => { setOpen(false); setQ(""); useNav.getState().navigate("employee", "detail", { id: e.id }); }} className="gap-3 rounded-lg px-3 py-2.5 text-[13px]">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">{initials(e.fullName)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{e.fullName}</p>
                      <p className="truncate text-[11px] text-slate-400">{e.employeeNo} · {e.position?.title ?? "—"}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
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
  const { t } = useI18n();
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
          aria-label={t("Ganti workspace — {name}", "Switch workspace — {name}", { name: tenant.name })}
          title={tenant.name}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
        >
          <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="hidden max-w-[160px] truncate sm:inline">{tenant.name}</span>
          <Badge className="hidden rounded-full bg-slate-100 px-1.5 text-[9px] font-extrabold uppercase text-slate-500 sm:inline-flex dark:bg-slate-800 dark:text-slate-400">{tenant.plan}</Badge>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">Workspace</DropdownMenuLabel>
        {(info?.workspaces ?? []).map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => void switchTo(w.id)}>
            <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="flex-1 truncate">{w.name}</span>
            {w.id === tenant.id ? (
              <Check className="h-4 w-4 shrink-0 text-brand dark:text-brand/85" />
            ) : (
              <span className="shrink-0 text-[10px] text-slate-400">{w.role}</span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" /> {t("Keluar")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
