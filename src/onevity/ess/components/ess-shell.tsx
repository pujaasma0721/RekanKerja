"use client";
// EssShell — navigasi Portal Karyawan TANPA SIDEBAR:
// • Desktop: topnav sticky (brand + menu horizontal + aksi pengguna)
// • Mobile: header ringkas + bottom tab bar ala aplikasi native (safe-area)
import { useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Waypoints, Moon, Sun, LogOut, KeyRound, ArrowLeftRight, ChevronDown, UserRound, CalendarCheck2, CalendarDays, ReceiptText, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "@/onevity/shared/components/shell/change-password-dialog";
import { useSession } from "@/onevity/shared/lib/session-store";
import { initials } from "@/onevity/shared/lib/api";
import { cn } from "@/lib/utils";
import { useEssNav, exitEss, type EssPage } from "@/onevity/ess/lib/ess-store";
import { useEssSession } from "@/onevity/ess/components/ess-session";

const NAV: { page: EssPage; label: string; short: string; icon: typeof Waypoints }[] = [
  { page: "home", label: "Beranda", short: "Beranda", icon: Waypoints },
  { page: "attendance", label: "Absensi Saya", short: "Absensi", icon: CalendarCheck2 },
  { page: "leave", label: "Cuti Saya", short: "Cuti", icon: CalendarDays },
  { page: "payslips", label: "Slip Gaji", short: "Slip", icon: ReceiptText },
  { page: "approvals", label: "Persetujuan", short: "Setuju", icon: ClipboardCheck },
  { page: "profile", label: "Profil Saya", short: "Profil", icon: UserRound },
];

export function EssShell({ children }: { children: React.ReactNode }) {
  const { page, navigate } = useEssNav();
  const { data: ess } = useEssSession();
  const { info, logout } = useSession();
  const { theme, setTheme } = useTheme();
  const [pwOpen, setPwOpen] = useState(false);
  const dark = theme === "dark";

  const tenantName = info?.tenant?.name ?? "";
  const emp = ess?.employee;
  const displayName = emp?.fullName ?? info?.user.name ?? "";
  const pending = ess?.pendingApprovals ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ===== topnav (desktop & mobile) ===== */}
      <header className="sticky top-0 z-40 border-b border-stone-200/70 bg-white/85 backdrop-blur-lg dark:border-stone-800/80 dark:bg-stone-950/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link href="/?area=ess" className="flex items-center gap-2.5" onClick={(e) => { e.preventDefault(); navigate("home"); }}>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md shadow-emerald-600/25">
              <Waypoints className="h-5 w-5" />
            </span>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-sm font-bold tracking-tight text-stone-900 dark:text-stone-50">OneVity</span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Portal Karyawan</span>
            </span>
            <span className="flex flex-col leading-tight sm:hidden">
              <span className="text-[13px] font-bold tracking-tight text-stone-900 dark:text-stone-50">OneVity</span>
            </span>
          </Link>

          {/* menu horizontal — desktop */}
          <nav className="ml-6 hidden flex-1 items-center gap-1 md:flex" aria-label="Menu utama portal karyawan">
            {NAV.map((n) => {
              const active = page === n.page;
              return (
                <button
                  key={n.page}
                  onClick={() => navigate(n.page)}
                  className={cn(
                    "relative rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                      : "text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-200",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {n.label}
                  {n.page === "approvals" && pending > 0 && (
                    <Badge className="ml-1.5 h-4 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white hover:bg-rose-500">{pending}</Badge>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="hidden md:block">
            {tenantName && (
              <span className="mr-1 hidden max-w-40 truncate text-xs text-stone-400 lg:block" title={tenantName}>{tenantName}</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <Button variant="ghost" size="icon" aria-label="Ganti tema" onClick={() => setTheme(dark ? "light" : "dark")} className="h-9 w-9 rounded-lg">
              {dark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-stone-500" />}
            </Button>

            {/* menu pengguna */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full border border-stone-200 py-1 pl-1 pr-2 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 dark:border-stone-700 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/10">
                  <Avatar className="h-7 w-7">
                    {emp?.photoUrl ? <AvatarImage src={emp.photoUrl} alt={displayName} /> : null}
                    <AvatarFallback className="bg-emerald-100 text-[11px] font-bold text-emerald-700">{initials(displayName)}</AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-28 truncate text-[13px] font-medium text-stone-700 dark:text-stone-300 sm:block">{displayName}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="space-y-0.5">
                  <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{displayName}</p>
                  <p className="truncate text-xs font-normal text-stone-500">{info?.user.email}</p>
                  <p className="truncate text-[11px] font-normal text-stone-400">
                    {emp ? `${emp.employeeNo} · ${emp.position ?? "—"}` : "—"}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("profile")}>
                  <UserRound className="h-4 w-4 text-stone-400" /> Profil Saya
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPwOpen(true)}>
                  <KeyRound className="h-4 w-4 text-stone-400" /> Ganti Kata Sandi
                </DropdownMenuItem>
                {ess?.canAdminApp && (
                  <DropdownMenuItem onClick={() => exitEss()}>
                    <ArrowLeftRight className="h-4 w-4 text-stone-400" /> Buka Aplikasi Admin
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-rose-600 focus:text-rose-600 dark:focus:text-rose-400"
                  onClick={() => { toast.success("Anda telah keluar dari sesi"); void logout(); }}
                >
                  <LogOut className="h-4 w-4" /> Keluar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* ===== konten ===== */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-12">{children}</main>

      {/* ===== footer ===== */}
      <footer className="mt-auto border-t border-stone-200/70 bg-stone-50/60 py-4 dark:border-stone-800/80 dark:bg-stone-900/40 md:block">
        <p className="hidden text-center text-[11px] text-stone-400 md:block">
          {tenantName ? `${tenantName} · ` : ""}Portal Karyawan OneVity — akses data kehadiran, cuti, slip gaji, dan persetujuan Anda.
        </p>
      </footer>

      {/* ===== bottom tab bar — mobile ===== */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg dark:border-stone-800 dark:bg-stone-950/95 md:hidden"
        aria-label="Menu bawah portal karyawan"
      >
        <div className="grid grid-cols-6">
          {NAV.map((n) => {
            const active = page === n.page;
            const Icon = n.icon;
            const isProfile = n.page === "profile";
            return (
              <button
                key={n.page}
                onClick={() => navigate(n.page)}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                  active ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400 dark:text-stone-500",
                )}
                aria-current={active ? "page" : undefined}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-emerald-500" />}
                <span className="relative flex h-5 w-5 items-center justify-center">
                  {isProfile ? (
                    <Avatar className="h-5 w-5">
                      {emp?.photoUrl ? <AvatarImage src={emp.photoUrl} alt={displayName} /> : null}
                      <AvatarFallback className="bg-emerald-100 text-[8px] font-bold text-emerald-700">{initials(displayName)}</AvatarFallback>
                    </Avatar>
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                  {n.page === "approvals" && pending > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{pending}</span>
                  )}
                </span>
                {n.short}
              </button>
            );
          })}
        </div>
      </nav>

      <ChangePasswordDialog open={pwOpen} setOpen={setPwOpen} />
    </div>
  );
}
