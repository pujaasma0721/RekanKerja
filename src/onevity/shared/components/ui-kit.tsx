"use client";
// OneVity shared UI kit
import { isValidElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FileSearch } from "lucide-react";
import { useI18n, translate } from "@/onevity/shared/lib/i18n";

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
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/70 pb-4 dark:border-slate-800/70">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 flex items-center gap-2">
            {/* Task D-3: identitas modul — bar & label aksen mengikuti modul aktif */}
            <span className="ov-bar h-[3px] w-5 rounded-full" aria-hidden />
            <span className="ov-text-accent text-[11px] font-bold uppercase tracking-[0.14em]">{eyebrow}</span>
          </p>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// status pill mapping used across modules
const STATUS_MAP: Record<string, { label: string; cls: string; dot: string }> = {
  // employee
  Active: { label: "Aktif", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
  Resigned: { label: "Resign", cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25", dot: "bg-slate-400" },
  Terminated: { label: "Diberhentikan", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", dot: "bg-rose-500" },
  Blacklisted: { label: "Blacklist", cls: "bg-red-50 text-red-800 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/25", dot: "bg-red-600" },
  // PA flow
  Prepared: { label: "Draft", cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25", dot: "bg-slate-400" },
  Submitted: { label: "Menunggu Approval", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25", dot: "bg-amber-500" },
  Approved: { label: "Disetujui", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
  Rejected: { label: "Ditolak", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", dot: "bg-rose-500" },
  Processed: { label: "Diproses", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
  Cancelled: { label: "Dibatalkan", cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-500 dark:border-slate-500/25", dot: "bg-slate-400" },
  // approval layer
  Pending: { label: "Pending", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25", dot: "bg-amber-400" },
  // 26-a: permintaan surat karyawan sudah diterbitkan (PDF siap diunduh)
  Issued: { label: "Diterbitkan", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
  // payroll period & run
  Open: { label: "Terbuka", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
  Scheduled: { label: "Terjadwal", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
  Closed: { label: "Ditutup", cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25", dot: "bg-slate-400" },
  Locked: { label: "Terkunci", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", dot: "bg-rose-500" },
  Calculated: { label: "Terhitung", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
  Confirmed: { label: "Dikonfirmasi", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
  Paid: { label: "Dibayar", cls: "bg-brand/10 text-brand-deep border-brand/40 dark:bg-brand/20 dark:text-brand/75 dark:border-brand/40", dot: "bg-brand" },
  // wage type
  Earning: { label: "Earning", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand" },
  Deduction: { label: "Deduction", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25", dot: "bg-rose-500" },
  Informational: { label: "Informational", cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25", dot: "bg-slate-400" },
};

// Peta EN paralel STATUS_MAP (label ID dipertahankan; render t(label, EN[label])).
const STATUS_LABEL_EN: Record<string, string> = {
  Active: "Active",
  Resigned: "Resigned",
  Terminated: "Terminated",
  Blacklisted: "Blacklisted",
  Prepared: "Draft",
  Submitted: "Awaiting Approval",
  Approved: "Approved",
  Rejected: "Rejected",
  Processed: "Processed",
  Cancelled: "Cancelled",
  Pending: "Pending",
  Issued: "Issued",
  Open: "Open",
  Scheduled: "Scheduled",
  Closed: "Closed",
  Locked: "Locked",
  Calculated: "Calculated",
  Confirmed: "Confirmed",
  Paid: "Paid",
  Earning: "Earning",
  Deduction: "Deduction",
  Informational: "Informational",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const { t } = useI18n();
  const s = STATUS_MAP[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25", dot: "bg-slate-400" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.cls, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {t(s.label, STATUS_LABEL_EN[status] ?? s.label)}
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

// Peta EN paralel PA_TYPES (dipakai render t(PA_TYPES[k], PA_TYPES_EN[k])).
export const PA_TYPES_EN: Record<string, string> = {
  Hire: "Hire",
  Promotion: "Promotion",
  Demotion: "Demotion",
  Transfer: "Transfer",
  Mutation: "Mutation",
  SalaryAdjustment: "Salary Adjustment",
  ContractRenewal: "Contract Renewal",
  ChangeStatus: "Status Change",
  ExtendProbation: "Probation Extension",
  Resignation: "Resignation",
  Termination: "Termination",
  Retirement: "Retirement",
};

export function paTypeLabel(t: string) {
  return translate(PA_TYPES[t]?.label ?? t, PA_TYPES_EN[t] ?? t);
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode | React.ElementType }) {
  // icon boleh ReactNode (elemen React / string) ATAU komponen ikon — function klasik
  // ATAU forwardRef object (lucide modern: {$$typeof, render}). Komponen di-render
  // sebagai <Icon className/> agar tidak jatuh sebagai object child (crash runtime).
  const isElement = isValidElement(icon);
  const isScalar = typeof icon === "string" || typeof icon === "number";
  const IconComp = !isElement && !isScalar && icon != null ? (icon as unknown as React.ElementType) : null;
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/30">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
        {isElement || isScalar ? icon : IconComp ? <IconComp className="h-6 w-6" /> : <FileSearch className="h-6 w-6" />}
      </div>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</p>
      {description && <p className="max-w-sm text-xs text-slate-500 dark:text-slate-500">{description}</p>}
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
