"use client";
// ============================================================================
// ONEVITY — MENU DESIGN LAB (mockup interaktif, BUKAN kode produksi)
// Tujuan: memutuskan arah desain menu navigasi SEBELUM implementasi ke app.
// Akses terisolasi via /?mockup=menu — menu live tidak tersentuh sama sekali.
//
// 5 konsep yang bisa dicoba langsung:
//   0 · Sekarang      — baseline pembanding (sidebar klasik seperti app live)
//   A · Module Rail   — rail ikon + panel modul, indikator meluncur (spring)
//   B · Menu Hidup    — item menu membawa sinyal data (avatar, ring gajian)
//   C · Identitas     — aksen warna per modul, logo ikut berubah
//   ★ Rekomendasi    — A + C + widget hidup terpilih (visi final)
// + Pratinjau mobile (bottom tab + sheet) untuk opsi A/★.
// ============================================================================
import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Users, Coins, CalendarClock, Palmtree, Plane, HeartPulse, Settings2,
  LayoutDashboard, Landmark, Building2, Network, Waypoints, BriefcaseBusiness,
  FileText, GraduationCap, TrendingUp, UserPlus, Scale, Inbox, Workflow,
  CalendarRange, PlayCircle, LayoutTemplate, IdCard, ArrowLeftRight,
  HeartHandshake, FileSpreadsheet, Percent, Calculator, BookOpen, Layers,
  Activity, XCircle, Clock, CheckCircle2, Wallet, BarChart3, Boxes, Hospital,
  ShieldCheck, Mail, ChevronDown, Check, X, MoreHorizontal, AlertTriangle,
  ArrowRight, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============ util warna ============
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ============ data modul (selaras app live) ============
type ModId = "hr" | "payroll" | "attendance" | "leave" | "travel" | "medical" | "settings";

interface SimModule { id: ModId; label: string; short: string; desc: string; icon: LucideIcon; hex: string }

const MODULES: SimModule[] = [
  { id: "hr", label: "Human Resource Base", short: "HR Base", desc: "Inti administrasi karyawan", icon: Users, hex: "#10b981" },
  { id: "payroll", label: "Payroll", short: "Payroll", desc: "Periode, proses & kepatuhan pajak", icon: Coins, hex: "#f59e0b" },
  { id: "attendance", label: "Attendance", short: "Attendance", desc: "Jadwal, clocking & lembur", icon: CalendarClock, hex: "#14b8a6" },
  { id: "leave", label: "Leave", short: "Leave", desc: "Saldo, permintaan & persetujuan", icon: Palmtree, hex: "#06b6d4" },
  { id: "travel", label: "Travel", short: "Travel", desc: "Perjalanan dinas & settlement", icon: Plane, hex: "#8b5cf6" },
  { id: "medical", label: "Medical", short: "Medical", desc: "Benefit & klaim kesehatan", icon: HeartPulse, hex: "#f43f5e" },
  { id: "settings", label: "Pengaturan Sistem", short: "Pengaturan", desc: "Konfigurasi sistem OneVity", icon: Settings2, hex: "#a8a29e" },
];

const EMERALD = "#10b981";

interface SimItem { id: string; label: string; icon: LucideIcon }
interface SimGroup { label?: string; items: SimItem[] }

