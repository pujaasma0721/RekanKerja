"use client";
// RekanKerja Payroll — Benefit Karyawan (P5): klaim dgn limit per siklus reset,
// auto-approve dalam limit, approval manual, jadwal bayar via run BENEFIT
// (pay-in-payroll) atau kas langsung + master jenis benefit.
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort, fmtDate } from "@/rekankerja/shared/lib/api";
import { useTableSort } from "@/rekankerja/shared/lib/use-table-sort";
import { EntityRulesDialog, type EntityRuleTarget } from "@/rekankerja/shared/components/entity-rules-dialog";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  HeartHandshake, Plus, CheckCircle2, XCircle, CalendarClock, Wallet, Pencil,
  Stethoscope, Glasses, Dumbbell, PartyPopper, Sparkles, Landmark, Ban, FileText, ChevronRight, SlidersHorizontal,
} from "lucide-react";
import { BenefitTypeRow, BenefitClaimRow, BenefitStats, PeriodRow, WageCompFull, PERIOD_STATUS_LABEL, PERIOD_STATUS_LABEL_EN } from "@/rekankerja/payroll/components/payroll-types";
import { cn } from "@/lib/utils";
import { useI18n, loc } from "@/rekankerja/shared/lib/i18n";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Pending", label: "Pending" },
  { key: "Approved", label: "Disetujui" },
  { key: "Scheduled", label: "Terjadwal" },
  { key: "Paid", label: "Dibayar" },
  { key: "Rejected", label: "Ditolak" },
];

const STATUS_FILTERS_EN: Record<string, string> = {
  all: "All", Pending: "Pending", Approved: "Approved", Scheduled: "Scheduled", Paid: "Paid", Rejected: "Rejected",
};

const CATEGORY_ICON: Record<string, React.ElementType> = {
  Medical: Stethoscope, Kesehatan: Glasses, Transport: Landmark,
  Rekreasi: Dumbbell, Perayaan: PartyPopper,
};

// Task 103-g — kategori benefit (data master ID) → label EN paralel utk t() dua-argumen
const CATEGORY_LABEL_EN: Record<string, string> = {
  Medical: "Medical", Kesehatan: "Health", Transport: "Transport",
  Rekreasi: "Recreation", Perayaan: "Celebration", Lainnya: "Other",
};

const RESET_LABEL: Record<string, string> = {
  None: "sekali seumur pakai", Monthly: "per bulan", Quarterly: "per kuartal", Yearly: "per tahun",
};

const RESET_LABEL_EN: Record<string, string> = {
  None: "once, lifetime", Monthly: "monthly", Quarterly: "quarterly", Yearly: "yearly",
};

