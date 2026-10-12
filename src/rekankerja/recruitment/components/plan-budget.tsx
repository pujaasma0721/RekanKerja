"use client";
// RekanKerja Recruitment F5 — view "Rencana & Anggaran": dua seksi padanan
// oranHR RecruitmentPlanning §2.1 (formula a–h: c=(a)+(b), g=(d)+(e)−(f),
// h=(c)−(g) + rekonsiliasi PR requested/fulfilled/unfulfilled) dan
// RecruitmentBudget §2.2 (anggaran per periode vs realisasi biaya kanal
// lowongan — ringkasan DUA LEVEL per Job Opportunity + per Advertised PR).
import { Fragment, useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  Calculator, ChevronDown, ChevronRight, Coins, Filter, Pencil, Plus, RefreshCw,
  Send, Sigma, Trash2, Wallet, AlertTriangle, Unlink, ListTree, CheckCircle2,
} from "lucide-react";

const PLAN_API = "/api/rekankerja/recruitment/plan";
const BUDGET_API = "/api/rekankerja/recruitment/budget";

const SCROLL_CLS = "overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700";

// ---------- tipe (mirror kontrak API planning-service) ----------

interface PlanRow {
  id: string;
  period: string;
  seqNo: number;
  positionId: string | null;
  positionTitle: string;
  companyOfficeId: string | null;
  officeName: string | null;
  targetA: number;
  adjustB: number;
  totalC: number;
  empD: number;
  inE: number;
  outF: number;
  resultedG: number;
  toRecruitH: number;
  salaryBudget: number | null;
  basePeriod: string | null;
  status: "Draft" | "Applied";
  note: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  recon: { requested: number; fulfilled: number; unfulfilled: number; prCount: number; explicitCount: number };
}

interface PlanListResp {
  rows: PlanRow[];
  stats: { total: number; draft: number; applied: number; periods: string[]; headcountLive: number | null; sumH: number; sumFulfilled: number; outsideCount: number };
  outside: { prId: string; prNo: string; positionTitle: string | null; status: string; requiredNo: number; requestDate: string }[];
}

/** Baris drill-down PR penyumbang recon (PLAN-LINK — mirror service). */
interface PlanPrLine {
  prId: string;
  prNo: string;
  status: string;
  requiredNo: number;
  appointed: number;
  matchType: "explicit" | "auto";
  positionTitle: string | null;
  requestDate: string;
}

interface PlanOptionsResp {
  positions: { id: string; code: string; title: string; headcount: number }[];
  offices: { id: string; name: string; city: string | null }[];
}

interface BudgetMethodLine {
  id: string;
  methodName: string;
  costItemName: string | null;
  actual: number | null;
  planned: number | null;
  datePosted: string | null;
}

interface BudgetPrLine {
  prId: string;
  prNo: string;
  positionTitle: string | null;
  requiredNo: number;
  prStatus: string;
  actual: number;
}

interface BudgetJoLine {
  joId: string;
  refNo: string;
  title: string;
  status: string;
  datePrepared: string | null;
  planned: number;
  actual: number;
  methods: BudgetMethodLine[];
  prs: BudgetPrLine[];
}

interface BudgetRow {
  period: string;
  totalBudget: number | null;
  adjust: number | null;
  adjustBudget: number | null;
  used: number;
  unused: number | null;
  currency: string;
  note: string | null;
  updatedAt: string | null;
  perJO: BudgetJoLine[];
}

// ---------- form plan ----------

interface PlanForm {
  period: string;
  positionId: string;
  positionTitle: string;
  companyOfficeId: string;
  targetA: string;
  adjustB: string;
  empD: string;
  inE: string;
  outF: string;
  salaryBudget: string;
  basePeriod: string;
  note: string;
}

const emptyPlanForm = (period: string): PlanForm => ({
  period, positionId: "", positionTitle: "", companyOfficeId: "",
  targetA: "0", adjustB: "", empD: "", inE: "", outF: "", salaryBudget: "", basePeriod: "", note: "",
});

/** kolom formula a–h — header pendek + tooltip dwibahasa. */
const FORMULA_COLS: { key: keyof PlanRow; short: string; shortEn: string; tip: string; tipEn: string }[] = [
  { key: "targetA", short: "(a) Target", shortEn: "(a) Target", tip: "Target awal kebutuhan", tipEn: "Initial target headcount" },
  { key: "adjustB", short: "(b) Adj", shortEn: "(b) Adj", tip: "Penyesuaian", tipEn: "Adjustment" },
  { key: "totalC", short: "(c) Total", shortEn: "(c) Total", tip: "Total kebutuhan = (a)+(b)", tipEn: "Total need = (a)+(b)" },
  { key: "empD", short: "(d) Awal", shortEn: "(d) Start", tip: "Jumlah karyawan awal (headcount)", tipEn: "Starting employee headcount" },
  { key: "inE", short: "(e) Masuk", shortEn: "(e) In", tip: "Pergerakan masuk (promosi/rotasi masuk)", tipEn: "Inbound movements" },
  { key: "outF", short: "(f) Keluar", shortEn: "(f) Out", tip: "Pergerakan keluar (rotasi keluar/resign)", tipEn: "Outbound movements" },
  { key: "resultedG", short: "(g) Hasil", shortEn: "(g) Result", tip: "Hasil tersedia = (d)+(e)−(f)", tipEn: "Available = (d)+(e)−(f)" },
  { key: "toRecruitH", short: "(h) Rekrut", shortEn: "(h) Recruit", tip: "Harus direkrut = (c)−(g)", tipEn: "To recruit = (c)−(g)" },
];