const NAVS: Record<ModId, SimGroup[]> = {
  hr: [
    { items: [{ id: "overview", label: "Dashboard", icon: LayoutDashboard }] },
    { label: "Perusahaan & Organisasi", items: [
      { id: "companies", label: "Perusahaan", icon: Landmark },
      { id: "offices", label: "Kantor & Lokasi Kerja", icon: Building2 },
      { id: "tree", label: "Unit Organisasi", icon: Network },
      { id: "chart", label: "Peta Organisasi", icon: Waypoints },
    ] },
    { label: "Posisi & Jabatan", items: [
      { id: "list", label: "Daftar Posisi", icon: BriefcaseBusiness },
      { id: "jobs", label: "Katalog Jabatan", icon: FileText },
      { id: "grades", label: "Grade & Level", icon: GraduationCap },
      { id: "levels", label: "Level Jabatan", icon: TrendingUp },
    ] },
    { label: "Karyawan", items: [
      { id: "directory", label: "Direktori Karyawan", icon: Users },
      { id: "wizard", label: "Onboarding Karyawan", icon: UserPlus },
      { id: "disciplinary", label: "Catatan Disiplin", icon: Scale },
    ] },
    { label: "Pengajuan & Persetujuan", items: [
      { id: "inbox", label: "Menunggu Persetujuan", icon: Inbox },
      { id: "all", label: "Semua Pengajuan", icon: Workflow },
    ] },
  ],
  payroll: [
    { items: [{ id: "overview", label: "Ringkasan", icon: LayoutDashboard }] },
    { label: "Periode & Proses", items: [
      { id: "periods", label: "Periode Payroll", icon: CalendarRange },
      { id: "runs", label: "Proses & Hasil", icon: PlayCircle },
    ] },
    { label: "Master Data", items: [
      { id: "components", label: "Komponen Upah", icon: Coins },
      { id: "templates", label: "Template Upah", icon: LayoutTemplate },
      { id: "profiles", label: "Data Gaji Karyawan", icon: IdCard },
    ] },
    { label: "Transaksi", items: [
      { id: "transactions", label: "Transaksi & Rapel", icon: ArrowLeftRight },
      { id: "benefits", label: "Benefit Karyawan", icon: HeartHandshake },
    ] },
    { label: "Laporan Tahunan", items: [{ id: "spt", label: "SPT & Pajak (1721-A1)", icon: FileSpreadsheet }] },
    { label: "Parameter", items: [
      { id: "parameters", label: "Parameter Pajak", icon: Percent },
      { id: "accounting", label: "Akun & Posting", icon: Calculator },
      { id: "journals", label: "Jurnal Payroll", icon: BookOpen },
    ] },
  ],
  attendance: [
    { items: [{ id: "schedules", label: "Ringkasan", icon: LayoutDashboard }] },
    { label: "Jadwal & Shift", items: [
      { id: "templates-schedule", label: "Template Jadwal", icon: CalendarClock },
      { id: "assignment-schedule", label: "Assign Jadwal", icon: CalendarRange },
      { id: "matrix", label: "Matriks Jadwal", icon: Layers },
    ] },
    { label: "Kehadiran", items: [
      { id: "clocking", label: "Data Clocking", icon: Activity },
      { id: "absence", label: "Absensi & Izin", icon: XCircle },
      { id: "overtime", label: "Lembur (Overtime)", icon: Clock },
      { id: "workoff", label: "Work Off Permission", icon: CheckCircle2 },
    ] },
  ],
  leave: [
    { items: [{ id: "balances", label: "Ringkasan", icon: LayoutDashboard }] },
    { label: "Cuti Karyawan", items: [
      { id: "leave-info", label: "Informasi Cuti (Saldo)", icon: Palmtree },
      { id: "leave-request", label: "Permintaan Cuti", icon: Inbox },
      { id: "leave-approval", label: "Persetujuan", icon: CheckCircle2 },
      { id: "leave-mass", label: "Cuti Massal (SKB)", icon: Users },
    ] },
    { label: "Pengaturan & Integrasi", items: [
      { id: "leave-type", label: "Jenis Cuti", icon: Layers },
      { id: "leave-encashment", label: "Uang Pengganti Cuti", icon: Wallet },
      { id: "leave-reports", label: "Laporan Cuti", icon: BarChart3 },
    ] },
  ],
  travel: [
    { items: [{ id: "requests", label: "Ringkasan", icon: LayoutDashboard }] },
    { label: "Perjalanan Dinas", items: [
      { id: "travel-request", label: "Permintaan Travel", icon: Plane },
      { id: "travel-approval", label: "Persetujuan", icon: CheckCircle2 },
      { id: "travel-claim", label: "Klaim & Settlement", icon: FileText },
      { id: "travel-budget", label: "Budget Travel", icon: Wallet },
    ] },
    { label: "Master & Laporan", items: [
      { id: "travel-templates", label: "Master Travel", icon: Boxes },
      { id: "travel-reports", label: "Laporan Travel", icon: BarChart3 },
    ] },
  ],
  medical: [
    { items: [{ id: "claims", label: "Ringkasan", icon: LayoutDashboard }] },
    { label: "Benefit Medis", items: [
      { id: "medical-info", label: "Saldo Medis Karyawan", icon: HeartPulse },
      { id: "medical-claim", label: "Klaim Medis", icon: Activity },
      { id: "medical-approval", label: "Persetujuan & Settlement", icon: CheckCircle2 },
      { id: "medical-adjustment", label: "Penyesuaian Saldo", icon: ArrowLeftRight },
    ] },
    { label: "Master & Laporan", items: [
      { id: "medical-benefit-type", label: "Jenis Benefit", icon: Boxes },
      { id: "medical-providers", label: "Rumah Sakit & Asuransi", icon: Hospital },
      { id: "medical-reports", label: "Laporan Medis", icon: BarChart3 },
    ] },
  ],
  settings: [
    { label: "Pengaturan Sistem", items: [
      { id: "lookups", label: "Data Master", icon: Layers },
      { id: "security", label: "Keamanan & Akses", icon: ShieldCheck },
      { id: "approval", label: "Approval Berjenjang", icon: CheckCircle2 },
      { id: "email", label: "Konfigurasi Email", icon: Mail },
    ] },
  ],
};

function groupsOf(mod: ModId): SimGroup[] {
  const base = NAVS[mod];
  return mod === "settings" ? base : [...base, ...NAVS.settings];
}

function firstItemOf(mod: ModId): string {
  return groupsOf(mod)[0].items[0].id;
}

// ============ widget hidup (opsi B / ★) ============
const AVA = ["#f59e0b", "#06b6d4", "#f43f5e"];

