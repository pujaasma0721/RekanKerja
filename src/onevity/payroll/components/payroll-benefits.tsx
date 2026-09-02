"use client";
// OneVity Payroll — Benefit Karyawan (P5): klaim dgn limit per siklus reset,
// auto-approve dalam limit, approval manual, jadwal bayar via run BENEFIT
// (pay-in-payroll) atau kas langsung + master jenis benefit.
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort, fmtDate } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
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
  Stethoscope, Glasses, Dumbbell, PartyPopper, Sparkles, Landmark, Ban, FileText, ChevronRight,
} from "lucide-react";
import { BenefitTypeRow, BenefitClaimRow, BenefitStats, PeriodRow, WageCompFull } from "@/onevity/payroll/components/payroll-types";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Pending", label: "Pending" },
  { key: "Approved", label: "Disetujui" },
  { key: "Scheduled", label: "Terjadwal" },
  { key: "Paid", label: "Dibayar" },
  { key: "Rejected", label: "Ditolak" },
];

const CATEGORY_ICON: Record<string, React.ElementType> = {
  Medical: Stethoscope, Kesehatan: Glasses, Transport: Landmark,
  Rekreasi: Dumbbell, Perayaan: PartyPopper,
};

const RESET_LABEL: Record<string, string> = {
  None: "sekali seumur pakai", Monthly: "per bulan", Quarterly: "per kuartal", Yearly: "per tahun",
};

