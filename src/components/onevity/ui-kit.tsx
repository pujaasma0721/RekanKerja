"use client";
// OneVity shared UI kit
import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FileSearch } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-stone-200/70 pb-4 dark:border-stone-800/70">
      <div className="min-w-0">
        {eyebrow && <p className="mb-0.5 text-xs font-medium text-stone-400 dark:text-stone-500">{eyebrow}</p>}
        <h1 className="truncate text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// status pill mapping used across modules
const STATUS_MAP: Record<string, { label: string; cls: string; dot: string }> = {
  // employee
  Active: { label: "Aktif", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25", dot: "bg-emerald-500" },
  Resigned: { label: "Resign", cls: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25", dot: "bg-stone-400" },
  Terminated: { label: "Diberhentikan", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", dot: "bg-rose-500" },
  Blacklisted: { label: "Blacklist", cls: "bg-red-50 text-red-800 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/25", dot: "bg-red-600" },
  // PA flow
  Prepared: { label: "Draft", cls: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25", dot: "bg-stone-400" },
  Submitted: { label: "Menunggu Approval", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25", dot: "bg-amber-500" },
  Approved: { label: "Disetujui", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25", dot: "bg-emerald-500" },
  Rejected: { label: "Ditolak", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", dot: "bg-rose-500" },
  Processed: { label: "Diproses", cls: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25", dot: "bg-teal-500" },
  Cancelled: { label: "Dibatalkan", cls: "bg-stone-100 text-stone-500 border-stone-200 dark:bg-stone-500/10 dark:text-stone-500 dark:border-stone-500/25", dot: "bg-stone-400" },
  // approval layer
  Pending: { label: "Pending", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25", dot: "bg-amber-400" },
  // payroll period & run
  Open: { label: "Terbuka", cls: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25", dot: "bg-teal-500" },
  Scheduled: { label: "Terjadwal", cls: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/25", dot: "bg-violet-500" },
  Closed: { label: "Ditutup", cls: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25", dot: "bg-stone-400" },
  Locked: { label: "Terkunci", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", dot: "bg-rose-500" },
  Calculated: { label: "Terhitung", cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/25", dot: "bg-sky-500" },
  Confirmed: { label: "Dikonfirmasi", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25", dot: "bg-emerald-500" },
  Paid: { label: "Dibayar", cls: "bg-emerald-600/10 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40", dot: "bg-emerald-600" },
  // wage type
  Earning: { label: "Earning", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25", dot: "bg-emerald-500" },
  Deduction: { label: "Deduction", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", dot: "bg-rose-500" },
  Informational: { label: "Informational", cls: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25", dot: "bg-stone-400" },
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25", dot: "bg-stone-400" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.cls, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

// PA type label + color
export const PA_TYPES: Record<string, { label: string; icon?: string }> = {
  Hire: { label: "Perekrutan" },
  Promotion: { label: "Promosi" },
  Demotion: { label: "Demosi" },
  Transfer: { label: "Rotasi/Transfer" },
  Mutation: { label: "Mutasi" },
  SalaryAdjustment: { label: "Penyesuaian Gaji" },
  ContractRenewal: { label: "Perpanjangan Kontrak" },
  ChangeStatus: { label: "Perubahan Status" },
  ExtendProbation: { label: "Perpanjangan Probation" },
  Resignation: { label: "Resignasi" },
  Termination: { label: "Pemutusan Hubungan Kerja" },
  Retirement: { label: "Pensiun" },
};

export function paTypeLabel(t: string) {
  return PA_TYPES[t]?.label ?? t;
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  // icon boleh ReactNode (elemen) ATAU komponen ikon (mis. lucide) — komponen
  // di-render sebagai <Icon className/> agar tidak jatuh sebagai object child.
  const IconComp = typeof icon === "function" ? (icon as unknown as React.ElementType) : null;
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-6 py-14 text-center dark:border-stone-700 dark:bg-stone-900/30">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400 dark:bg-stone-800">
        {IconComp ? <IconComp className="h-6 w-6" /> : (icon ?? <FileSearch className="h-6 w-6" />)}
      </div>
      <p className="text-sm font-semibold text-stone-700 dark:text-stone-300">{title}</p>
      {description && <p className="max-w-sm text-xs text-stone-500 dark:text-stone-500">{description}</p>}
    </div>
  );
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn("h-12 w-full", i % 3 === 2 && "w-[92%]")} />
      ))}
    </div>
  );
}

export function LoadingCards({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: cards }).map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-2xl" />
      ))}
    </div>
  );
}