function AvatarStack() {
  return (
    <span className="flex shrink-0 -space-x-1.5">
      {["A", "B", "S"].map((c, i) => (
        <span key={c} className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-extrabold text-white ring-2 ring-[#232228]" style={{ background: AVA[i] }}>
          {c}
        </span>
      ))}
    </span>
  );
}

function PayrollRing({ hex }: { hex: string }) {
  return (
    <span className="relative flex h-[30px] w-[30px] shrink-0 items-center justify-center" aria-label="Gajian D-3">
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="18" cy="18" r="13" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3.5" />
        <motion.circle
          cx="18" cy="18" r="13" fill="none" stroke={hex} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray="81.7"
          initial={{ strokeDashoffset: 81.7 }}
          animate={{ strokeDashoffset: 19 }}
          transition={{ duration: 1.1, ease: "easeOut", delay: 0.3 }}
        />
      </svg>
      <span className="text-[8px] font-extrabold" style={{ color: hex }}>D-3</span>
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

function ItemLiveWidget({ mod, item, hex }: { mod: ModId; item: SimItem; hex: string }) {
  const key = `${mod}:${item.id}`;
  if (key === "hr:inbox") {
    return (
      <span className="flex items-center gap-2">
        <AvatarStack />
        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: hexA(hex, 0.18), color: hex }}>2</span>
      </span>
    );
  }
  if (key === "payroll:runs") return <PayrollRing hex={hex} />;
  if (key === "payroll:benefits") return <LiveDot hex="#f59e0b" label="1 menunggu" />;
  if (key === "settings:email") return <LiveDot hex="#10b981" label="aktif" />;
  if (key === "leave:leave-request") {
    return <span className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: hexA(hex, 0.18), color: hex }}>3 baru</span>;
  }
  return null;
}

function PlainBadge({ hex, n }: { hex: string; n: number }) {
  return <span className="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: hexA(hex, 0.18), color: hex }}>{n}</span>;
}

const PLAIN_BADGES: Record<string, number> = { "hr:inbox": 2, "payroll:runs": 2, "payroll:benefits": 1 };