export function PayrollBenefitsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState("claims");
  const [claimDialog, setClaimDialog] = useState(false);
  const [typeDialog, setTypeDialog] = useState(false);
  const [editType, setEditType] = useState<BenefitTypeRow | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [rejectTarget, setRejectTarget] = useState<BenefitClaimRow | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<BenefitClaimRow | null>(null);
  const [rulesTarget, setRulesTarget] = useState<EntityRuleTarget | null>(null);

  const claimsApi = useApi<{ claims: BenefitClaimRow[]; stats: BenefitStats }>(`/api/rekankerja/benefit-claims?status=${statusFilter}`);

  // Task 72 — sorting kolom tabel klaim benefit
  const sort = useTableSort(claimsApi.data?.claims, {
    claim: (c) => c.claimNo,
    employee: (c) => c.employee.fullName,
    type: (c) => c.benefitType.name,
    date: (c) => c.claimDate,
    amount: (c) => c.approvedAmount || c.amount,
    limit: (c) => c.limitRemaining,
    status: (c) => c.status,
  }, { defaultKey: "date", defaultDir: "desc" });
  const typesApi = useApi<{ types: BenefitTypeRow[] }>("/api/rekankerja/benefit-types");
  const stats = claimsApi.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Benefit Karyawan")}
        description={t("Klaim dengan limit per siklus, auto-approve dalam limit, dan pembayaran terintegrasi run payroll BENEFIT atau kas langsung", "Claims with per-cycle limits, auto-approve within limit, and payments integrated with the BENEFIT payroll run or direct cash")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditType(null); setTypeDialog(true); }} className="gap-2 font-bold">
              <Sparkles className="h-4 w-4 text-brand" /> {t("Jenis Benefit", "Benefit Types")}
            </Button>
            <Button onClick={() => setClaimDialog(true)} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Ajukan Klaim", "Submit Claim")}
            </Button>
          </div>
        }
      />

      {/* KPI */}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          icon={<XCircle className="h-4 w-4" />} tone="amber"
          label={t("Menunggu Persetujuan")}
          value={String(stats?.pending ?? 0)}
          sub={stats ? t("{v} menunggu keputusan", "{v} awaiting decision", { v: fmtIDR(stats.pendingAmount) }) : undefined}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald"
          label={t("Disetujui (siap jadwal)", "Approved (ready to schedule)")}
          value={String((stats?.approvedCount ?? 0) - (stats?.scheduledCount ?? 0))}
          sub={stats ? fmtIDR(stats.approvedAmount) : undefined}
        />
        <KpiCard
          icon={<CalendarClock className="h-4 w-4" />} tone="violet"
          label={t("Terjadwal di Payroll", "Scheduled in Payroll")}
          value={String(stats?.scheduledCount ?? 0)}
          sub={t("dibayar saat run BENEFIT dikonfirmasi", "paid when the BENEFIT run is confirmed")}
        />
        <KpiCard
          icon={<Wallet className="h-4 w-4" />} tone="teal"
          label={t("Dibayar Tahun Ini", "Paid This Year")}
          value={stats ? fmtIDRShort(stats.ytdAmount) : "—"}
          sub={stats ? t("{n} klaim lunas", "{n} claims settled", { n: stats.paidCount }) : undefined}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto rounded-2xl bg-slate-100 p-1.5 dark:bg-slate-900">
          <TabsTrigger value="claims" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800">
            <HeartHandshake className="h-3.5 w-3.5" /> {t("Klaim", "Claims")} ({claimsApi.data?.claims.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="types" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800">
            <Sparkles className="h-3.5 w-3.5" /> {t("Jenis Benefit", "Benefit Types")} ({typesApi.data?.types.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="claims">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-bold transition-colors",
                  statusFilter === f.key
                    ? "ov-soft ov-border-accent"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
                )}
              >
                {t(f.label, STATUS_FILTERS_EN[f.key])}
              </button>
            ))}
          </div>
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-0">
              {claimsApi.loading && !claimsApi.data ? (
                <div className="p-4"><LoadingRows rows={5} /></div>
              ) : (claimsApi.data?.claims.length ?? 0) === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={t("Belum ada klaim", "No claims yet")}
                    description={t("Ajukan klaim benefit karyawan — klaim dalam limit bisa otomatis disetujui.", "Submit an employee benefit claim — claims within limit can be auto-approved.")}
                    icon={<HeartHandshake className="h-6 w-6" />}
                  />
                </div>
              ) : (
                <div className="max-h-[560px] overflow-y-auto overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                        {sort.head("claim", t("Klaim", "Claim"), "text-[11px] font-bold")}
                        {sort.head("employee", t("Karyawan"), "text-[11px] font-bold")}
                        {sort.head("type", t("Jenis Benefit", "Benefit Type"), "text-[11px] font-bold")}
                        {sort.head("date", t("Tanggal"), "text-[11px] font-bold")}
                        {sort.head("amount", t("Nilai", "Value"), "text-right text-[11px] font-bold")}
                        {sort.head("limit", t("Limit"), "text-[11px] font-bold")}
                        {sort.head("status", t("Status"), "text-[11px] font-bold")}
                        <TableHead className="text-right text-[11px] font-bold">{t("Aksi")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sort.sorted.map((c) => (
                        <ClaimRow key={c.id} claim={c}
                          onReject={() => setRejectTarget(c)}
                          onSchedule={() => setScheduleTarget(c)}
                          onChanged={() => { claimsApi.refresh(); typesApi.refresh(); }}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="types">
          {typesApi.loading && !typesApi.data ? (
            <div className="grid gap-3 md:grid-cols-2"><LoadingRows rows={3} /></div>
          ) : (typesApi.data?.types.length ?? 0) === 0 ? (
            <Card className="rounded-2xl border-slate-200/80 dark:border-slate-800">
              <CardContent className="p-5">
                <EmptyState
                  title={t("Belum ada jenis benefit", "No benefit types yet")}
                  description={t("Buat jenis benefit: medical, kacamata, olahraga, pernikahan, dst.", "Create benefit types: medical, glasses, sports, wedding, etc.")}
                  icon={<Sparkles className="h-6 w-6" />}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(typesApi.data?.types ?? []).map((t) => (
                <TypeCard key={t.id} type={t}
                  onEdit={() => { setEditType(t); setTypeDialog(true); }}
                  onChanged={() => { typesApi.refresh(); claimsApi.refresh(); }}
                  onOpenRules={setRulesTarget}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ClaimDialog open={claimDialog} onClose={() => setClaimDialog(false)} onSubmitted={() => { claimsApi.refresh(); typesApi.refresh(); }} />
      <TypeDialog open={typeDialog} editing={editType} onClose={() => { setTypeDialog(false); setEditType(null); }} onSaved={() => typesApi.refresh()} />
      <RejectDialog claim={rejectTarget} onClose={() => setRejectTarget(null)} onDone={() => { claimsApi.refresh(); setRejectTarget(null); }} />
      <ScheduleDialog claim={scheduleTarget} onClose={() => setScheduleTarget(null)} onDone={() => { claimsApi.refresh(); setScheduleTarget(null); }} />

      {rulesTarget && (
        <EntityRulesDialog
          key={rulesTarget.id}
          open={!!rulesTarget}
          target={rulesTarget}
          onClose={() => { setRulesTarget(null); typesApi.refresh(); }}
        />
      )}
    </div>
  );
}

function KpiCard({ icon, tone, label, value, sub }: {
  icon: React.ReactNode; tone: "amber" | "emerald" | "violet" | "teal";
  label: string; value: string; sub?: string;
}) {
  const tones: Record<string, string> = {
    amber: "from-brand to-orange-500",
    emerald: "from-brand to-brand",
    violet: "from-brand to-purple-600",
    teal: "from-brand to-brand",
  };
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", tones[tone])}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="truncate text-[15px] font-extrabold text-slate-800 dark:text-slate-100">{value}</p>
          {sub && <p className="truncate text-[10px] text-slate-400">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ BARIS KLAIM ============

function ClaimRow({ claim, onReject, onSchedule, onChanged }: {
  claim: BenefitClaimRow; onReject: () => void; onSchedule: () => void; onChanged: () => void;
}) {
  const { navigate } = useNav();
  const { t } = useI18n();
  const [busy, setBusy] = useState("");

  const act = async (key: string, action: string, extra?: Record<string, unknown>, okMsg?: string) => {
    setBusy(key);
    try {
      await apiSend("/api/rekankerja/benefit-claims", "PATCH", { id: claim.id, action, ...extra });
      toast.success(okMsg ?? t("Klaim diperbarui", "Claim updated"));
      onChanged();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };

  const CatIcon = CATEGORY_ICON[claim.benefitType.category] ?? HeartHandshake;

  return (
    <TableRow className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
      <TableCell>
        <p className="font-mono text-[12px] font-bold text-slate-700 dark:text-slate-200">{claim.claimNo}</p>
        {claim.description && <p className="max-w-52 truncate text-[10px] text-slate-400">{claim.description}</p>}
      </TableCell>
      <TableCell>
        <p className="text-[13px] font-bold">{claim.employee.fullName}</p>
        <p className="font-mono text-[10px] text-slate-400">{claim.employee.employeeNo}</p>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand dark:bg-brand/10 dark:text-brand/85">
            <CatIcon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{claim.benefitType.name}</p>
            <p className="text-[10px] text-slate-400">
              {t(RESET_LABEL[claim.benefitType.resetPeriod] ?? claim.benefitType.resetPeriod, RESET_LABEL_EN[claim.benefitType.resetPeriod])}
              {claim.benefitType.unlimited ? t(" · tanpa limit", " · no limit") : t(" · limit {v}", " · limit {v}", { v: fmtIDRShort(claim.benefitType.maxClaimAmount) })}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-xs text-slate-500">{fmtDate(claim.claimDate)}</TableCell>
      <TableCell className="text-right text-xs font-bold">{fmtIDR(claim.amount)}</TableCell>
      <TableCell>
        {claim.benefitType.unlimited ? (
          <Badge variant="outline" className="text-[9px] font-bold text-slate-500">{t("Tanpa Limit", "No Limit")}</Badge>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className={cn(
                "cursor-help text-[9px] font-bold",
                claim.inLimit
                  ? "border-brand/40 bg-brand/10 text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85"
                  : "border-brand/40 bg-brand/10 text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85",
              )}>
                {claim.inLimit ? t("Dalam Limit", "Within Limit") : claim.status === "Rejected" ? t("Melebihi Limit", "Over Limit") : t("Over (diizinkan)", "Over (allowed)")}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">
              {t("Terpakai {u} · sisa {r} saat pengajuan", "Used {u} · remaining {r} at submission", { u: fmtIDR(claim.limitUsed), r: fmtIDR(claim.limitRemaining) })}
            </TooltipContent>
          </Tooltip>
        )}
      </TableCell>
      <TableCell>
        <StatusPill status={claim.status} />
        {claim.status === "Rejected" && claim.rejectedReason && (
          <p className="mt-1 max-w-44 text-[10px] italic leading-tight text-rose-500">{claim.rejectedReason}</p>
        )}
        {claim.status === "Scheduled" && claim.period && (
          <p className="mt-1 text-[10px] font-semibold text-brand dark:text-brand/85">{loc(claim.period.name)}</p>
        )}
        {claim.status === "Paid" && (
          <p className="mt-1 font-mono text-[10px] text-brand dark:text-brand/85">{claim.paidRunNo ?? t("via kas", "via cash")}</p>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-1">
          {claim.status === "Pending" && (
            <>
              <Button size="sm" disabled={busy === "a"} onClick={() => act("a", "approve", {}, t("Klaim {no} disetujui", "Claim {no} approved", { no: claim.claimNo }))}
                className="h-7 gap-1 rounded-lg bg-brand px-2.5 text-[10px] font-bold hover:bg-brand/70">
                <CheckCircle2 className="h-3 w-3" /> {t("Setujui", "Approve")}
              </Button>
              <Button size="sm" variant="outline" disabled={busy === "r"} onClick={onReject}
                className="h-7 gap-1 rounded-lg px-2.5 text-[10px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10">
                <XCircle className="h-3 w-3" /> {t("Tolak", "Reject")}
              </Button>
            </>
          )}
          {claim.status === "Approved" && (
            claim.benefitType.payInPayroll ? (
              <Button size="sm" disabled={busy === "s"} onClick={onSchedule}
                className="h-7 gap-1 rounded-lg bg-brand px-2.5 text-[10px] font-bold hover:bg-brand/70">
                <CalendarClock className="h-3 w-3" /> {t("Jadwalkan", "Schedule")}
              </Button>
            ) : (
              <Button size="sm" disabled={busy === "p"} onClick={() => act("p", "markPaid", undefined, t("Klaim {no} lunas dari kas", "Claim {no} settled from cash", { no: claim.claimNo }))}
                className="h-7 gap-1 rounded-lg bg-brand px-2.5 text-[10px] font-bold hover:bg-brand/70">
                <Wallet className="h-3 w-3" /> {t("Tandai Lunas", "Mark Settled")}
              </Button>
            )
          )}
          {claim.status === "Scheduled" && claim.period && (
            <button
              onClick={() => navigate("payroll", "runs", claim.periodId ? { period: claim.periodId } : undefined)}
              className="flex h-7 items-center gap-1 rounded-lg border border-brand/25 bg-white px-2.5 text-[10px] font-bold text-brand-deep hover:bg-brand/10 dark:border-brand/30 dark:bg-slate-900 dark:text-brand/85 dark:hover:bg-brand/10"
            >
              {t("Lihat Run", "View Run")} <ChevronRight className="h-3 w-3" />
            </button>
          )}
          {["Pending", "Approved", "Scheduled"].includes(claim.status) && (
            <button
              disabled={busy === "c"}
              onClick={() => {
                if (!window.confirm(t("Batalkan klaim {no} ({emp})?", "Cancel claim {no} ({emp})?", { no: claim.claimNo, emp: claim.employee.fullName }))) return;
                act("c", "cancel", undefined, t("Klaim {no} dibatalkan", "Claim {no} cancelled", { no: claim.claimNo }));
              }}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500 dark:hover:bg-slate-800"
              aria-label={t("Batalkan", "Cancel")}
            >
              <Ban className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ============ KARTU JENIS BENEFIT ============

function TypeCard({ type, onEdit, onChanged, onOpenRules }: {
  type: BenefitTypeRow; onEdit: () => void; onChanged: () => void; onOpenRules: (t: EntityRuleTarget) => void;
}) {
  const { t } = useI18n();
  const Icon = CATEGORY_ICON[type.category] ?? Sparkles;
  const toggleActive = async () => {
    try {
      await apiSend("/api/rekankerja/benefit-types", "PATCH", { id: type.id, active: !type.active });
      toast.success(type.active ? t("{name} dinonaktifkan", "{name} deactivated", { name: type.name }) : t("{name} diaktifkan", "{name} activated", { name: type.name }));
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card className={cn("rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800", !type.active && "opacity-60")}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-purple-600 text-white shadow-md">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[14px] font-bold">{type.name}</p>
              <Badge variant="outline" className="shrink-0 text-[9px] font-bold text-brand dark:text-brand/85">{t(type.category, CATEGORY_LABEL_EN[type.category] ?? type.category)}</Badge>
            </div>
            <p className="font-mono text-[10px] text-slate-400">{type.code} · {t(RESET_LABEL[type.resetPeriod] ?? type.resetPeriod, RESET_LABEL_EN[type.resetPeriod])}</p>
            {type.description && <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{type.description}</p>}
          </div>
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-slate-900/60">
          <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
            {type.unlimited || type.maxClaimAmount <= 0
              ? t("Tanpa limit nominal", "No amount limit")
              : <>{t("Limit {v}", "Limit {v}", { v: fmtIDR(type.maxClaimAmount) })} <span className="font-normal text-slate-400">{t(RESET_LABEL[type.resetPeriod] ?? type.resetPeriod, RESET_LABEL_EN[type.resetPeriod])}</span></>}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {t("{n} klaim aktif · total {v}", "{n} active claims · total {v}", { n: type.activeClaimCount, v: fmtIDR(type.totalApprovedAmount) })}
            {type.wageComponent && <> · {t("komponen", "component")} <b className="font-semibold">{type.wageComponent.code}</b></>}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {type.autoApproveInLimit && (
            <Badge variant="outline" className="gap-1 border-brand/40 bg-brand/10 text-[9px] font-bold text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85"><CheckCircle2 className="h-2.5 w-2.5" /> {t("Auto-approve dalam limit", "Auto-approve within limit")}</Badge>
          )}
          <Badge variant="outline" className="gap-1 border-brand/40 bg-brand/10 text-[9px] font-bold text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85">
            {type.payInPayroll ? <><CalendarClock className="h-2.5 w-2.5" /> {t("Pay-in-payroll (BENEFIT)", "Pay-in-payroll (BENEFIT)")}</> : <><Wallet className="h-2.5 w-2.5" /> {t("Kas langsung", "Direct cash")}</>}
          </Badge>
          {type.needDocuments && <Badge variant="outline" className="gap-1 border-brand/40 bg-brand/10 text-[9px] font-bold text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85"><FileText className="h-2.5 w-2.5" /> {t("Perlu dokumen", "Documents required")}</Badge>}
          {type.allowOverlimit && <Badge variant="outline" className="text-[9px] font-bold text-slate-500">{t("Boleh overlimit", "Overlimit allowed")}</Badge>}
          {type.entitleFor !== "All" && <Badge variant="outline" className="text-[9px] font-bold text-slate-500">{t("{s} saja", "{s} only", { s: type.entitleFor })}</Badge>}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} className="h-7 gap-1 rounded-lg px-2.5 text-[10px] font-bold">
            <Pencil className="h-3 w-3" /> {t("Ubah")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenRules({ domain: "benefit", id: type.id, code: type.code, name: type.name })} className="h-7 gap-1 rounded-lg px-2.5 text-[10px] font-bold">
            <SlidersHorizontal className="h-3 w-3" /> {t("Aturan", "Rules")} {type.ruleCount ? `(${type.ruleCount})` : ""}
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleActive} className="h-7 gap-1 rounded-lg px-2.5 text-[10px] font-bold text-slate-500">
            {type.active ? t("Nonaktifkan", "Deactivate") : t("Aktifkan", "Activate")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============ DIALOG AJUKAN KLAIM ============

function ClaimDialog({ open, onClose, onSubmitted }: { open: boolean; onClose: () => void; onSubmitted: () => void }) {
  const { t } = useI18n();
  const employeesApi = useApi<{ employees: { employeeId: string; fullName: string; employeeNo: string }[] }>(open ? "/api/rekankerja/payroll-profiles" : null);
  const [employeeId, setEmployeeId] = useState("");
  const [benefitTypeId, setBenefitTypeId] = useState("");
  const [amount, setAmount] = useState("");
  const [claimDate, setClaimDate] = useState("");
  const [description, setDescription] = useState("");
  const [documentsNote, setDocumentsNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Snapshot limit live per karyawan terpilih (fallback: daftar master).
  const usageApi = useApi<{ types: BenefitTypeRow[] }>(open && employeeId ? `/api/rekankerja/benefit-types?employeeId=${employeeId}` : null);
  const allTypesApi = useApi<{ types: BenefitTypeRow[] }>(open ? "/api/rekankerja/benefit-types" : null);
  const typeList = employeeId ? (usageApi.data?.types ?? []) : (allTypesApi.data?.types ?? []);
  const selected = typeList.find((o) => o.id === benefitTypeId);
  const amt = Number(amount) || 0;
  const usage = selected?.usage;

  const submit = async () => {
    if (!employeeId || !benefitTypeId || amt <= 0) { toast.error(t("Lengkapi karyawan, jenis benefit & nilai klaim", "Complete employee, benefit type & claim amount")); return; }
    if (selected?.needDocuments && !documentsNote.trim()) { toast.error(t("Jenis benefit ini mewajibkan keterangan dokumen", "This benefit type requires a documents note")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ note: string }>("/api/rekankerja/benefit-claims", "POST", {
        employeeId, benefitTypeId, amount: amt,
        claimDate: claimDate || undefined,
        description: description.trim() || null,
        documentsNote: documentsNote.trim() || null,
      });
      toast.success(res.note);
      setEmployeeId(""); setBenefitTypeId(""); setAmount(""); setDescription(""); setDocumentsNote(""); setClaimDate("");
      onSubmitted();
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><HeartHandshake className="h-4 w-4 text-brand" /> {t("Ajukan Klaim Benefit", "Submit Benefit Claim")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">{t("Karyawan *")}</Label>
            <Select value={employeeId} onValueChange={(v) => { setEmployeeId(v); setBenefitTypeId(""); }}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
              <SelectContent className="max-h-52">
                {(employeesApi.data?.employees ?? []).map((e) => (
                  <SelectItem key={e.employeeId} value={e.employeeId}>{e.employeeNo} — {e.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Jenis Benefit *", "Benefit Type *")}</Label>
            <Select value={benefitTypeId} onValueChange={setBenefitTypeId} disabled={!employeeId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={employeeId ? t("Pilih jenis benefit", "Select benefit type") : t("Pilih karyawan dulu", "Select an employee first")} /></SelectTrigger>
              <SelectContent className="max-h-52">
                {typeList.map((bt) => (
                  <SelectItem key={bt.id} value={bt.id}>
                    {bt.name}{!bt.unlimited && bt.maxClaimAmount > 0 ? ` — limit ${fmtIDRShort(bt.maxClaimAmount)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Nilai Klaim (Rp) *", "Claim Amount (Rp) *")}</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="450000" className="mt-1.5 font-mono" />
            </div>
            <div>
              <Label className="text-xs">{t("Tanggal Klaim", "Claim Date")}</Label>
              <Input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("Keterangan")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("cth: Medical check-up klinik", "e.g. clinic medical check-up")} className="mt-1.5" />
          </div>
          {selected?.needDocuments && (
            <div>
              <Label className="text-xs">{t("Dokumen Pendukung *", "Supporting Documents *")}</Label>
              <Textarea value={documentsNote} onChange={(e) => setDocumentsNote(e.target.value)} rows={2}
                placeholder={t("cth: kwitansi klinik #RCP-881, resep obat", "e.g. clinic receipt #RCP-881, prescription")} className="mt-1.5 text-xs" />
            </div>
          )}
          {selected && usage && (
            <p className={cn(
              "rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed font-semibold",
              usage.limit === null
                ? "bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-400"
                : usage.inLimit && amt <= (usage.remaining ?? 0)
                  ? "bg-brand/10 text-brand-deep dark:bg-brand/10 dark:text-brand/85"
                  : "bg-brand/10 text-brand-deep dark:bg-brand/10 dark:text-brand/85",
            )}>
              {usage.limit === null
                ? t("Jenis ini tanpa limit nominal.", "This type has no amount limit.")
                : <>{t("Siklus {w}: terpakai {u} · sisa {r}", "Cycle {w}: used {u} · remaining {r}", { w: usage.windowLabel, u: fmtIDR(usage.used), r: fmtIDR(usage.remaining ?? 0) })}
                  {amt > 0 && <> · {t("klaim ini ", "this claim ")}<b>{usage.inLimit && amt <= (usage.remaining ?? 0) ? t("dalam limit", "within limit") : (selected.allowOverlimit ? t("MELEBIHI limit (butuh approval manual)", "EXCEEDS the limit (needs manual approval)") : t("akan DITOLAK — melebihi limit", "will be REJECTED — exceeds the limit"))}</b></>}
                </>}
              {selected.autoApproveInLimit && <span className="block font-normal">{t("Auto-approve aktif: klaim dalam limit langsung disetujui sistem.", "Auto-approve active: claims within limit are approved by the system immediately.")}</span>}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Mengirim…", "Submitting…") : t("Ajukan Klaim", "Submit Claim")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ DIALOG JENIS BENEFIT (buat/ubah) ============

function TypeDialog({ open, editing, onClose, onSaved }: {
  open: boolean; editing: BenefitTypeRow | null; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const compsApi = useApi<{ components: WageCompFull[] }>(open ? "/api/rekankerja/wage-components" : null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Medical");
  const [description, setDescription] = useState("");
  const [resetPeriod, setResetPeriod] = useState("Monthly");
  const [maxClaimAmount, setMaxClaimAmount] = useState("");
  const [unlimited, setUnlimited] = useState(false);
  const [allowOverlimit, setAllowOverlimit] = useState(false);
  const [needDocuments, setNeedDocuments] = useState(false);
  const [autoApproveInLimit, setAutoApproveInLimit] = useState(true);
  const [payInPayroll, setPayInPayroll] = useState(true);
  const [wageComponentId, setWageComponentId] = useState("");
  const [entitleFor, setEntitleFor] = useState("All");
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState<string | null>(null);

  // Prefill saat edit (id sebagai penanda ganti target).
  const targetId = editing?.id ?? "new";
  if (open && initialized !== targetId) {
    setInitialized(targetId);
    setCode(editing?.code ?? "");
    setName(editing?.name ?? "");
    setCategory(editing?.category ?? "Medical");
    setDescription(editing?.description ?? "");
    setResetPeriod(editing?.resetPeriod ?? "Monthly");
    setMaxClaimAmount(editing && editing.maxClaimAmount > 0 ? String(editing.maxClaimAmount) : "");
    setUnlimited(editing?.unlimited ?? false);
    setAllowOverlimit(editing?.allowOverlimit ?? false);
    setNeedDocuments(editing?.needDocuments ?? false);
    setAutoApproveInLimit(editing?.autoApproveInLimit ?? true);
    setPayInPayroll(editing?.payInPayroll ?? true);
    setWageComponentId(editing?.wageComponentId ?? "");
    setEntitleFor(editing?.entitleFor ?? "All");
  }

  const submit = async () => {
    if (!editing && !code.trim()) { toast.error(t("Kode wajib diisi", "Code is required")); return; }
    if (!name.trim()) { toast.error(t("Nama wajib diisi", "Name is required")); return; }
    if (payInPayroll && !wageComponentId) { toast.error(t("Pay-in-payroll wajib memetakan komponen upah", "Pay-in-payroll requires a wage component mapping")); return; }
    if (!unlimited && !(Number(maxClaimAmount) > 0)) { toast.error(t("Isi limit nominal atau aktifkan tanpa limit", "Fill in the amount limit or enable no limit")); return; }
    setBusy(true);
    try {
      const body = {
        code: code.trim().toUpperCase(), name: name.trim(), category, description: description.trim() || null,
        resetPeriod, maxClaimAmount: Number(maxClaimAmount) || 0, unlimited, allowOverlimit,
        needDocuments, autoApproveInLimit, payInPayroll,
        wageComponentId: wageComponentId || null, entitleFor,
      };
      if (editing) {
        await apiSend("/api/rekankerja/benefit-types", "PATCH", { id: editing.id, ...body });
        toast.success(t("Jenis benefit {n} diperbarui", "Benefit type {n} updated", { n: body.name }));
      } else {
        await apiSend("/api/rekankerja/benefit-types", "POST", body);
        toast.success(t("Jenis benefit {c} dibuat", "Benefit type {c} created", { c: body.code }));
      }
      setInitialized(null);
      onSaved();
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setInitialized(null); onClose(); } }}>
      <DialogContent className="max-h-[90vh] sm:max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-brand" /> {editing ? t("Ubah — {n}", "Edit — {n}", { n: editing.name }) : t("Jenis Benefit Baru", "New Benefit Type")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">{t("Kode *", "Code *")}</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!editing}
                placeholder="MEDICAL" className="mt-1.5 font-mono uppercase" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t("Nama *", "Name *")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Reimburse Medis", "Medical Reimbursement")} className="mt-1.5" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Kategori", "Category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Medical", "Kesehatan", "Transport", "Rekreasi", "Perayaan", "Lainnya"].map((c) => (
                    <SelectItem key={c} value={c}>{t(c, CATEGORY_LABEL_EN[c] ?? c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("Siklus Reset Limit", "Limit Reset Cycle")}</Label>
              <Select value={resetPeriod} onValueChange={setResetPeriod}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Monthly">{t("Bulanan", "Monthly")}</SelectItem>
                  <SelectItem value="Quarterly">{t("Kuartalan", "Quarterly")}</SelectItem>
                  <SelectItem value="Yearly">{t("Tahunan", "Yearly")}</SelectItem>
                  <SelectItem value="None">{t("Sekali seumur pakai", "Once, lifetime")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Limit per Siklus (Rp)", "Limit per Cycle (Rp)")}</Label>
              <Input type="number" value={maxClaimAmount} disabled={unlimited} onChange={(e) => setMaxClaimAmount(e.target.value)}
                placeholder="2000000" className="mt-1.5 font-mono" />
            </div>
            <div>
              <Label className="text-xs">{t("Hanya utk Status", "Only for Status")}</Label>
              <Select value={entitleFor} onValueChange={setEntitleFor}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">{t("Semua karyawan", "All employees")}</SelectItem>
                  <SelectItem value="Permanent">{t("Tetap", "Permanent")}</SelectItem>
                  <SelectItem value="Contract">{t("Kontrak", "Contract")}</SelectItem>
                  <SelectItem value="Probation">{t("Percobaan", "Probation")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-900/60">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Perilaku", "Behavior")}</p>
            <div className="grid gap-2.5">
              <ToggleRow checked={unlimited} onChange={setUnlimited} label={t("Tanpa limit nominal", "No amount limit")} hint={t("Abaikan limit per siklus", "Ignore per-cycle limit")} />
              <ToggleRow checked={autoApproveInLimit} onChange={setAutoApproveInLimit} label={t("Auto-approve dalam limit", "Auto-approve within limit")} hint={t("Klaim ≤ limit langsung disetujui sistem", "Claims ≤ limit approved by the system immediately")} />
              <ToggleRow checked={allowOverlimit} onChange={setAllowOverlimit} label={t("Izinkan klaim melebihi limit", "Allow claims over the limit")} hint={t("Overlimit masuk approval manual", "Overlimit goes to manual approval")} />
              <ToggleRow checked={needDocuments} onChange={setNeedDocuments} label={t("Wajib dokumen pendukung", "Supporting documents required")} hint={t("Keterangan dokumen saat pengajuan", "Documents note on submission")} />
              <ToggleRow checked={payInPayroll} onChange={setPayInPayroll} label={t("Bayar via payroll (pay-in-payroll)", "Pay via payroll (pay-in-payroll)")} hint={t("Dibayar saat run BENEFIT dikonfirmasi", "Paid when the BENEFIT run is confirmed")} />
            </div>
          </div>
          {payInPayroll && (
            <div>
              <Label className="text-xs">{t("Komponen Upah (payslip) *", "Wage Component (payslip) *")}</Label>
              <Select value={wageComponentId} onValueChange={setWageComponentId}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("cth: Benefit Medis", "e.g. Medical Benefit")} /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {(compsApi.data?.components ?? []).filter((c) => c.type === "Earning").map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                {t("Komponen muncul di payslip & jurnal saat klaim dijadwalkan; klaim karyawan di period yang sama otomatis dijumlahkan.", "The component appears on the payslip & journal when the claim is scheduled; claims of the same employee in the same period are summed automatically.")}
              </p>
            </div>
          )}
          <div>
            <Label className="text-xs">{t("Deskripsi")}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              placeholder={t("Ketentuan benefit (cth: hanya rawat jalan)", "Benefit terms (e.g. outpatient only)")} className="mt-1.5 text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="bg-brand font-bold hover:bg-brand/70">{busy ? t("Menyimpan…") : editing ? t("Simpan") : t("Buat Jenis", "Create Type")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">{label}</p>
        <p className="text-[10px] text-slate-400">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

// ============ DIALOG TOLAK ============

function RejectDialog({ claim, onClose, onDone }: { claim: BenefitClaimRow | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!claim) return;
    if (!reason.trim()) { toast.error(t("Alasan penolakan wajib diisi", "Rejection reason is required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/benefit-claims", "PATCH", { id: claim.id, action: "reject", reason: reason.trim() });
      toast.success(t("Klaim {no} ditolak", "Claim {no} rejected", { no: claim.claimNo }));
      setReason("");
      onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!claim} onOpenChange={(v) => { if (!v) { setReason(""); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><XCircle className="h-4 w-4 text-rose-500" /> {t("Tolak Klaim {no}", "Reject Claim {no}", { no: claim?.claimNo ?? "" })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-xs text-slate-500">
            {claim?.employee.fullName} · {claim?.benefitType.name} · {claim ? fmtIDR(claim.amount) : ""}
          </p>
          <div>
            <Label className="text-xs">{t("Alasan Penolakan *", "Rejection Reason *")}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder={t("cth: melebihi limit bulan ini & bukti tidak lengkap", "e.g. over this month's limit & incomplete evidence")} className="mt-1.5 text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="bg-rose-600 font-bold hover:bg-rose-700">{busy ? t("Menolak…", "Rejecting…") : t("Tolak Klaim", "Reject Claim")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ DIALOG JADWALKAN KE PERIOD ============

function ScheduleDialog({ claim, onClose, onDone }: { claim: BenefitClaimRow | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const periodsApi = useApi<{ periods: PeriodRow[] }>(claim ? "/api/rekankerja/payroll-periods" : null);
  const [periodId, setPeriodId] = useState("");
  const [busy, setBusy] = useState(false);
  const periods = (periodsApi.data?.periods ?? []).filter((p) => p.status === "Open" || p.status === "Processed");

  const submit = async () => {
    if (!claim) return;
    if (!periodId) { toast.error(t("Pilih period payroll", "Select a payroll period")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/benefit-claims", "PATCH", { id: claim.id, action: "schedule", periodId });
      toast.success(t('Klaim {no} dijadwalkan — buat run jenis "Benefit" lalu konfirmasi utk membayar', 'Claim {no} scheduled — create a "Benefit" run then confirm to pay', { no: claim.claimNo }));
      setPeriodId("");
      onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!claim} onOpenChange={(v) => { if (!v) { setPeriodId(""); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-brand" /> {t("Jadwalkan {no}", "Schedule {no}", { no: claim?.claimNo ?? "" })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-xs text-slate-500">
            {claim?.employee.fullName} · {claim?.benefitType.name} · {claim ? fmtIDR(claim.amount) : ""}
          </p>
          <div>
            <Label className="text-xs">{t("Period Payroll *", "Payroll Period *")}</Label>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("pilih period", "select period")} /></SelectTrigger>
              <SelectContent className="max-h-52">
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{loc(p.name)} · {t(PERIOD_STATUS_LABEL[p.status] ?? p.status, PERIOD_STATUS_LABEL_EN[p.status] ?? p.status)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="rounded-xl bg-brand/10 px-3.5 py-2.5 text-[11px] leading-relaxed font-semibold text-brand-deep dark:bg-brand/10 dark:text-brand/85">
            {t("Klaim menjadi komponen upah period ini (run jenis ", "The claim becomes a wage component of this period (a ")}
            <b>{t("Benefit")}</b>{t("). Konfirmasi run tersebut agar klaim otomatis berstatus Dibayar + jurnal terposting.", " run). Confirm that run so the claim automatically becomes Paid + the journal is posted.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="bg-brand font-bold hover:bg-brand/70">{busy ? t("Menjadwalkan…", "Scheduling…") : t("Jadwalkan", "Schedule")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