export function PayrollBenefitsPage() {
  const [tab, setTab] = useState("claims");
  const [claimDialog, setClaimDialog] = useState(false);
  const [typeDialog, setTypeDialog] = useState(false);
  const [editType, setEditType] = useState<BenefitTypeRow | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [rejectTarget, setRejectTarget] = useState<BenefitClaimRow | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<BenefitClaimRow | null>(null);

  const claimsApi = useApi<{ claims: BenefitClaimRow[]; stats: BenefitStats }>(`/api/onevity/benefit-claims?status=${statusFilter}`);
  const typesApi = useApi<{ types: BenefitTypeRow[] }>("/api/onevity/benefit-types");
  const stats = claimsApi.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Benefit Karyawan"
        description="Klaim dengan limit per siklus, auto-approve dalam limit, dan pembayaran terintegrasi run payroll BENEFIT atau kas langsung"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditType(null); setTypeDialog(true); }} className="gap-2 font-bold">
              <Sparkles className="h-4 w-4 text-violet-600" /> Jenis Benefit
            </Button>
            <Button onClick={() => setClaimDialog(true)} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> Ajukan Klaim
            </Button>
          </div>
        }
      />

      {/* KPI */}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          icon={<XCircle className="h-4 w-4" />} tone="amber"
          label="Menunggu Persetujuan"
          value={String(stats?.pending ?? 0)}
          sub={stats ? `${fmtIDR(stats.pendingAmount)} menunggu keputusan` : undefined}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald"
          label="Disetujui (siap jadwal)"
          value={String((stats?.approvedCount ?? 0) - (stats?.scheduledCount ?? 0))}
          sub={stats ? fmtIDR(stats.approvedAmount) : undefined}
        />
        <KpiCard
          icon={<CalendarClock className="h-4 w-4" />} tone="violet"
          label="Terjadwal di Payroll"
          value={String(stats?.scheduledCount ?? 0)}
          sub="dibayar saat run BENEFIT dikonfirmasi"
        />
        <KpiCard
          icon={<Wallet className="h-4 w-4" />} tone="teal"
          label="Dibayar Tahun Ini"
          value={stats ? fmtIDRShort(stats.ytdAmount) : "—"}
          sub={stats ? `${stats.paidCount} klaim lunas` : undefined}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
          <TabsTrigger value="claims" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <HeartHandshake className="h-3.5 w-3.5" /> Klaim ({claimsApi.data?.claims.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="types" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" /> Jenis Benefit ({typesApi.data?.types.length ?? 0})
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
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-400"
                    : "border-stone-200 bg-white text-stone-500 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-0">
              {claimsApi.loading && !claimsApi.data ? (
                <div className="p-4"><LoadingRows rows={5} /></div>
              ) : (claimsApi.data?.claims.length ?? 0) === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="Belum ada klaim"
                    description="Ajukan klaim benefit karyawan — klaim dalam limit bisa otomatis disetujui."
                    icon={<HeartHandshake className="h-6 w-6" />}
                  />
                </div>
              ) : (
                <div className="max-h-[560px] overflow-y-auto overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                        <TableHead className="text-[11px] font-bold">Klaim</TableHead>
                        <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                        <TableHead className="text-[11px] font-bold">Jenis Benefit</TableHead>
                        <TableHead className="text-[11px] font-bold">Tanggal</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Nilai</TableHead>
                        <TableHead className="text-[11px] font-bold">Limit</TableHead>
                        <TableHead className="text-[11px] font-bold">Status</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(claimsApi.data?.claims ?? []).map((c) => (
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
            <Card className="rounded-2xl border-stone-200/80 dark:border-stone-800">
              <CardContent className="p-5">
                <EmptyState
                  title="Belum ada jenis benefit"
                  description="Buat jenis benefit: medical, kacamata, olahraga, pernikahan, dst."
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
    </div>
  );
}

function KpiCard({ icon, tone, label, value, sub }: {
  icon: React.ReactNode; tone: "amber" | "emerald" | "violet" | "teal";
  label: string; value: string; sub?: string;
}) {
  const tones: Record<string, string> = {
    amber: "from-amber-500 to-orange-500",
    emerald: "from-emerald-500 to-teal-600",
    violet: "from-violet-500 to-purple-600",
    teal: "from-teal-500 to-emerald-600",
  };
  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", tones[tone])}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
          <p className="truncate text-[15px] font-extrabold text-stone-800 dark:text-stone-100">{value}</p>
          {sub && <p className="truncate text-[10px] text-stone-400">{sub}</p>}
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
  const [busy, setBusy] = useState("");

  const act = async (key: string, action: string, extra?: Record<string, unknown>, okMsg?: string) => {
    setBusy(key);
    try {
      await apiSend("/api/onevity/benefit-claims", "PATCH", { id: claim.id, action, ...extra });
      toast.success(okMsg ?? "Klaim diperbarui");
      onChanged();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };

  const CatIcon = CATEGORY_ICON[claim.benefitType.category] ?? HeartHandshake;

  return (
    <TableRow className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
      <TableCell>
        <p className="font-mono text-[12px] font-bold text-stone-700 dark:text-stone-200">{claim.claimNo}</p>
        {claim.description && <p className="max-w-52 truncate text-[10px] text-stone-400">{claim.description}</p>}
      </TableCell>
      <TableCell>
        <p className="text-[13px] font-bold">{claim.employee.fullName}</p>
        <p className="font-mono text-[10px] text-stone-400">{claim.employee.employeeNo}</p>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
            <CatIcon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{claim.benefitType.name}</p>
            <p className="text-[10px] text-stone-400">
              {RESET_LABEL[claim.benefitType.resetPeriod] ?? claim.benefitType.resetPeriod}
              {claim.benefitType.unlimited ? " · tanpa limit" : ` · limit ${fmtIDRShort(claim.benefitType.maxClaimAmount)}`}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-xs text-stone-500">{fmtDate(claim.claimDate)}</TableCell>
      <TableCell className="text-right text-xs font-bold">{fmtIDR(claim.amount)}</TableCell>
      <TableCell>
        {claim.benefitType.unlimited ? (
          <Badge variant="outline" className="text-[9px] font-bold text-stone-500">Tanpa Limit</Badge>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className={cn(
                "cursor-help text-[9px] font-bold",
                claim.inLimit
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                  : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
              )}>
                {claim.inLimit ? "Dalam Limit" : claim.status === "Rejected" ? "Melebihi Limit" : "Over (diizinkan)"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">
              Terpakai {fmtIDR(claim.limitUsed)} · sisa {fmtIDR(claim.limitRemaining)} saat pengajuan
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
          <p className="mt-1 text-[10px] font-semibold text-violet-600 dark:text-violet-400">{claim.period.name}</p>
        )}
        {claim.status === "Paid" && (
          <p className="mt-1 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">{claim.paidRunNo ?? "via kas"}</p>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-1">
          {claim.status === "Pending" && (
            <>
              <Button size="sm" disabled={busy === "a"} onClick={() => act("a", "approve", {}, `Klaim ${claim.claimNo} disetujui`)}
                className="h-7 gap-1 rounded-lg bg-emerald-600 px-2.5 text-[10px] font-bold hover:bg-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Setujui
              </Button>
              <Button size="sm" variant="outline" disabled={busy === "r"} onClick={onReject}
                className="h-7 gap-1 rounded-lg px-2.5 text-[10px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10">
                <XCircle className="h-3 w-3" /> Tolak
              </Button>
            </>
          )}
          {claim.status === "Approved" && (
            claim.benefitType.payInPayroll ? (
              <Button size="sm" disabled={busy === "s"} onClick={onSchedule}
                className="h-7 gap-1 rounded-lg bg-violet-600 px-2.5 text-[10px] font-bold hover:bg-violet-700">
                <CalendarClock className="h-3 w-3" /> Jadwalkan
              </Button>
            ) : (
              <Button size="sm" disabled={busy === "p"} onClick={() => act("p", "markPaid", undefined, `Klaim ${claim.claimNo} lunas dari kas`)}
                className="h-7 gap-1 rounded-lg bg-teal-600 px-2.5 text-[10px] font-bold hover:bg-teal-700">
                <Wallet className="h-3 w-3" /> Tandai Lunas
              </Button>
            )
          )}
          {claim.status === "Scheduled" && claim.period && (
            <button
              onClick={() => navigate("payroll", "runs", { period: claim.periodId ?? undefined })}
              className="flex h-7 items-center gap-1 rounded-lg border border-violet-200 bg-white px-2.5 text-[10px] font-bold text-violet-700 hover:bg-violet-50 dark:border-violet-500/30 dark:bg-stone-900 dark:text-violet-400 dark:hover:bg-violet-500/10"
            >
              Lihat Run <ChevronRight className="h-3 w-3" />
            </button>
          )}
          {["Pending", "Approved", "Scheduled"].includes(claim.status) && (
            <button
              disabled={busy === "c"}
              onClick={() => {
                if (!window.confirm(`Batalkan klaim ${claim.claimNo} (${claim.employee.fullName})?`)) return;
                act("c", "cancel", undefined, `Klaim ${claim.claimNo} dibatalkan`);
              }}
              className="rounded-lg p-1.5 text-stone-300 hover:bg-stone-100 hover:text-stone-500 dark:hover:bg-stone-800"
              aria-label="Batalkan"
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

function TypeCard({ type, onEdit, onChanged }: {
  type: BenefitTypeRow; onEdit: () => void; onChanged: () => void;
}) {
  const Icon = CATEGORY_ICON[type.category] ?? Sparkles;
  const toggleActive = async () => {
    try {
      await apiSend("/api/onevity/benefit-types", "PATCH", { id: type.id, active: !type.active });
      toast.success(type.active ? `${type.name} dinonaktifkan` : `${type.name} diaktifkan`);
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card className={cn("rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800", !type.active && "opacity-60")}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[14px] font-bold">{type.name}</p>
              <Badge variant="outline" className="shrink-0 text-[9px] font-bold text-violet-600 dark:text-violet-400">{type.category}</Badge>
            </div>
            <p className="font-mono text-[10px] text-stone-400">{type.code} · {RESET_LABEL[type.resetPeriod] ?? type.resetPeriod}</p>
            {type.description && <p className="mt-1 text-[11px] leading-snug text-stone-500 dark:text-stone-400">{type.description}</p>}
          </div>
        </div>
        <div className="mt-3 rounded-xl bg-stone-50 px-3.5 py-2.5 dark:bg-stone-900/60">
          <p className="text-[11px] font-bold text-stone-700 dark:text-stone-200">
            {type.unlimited || type.maxClaimAmount <= 0
              ? "Tanpa limit nominal"
              : <>Limit {fmtIDR(type.maxClaimAmount)} <span className="font-normal text-stone-400">{RESET_LABEL[type.resetPeriod] ?? type.resetPeriod}</span></>}
          </p>
          <p className="mt-0.5 text-[10px] text-stone-400">
            {type.activeClaimCount} klaim aktif · total {fmtIDR(type.totalApprovedAmount)}
            {type.wageComponent && <> · komponen <b className="font-semibold">{type.wageComponent.code}</b></>}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {type.autoApproveInLimit && (
            <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-[9px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"><CheckCircle2 className="h-2.5 w-2.5" /> Auto-approve dalam limit</Badge>
          )}
          <Badge variant="outline" className="gap-1 border-violet-300 bg-violet-50 text-[9px] font-bold text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400">
            {type.payInPayroll ? <><CalendarClock className="h-2.5 w-2.5" /> Pay-in-payroll (BENEFIT)</> : <><Wallet className="h-2.5 w-2.5" /> Kas langsung</>}
          </Badge>
          {type.needDocuments && <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-[9px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"><FileText className="h-2.5 w-2.5" /> Perlu dokumen</Badge>}
          {type.allowOverlimit && <Badge variant="outline" className="text-[9px] font-bold text-stone-500">Boleh overlimit</Badge>}
          {type.entitleFor !== "All" && <Badge variant="outline" className="text-[9px] font-bold text-stone-500">{type.entitleFor} saja</Badge>}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} className="h-7 gap-1 rounded-lg px-2.5 text-[10px] font-bold">
            <Pencil className="h-3 w-3" /> Ubah
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleActive} className="h-7 gap-1 rounded-lg px-2.5 text-[10px] font-bold text-stone-500">
            {type.active ? "Nonaktifkan" : "Aktifkan"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============ DIALOG AJUKAN KLAIM ============

function ClaimDialog({ open, onClose, onSubmitted }: { open: boolean; onClose: () => void; onSubmitted: () => void }) {
  const employeesApi = useApi<{ employees: { employeeId: string; fullName: string; employeeNo: string }[] }>(open ? "/api/onevity/payroll-profiles" : null);
  const [employeeId, setEmployeeId] = useState("");
  const [benefitTypeId, setBenefitTypeId] = useState("");
  const [amount, setAmount] = useState("");
  const [claimDate, setClaimDate] = useState("");
  const [description, setDescription] = useState("");
  const [documentsNote, setDocumentsNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Snapshot limit live per karyawan terpilih (fallback: daftar master).
  const usageApi = useApi<{ types: BenefitTypeRow[] }>(open && employeeId ? `/api/onevity/benefit-types?employeeId=${employeeId}` : null);
  const allTypesApi = useApi<{ types: BenefitTypeRow[] }>(open ? "/api/onevity/benefit-types" : null);
  const typeList = employeeId ? (usageApi.data?.types ?? []) : (allTypesApi.data?.types ?? []);
  const selected = typeList.find((t) => t.id === benefitTypeId);
  const amt = Number(amount) || 0;
  const usage = selected?.usage;

  const submit = async () => {
    if (!employeeId || !benefitTypeId || amt <= 0) { toast.error("Lengkapi karyawan, jenis benefit & nilai klaim"); return; }
    if (selected?.needDocuments && !documentsNote.trim()) { toast.error("Jenis benefit ini mewajibkan keterangan dokumen"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ note: string }>("/api/onevity/benefit-claims", "POST", {
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><HeartHandshake className="h-4 w-4 text-violet-600" /> Ajukan Klaim Benefit</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Karyawan *</Label>
            <Select value={employeeId} onValueChange={(v) => { setEmployeeId(v); setBenefitTypeId(""); }}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
              <SelectContent className="max-h-52">
                {(employeesApi.data?.employees ?? []).map((e) => (
                  <SelectItem key={e.employeeId} value={e.employeeId}>{e.employeeNo} — {e.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Jenis Benefit *</Label>
            <Select value={benefitTypeId} onValueChange={setBenefitTypeId} disabled={!employeeId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={employeeId ? "Pilih jenis benefit" : "Pilih karyawan dulu"} /></SelectTrigger>
              <SelectContent className="max-h-52">
                {typeList.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{!t.unlimited && t.maxClaimAmount > 0 ? ` — limit ${fmtIDRShort(t.maxClaimAmount)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nilai Klaim (Rp) *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="450000" className="mt-1.5 font-mono" />
            </div>
            <div>
              <Label className="text-xs">Tanggal Klaim</Label>
              <Input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Keterangan</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="cth: Medical check-up klinik" className="mt-1.5" />
          </div>
          {selected?.needDocuments && (
            <div>
              <Label className="text-xs">Dokumen Pendukung *</Label>
              <Textarea value={documentsNote} onChange={(e) => setDocumentsNote(e.target.value)} rows={2}
                placeholder="cth: kwitansi klinik #RCP-881, resep obat" className="mt-1.5 text-xs" />
            </div>
          )}
          {selected && usage && (
            <p className={cn(
              "rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed font-semibold",
              usage.limit === null
                ? "bg-stone-50 text-stone-600 dark:bg-stone-900 dark:text-stone-400"
                : usage.inLimit && amt <= (usage.remaining ?? 0)
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
            )}>
              {usage.limit === null
                ? "Jenis ini tanpa limit nominal."
                : <>Siklus {usage.windowLabel}: terpakai {fmtIDR(usage.used)} · sisa {fmtIDR(usage.remaining ?? 0)}
                  {amt > 0 && <> · klaim ini <b>{usage.inLimit && amt <= (usage.remaining ?? 0) ? "dalam limit" : (selected.allowOverlimit ? "MELEBIHI limit (butuh approval manual)" : "akan DITOLAK — melebihi limit")}</b></>}
                </>}
              {selected.autoApproveInLimit && <span className="block font-normal">Auto-approve aktif: klaim dalam limit langsung disetujui sistem.</span>}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Mengirim…" : "Ajukan Klaim"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ DIALOG JENIS BENEFIT (buat/ubah) ============

function TypeDialog({ open, editing, onClose, onSaved }: {
  open: boolean; editing: BenefitTypeRow | null; onClose: () => void; onSaved: () => void;
}) {
  const compsApi = useApi<{ components: WageCompFull[] }>(open ? "/api/onevity/wage-components" : null);
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
    if (!editing && !code.trim()) { toast.error("Kode wajib diisi"); return; }
    if (!name.trim()) { toast.error("Nama wajib diisi"); return; }
    if (payInPayroll && !wageComponentId) { toast.error("Pay-in-payroll wajib memetakan komponen upah"); return; }
    if (!unlimited && !(Number(maxClaimAmount) > 0)) { toast.error("Isi limit nominal atau aktifkan tanpa limit"); return; }
    setBusy(true);
    try {
      const body = {
        code: code.trim().toUpperCase(), name: name.trim(), category, description: description.trim() || null,
        resetPeriod, maxClaimAmount: Number(maxClaimAmount) || 0, unlimited, allowOverlimit,
        needDocuments, autoApproveInLimit, payInPayroll,
        wageComponentId: wageComponentId || null, entitleFor,
      };
      if (editing) {
        await apiSend("/api/onevity/benefit-types", "PATCH", { id: editing.id, ...body });
        toast.success(`Jenis benefit ${body.name} diperbarui`);
      } else {
        await apiSend("/api/onevity/benefit-types", "POST", body);
        toast.success(`Jenis benefit ${body.code} dibuat`);
      }
      setInitialized(null);
      onSaved();
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setInitialized(null); onClose(); } }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-600" /> {editing ? `Ubah — ${editing.name}` : "Jenis Benefit Baru"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Kode *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!editing}
                placeholder="MEDICAL" className="mt-1.5 font-mono uppercase" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Nama *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reimburse Medis" className="mt-1.5" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Kategori</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Medical", "Kesehatan", "Transport", "Rekreasi", "Perayaan", "Lainnya"].map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Siklus Reset Limit</Label>
              <Select value={resetPeriod} onValueChange={setResetPeriod}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Monthly">Bulanan</SelectItem>
                  <SelectItem value="Quarterly">Kuartalan</SelectItem>
                  <SelectItem value="Yearly">Tahunan</SelectItem>
                  <SelectItem value="None">Sekali seumur pakai</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Limit per Siklus (Rp)</Label>
              <Input type="number" value={maxClaimAmount} disabled={unlimited} onChange={(e) => setMaxClaimAmount(e.target.value)}
                placeholder="2000000" className="mt-1.5 font-mono" />
            </div>
            <div>
              <Label className="text-xs">Hanya utk Status</Label>
              <Select value={entitleFor} onValueChange={setEntitleFor}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">Semua karyawan</SelectItem>
                  <SelectItem value="Permanent">Tetap</SelectItem>
                  <SelectItem value="Contract">Kontrak</SelectItem>
                  <SelectItem value="Probation">Percobaan</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-xl bg-stone-50 p-3.5 dark:bg-stone-900/60">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-stone-400">Perilaku</p>
            <div className="grid gap-2.5">
              <ToggleRow checked={unlimited} onChange={setUnlimited} label="Tanpa limit nominal" hint="Abaikan limit per siklus" />
              <ToggleRow checked={autoApproveInLimit} onChange={setAutoApproveInLimit} label="Auto-approve dalam limit" hint="Klaim ≤ limit langsung disetujui sistem" />
              <ToggleRow checked={allowOverlimit} onChange={setAllowOverlimit} label="Izinkan klaim melebihi limit" hint="Overlimit masuk approval manual" />
              <ToggleRow checked={needDocuments} onChange={setNeedDocuments} label="Wajib dokumen pendukung" hint="Keterangan dokumen saat pengajuan" />
              <ToggleRow checked={payInPayroll} onChange={setPayInPayroll} label="Bayar via payroll (pay-in-payroll)" hint="Dibayar saat run BENEFIT dikonfirmasi" />
            </div>
          </div>
          {payInPayroll && (
            <div>
              <Label className="text-xs">Komponen Upah (payslip) *</Label>
              <Select value={wageComponentId} onValueChange={setWageComponentId}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="cth: Benefit Medis" /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {(compsApi.data?.components ?? []).filter((c) => c.type === "Earning").map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[10px] leading-relaxed text-stone-400">
                Komponen muncul di payslip & jurnal saat klaim dijadwalkan; klaim karyawan di period yang sama otomatis dijumlahkan.
              </p>
            </div>
          )}
          <div>
            <Label className="text-xs">Deskripsi</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              placeholder="Ketentuan benefit (cth: hanya rawat jalan)" className="mt-1.5 text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-violet-600 font-bold hover:bg-violet-700">{busy ? "Menyimpan…" : editing ? "Simpan" : "Buat Jenis"}</Button>
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
        <p className="text-[10px] text-stone-400">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

// ============ DIALOG TOLAK ============

function RejectDialog({ claim, onClose, onDone }: { claim: BenefitClaimRow | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!claim) return;
    if (!reason.trim()) { toast.error("Alasan penolakan wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/benefit-claims", "PATCH", { id: claim.id, action: "reject", reason: reason.trim() });
      toast.success(`Klaim ${claim.claimNo} ditolak`);
      setReason("");
      onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!claim} onOpenChange={(v) => { if (!v) { setReason(""); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><XCircle className="h-4 w-4 text-rose-500" /> Tolak Klaim {claim?.claimNo}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-xs text-stone-500">
            {claim?.employee.fullName} · {claim?.benefitType.name} · {claim ? fmtIDR(claim.amount) : ""}
          </p>
          <div>
            <Label className="text-xs">Alasan Penolakan *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="cth: melebihi limit bulan ini & bukti tidak lengkap" className="mt-1.5 text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-rose-600 font-bold hover:bg-rose-700">{busy ? "Menolak…" : "Tolak Klaim"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ DIALOG JADWALKAN KE PERIOD ============

function ScheduleDialog({ claim, onClose, onDone }: { claim: BenefitClaimRow | null; onClose: () => void; onDone: () => void }) {
  const periodsApi = useApi<{ periods: PeriodRow[] }>(claim ? "/api/onevity/payroll-periods" : null);
  const [periodId, setPeriodId] = useState("");
  const [busy, setBusy] = useState(false);
  const periods = (periodsApi.data?.periods ?? []).filter((p) => p.status === "Open" || p.status === "Processed");

  const submit = async () => {
    if (!claim) return;
    if (!periodId) { toast.error("Pilih period payroll"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/benefit-claims", "PATCH", { id: claim.id, action: "schedule", periodId });
      toast.success(`Klaim ${claim.claimNo} dijadwalkan — buat run jenis "Benefit" lalu konfirmasi utk membayar`);
      setPeriodId("");
      onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!claim} onOpenChange={(v) => { if (!v) { setPeriodId(""); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-violet-600" /> Jadwalkan {claim?.claimNo}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <p className="text-xs text-stone-500">
            {claim?.employee.fullName} · {claim?.benefitType.name} · {claim ? fmtIDR(claim.amount) : ""}
          </p>
          <div>
            <Label className="text-xs">Period Payroll *</Label>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="pilih period" /></SelectTrigger>
              <SelectContent className="max-h-52">
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} · {p.status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="rounded-xl bg-violet-50 px-3.5 py-2.5 text-[11px] leading-relaxed font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">
            Klaim menjadi komponen upah period ini (run jenis <b>Benefit</b>). Konfirmasi run tersebut agar klaim otomatis berstatus Dibayar + jurnal terposting.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-violet-600 font-bold hover:bg-violet-700">{busy ? "Menjadwalkan…" : "Jadwalkan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