// =====================================================================
// seksi A — rencana rekrutmen (formula a–h + rekonsiliasi PR)
// =====================================================================

function PlanSection() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();

  const [periodFilter, setPeriodFilter] = useState<string>(""); // "" = semua
  const listApi = useApi<PlanListResp>(`${PLAN_API}?list=1${periodFilter ? `&period=${encodeURIComponent(periodFilter)}` : ""}`, [periodFilter]);
  const optionsApi = useApi<PlanOptionsResp>(`${PLAN_API}?options=1`, []);

  const rows = listApi.data?.rows ?? [];
  const stats = listApi.data?.stats;
  const positions = optionsApi.data?.positions ?? [];
  const offices = optionsApi.data?.offices ?? [];

  const canCreate = perms.can("recruitment", "plan", "create");
  const canUpdate = perms.can("recruitment", "plan", "update");
  const canDelete = perms.can("recruitment", "plan", "delete");
  const canApply = perms.canOp("recruitment", "plan", "op:apply");

  // dialog form (create / edit)
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyPlanForm(String(new Date().getFullYear())));
  const [busy, setBusy] = useState(false);

  // PLAN-LINK — drill-down PR penyumbang recon + dialog PR di luar rencana
  const [prsTarget, setPrsTarget] = useState<PlanRow | null>(null);
  const [outsideOpen, setOutsideOpen] = useState(false);
  const prsApi = useApi<{ prs: PlanPrLine[] }>(prsTarget ? `${PLAN_API}?prs=${prsTarget.id}` : null, [prsTarget?.id]);
  const prsLines = prsApi.data?.prs ?? null;

  const refresh = () => { listApi.refresh(); optionsApi.refresh(); };

  const openCreate = () => {
    setEditId(null);
    setForm(emptyPlanForm(stats?.periods?.[0] ?? String(new Date().getFullYear())));
    setFormOpen(true);
  };

  const openEdit = (r: PlanRow) => {
    setEditId(r.id);
    setForm({
      period: r.period,
      positionId: r.positionId ?? "",
      positionTitle: r.positionTitle,
      companyOfficeId: r.companyOfficeId ?? "",
      targetA: String(r.targetA),
      adjustB: r.adjustB != null ? String(r.adjustB) : "",
      empD: r.empD != null ? String(r.empD) : "",
      inE: r.inE != null ? String(r.inE) : "",
      outF: r.outF != null ? String(r.outF) : "",
      salaryBudget: r.salaryBudget != null ? String(r.salaryBudget) : "",
      basePeriod: r.basePeriod ?? "",
      note: r.note ?? "",
    });
    setFormOpen(true);
  };

  const savePlan = async () => {
    if (!form.period.trim() || !form.positionTitle.trim()) {
      toast.error(t("Periode dan judul posisi wajib diisi", "Period and position title are required"));
      return;
    }
    const a = form.targetA === "" ? 0 : Number(form.targetA);
    if (!Number.isFinite(a) || a < 0) {
      toast.error(t("Target awal (a) harus ≥ 0", "Initial target (a) must be ≥ 0"));
      return;
    }
    setBusy(true);
    try {
      const body = {
        period: form.period.trim(),
        positionId: form.positionId || null,
        positionTitle: form.positionTitle.trim(),
        companyOfficeId: form.companyOfficeId || null,
        targetA: a,
        adjustB: form.adjustB === "" ? undefined : Number(form.adjustB),
        empD: form.empD === "" ? undefined : Number(form.empD),
        inE: form.inE === "" ? undefined : Number(form.inE),
        outF: form.outF === "" ? undefined : Number(form.outF),
        salaryBudget: form.salaryBudget === "" ? null : Number(form.salaryBudget),
        basePeriod: form.basePeriod || null,
        note: form.note || null,
      };
      if (editId) {
        await apiSend(PLAN_API, "PATCH", { action: "update", id: editId, ...body });
        toast.success(t("Rencana diperbarui", "Plan updated"));
      } else {
        const res = await apiSend<{ row: PlanRow }>(PLAN_API, "POST", body);
        toast.success(t(
          `Rencana #${res.row.seqNo} ${res.row.positionTitle} disimpan — (h) harus direkrut: ${res.row.toRecruitH}`,
          `Plan #${res.row.seqNo} ${res.row.positionTitle} saved — (h) to recruit: ${res.row.toRecruitH}`,
        ));
      }
      setFormOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan rencana", "Failed to save the plan"));
    } finally { setBusy(false); }
  };

  const doApply = async (r: PlanRow) => {
    if (!window.confirm(t(
      `Terapkan rencana #${r.seqNo} (${r.positionTitle}, periode ${r.period})? Baris jadi hanya-baca (Applied) dan terlihat oleh karyawan di Portal Karyawan.`,
      `Apply plan #${r.seqNo} (${r.positionTitle}, period ${r.period})? The row becomes read-only (Applied) and visible to employees in the Employee Portal.`,
    ))) return;
    try {
      await apiSend(PLAN_API, "PATCH", { action: "apply", id: r.id });
      toast.success(t(`Rencana #${r.seqNo} diterapkan`, `Plan #${r.seqNo} applied`));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menerapkan rencana", "Failed to apply the plan"));
    }
  };

  const doSync = async (r: PlanRow) => {
    try {
      const res = await apiSend<{ empD: number }>(PLAN_API, "PATCH", { action: "sync-headcount", id: r.id });
      toast.success(t(
        `Jumlah karyawan awal (d) disinkronkan: ${res.empD}`,
        `Starting headcount (d) synced: ${res.empD}`,
      ));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal sinkron headcount", "Failed to sync the headcount"));
    }
  };

  const doDelete = async (r: PlanRow) => {
    if (!window.confirm(t(`Hapus rencana Draft #${r.seqNo} (${r.positionTitle})?`, `Delete Draft plan #${r.seqNo} (${r.positionTitle})?`))) return;
    try {
      await apiSend(`${PLAN_API}?id=${r.id}`, "DELETE");
      toast.success(t(`Rencana #${r.seqNo} dihapus`, `Plan #${r.seqNo} deleted`));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus rencana", "Failed to delete the plan"));
    }
  };

  const periodOptions = stats?.periods?.length ? stats.periods : [String(new Date().getFullYear())];
  const outsideLines = listApi.data?.outside ?? [];

  return (
    <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Calculator className="h-4 w-4 ov-text-accent" aria-hidden />
          {t("Rencana Rekrutmen (formula a–h)", "Recruitment Plan (formula a–h)")}
          <Badge variant="secondary" className="font-mono">{rows.length}</Badge>
          {canCreate && (
            <Button size="sm" className="ov-fill ml-auto h-8 gap-1 px-2" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Rencana Baru", "New Plan")}
            </Button>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          {t(
            "Padanan RecruitmentPlanning oranHR §2.1 — (a) target awal + (b) penyesuaian → (c) total kebutuhan; (d) karyawan awal + (e) masuk − (f) keluar → (g) hasil tersedia; (h) = (c)−(g) yang harus direkrut, direkonsiliasi dengan PR berjalan.",
            "oranHR RecruitmentPlanning §2.1 equivalent — (a) initial target + (b) adjustment → (c) total need; (d) starting headcount + (e) in − (f) out → (g) available; (h) = (c)−(g) to recruit, reconciled with running PRs.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* chips statistik + pemilih periode */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {([
            { key: "total", label: "Total Rencana", labelEn: "Total Plans", value: stats?.total },
            { key: "applied", label: "Applied", labelEn: "Applied", value: stats?.applied },
            { key: "draft", label: "Draft", labelEn: "Draft", value: stats?.draft },
          ] as { key: string; label: string; labelEn: string; value: number | undefined }[]).map((c) => (
            <div key={c.key}
              className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80"
              title={t("total seluruh periode (tanpa filter)", "total across all periods (unfiltered)")}>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(c.label, c.labelEn)}</div>
              <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{c.value ?? 0}</div>
            </div>
          ))}
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Periode", "Period")}</div>
            <Select value={periodFilter || "__all__"} onValueChange={(v) => setPeriodFilter(v === "__all__" ? "" : v)}>
              <SelectTrigger className="mt-0.5 h-8 text-sm font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="__all__">{t("Semua periode", "All periods")}</SelectItem>
                {periodOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-end rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[11px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 sm:col-span-2 xl:col-span-3">
            <Sigma className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="font-mono tabular-nums">c=(a)+(b) · g=(d)+(e)−(f) · h=(c)−(g)</span>
          </div>
        </div>

        {/* PLAN-LINK — banner PR di luar rencana (hanya bila ada) */}
        {(listApi.data?.stats?.outsideCount ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setOutsideOpen(true)}
            className="mb-4 flex w-full items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-left text-xs text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <b className="tabular-nums">{listApi.data?.stats?.outsideCount}</b>{" "}
              {t("PR aktif tidak terhubung ke rencana MPP mana pun — tidak terhitung dalam capaian perencanaan (klik untuk detail).", "active requisitions are not linked to any manpower plan — not counted in planning achievement (click for details).")}
            </span>
          </button>
        )}

        {listApi.loading && !listApi.data ? (
          <LoadingRows rows={4} />
        ) : listApi.error ? (
          <EmptyState title={t("Gagal memuat rencana rekrutmen", "Failed to load the recruitment plan")} description={listApi.error} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Calculator}
            title={t("Belum ada rencana rekrutmen", "No recruitment plans yet")}
            description={t(
              "Buat baris rencana per periode — pilih posisi & kantor, isi target (a) dan pergerakan (d/e/f), sisanya dihitung otomatis.",
              "Create a plan row per period — pick a position & office, fill target (a) and movements (d/e/f), the rest is computed automatically.",
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1240px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>{t("Periode", "Period")}</TableHead>
                  <TableHead>{t("Posisi", "Position")}</TableHead>
                  {FORMULA_COLS.map((c) => (
                    <TableHead key={String(c.key)} className="text-center" title={t(c.tip, c.tipEn)}>
                      <span className={cn(c.key === "toRecruitH" && "text-emerald-700 dark:text-emerald-400")}>
                        {t(c.short, c.shortEn)}
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="text-center" title={t("PR diajukan / terpenuhi / belum terpenuhi", "PRs requested / fulfilled / unfulfilled")}>
                    {t("Rekonsiliasi PR", "PR Recon")}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">{t("Anggaran Gaji", "Salary Budget")}</TableHead>
                  <TableHead>{t("Status", "Status")}</TableHead>
                  <TableHead className="w-52 text-right">{t("Aksi", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const draft = r.status === "Draft";
                  return (
                    <TableRow key={r.id} className={cn(!draft && "opacity-80")} title={r.note ?? undefined}>
                      <TableCell className="text-center font-mono text-xs font-semibold tabular-nums">{r.seqNo}</TableCell>
                      <TableCell className="font-mono text-xs">{r.period}</TableCell>
                      <TableCell>
                        <div className="max-w-[180px] truncate text-[13px] font-semibold" title={r.positionTitle}>{r.positionTitle}</div>
                        {r.officeName && <div className="text-[10px] text-slate-500 dark:text-slate-400">{r.officeName}</div>}
                        {r.basePeriod && <div className="text-[10px] text-slate-400">{t("basis", "base")}: {r.basePeriod}</div>}
                      </TableCell>
                      {FORMULA_COLS.map((c) => {
                        const v = r[c.key] as number;
                        return (
                          <TableCell key={String(c.key)} className={cn(
                            "text-center tabular-nums",
                            c.key === "toRecruitH" && "bg-emerald-50/60 font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
                            c.key === "totalC" && "font-semibold",
                          )}>
                            {v}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center">
                        {/* PLAN-LINK — recon v2: klik utk drill-down PR penyumbang */}
                        <button
                          type="button"
                          onClick={() => setPrsTarget(r)}
                          title={t("Lihat PR yang melayani rencana ini", "View the requisitions serving this plan")}
                          className="rounded-md px-1 py-0.5 font-mono text-xs font-semibold tabular-nums underline-offset-2 hover:underline"
                        >
                          <span className={cn(
                            r.recon.unfulfilled > 0 ? "text-amber-700 dark:text-amber-400" : "text-slate-600 dark:text-slate-300",
                          )}>
                            {r.recon.requested}/{r.recon.fulfilled}/{r.recon.unfulfilled}
                          </span>
                          <span className="ml-1 inline-flex items-center gap-0.5 align-middle text-[10px] font-normal text-slate-400">
                            <ListTree className="h-3 w-3" aria-hidden />
                            {t("PR {n}", "PR {n}", { n: String(r.recon.prCount) })}
                          </span>
                        </button>
                        {/* capaian vs h — hijau tercapai / amber berjalan / rose melampaui */}
                        {(() => {
                          const h = r.toRecruitH;
                          const req = r.recon.requested;
                          const ful = r.recon.fulfilled;
                          if (h <= 0 && req > 0) {
                            return (
                              <div className="mt-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400"
                                title={t(`PR diajukan ${req} orang padahal kebutuhan rencana h=0 — hiring di luar rencana`, `${req} headcount requested although the plan's need is h=0 — hiring beyond the plan`)}>
                                {t("melampaui rencana", "over plan")} · PR {req} &gt; h {h}
                              </div>
                            );
                          }
                          if (h > 0 && ful >= h) {
                            return (
                              <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"
                                title={t("Target MPP tercapai dari sisi requisition", "Manpower plan target achieved from the requisition side")}>
                                <CheckCircle2 className="h-3 w-3" aria-hidden /> {t("capaian", "achieved")} {ful}/{h} h
                              </div>
                            );
                          }
                          if (h > 0 && req === 0) {
                            return (
                              <div className="mt-0.5 text-[10px] text-slate-400"
                                title={t("Kebutuhan (h) belum diajukan sebagai PR", "The need (h) has not been requested as a PR yet")}>
                                {t("belum ada PR", "no PRs yet")} (h {h})
                              </div>
                            );
                          }
                          if (h > 0) {
                            return (
                              <div className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                                title={t(`Capaian ${ful}/${h} — PR diajukan ${req} dari h ${h}`, `Achieved ${ful}/${h} — ${req} of h ${h} requested`)}>
                                {t("capaian", "achieved")} {ful}/{h} h{req < h ? t(" · PR {r}/{h}", " · PRs {r}/{h}", { r: String(req), h: String(h) }) : ""}
                              </div>
                            );
                          }
                          return <div className="mt-0.5 text-[10px] text-slate-400">—</div>;
                        })()}
                      </TableCell>
                      <TableCell className="hidden tabular-nums lg:table-cell">
                        {r.salaryBudget != null ? (
                          <span className="text-xs font-semibold">{fmtIDR(r.salaryBudget)}</span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {draft ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-500/10 dark:text-slate-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden /> {t("Draft", "Draft")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> Applied
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {draft ? (
                            <>
                              {canUpdate && (
                                <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={() => openEdit(r)}>
                                  <Pencil className="h-3.5 w-3.5" aria-hidden /> {t("Edit", "Edit")}
                                </Button>
                              )}
                              {canApply && (
                                <Button size="sm" className="ov-fill h-8 gap-1 px-2" onClick={() => doApply(r)}>
                                  <Send className="h-3.5 w-3.5" aria-hidden /> {t("Terapkan", "Apply")}
                                </Button>
                              )}
                              {canUpdate && (
                                <Button variant="outline" size="sm" className="h-8 gap-1 px-2" title={t("Sinkron (d) dari headcount karyawan aktif", "Sync (d) from active employee headcount")} onClick={() => doSync(r)}>
                                  <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t("Sinkron (d)", "Sync (d)")}
                                </Button>
                              )}
                              {canDelete && (
                                <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => doDelete(r)}>
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("Hapus", "Delete")}
                                </Button>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-400">{t("hanya-baca", "read-only")}</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
          <Filter className="h-3.5 w-3.5" aria-hidden />
          {t(
            "Rekonsiliasi = PR (diajukan/terpenuhi/belum) pada posisi & kantor yang sama — amber bila masih ada yang belum terpenuhi. Anggaran gaji tersimpan terenkripsi (brankas uang).",
            "Reconciliation = PRs (requested/fulfilled/unfulfilled) for the same position & office — amber when some remain unfulfilled. Salary budget is stored encrypted (money vault).",
          )}
        </p>
      </CardContent>

      {/* ===== dialog form rencana ===== */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) setFormOpen(false); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editId ? t("Ubah Rencana Rekrutmen", "Edit Recruitment Plan") : t("Rencana Rekrutmen Baru", "New Recruitment Plan")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("Periode *", "Period *")}</Label>
              <Input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="2026" />
              <p className="text-[10px] text-slate-400">{t("bebas — umumnya tahun (2026) atau bulan (2026-01)", "free-form — usually a year (2026) or month (2026-01)")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Posisi (master)", "Position (master)")}</Label>
              <Select
                value={form.positionId || "__none__"}
                onValueChange={(v) => {
                  const p = positions.find((x) => x.id === v);
                  setForm({
                    ...form,
                    positionId: v === "__none__" ? "" : v,
                    positionTitle: p ? p.title : form.positionTitle,
                  });
                }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className={cn("max-h-64", SCROLL_CLS)}>
                  <SelectItem value="__none__">{t("— pilih sendiri (teks bebas) —", "— free text (no master) —")}</SelectItem>
                  {positions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}{p.code ? ` (${p.code})` : ""} · {t("headcount {n}", "headcount {n}", { n: String(p.headcount) })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Judul Posisi *", "Position Title *")}</Label>
              <Input value={form.positionTitle} onChange={(e) => setForm({ ...form, positionTitle: e.target.value })}
                placeholder={t("mis. QA Staff", "e.g. QA Staff")} />
              <p className="text-[10px] text-slate-400">{t("terisi otomatis dari posisi master — boleh diketik bebas", "auto-filled from the master position — free text allowed")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Kantor", "Office")}</Label>
              <Select value={form.companyOfficeId || "__none__"} onValueChange={(v) => setForm({ ...form, companyOfficeId: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="__none__">{t("Semua kantor", "All offices")}</SelectItem>
                  {offices.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}{o.city ? ` · ${o.city}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:col-span-2">
              <div className="space-y-1.5">
                <Label title={t("Target awal kebutuhan", "Initial target headcount")}>{t("(a) Target *", "(a) Target *")}</Label>
                <Input type="number" min={0} value={form.targetA} onChange={(e) => setForm({ ...form, targetA: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label title={t("Penyesuaian", "Adjustment")}>{t("(b) Penyesuaian", "(b) Adjustment")}</Label>
                <Input type="number" value={form.adjustB} onChange={(e) => setForm({ ...form, adjustB: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label title={t("Jumlah karyawan awal", "Starting employee headcount")}>{t("(d) Karyawan Awal", "(d) Starting Headcount")}</Label>
                <Input type="number" min={0} value={form.empD} onChange={(e) => setForm({ ...form, empD: e.target.value })} placeholder="0" />
                <p className="text-[10px] text-slate-400">{t("kosong = sinkron otomatis headcount", "empty = auto-sync headcount")}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label title={t("Pergerakan masuk", "Inbound movements")}>{t("(e) Masuk", "(e) In")}</Label>
                <Input type="number" value={form.inE} onChange={(e) => setForm({ ...form, inE: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label title={t("Pergerakan keluar", "Outbound movements")}>{t("(f) Keluar", "(f) Out")}</Label>
                <Input type="number" value={form.outF} onChange={(e) => setForm({ ...form, outF: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label title={t("Anggaran gaji rekrutmen (brankas uang)", "Recruitment salary budget (money vault)")}>{t("Anggaran Gaji (Rp)", "Salary Budget (Rp)")}</Label>
              <Input type="number" min={0} value={form.salaryBudget} onChange={(e) => setForm({ ...form, salaryBudget: e.target.value })} placeholder="21000000" />
            </div>
            <div className="space-y-1.5">
              <Label title={t("Periode data dasar (d)", "Base period of (d)")}>{t("Periode Basis", "Base Period")}</Label>
              <Input value={form.basePeriod} onChange={(e) => setForm({ ...form, basePeriod: e.target.value })} placeholder="2025" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("Catatan", "Note")}</Label>
              <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <p className="text-[11px] text-slate-500 sm:col-span-2">
              {t(
                "Kolom (c) total, (g) hasil dan (h) harus direkrut dihitung otomatis saat disimpan: c=(a)+(b) · g=(d)+(e)−(f) · h=(c)−(g).",
                "Columns (c) total, (g) result and (h) to-recruit are computed on save: c=(a)+(b) · g=(d)+(e)−(f) · h=(c)−(g).",
              )}
            </p>
          </div>
          <DialogFooter className="mt-2 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono text-[11px] text-slate-400">c=(a)+(b) · g=(d)+(e)−(f) · h=(c)−(g)</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>{t("Batal", "Cancel")}</Button>
              <Button onClick={savePlan} disabled={busy} className="ov-fill">
                {busy ? t("Menyimpan…", "Saving…") : editId ? t("Simpan Perubahan", "Save Changes") : t("Simpan", "Save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== PLAN-LINK — dialog drill-down PR penyumbang recon ===== */}
      <Dialog open={prsTarget != null} onOpenChange={(o) => { if (!o) setPrsTarget(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <ListTree className="h-4 w-4 ov-text-accent" aria-hidden />
              {prsTarget && t(
                `PR melayani rencana ${prsTarget.period} #${prsTarget.seqNo} — ${prsTarget.positionTitle}`,
                `PRs serving plan ${prsTarget.period} #${prsTarget.seqNo} — ${prsTarget.positionTitle}`,
              )}
            </DialogTitle>
          </DialogHeader>
          {prsTarget && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{t("Kebutuhan (h)", "Need (h)")}</div>
                  <div className="text-lg font-bold tabular-nums">{prsTarget.toRecruitH}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{t("PR diajukan", "PRs requested")}</div>
                  <div className="text-lg font-bold tabular-nums">{prsTarget.recon.requested}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{t("Terpenuhi", "Fulfilled")}</div>
                  <div className={cn("text-lg font-bold tabular-nums", prsTarget.recon.fulfilled >= prsTarget.toRecruitH && prsTarget.toRecruitH > 0 ? "text-emerald-600 dark:text-emerald-400" : prsTarget.recon.fulfilled > 0 ? "text-amber-600 dark:text-amber-400" : "")}>{prsTarget.recon.fulfilled}</div>
                </div>
              </div>
              {prsApi.loading && !prsLines ? (
                <div className="py-6 text-center text-xs text-slate-500">{t("Memuat daftar PR…", "Loading requisitions…")}</div>
              ) : (prsLines?.length ?? 0) === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500">{t("Belum ada PR yang melayani rencana ini.", "No requisitions serve this plan yet.")}</div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("No. PR", "PR No.")}</TableHead>
                        <TableHead>{t("Status", "Status")}</TableHead>
                        <TableHead className="text-center">{t("Jumlah", "Headcount")}</TableHead>
                        <TableHead className="text-center">{t("Diangkat", "Appointed")}</TableHead>
                        <TableHead className="text-center">{t("Tautan", "Link")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(prsLines ?? []).map((l) => (
                        <TableRow key={l.prId}>
                          <TableCell className="font-mono text-xs font-semibold">{l.prNo}
                            <div className="font-sans text-[10px] font-normal text-slate-500">{new Date(l.requestDate).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}</div>
                          </TableCell>
                          <TableCell className="text-xs">{l.status}</TableCell>
                          <TableCell className="text-center tabular-nums">{l.requiredNo}</TableCell>
                          <TableCell className="text-center tabular-nums">{l.appointed > 0 ? <b className="text-emerald-700 dark:text-emerald-400">{l.appointed}</b> : "0"}</TableCell>
                          <TableCell className="text-center">
                            {l.matchType === "explicit"
                              ? <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">{t("eksplisit", "explicit")}</Badge>
                              : <Badge variant="secondary">{t("otomatis", "auto")}</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {t(
                  "Tautan \"eksplisit\" dipilih saat membuat PR (kolom Melayani Rencana MPP); \"otomatis\" dicocokkan dari posisi + kantor + tahun periode. Atur di menu Permintaan Karyawan → form PR.",
                  "An \"explicit\" link is chosen when creating the PR (Serves Manpower Plan field); \"auto\" is matched from position + office + period year. Manage it in the Personnel Requisitions menu → PR form.",
                )}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrsTarget(null)}>{t("Tutup", "Close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== PLAN-LINK — dialog PR di luar rencana ===== */}
      <Dialog open={outsideOpen} onOpenChange={setOutsideOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Unlink className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
              {t("PR di Luar Rencana MPP", "Requisitions Outside the Manpower Plan")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t(
              "PR berikut berjalan tanpa terhubung ke rencana (tautan eksplisit maupun pencocokan posisi/kantor/tahun) — pengeluarannya tidak tercakup capaian MPP mana pun.",
              "The requisitions below run without any plan link (neither explicit nor position/office/year matching) — their spending is not covered by any MPP achievement.",
            )}
          </p>
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("No. PR", "PR No.")}</TableHead>
                  <TableHead>{t("Posisi", "Position")}</TableHead>
                  <TableHead className="text-center">{t("Jumlah", "Headcount")}</TableHead>
                  <TableHead>{t("Status", "Status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outsideLines.map((l) => (
                  <TableRow key={l.prId}>
                    <TableCell className="font-mono text-xs font-semibold">{l.prNo}</TableCell>
                    <TableCell className="text-xs">{l.positionTitle ?? "—"}</TableCell>
                    <TableCell className="text-center tabular-nums">{l.requiredNo}</TableCell>
                    <TableCell className="text-xs">{l.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutsideOpen(false)}>{t("Tutup", "Close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// =====================================================================
// seksi B — anggaran rekrutmen (budget vs realisasi dua level)
// =====================================================================

function BudgetSection() {
  const { t } = useI18n();
  const perms = useMenuPerms();

  const periodsApi = useApi<{ periods: string[]; suggest: string }>(`${BUDGET_API}?periods=1`, []);
  const [period, setPeriod] = useState<string>("");
  const activePeriod = period || periodsApi.data?.suggest || String(new Date().getFullYear());
  const budgetApi = useApi<{ row: BudgetRow | null }>(`${BUDGET_API}?period=${encodeURIComponent(activePeriod)}`, [activePeriod]);

  const row = budgetApi.data?.row ?? null;
  const canUpdate = perms.can("recruitment", "budget", "update");
  const canDelete = perms.can("recruitment", "budget", "delete");

  // form ubah anggaran
  const [formOpen, setFormOpen] = useState(false);
  const [totalBudget, setTotalBudget] = useState("");
  const [adjust, setAdjust] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // baris JO yang di-expand (ringkasan dua level)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = () => { budgetApi.refresh(); periodsApi.refresh(); };

  const openForm = () => {
    setTotalBudget(row?.totalBudget != null ? String(row.totalBudget) : "");
    setAdjust(row?.adjust != null ? String(row.adjust) : "");
    setNote(row?.note ?? "");
    setFormOpen(true);
  };

  const saveBudget = async () => {
    const tb = totalBudget === "" ? 0 : Number(totalBudget);
    if (!Number.isFinite(tb) || tb < 0) {
      toast.error(t("Total anggaran harus ≥ 0", "Total budget must be ≥ 0"));
      return;
    }
    setBusy(true);
    try {
      await apiSend(BUDGET_API, "POST", {
        period: activePeriod,
        totalBudget: tb,
        adjust: adjust === "" ? undefined : Number(adjust),
        note: note || null,
      });
      toast.success(t(`Anggaran periode ${activePeriod} disimpan`, `Budget for period ${activePeriod} saved`));
      setFormOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan anggaran", "Failed to save the budget"));
    } finally { setBusy(false); }
  };

  const removeBudget = async () => {
    if (!window.confirm(t(`Hapus anggaran periode ${activePeriod}?`, `Delete the budget for period ${activePeriod}?`))) return;
    try {
      await apiSend(`${BUDGET_API}?period=${encodeURIComponent(activePeriod)}`, "DELETE");
      toast.success(t(`Anggaran periode ${activePeriod} dihapus`, `Budget for period ${activePeriod} deleted`));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus anggaran", "Failed to delete the budget"));
    }
  };

  const toggleJo = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // progress bar used vs adjustBudget
  const pct = row && row.adjustBudget && row.adjustBudget > 0
    ? Math.min(100, Math.round((row.used / row.adjustBudget) * 100))
    : 0;

  const periods = periodsApi.data?.periods?.length
    ? periodsApi.data.periods
    : [activePeriod];

  const summary = (label: string, labelEn: string, value: number | null | undefined, opts?: { accent?: "amber" | "emerald"; sign?: boolean }) => (
    <div className={cn(
      "rounded-xl border p-3",
      opts?.accent === "emerald"
        ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10"
        : opts?.accent === "amber"
          ? "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10"
          : "border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80",
    )}>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(label, labelEn)}</div>
      <div className={cn(
        "mt-0.5 text-lg font-bold tabular-nums",
        opts?.accent === "emerald" ? "text-emerald-700 dark:text-emerald-400"
          : opts?.accent === "amber" ? "text-amber-700 dark:text-amber-400"
            : "text-slate-900 dark:text-slate-50",
      )}>
        {value == null ? "—" : `${opts?.sign && value > 0 ? "+" : ""}${fmtIDR(value)}`}
      </div>
    </div>
  );

  return (
    <Card className="mt-4 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Coins className="h-4 w-4 ov-text-accent" aria-hidden />
          {t("Anggaran Rekrutmen", "Recruitment Budget")}
          <div className="ml-2">
            <Select value={activePeriod} onValueChange={(v) => setPeriod(v)}>
              <SelectTrigger className="h-8 w-32 text-sm font-semibold"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                {periods.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {canUpdate && (
              <Button size="sm" variant="outline" className="h-8 gap-1 px-2" onClick={openForm}>
                <Pencil className="h-3.5 w-3.5" aria-hidden /> {row?.totalBudget != null ? t("Ubah Anggaran", "Edit Budget") : t("Set Anggaran", "Set Budget")}
              </Button>
            )}
            {canDelete && row?.totalBudget != null && (
              <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={removeBudget}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("Hapus", "Delete")}
              </Button>
            )}
          </div>
        </CardTitle>
        <CardDescription className="text-xs">
          {t(
            "Padanan RecruitmentBudget oranHR §2.2 — anggaran per periode (brankas uang) vs realisasi = Σ biaya aktual kanal lowongan pada periode tsb, diringkas dua level (per Job Opportunity + per Advertised PR).",
            "oranHR RecruitmentBudget §2.2 equivalent — per-period budget (money vault) vs actuals = Σ actual channel costs of job openings in that period, summarized two levels (per Job Opportunity + per Advertised PR).",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {budgetApi.loading && !budgetApi.data ? (
          <LoadingRows rows={4} />
        ) : budgetApi.error ? (
          <EmptyState title={t("Gagal memuat anggaran", "Failed to load the budget")} description={budgetApi.error} />
        ) : !row || row.totalBudget == null ? (
          <EmptyState
            icon={Wallet}
            title={t("Belum ada anggaran periode ini", "No budget for this period yet")}
            description={t(
              `Set total anggaran rekrutmen untuk ${activePeriod} — realisasi biaya kanal lowongan akan dipantau di sini.`,
              `Set the recruitment budget total for ${activePeriod} — actual channel costs will be tracked here.`,
            )}
          />
        ) : (
          <>
            {/* kartu ringkasan */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {summary("Total", "Total", row.totalBudget)}
              {summary("Penyesuaian", "Adjustment", row.adjust, { sign: true })}
              {summary("Total + Penyesuaian", "Total + Adjustment", row.adjustBudget)}
              {summary("Realisasi", "Actual / Used", row.used, { accent: "amber" })}
              {summary("Sisa", "Remaining", row.unused, { accent: "emerald" })}
            </div>

            {/* progress used vs adjustBudget */}
            <div className="mb-4">
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <span>{t("Realisasi vs Total+Penyesuaian", "Actuals vs Total+Adjustment")}</span>
                <span className="tabular-nums">{pct}%{row.unused != null && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">{t("sisa {n}", "left {n}", { n: fmtIDR(row.unused) })}</span>}</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className={cn("h-3 rounded-full",
                    pct >= 100
                      ? "bg-gradient-to-r from-rose-400 to-rose-600 dark:from-rose-500 dark:to-rose-400"
                      : "bg-gradient-to-r from-amber-300 to-amber-500 dark:from-amber-600 dark:to-amber-400")}
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </div>

            {/* ringkasan dua level per JO */}
            <div className="overflow-x-auto">
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>{t("Lowongan (JO)", "Job Opening (JO)")}</TableHead>
                    <TableHead>{t("Status", "Status")}</TableHead>
                    <TableHead className="text-right">{t("Rencana", "Planned")}</TableHead>
                    <TableHead className="text-right">{t("Aktual", "Actual")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Disiapkan", "Prepared")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {row.perJO.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <p className="py-6 text-center text-xs text-slate-400">
                          {t("Belum ada lowongan pada periode ini.", "No job openings in this period yet.")}
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                  {row.perJO.map((jo) => {
                    const open = expanded.has(jo.joId);
                    return (
                      <Fragment key={jo.joId}>
                        <TableRow className="cursor-pointer" onClick={() => toggleJo(jo.joId)}>
                          <TableCell className="text-center">
                            {open
                              ? <ChevronDown className="mx-auto h-4 w-4 text-slate-400" aria-hidden />
                              : <ChevronRight className="mx-auto h-4 w-4 text-slate-400" aria-hidden />}
                          </TableCell>
                          <TableCell>
                            <div className="font-mono text-xs font-semibold">{jo.refNo}</div>
                            <div className="max-w-[280px] truncate text-[12px] text-slate-500 dark:text-slate-400" title={jo.title}>{jo.title}</div>
                          </TableCell>
                          <TableCell>
                            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              jo.status === "Posted" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                                : jo.status === "Draft" ? "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-500/10 dark:text-slate-400"
                                  : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-500/10 dark:text-zinc-400")}>
                              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> {jo.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums">{fmtIDR(jo.planned)}</TableCell>
                          <TableCell className="text-right text-xs font-bold tabular-nums text-amber-700 dark:text-amber-400">{fmtIDR(jo.actual)}</TableCell>
                          <TableCell className="hidden text-xs md:table-cell">{jo.datePrepared ? jo.datePrepared.slice(0, 10) : "—"}</TableCell>
                        </TableRow>
                        {open && (
                          <TableRow>
                            <TableCell colSpan={6} className="bg-slate-50/70 p-0 dark:bg-slate-900/40">
                              <div className="grid gap-3 p-3 lg:grid-cols-2">
                                {/* kanal & biaya */}
                                <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                    {t("Kanal & Biaya ({n})", "Channels & Costs ({n})", { n: String(jo.methods.length) })}
                                  </p>
                                  <div className={cn("max-h-96 space-y-1.5 overflow-y-auto pr-1", SCROLL_CLS)}>
                                    {jo.methods.length === 0 && (
                                      <p className="text-[11px] italic text-slate-400">{t("Belum ada kanal biaya.", "No cost channels yet.")}</p>
                                    )}
                                    {jo.methods.map((m) => (
                                      <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-800/40">
                                        <div className="min-w-0">
                                          <span className="text-[12px] font-semibold">{m.methodName}</span>
                                          {m.costItemName && <span className="ml-1 text-[11px] text-slate-400">· {m.costItemName}</span>}
                                          {m.datePosted && <div className="text-[10px] text-slate-400">{t("posting", "posted")} {m.datePosted.slice(0, 10)}</div>}
                                        </div>
                                        <div className="text-right text-[11px] tabular-nums">
                                          <div className="font-bold text-amber-700 dark:text-amber-400">{m.actual != null ? fmtIDR(m.actual) : "—"}</div>
                                          <div className="text-slate-400">{t("rencana", "planned")}: {m.planned != null ? fmtIDR(m.planned) : "—"}</div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                {/* PR diiklankan */}
                                <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                    {t("PR yang Diiklankan ({n})", "Advertised PRs ({n})", { n: String(jo.prs.length) })}
                                  </p>
                                  <div className={cn("max-h-96 space-y-1.5 overflow-y-auto pr-1", SCROLL_CLS)}>
                                    {jo.prs.length === 0 && (
                                      <p className="text-[11px] italic text-slate-400">{t("Tidak ada slot PR.", "No PR slots.")}</p>
                                    )}
                                    {jo.prs.map((p) => (
                                      <div key={p.prId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 dark:border-slate-800 dark:bg-slate-800/40">
                                        <div className="min-w-0">
                                          <span className="font-mono text-[11px] font-semibold">{p.prNo}</span>
                                          <span className="ml-1.5 text-[11px] text-slate-500 dark:text-slate-400">{p.positionTitle ?? "—"}</span>
                                          <div className="text-[10px] text-slate-400">{t("kebutuhan {n} org", "{n} headcount", { n: String(p.requiredNo) })} · {p.prStatus}</div>
                                        </div>
                                        <div className="text-[11px] font-bold tabular-nums text-amber-700 dark:text-amber-400">{fmtIDR(p.actual)}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {row.note && (
              <p className="mt-3 text-[11px] italic text-slate-400">“{row.note}”</p>
            )}
          </>
        )}
      </CardContent>

      {/* ===== dialog form anggaran ===== */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) setFormOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Anggaran Periode {p}", "Budget for Period {p}", { p: activePeriod })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Total Anggaran (Rp) *", "Total Budget (Rp) *")}</Label>
              <Input type="number" min={0} value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} placeholder="50000000" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Penyesuaian (Rp)", "Adjustment (Rp)")}</Label>
              <Input type="number" value={adjust} onChange={(e) => setAdjust(e.target.value)} placeholder="0" />
              <p className="text-[10px] text-slate-400">{t("boleh negatif — total efektif = total + penyesuaian", "may be negative — effective total = total + adjustment")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Catatan", "Note")}</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={saveBudget} disabled={busy} className="ov-fill">
              {busy ? t("Menyimpan…", "Saving…") : t("Simpan Anggaran", "Save Budget")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// =====================================================================
// halaman gabungan
// =====================================================================

export function PlanBudgetPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · F5")}
        title={t("Rencana & Anggaran Rekrutmen", "Recruitment Plan & Budget")}
        description={t(
          "Rencana kebutuhan per periode dengan formula a–h oranHR (target → total → hasil tersedia → harus direkrut) + rekonsiliasi PR berjalan, serta anggaran rekrutmen vs realisasi biaya kanal lowongan.",
          "Per-period headcount planning with the oranHR a–h formula (target → total → available → to recruit) + running PR reconciliation, and the recruitment budget vs actual channel costs.",
        )}
      />
      <PlanSection />
      <BudgetSection />
    </div>
  );
}