// ============ area konten palsu ============
function ContentArea({ hex, live, modLabel }: { hex: string; live: boolean; modLabel: string }) {
  return (
    <div className="relative hidden min-w-0 flex-1 flex-col overflow-y-auto bg-stone-50 p-6 md:flex">
      <span className="absolute right-4 top-4 z-10 rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-400">
        Area konten · ilustrasi
      </span>
      <div className="pt-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: hex }}>{modLabel}</p>
        <h2 className="mt-1 text-xl font-extrabold tracking-tight text-stone-900">Selamat pagi, Tri Handayani</h2>
        <p className="mt-1 text-xs text-stone-500">Ringkasan operasional hari ini — Jumat, 4 September 2026</p>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Karyawan Aktif</p>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-stone-900">44</p>
          <p className="text-[10px] text-stone-500">+2 onboarding bulan ini</p>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: hexA(hex, 0.35), background: hexA(hex, 0.05) }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: hex }}>Menunggu Persetujuan</p>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight" style={{ color: hex }}>2</p>
          <p className="text-[10px] text-stone-500">cuti 1 · klaim medis 1</p>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: live ? hexA(hex, 0.35) : "rgb(231 229 228)", background: live ? hexA(hex, 0.05) : "white" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Siklus Gajian</p>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-stone-900">D-3</p>
          <p className="text-[10px] text-stone-500">{live ? "payroll Sep belum dikonfirmasi" : "payroll Sep draft"}</p>
        </div>
      </div>
      <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-stone-700">Tren kehadiran mingguan</p>
          <p className="text-[10px] text-stone-400">Minggu 31–36</p>
        </div>
        <div className="mt-3 flex h-24 items-end gap-1.5">
          {[42, 58, 47, 72, 64, 84, 70, 92, 76, 68, 90, 96].map((h, i) => (
            <motion.div
              key={i}
              className="flex-1 origin-bottom rounded-t-[3px]"
              style={{ height: `${h}%`, background: i >= 9 ? hex : hexA(hex, 0.35) }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: 0.25 + i * 0.04, duration: 0.35, ease: "easeOut" }}
            />
          ))}
        </div>
      </div>
      <div className="mt-4 space-y-2 opacity-80">
        {[
          ["Andi Wijaya", "Perjalanan dinas · Jakarta", "Menunggu"],
          ["Siti Rahma", "Klaim medis · Kacamata", "Menunggu"],
          ["Budi Santoso", "Lembur · 3 jam (24 Agu)", "Disetujui"],
        ].map(([n, d, s]) => (
          <div key={n} className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-100 text-[10px] font-extrabold text-stone-500">
              {n.split(" ").map((w) => w[0]).join("")}
            </span>
            <span className="text-xs font-semibold text-stone-700">{n}</span>
            <span className="truncate text-xs text-stone-400">{d}</span>
            <span className="ml-auto shrink-0 rounded-full border border-stone-200 px-2 py-0.5 text-[9px] font-bold text-stone-500">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ varian menu klasik (baseline / B / C) ============
function ClassicSidebar({ colorIdentity, live }: { colorIdentity: boolean; live: boolean }) {
  const [activeMod, setActiveMod] = useState<ModId>("hr");
  const [popover, setPopover] = useState(false);
  const [sel, setSel] = useState<Record<string, string>>(
    () => Object.fromEntries(MODULES.map((m) => [m.id, firstItemOf(m.id)])) as Record<string, string>
  );
  const mod = MODULES.find((m) => m.id === activeMod)!;
  const accent = colorIdentity ? mod.hex : EMERALD;

  return (
    <div className="flex h-full min-w-0 flex-1">
      <aside className="flex w-[264px] shrink-0 flex-col bg-[#232228] text-stone-300">
        {/* brand */}
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `linear-gradient(135deg, ${accent}, ${hexA(accent, 0.7)})`, boxShadow: `0 10px 24px -8px ${hexA(accent, 0.55)}` }}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="2.6" /><circle cx="5" cy="17" r="2.6" /><circle cx="19" cy="17" r="2.6" />
              <path d="M12 7.6 6.6 14.6M12 7.6l5.4 7M7.6 17h8.8" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-extrabold leading-tight tracking-tight text-white">
              One<span style={{ color: accent }}>Vity</span>
            </p>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-stone-500">HR Suite</p>
          </div>
        </div>
        {/* kartu perusahaan */}
        <div className="px-4 pb-2.5">
          <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 text-[11px] font-extrabold text-white">MII</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-stone-100">MII</p>
              <p className="truncate text-[10px] text-stone-500">PT Mitra Industri Internasional</p>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">Aktif</span>
          </div>
        </div>
        {/* dropdown modul */}
        <div className="relative px-4 pb-2.5">
          <button
            className="flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition"
            style={{ borderColor: hexA(accent, 0.25), background: hexA(accent, 0.08) }}
            onClick={() => setPopover((v) => !v)}
            aria-label="Pilih modul"
            aria-expanded={popover}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow" style={{ background: `linear-gradient(135deg, ${accent}, ${hexA(accent, 0.75)})` }}>
              <mod.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-stone-500">Modul Aktif</p>
              <p className="truncate text-[13px] font-bold text-stone-50">{mod.label}</p>
            </div>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-stone-400 transition-transform", popover && "rotate-180")} />
          </button>
          <AnimatePresence>
            {popover && (
              <motion.div
                className="absolute left-4 right-4 top-full z-40 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#2a2830] shadow-2xl"
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {MODULES.filter((m) => m.id !== "settings").map((m) => {
                  const active = m.id === activeMod;
                  return (
                    <button
                      key={m.id}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/[0.05]"
                      onClick={() => { setActiveMod(m.id); setPopover(false); }}
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: active ? (colorIdentity ? m.hex : EMERALD) : "rgba(255,255,255,0.08)", color: active ? "white" : "#a8a29e" }}>
                        <m.icon className="h-3.5 w-3.5" />
                      </div>
                      <span className={cn("flex-1 text-[13px] font-semibold", active ? "text-stone-50" : "text-stone-300")}>{m.label}</span>
                      {active && <Check className="h-4 w-4" style={{ color: colorIdentity ? m.hex : EMERALD }} />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {/* nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-0.5" aria-label="Navigasi utama">
          <motion.div
            key={activeMod}
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.022 } } }}
          >
            {groupsOf(activeMod).map((g, gi) => (
              <motion.div key={`${activeMod}-${gi}-${g.label ?? "root"}`} className="pb-1" variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0, transition: { duration: 0.18 } } }}>
                {g.label && (
                  <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">{g.label}</p>
                )}
                {g.items.map((item) => {
                  const active = sel[activeMod] === item.id && (g.label !== undefined || item.id === firstItemOf(activeMod));
                  return (
                    <button
                      key={item.id}
                      className={cn(
                        "group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors",
                        active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                      )}
                      onClick={() => setSel((s) => ({ ...s, [activeMod]: item.id }))}
                    >
                      {active && (
                        <motion.span
                          layoutId="classic-active-bar"
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
                          style={{ background: accent, boxShadow: `0 0 12px ${hexA(accent, 0.8)}` }}
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <item.icon className={cn("h-[15px] w-[15px] shrink-0 transition-all duration-200", !active && "text-stone-500 group-hover:text-stone-300 group-hover:translate-x-0.5")} style={active ? { color: accent } : undefined} />
                      <span className={cn("flex-1 truncate text-[12.5px] font-medium", active ? "text-stone-50" : "text-stone-400 group-hover:text-stone-200")}>{item.label}</span>
                      {live ? (
                        <ItemLiveWidget mod={activeMod} item={item} hex={accent} />
                      ) : (
                        PLAIN_BADGES[`${activeMod}:${item.id}`] != null && <PlainBadge hex={accent} n={PLAIN_BADGES[`${activeMod}:${item.id}`]} />
                      )}
                    </button>
                  );
                })}
              </motion.div>
            ))}
          </motion.div>
        </nav>
        {/* user */}
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-stone-500 to-stone-700 text-[10px] font-extrabold text-white">TH</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-stone-100">Tri Handayani</p>
              <p className="truncate text-[10px] text-stone-500">HRD · MII</p>
            </div>
          </div>
        </div>
      </aside>
      <ContentArea hex={accent} live={live} modLabel={mod.short} />
    </div>
  );
}

// ============ varian module rail (A / ★) ============
function RailSidebar({ colorIdentity, live }: { colorIdentity: boolean; live: boolean }) {
  const [activeMod, setActiveMod] = useState<ModId>("hr");
  const [sel, setSel] = useState<Record<string, string>>(
    () => Object.fromEntries(MODULES.map((m) => [m.id, firstItemOf(m.id)])) as Record<string, string>
  );
  const mod = MODULES.find((m) => m.id === activeMod)!;
  const accent = colorIdentity ? mod.hex : EMERALD;
  const railMods = MODULES.filter((m) => m.id !== "settings");
  const railBadges: Partial<Record<ModId, number>> = live ? { hr: 2, payroll: 2, medical: 1 } : {};

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* rail */}
      <div className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 overflow-visible bg-[#1b1a20] py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `linear-gradient(135deg, ${accent}, ${hexA(accent, 0.7)})`, boxShadow: `0 8px 20px -6px ${hexA(accent, 0.5)}` }}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="2.6" /><circle cx="5" cy="17" r="2.6" /><circle cx="19" cy="17" r="2.6" />
            <path d="M12 7.6 6.6 14.6M12 7.6l5.4 7M7.6 17h8.8" />
          </svg>
        </div>
        <div className="my-2 h-px w-8 bg-white/10" />
        {railMods.map((m) => {
          const active = m.id === activeMod;
          const b = railBadges[m.id];
          return (
            <button
              key={m.id}
              className="group relative flex h-11 w-11 items-center justify-center rounded-xl"
              onClick={() => setActiveMod(m.id)}
              aria-label={m.label}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="rail-active"
                  className="absolute inset-0 rounded-xl"
                  style={{ background: `linear-gradient(135deg, ${hexA(m.hex, 0.95)}, ${hexA(m.hex, 0.6)})`, boxShadow: `0 10px 22px -6px ${hexA(m.hex, 0.55)}` }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <m.icon className={cn("relative z-10 h-[18px] w-[18px] transition-all duration-200 group-hover:scale-110", active ? "text-white" : "text-stone-500 group-hover:text-stone-200")} />
              {b != null && (
                <span className="absolute -right-0.5 -top-0.5 z-20 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[8px] font-extrabold text-white" style={{ background: m.hex }}>
                  {b}
                </span>
              )}
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[10px] font-semibold text-stone-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                {m.short}
              </span>
            </button>
          );
        })}
        <div className="mt-auto">
          <button
            className={cn("group relative flex h-11 w-11 items-center justify-center rounded-xl", activeMod === "settings" && "bg-white/[0.08]")}
            onClick={() => setActiveMod("settings")}
            aria-label="Pengaturan Sistem"
          >
            <Settings2 className={cn("h-[18px] w-[18px] transition-colors", activeMod === "settings" ? "text-stone-200" : "text-stone-500 group-hover:text-stone-200")} />
            <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-black px-2 py-1 text-[10px] font-semibold text-stone-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
              Pengaturan
            </span>
          </button>
        </div>
      </div>
      {/* panel modul */}
      <div className="flex w-[264px] shrink-0 flex-col border-l border-white/[0.06] bg-[#232228] text-stone-300">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow" style={{ background: `linear-gradient(135deg, ${accent}, ${hexA(accent, 0.72)})` }}>
            <mod.icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-extrabold text-stone-50">{mod.label}</p>
            <p className="truncate text-[10px] text-stone-500">{mod.desc}</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-1" aria-label="Navigasi modul">
          <motion.div
            key={activeMod}
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.025 } } }}
          >
            {groupsOf(activeMod).map((g, gi) => (
              <motion.div key={`${activeMod}-${gi}-${g.label ?? "root"}`} className="pb-1" variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0, transition: { duration: 0.18 } } }}>
                {g.label && (
                  <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">{g.label}</p>
                )}
                {g.items.map((item) => {
                  const active = sel[activeMod] === item.id && (g.label !== undefined || item.id === firstItemOf(activeMod));
                  return (
                    <button
                      key={item.id}
                      className={cn(
                        "group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors",
                        active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                      )}
                      onClick={() => setSel((s) => ({ ...s, [activeMod]: item.id }))}
                    >
                      {active && (
                        <motion.span
                          layoutId="rail-active-bar"
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
                          style={{ background: accent, boxShadow: `0 0 12px ${hexA(accent, 0.8)}` }}
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <item.icon className={cn("h-[15px] w-[15px] shrink-0 transition-all duration-200", !active && "text-stone-500 group-hover:text-stone-300 group-hover:translate-x-0.5")} style={active ? { color: accent } : undefined} />
                      <span className={cn("flex-1 truncate text-[12.5px] font-medium", active ? "text-stone-50" : "text-stone-400 group-hover:text-stone-200")}>{item.label}</span>
                      {live ? (
                        <ItemLiveWidget mod={activeMod} item={item} hex={accent} />
                      ) : (
                        PLAIN_BADGES[`${activeMod}:${item.id}`] != null && <PlainBadge hex={accent} n={PLAIN_BADGES[`${activeMod}:${item.id}`]} />
                      )}
                    </button>
                  );
                })}
              </motion.div>
            ))}
          </motion.div>
        </nav>
        <div className="border-t border-white/10 p-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-stone-500 to-stone-700 text-[9px] font-extrabold text-white">TH</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-bold text-stone-100">Tri Handayani</p>
              <p className="truncate text-[9px] text-stone-500">HRD · MII</p>
            </div>
          </div>
        </div>
      </div>
      <ContentArea hex={accent} live={live} modLabel={mod.short} />
    </div>
  );
}

// ============ pratinjau mobile (bottom tab + sheet) ============
function PhonePreview({ colorIdentity, live }: { colorIdentity: boolean; live: boolean }) {
  const [sheet, setSheet] = useState<ModId | "all" | null>(null);
  const [activeTab, setActiveTab] = useState<ModId>("hr");
  const tabs: ModId[] = ["hr", "payroll", "attendance", "leave"];
  const accent = colorIdentity ? MODULES.find((m) => m.id === activeTab)!.hex : EMERALD;

  const openSheet = (m: ModId) => { setSheet(m); setActiveTab(m); };
  const sheetMod = MODULES.find((x) => x.id === sheet);

  return (
    <div className="relative flex h-[560px] w-[270px] shrink-0 flex-col overflow-hidden rounded-[2.2rem] border-[8px] border-stone-800 bg-stone-50 shadow-2xl">
      {/* notch */}
      <div className="absolute left-1/2 top-2 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-stone-800" />
      {/* status bar */}
      <div className="flex items-center justify-between px-6 pt-3 text-[10px] font-bold text-stone-800">
        <span>09:41</span>
        <span className="tracking-[0.2em]">····</span>
      </div>
      {/* mini konten */}
      <div className="flex-1 overflow-hidden px-4 pt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>Selamat pagi</p>
        <p className="mt-0.5 text-sm font-extrabold tracking-tight text-stone-900">Tri Handayani</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-stone-200 bg-white p-2.5">
            <p className="text-[8px] font-bold uppercase tracking-wider text-stone-400">Karyawan</p>
            <p className="text-base font-extrabold text-stone-900">44</p>
          </div>
          <div className="rounded-xl border p-2.5" style={{ borderColor: hexA(accent, 0.35), background: hexA(accent, 0.05) }}>
            <p className="text-[8px] font-bold uppercase tracking-wider" style={{ color: accent }}>Persetujuan</p>
            <p className="text-base font-extrabold" style={{ color: accent }}>2</p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          {["Andi Wijaya · Cuti 2 hari", "Siti Rahma · Klaim medis", "Payroll Sep · Draft"].map((t, i) => (
            <div key={t} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: i === 2 ? "#f59e0b" : accent }} />
              <span className="truncate text-[10px] font-medium text-stone-600">{t}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[9px] font-medium uppercase tracking-wider text-stone-400">Area konten · ilustrasi</p>
        {live && (
          <div className="mt-3 rounded-xl border border-stone-200 bg-white p-2.5">
            <div className="flex items-center gap-2">
              <AvatarStack />
              <p className="text-[9px] font-bold text-stone-600">menunggu persetujuan Anda</p>
            </div>
          </div>
        )}
      </div>
      {/* bottom tab bar */}
      <div className="flex items-center justify-around border-t border-stone-200 bg-white/95 px-2 pb-3 pt-2 backdrop-blur">
        {tabs.map((m) => {
          const M = MODULES.find((x) => x.id === m)!;
          const active = activeTab === m;
          const c = colorIdentity ? M.hex : EMERALD;
          return (
            <button key={m} className="flex flex-col items-center gap-0.5 px-2 py-1" onClick={() => openSheet(m)} aria-label={M.label}>
              <span className="relative">
                {active && (
                  <motion.span layoutId="phone-tab" className="absolute -inset-1.5 rounded-xl" style={{ background: hexA(c, 0.12) }} transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                )}
                <M.icon className="relative h-5 w-5" style={{ color: active ? c : "#a8a29e" }} />
              </span>
              <span className="text-[8px] font-bold" style={{ color: active ? c : "#a8a29e" }}>{M.short}</span>
            </button>
          );
        })}
        <button className="flex flex-col items-center gap-0.5 px-2 py-1" onClick={() => setSheet("all")} aria-label="Semua modul">
          <span className="relative">
            {sheet === "all" && <span className="absolute -inset-1.5 rounded-xl" style={{ background: hexA(accent, 0.12) }} />}
            <MoreHorizontal className="relative h-5 w-5" style={{ color: sheet === "all" ? accent : "#a8a29e" }} />
          </span>
          <span className="text-[8px] font-bold" style={{ color: sheet === "all" ? accent : "#a8a29e" }}>Lainnya</span>
        </button>
      </div>
      {/* sheet */}
      <AnimatePresence>
        {sheet && (
          <>
            <motion.div
              className="absolute inset-0 z-20 bg-black/40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSheet(null)}
            />
            <motion.div
              className="absolute inset-x-0 bottom-0 z-30 max-h-[74%] overflow-y-auto rounded-t-3xl bg-white p-5"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300" />
              {sheet === "all" ? (
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-400">Semua modul</p>
                  <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}>
                    {MODULES.map((m) => (
                      <motion.button key={m.id} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-stone-100" onClick={() => { setSheet(m.id); if (m.id !== "settings") setActiveTab(m.id); }}>
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl text-white" style={{ background: colorIdentity ? m.hex : EMERALD }}>
                          <m.icon className="h-4 w-4" />
                        </span>
                        <span className="flex-1 text-[13px] font-bold text-stone-700">{m.label}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-stone-300" />
                      </motion.button>
                    ))}
                  </motion.div>
                </div>
              ) : sheetMod && (
                <div>
                  <div className="mb-2 flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl text-white" style={{ background: colorIdentity ? sheetMod.hex : EMERALD }}>
                      <sheetMod.icon className="h-4 w-4" />
                    </span>
                    <p className="flex-1 text-[14px] font-extrabold text-stone-800">{sheetMod.label}</p>
                    <button className="rounded-full p-1.5 hover:bg-stone-100" onClick={() => setSheet(null)} aria-label="Tutup">
                      <X className="h-4 w-4 text-stone-400" />
                    </button>
                  </div>
                  <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}>
                    {groupsOf(sheet).map((g, gi) => (
                      <motion.div key={`${gi}-${g.label ?? "root"}`} variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}>
                        {g.label && <p className="px-2 pb-1 pt-2.5 text-[9px] font-bold uppercase tracking-[0.14em] text-stone-400">{g.label}</p>}
                        {g.items.map((item) => (
                          <motion.button
                            key={item.id}
                            variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
                            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-stone-100"
                            onClick={() => setSheet(null)}
                          >
                            <item.icon className="h-4 w-4 shrink-0" style={{ color: colorIdentity ? sheetMod.hex : EMERALD }} />
                            <span className="flex-1 text-[13px] font-semibold text-stone-700">{item.label}</span>
                          </motion.button>
                        ))}
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ konsep & catatan ============
type OptKey = "now" | "a" | "b" | "c" | "rec";

interface OptionDef {
  key: OptKey;
  tab: string;
  title: string;
  variant: "classic" | "rail";
  colorIdentity: boolean;
  live: boolean;
  phone: boolean;
  effort: string;
  changed: string[];
  pros: string[];
  watch: string[];
  verdict?: string;
}

const OPTIONS: OptionDef[] = [
  {
    key: "now", tab: "Sekarang", title: "0 · Desain Saat Ini (Pembanding)",
    variant: "classic", colorIdentity: false, live: false, phone: false, effort: "titik nol",
    changed: ["Sidebar 264px — semua item seragam dari atas ke bawah", "6 modul tersembunyi di dropdown", "Badge angka statis, menu pasif"],
    pros: ["Familiar bagi pengguna saat ini", "Stabil dan konsisten"],
    watch: ["Tanpa hirarki visual — mata tidak punya jangkar", "Modul (identitas terbesar aplikasi) tidak terlihat", "Menu tidak membawa sinyal data apa pun"],
    verdict: "Baseline untuk membandingkan — inilah yang terasa standar.",
  },
  {
    key: "a", tab: "A · Module Rail", title: "A · Module Rail (Struktural)",
    variant: "rail", colorIdentity: false, live: false, phone: true, effort: "±1–2 hari",
    changed: ["Rail ikon 68px selalu terlihat — 6 modul jadi landmark navigasi", "Panel menu spesifik modul terbuka di sampingnya", "Indikator aktif meluncur antar modul (spring) + item stagger saat ganti modul"],
    pros: ["Spatial memory — pengguna menghafal posisi modul", "Konten utama lebih lega (rail 68px vs sidebar 264px)", "Pola mobile-native: bottom tab + bottom sheet"],
    watch: ["Ikon tanpa label butuh tooltip dan masa adaptasi singkat", "Pengguna lama perlu transisi (bisa 1 minggu dual-mode)"],
    verdict: "Perubahan struktural terbesar — paling terasa beda dari HRIS umum.",
  },
  {
    key: "b", tab: "B · Menu Hidup", title: "B · Menu Hidup (Data Ambient)",
    variant: "classic", colorIdentity: false, live: true, phone: false, effort: "bertahap",
    changed: ["Menunggu Persetujuan membawa avatar pengaju + jumlah", "Proses & Hasil membawa ring siklus gajian (D-3)", "Benefit & Konfigurasi Email membawa status live"],
    pros: ["HRD langsung tahu yang butuh perhatian tanpa klik", "Kesan produk yang hidup dan terawat"],
    watch: ["Batasi 1–2 widget hidup per grup agar tidak berisik", "Butuh endpoint agregat ringan (perluas /api/onevity/meta, cache 30–60 detik)"],
    verdict: "Paling sering diceritakan user ke rekan kerjanya.",
  },
  {
    key: "c", tab: "C · Identitas Modul", title: "C · Identitas Warna per Modul",
    variant: "classic", colorIdentity: true, live: false, phone: false, effort: "±½–1 hari",
    changed: ["Tiap modul punya aksen sendiri (lihat swatch di bawah)", "Logo, indikator aktif, dan glow ikut berubah saat ganti modul", "Membantu orientasi: warna = lokasi"],
    pros: ["Identitas instan dengan biaya implementasi paling murah", "Kontras visual antar modul mempercepat orientasi"],
    watch: ["Uji kontras & colorblind — selalu pasangkan ikon + teks, jangan warna saja", "Aksen jangan bocor berlebihan ke area konten"],
    verdict: "Paling murah, bisa jalan sendiri tanpa A.",
  },
  {
    key: "rec", tab: "★ Rekomendasi", title: "★ Rekomendasi — A + C + Hidup (Visi Final)",
    variant: "rail", colorIdentity: true, live: true, phone: true, effort: "±2–3 hari (bertahap)",
    changed: ["Rail berwarna per modul + indikator meluncur", "Widget hidup hanya untuk item prioritas (inbox, gajian, klaim)", "Logo OneVity ikut berganti aksen — sentuhan halus yang diingat"],
    pros: ["Struktur baru + kepribadian + kegunaan sekaligus", "Bisa dirilis bertahap: A dulu → C → B", "Versi produksi lebih tenang dari mockup ini (widget dibatasi)"],
    watch: ["Disiplin batasi widget hidup — mockup ini sengaja dibuat berlebihan"],
    verdict: "Rekomendasi saya — fondasi A+C, lalu B bertahap.",
  },
];

// ============ panel catatan ============
function NotesPanel({ opt }: { opt: OptionDef }) {
  const accent = opt.key === "rec" ? "#f59e0b" : EMERALD;
  return (
    <div className={cn("rounded-2xl border p-5", opt.key === "rec" ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-white/10 bg-white/[0.03]")}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-extrabold tracking-tight text-stone-50">{opt.title}</h3>
        <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-400">{opt.effort}</span>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Apa yang berubah</p>
        <ul className="mt-1.5 space-y-1.5">
          {opt.changed.map((t) => (
            <li key={t} className="flex gap-2 text-[12px] leading-relaxed text-stone-300">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: accent }} />
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Kelebihan</p>
        <ul className="mt-1.5 space-y-1.5">
          {opt.pros.map((t) => (
            <li key={t} className="flex gap-2 text-[12px] leading-relaxed text-stone-300">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Perlu diperhatikan</p>
        <ul className="mt-1.5 space-y-1.5">
          {opt.watch.map((t) => (
            <li key={t} className="flex gap-2 text-[12px] leading-relaxed text-stone-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" />
              {t}
            </li>
          ))}
        </ul>
      </div>
      {opt.key === "c" && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Palet aksen</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {MODULES.filter((m) => m.id !== "settings").map((m) => (
              <span key={m.id} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-stone-300">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.hex }} />
                {m.short}
              </span>
            ))}
          </div>
        </div>
      )}
      {opt.verdict && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
          <div className="flex gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
            <p className="text-[12px] font-semibold leading-relaxed text-stone-200">{opt.verdict}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ frame browser ============
function BrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-stone-900 shadow-2xl">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
        <div className="mx-auto w-full max-w-xs rounded-full bg-stone-800 px-4 py-1 text-center text-[10px] font-semibold tracking-wide text-stone-500">
          onevity.app · pratinjau desain menu
        </div>
        <span className="w-12" />
      </div>
      <div className="h-[560px] bg-white">{children}</div>
    </div>
  );
}

// ============ root lab ============
export function MenuDesignLab() {
  const [opt, setOpt] = useState<OptKey>("now");
  const active = OPTIONS.find((o) => o.key === opt)!;

  return (
    <div className="relative min-h-screen bg-stone-950 text-stone-100">
      {/* latar studio */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(600px circle at 15% 0%, rgba(16,185,129,0.13), transparent 45%), radial-gradient(700px circle at 85% 100%, rgba(245,158,11,0.09), transparent 45%), linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "auto, auto, 32px 32px, 32px 32px",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {/* header */}
        <header className="flex items-center justify-between gap-4 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-900/40">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="2.6" /><circle cx="5" cy="17" r="2.6" /><circle cx="19" cy="17" r="2.6" />
                <path d="M12 7.6 6.6 14.6M12 7.6l5.4 7M7.6 17h8.8" />
              </svg>
            </div>
            <div>
              <p className="text-[15px] font-extrabold leading-tight tracking-tight text-white">OneVity <span className="text-emerald-400">Design Lab</span></p>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-stone-500">Preview desain menu navigasi</p>
            </div>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-stone-300 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
          >
            Buka aplikasi <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </header>

        {/* hero */}
        <div className="pt-2">
          <h1 className="max-w-2xl text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Lima konsep menu — rasakan sebelum diputuskan
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-400">
            Ini mockup interaktif terisolasi: menu live aplikasi tidak tersentuh. Klik modul di rail / dropdown,
            klik item menu, coba pratinjau ponsel — semua gerak, warna, dan sinyal data bisa dicoba langsung.
          </p>
        </div>

        {/* tab opsi */}
        <div role="tablist" aria-label="Pilihan konsep" className="mt-6 flex flex-wrap gap-2">
          {OPTIONS.map((o) => {
            const isOn = o.key === opt;
            return (
              <button
                key={o.key}
                role="tab"
                aria-selected={isOn}
                onClick={() => setOpt(o.key)}
                className={cn(
                  "rounded-full border px-4 py-2 text-[12.5px] font-bold transition",
                  isOn
                    ? "border-transparent bg-stone-100 text-stone-950 shadow-lg"
                    : "border-white/15 text-stone-400 hover:border-white/30 hover:bg-white/5 hover:text-stone-200",
                  o.key === "rec" && !isOn && "border-amber-500/30 text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/5 hover:text-amber-200"
                )}
              >
                {o.tab}
              </button>
            );
          })}
        </div>

        {/* stage + catatan */}
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div>
            <BrowserFrame key={opt}>
              {active.variant === "rail" ? (
                <RailSidebar key={`rail-${opt}`} colorIdentity={active.colorIdentity} live={active.live} />
              ) : (
                <ClassicSidebar key={`classic-${opt}`} colorIdentity={active.colorIdentity} live={active.live} />
              )}
            </BrowserFrame>

            {active.phone && (
              <div className="mt-6 flex flex-wrap items-start justify-center gap-6">
                <PhonePreview key={`phone-${opt}`} colorIdentity={active.colorIdentity} live={active.live} />
                <div className="max-w-[240px] pt-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Pratinjau mobile</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-400">
                    Pola navigasi native: <span className="font-bold text-stone-200">bottom tab</span> untuk modul utama,
                    item menu dibuka lewat <span className="font-bold text-stone-200">bottom sheet</span> (tap ikon di bawah untuk mencoba).
                  </p>
                </div>
              </div>
            )}
          </div>
          <NotesPanel key={`notes-${opt}`} opt={active} />
        </div>

        {/* footer */}
        <footer className="mt-10 border-t border-white/[0.07] pt-5">
          <p className="text-[11px] leading-relaxed text-stone-500">
            OneVity Design Lab · mockup interaktif untuk pengambilan keputusan — bukan kode produksi.
            Data menu diambil dari struktur navigasi asli (6 modul + Pengaturan Sistem); angka &amp; aktivitas berupa contoh.
          </p>
        </footer>
      </div>
    </div>
  );
}
