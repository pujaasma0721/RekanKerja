"use client";
// RekanKerja Medical — P2.5-BM (D-BM20): Polis Asuransi Grup.
// Administrasi polis (provider INSURANCE, periode, premi bulanan vault-gated,
// % porsi perusahaan) + enrollment karyawan±dependen (effective dating) +
// akhiri membership / terminasi polis + laporan premi per anggota & rekap
// (XLSX dwibahasa). BATAS D-BM20: adjudikasi klaim TETAP di engine
// reimbursement modul klaim existing.
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ShieldCheck, Plus, Pencil, Eye, UserPlus, Ban, FileSpreadsheet, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtIDR } from "./medical-types";

// ============ tipe UI (cermin serializer policy-service) ============

interface PolicyUI {
  id: string;
  providerId: string;
  providerCode: string;
  providerName: string;
  policyNo: string;
  periodStart: string;
  periodEnd: string;
  /** null = vault uang masked (render "••••" + hint brankas). */
  premiumMonthly: number | null;
  premiumMasked: boolean;
  pctCompany: number;
  status: string;
  note: string | null;
  memberCount: number;
  activeMemberCount: number;
  daysToEnd: number | null;
}
interface ProviderOption { id: string; code: string; name: string; city: string | null }
interface EmployeeOption { id: string; employeeNo: string; fullName: string }
interface MemberUI {
  id: string; employeeId: string; employeeNo: string; employeeName: string; employeeStatus: string;
  dependentId: string | null; dependentName: string | null; dependentRelation: string | null;
  effectiveFrom: string; effectiveTo: string | null; active: boolean;
  policyNo: string; policyPeriodStart: string; policyPeriodEnd: string;
}
interface PremiumRowUI {
  policyId: string; policyNo: string; providerName: string; memberId: string;
  employeeNo: string; employeeName: string;
  dependentName: string | null; dependentRelation: string | null; memberKind: string;
  effectiveFrom: string; effectiveTo: string | null;
  premiumPerMember: number | null; companyShare: number | null; employeeShare: number | null;
}
interface PremiumRekapUI {
  policyId: string; policyNo: string; providerName: string;
  periodStart: string; periodEnd: string; status: string; pctCompany: number; activeMembers: number;
  premiumMonthly: number | null; totalAllocated: number | null; totalCompany: number | null; totalEmployee: number | null;
}
interface FamilyOption { id: string; name: string; relation: string; isDependent: boolean }

// ============ label lokal ============

const POLICY_STATUS_LABEL: Record<string, string> = { Active: "Aktif", Expired: "Kedaluwarsa", Terminated: "Dihentikan" };
const POLICY_STATUS_LABEL_EN: Record<string, string> = { Active: "Active", Expired: "Expired", Terminated: "Terminated" };
const POLICY_STATUS_VARIANT: Record<string, string> = {
  Active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Expired: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Terminated: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const todayISO = () => new Date().toISOString().slice(0, 10);

interface FormState {
  id?: string;
  providerId: string;
  policyNo: string;
  periodStart: string;
  periodEnd: string;
  premiumMonthly: string;
  pctCompany: string;
  note: string;
}

const emptyForm = (): FormState => ({
  providerId: "", policyNo: "",
  periodStart: todayISO(),
  periodEnd: "",
  premiumMonthly: "", pctCompany: "100", note: "",
});

export function InsurancePoliciesPage() {
  const { t, lang } = useI18n();
  const api = useApi<{ policies: PolicyUI[]; providers: ProviderOption[]; employees: EmployeeOption[] }>(
    "/api/rekankerja/medical/insurance-policies",
  );
  const [q, setQ] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  // dialog detail (policy + members + laporan premi) — URL-driven useApi
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useApi<{ policy: PolicyUI; members: MemberUI[]; premium: { rows: PremiumRowUI[]; rekap: PremiumRekapUI[] } }>(
    detailId ? `/api/rekankerja/medical/insurance-policies?detail=${detailId}` : null,
    [detailId],
  );
  // dialog enroll
  const [enrollFor, setEnrollFor] = useState<PolicyUI | null>(null);
  const [enrollEmp, setEnrollEmp] = useState("");
  const [enrollDep, setEnrollDep] = useState("");
  const [enrollFrom, setEnrollFrom] = useState(todayISO());
  const familyApi = useApi<{ family: FamilyOption[] }>(
    enrollFor && enrollEmp ? `/api/rekankerja/medical/insurance-policies?familyFor=${enrollEmp}` : null,
    [enrollFor, enrollEmp],
  );
  // dialog akhiri membership / terminasi polis
  const [endTarget, setEndTarget] = useState<MemberUI | null>(null);
  const [endTo, setEndTo] = useState(todayISO());
  const [terminateFor, setTerminateFor] = useState<PolicyUI | null>(null);
  const [terminateNote, setTerminateNote] = useState("");

  const all = api.data?.policies ?? [];
  const providers = api.data?.providers ?? [];
  const employees = api.data?.employees ?? [];
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((p) => `${p.policyNo} ${p.providerName} ${p.providerCode} ${p.note ?? ""}`.toLowerCase().includes(s));
  }, [all, q]);

  const openDetail = (id: string) => setDetailId(id);

  const openNew = () => {
    setForm({ ...emptyForm(), providerId: providers[0]?.id ?? "" });
    setDialog(true);
  };
  const openEdit = (p: PolicyUI) => {
    setForm({
      id: p.id,
      providerId: p.providerId,
      policyNo: p.policyNo,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      premiumMonthly: p.premiumMonthly == null ? "" : String(p.premiumMonthly),
      pctCompany: String(p.pctCompany),
      note: p.note ?? "",
    });
    setDialog(true);
  };

  const save = async () => {
    if (!form.providerId) { toast.error(t("Pilih penyedia asuransi", "Select an insurance provider")); return; }
    if (!form.policyNo.trim()) { toast.error(t("Nomor polis wajib diisi", "Policy number is required")); return; }
    if (!form.periodStart || !form.periodEnd) { toast.error(t("Periode polis wajib diisi", "Policy period is required")); return; }
    if (new Date(form.periodEnd) <= new Date(form.periodStart)) {
      toast.error(t("Tanggal berakhir harus setelah tanggal mulai", "End date must be after start date"));
      return;
    }
    const pct = Number(form.pctCompany);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast.error(t("Porsi perusahaan harus 0–100%", "Company share must be 0–100%"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/medical/insurance-policies", "POST", {
        action: "upsert",
        id: form.id,
        providerId: form.providerId,
        policyNo: form.policyNo.trim(),
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        premiumMonthly: form.premiumMonthly === "" ? null : Number(form.premiumMonthly),
        pctCompany: pct,
        note: form.note.trim() || undefined,
      });
      toast.success(form.id ? t("Polis diperbarui", "Policy updated") : t("Polis dibuat", "Policy created"));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  const openEnroll = (p: PolicyUI) => {
    setEnrollFor(p);
    setEnrollEmp(employees[0]?.id ?? "");
    setEnrollDep("");
    setEnrollFrom(todayISO());
  };
  const pickEnrollEmployee = (id: string) => {
    setEnrollEmp(id);
    setEnrollDep("");
  };
  const submitEnroll = async () => {
    if (!enrollFor) return;
    if (!enrollEmp) { toast.error(t("Pilih karyawan", "Select an employee")); return; }
    if (!enrollFrom) { toast.error(t("Tanggal efektif wajib diisi", "Effective date is required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/medical/insurance-policies", "POST", {
        action: "enroll",
        policyId: enrollFor.id,
        employeeId: enrollEmp,
        dependentId: enrollDep || undefined,
        effectiveFrom: enrollFrom,
      });
      toast.success(t("Anggota terdaftar", "Member enrolled"));
      setEnrollFor(null);
      detail.refresh();
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  const submitEnd = async () => {
    if (!endTarget) return;
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/medical/insurance-policies", "POST", {
        action: "end-membership",
        id: endTarget.id,
        effectiveTo: endTo,
      });
      toast.success(t("Membership diakhiri", "Membership ended"));
      setEndTarget(null);
      detail.refresh();
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  const submitTerminate = async () => {
    if (!terminateFor) return;
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/medical/insurance-policies", "POST", {
        action: "terminate",
        id: terminateFor.id,
        note: terminateNote.trim() || undefined,
      });
      toast.success(t("Polis dihentikan — membership terbuka ditutup", "Policy terminated — open memberships closed"));
      setTerminateFor(null);
      detail.refresh();
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  const exportXlsx = async () => {
    try {
      const res = await fetch(`/api/rekankerja/medical/insurance-policies?report=all&export=xlsx&lang=${lang}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ? String(j.error) : t("Gagal mengekspor", "Export failed"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rekankerja-premi-polis-${todayISO()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("Laporan premi terunduh (XLSX)", "Premium report downloaded (XLSX)"));
    } catch {
      toast.error(t("Gagal mengekspor", "Export failed"));
    }
  };

  const dPolicy = detail.data?.policy;
  const dMembers = detail.data?.members ?? [];
  const dRekap = detail.data?.premium.rekap[0];

  return (
    <div>
      <PageHeader
        eyebrow={t("Medical · Benefits")}
        title={t("Polis Asuransi Grup")}
        description={t(
          "Administrasi polis asuransi grup perusahaan — enrollment karyawan & dependen, porsi premi perusahaan vs karyawan, dan pengingat perpanjangan (batas D-BM20: adjudikasi klaim tetap di modul klaim)",
          "Group insurance policy administration — employee & dependent enrollment, company vs employee premium share, and renewal reminders (D-BM20 boundary: claim adjudication stays in the claims module)",
        )}
        actions={(
          <>
            <Button variant="outline" onClick={exportXlsx}>
              <FileSpreadsheet className="h-4 w-4" /> {t("Export XLSX")}
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> {t("Polis Baru", "New Policy")}
            </Button>
          </>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Cari no. polis / penyedia…", "Search policy no. / provider…")}
            className="pl-8"
            aria-label={t("Cari polis", "Search policies")}
          />
        </div>
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={ShieldCheck}
                title={t("Belum ada polis asuransi grup", "No group insurance policies yet")}
                description={t("Buat polis pertama (provider asuransi + periode + premi bulanan), lalu enroll karyawan dan dependennya.", "Create the first policy (insurance provider + period + monthly premium), then enroll employees and their dependents.")}
              />
            </div>
          ) : (
            <div className="max-h-[30rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead>{t("Penyedia")}</TableHead>
                    <TableHead>{t("No. Polis", "Policy No.")}</TableHead>
                    <TableHead>{t("Periode")}</TableHead>
                    <TableHead className="text-right">{t("Premi/Bulan", "Premium/Month")}</TableHead>
                    <TableHead className="text-right">{t("% Perusahaan", "Company %")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead className="text-right">{t("Anggota", "Members")}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-semibold">{p.providerName}</p>
                        <p className="text-xs text-slate-500">{p.providerCode}</p>
                      </TableCell>
                      <TableCell className="font-semibold">
                        {p.policyNo}
                        {p.note ? <p className="max-w-[16rem] truncate text-xs font-normal text-slate-500" title={p.note}>{p.note}</p> : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.periodStart} → {p.periodEnd}
                        {p.status === "Active" && p.daysToEnd != null && p.daysToEnd <= 30 ? (
                          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                            {t("{n} hari lagi", "{n} days left", { n: p.daysToEnd })}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {p.premiumMonthly == null ? (
                          <span
                            className="cursor-help text-slate-400"
                            title={t("Premi tersembunyi — buka brankas uang untuk melihat", "Premium hidden — open the money vault to view")}
                          >
                            ••••
                          </span>
                        ) : (
                          fmtIDR(p.premiumMonthly)
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm">{p.pctCompany}%</TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${POLICY_STATUS_VARIANT[p.status] ?? ""}`}>
                          {t(POLICY_STATUS_LABEL[p.status] ?? p.status, POLICY_STATUS_LABEL_EN[p.status] ?? p.status)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          {t("{n} aktif / {m}", "{n} active / {m}", { n: p.activeMemberCount, m: p.memberCount })}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={t("Lihat", "View")} onClick={() => openDetail(p.id)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={t("Ubah", "Edit")} onClick={() => openEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog buat/ubah polis ===== */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 ov-text-accent" />
              {form.id ? t("Ubah Polis", "Edit Policy") : t("Polis Baru", "New Policy")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Penyedia Asuransi *", "Insurance Provider *")}</Label>
              <Select value={form.providerId} onValueChange={(v) => setForm({ ...form, providerId: v })}>
                <SelectTrigger><SelectValue placeholder={t("Pilih provider INSURANCE aktif", "Select an active INSURANCE provider")} /></SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.city ? `· ${p.city}` : ""} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {providers.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("Belum ada provider INSURANCE aktif — tambahkan di master Rumah Sakit & Asuransi.", "No active INSURANCE provider yet — add one in the Hospitals & Insurance master.")}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>{t("No. Polis *", "Policy No. *")}</Label>
              <Input value={form.policyNo} onChange={(e) => setForm({ ...form, policyNo: e.target.value })} placeholder={t("mis. POL/GA/2026/001", "e.g. POL/GA/2026/001")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Mulai Periode *", "Period Start *")}</Label>
                <Input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Akhir Periode *", "Period End *")}</Label>
                <Input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Premi Bulanan (Rp)", "Monthly Premium (Rp)")}</Label>
                <Input type="number" min={0} value={form.premiumMonthly} onChange={(e) => setForm({ ...form, premiumMonthly: e.target.value })} placeholder={t("mis. 5000000", "e.g. 5000000")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Porsi Perusahaan (%) *", "Company Share (%) *")}</Label>
                <Input type="number" min={0} max={100} value={form.pctCompany} onChange={(e) => setForm({ ...form, pctCompany: e.target.value })} />
                <p className="text-xs text-slate-500">{t("Sisanya dibebankan ke karyawan (potongan payroll).", "The remainder is charged to the employee (payroll deduction).")}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Catatan")}</Label>
              <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t("mis. Polis rawat inap kelas 1 + jalan", "e.g. Inpatient class 1 + outpatient policy")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal")}</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? t("Menyimpan…", "Saving…") : t("Simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog detail polis: anggota + laporan premi + aksi ===== */}
      <Dialog open={!!detailId} onOpenChange={(v) => { if (!v) setDetailId(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 ov-text-accent" />
              {dPolicy ? `${dPolicy.policyNo} — ${dPolicy.providerName}` : t("Detail Polis", "Policy Detail")}
            </DialogTitle>
          </DialogHeader>
          {detail.loading && !detail.data ? (
            <LoadingRows rows={4} />
          ) : dPolicy ? (
            <div className="space-y-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="flex justify-between"><span className="text-slate-500">{t("Periode")}</span><span className="font-semibold">{dPolicy.periodStart} → {dPolicy.periodEnd}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t("Premi Bulanan", "Monthly Premium")}</span><span className="font-semibold">{dPolicy.premiumMonthly == null ? "••••" : fmtIDR(dPolicy.premiumMonthly)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t("Porsi Perusahaan", "Company Share")}</span><span className="font-semibold">{dPolicy.pctCompany}%</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t("Status")}</span><span className="font-semibold">{t(POLICY_STATUS_LABEL[dPolicy.status] ?? dPolicy.status, POLICY_STATUS_LABEL_EN[dPolicy.status] ?? dPolicy.status)}</span></div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="flex justify-between"><span className="text-slate-500">{t("Anggota Aktif", "Active Members")}</span><span className="font-semibold">{dRekap?.activeMembers ?? 0}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t("Premi per Anggota", "Premium per Member")}</span><span className="font-semibold">{dRekap && dRekap.totalAllocated != null && dRekap.activeMembers > 0 ? fmtIDR(Math.round(dRekap.totalAllocated / dRekap.activeMembers)) : "••••"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t("Porsi Perusahaan / Anggota", "Company Share / Member")}</span><span className="font-semibold">{dRekap && dRekap.totalCompany != null && dRekap.activeMembers > 0 ? fmtIDR(Math.round(dRekap.totalCompany / dRekap.activeMembers)) : "••••"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">{t("Porsi Karyawan / Anggota", "Employee Share / Member")}</span><span className="font-semibold">{dRekap && dRekap.totalEmployee != null && dRekap.activeMembers > 0 ? fmtIDR(Math.round(dRekap.totalEmployee / dRekap.activeMembers)) : "••••"}</span></div>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                    <TableRow>
                      <TableHead>{t("Anggota", "Member")}</TableHead>
                      <TableHead>{t("Jenis", "Type")}</TableHead>
                      <TableHead>{t("Efektif Dari", "Effective From")}</TableHead>
                      <TableHead>{t("Efektif Sampai", "Effective To")}</TableHead>
                      <TableHead className="w-16" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dMembers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">
                          {t("Belum ada anggota — enroll karyawan pertama.", "No members yet — enroll the first employee.")}
                        </TableCell>
                      </TableRow>
                    ) : dMembers.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <p className="font-semibold">{m.employeeName}</p>
                          <p className="text-xs text-slate-500">{m.employeeNo}</p>
                        </TableCell>
                        <TableCell className="text-sm">
                          {m.dependentName
                            ? t("Dependen — {rel} ({name})", "Dependent — {rel} ({name})", { rel: m.dependentRelation ?? "-", name: m.dependentName })
                            : t("Karyawan")}
                        </TableCell>
                        <TableCell className="text-sm">{m.effectiveFrom}</TableCell>
                        <TableCell className="text-sm">
                          {m.effectiveTo ?? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{t("Aktif")}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {m.active ? (
                            <Button
                              size="sm" variant="ghost" className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600"
                              title={t("Akhiri membership", "End membership")}
                              onClick={() => { setEndTarget(m); setEndTo(todayISO()); }}
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {dPolicy.status === "Active" ? (
                  <>
                    <Button size="sm" onClick={() => openEnroll(dPolicy)}>
                      <UserPlus className="h-4 w-4" /> {t("Enroll Anggota", "Enroll Member")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => { setTerminateFor(dPolicy); setTerminateNote(""); }}>
                      <Ban className="h-4 w-4" /> {t("Akhiri Polis", "Terminate Policy")}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ===== dialog enroll anggota ===== */}
      <Dialog open={!!enrollFor} onOpenChange={(v) => { if (!v) setEnrollFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 ov-text-accent" />
              {t("Enroll Anggota — {polis}", "Enroll Member — {polis}", { polis: enrollFor?.policyNo ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("Karyawan *", "Employee *")}</Label>
              <Select value={enrollEmp} onValueChange={pickEnrollEmployee}>
                <SelectTrigger><SelectValue placeholder={t("Pilih karyawan aktif", "Select an active employee")} /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Dependen (opsional)", "Dependent (optional)")}</Label>
              <Select value={enrollDep || "__none"} onValueChange={(v) => setEnrollDep(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t("— Karyawan saja —", "— Employee only —")}</SelectItem>
                  {(familyApi.data?.family ?? []).filter((f) => f.isDependent).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name} ({f.relation})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {t("Depenen harus terdaftar di data keluarga karyawan (registry HR).", "Dependents must be registered in the employee family record (HR registry).")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Tanggal Efektif *", "Effective Date *")}</Label>
              <Input type="date" value={enrollFrom} onChange={(e) => setEnrollFrom(e.target.value)} />
              <p className="text-xs text-slate-500">
                {t("Harus dalam periode polis ({a} → {b}).", "Must be within the policy period ({a} → {b}).", { a: enrollFor?.periodStart ?? "-", b: enrollFor?.periodEnd ?? "-" })}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollFor(null)}>{t("Batal")}</Button>
            <Button onClick={submitEnroll} disabled={busy}>
              {busy ? t("Menyimpan…", "Saving…") : t("Enroll")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog akhiri membership ===== */}
      <Dialog open={!!endTarget} onOpenChange={(v) => { if (!v) setEndTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" />
              {t("Akhiri Membership", "End Membership")}
            </DialogTitle>
          </DialogHeader>
          {endTarget ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {t(
                  "Akhiri membership {emp}{dep} pada polis {polis} — anggota berhenti tercakup mulai tanggal berakhir.",
                  "End the membership of {emp}{dep} on policy {polis} — coverage stops from the end date.",
                  {
                    emp: endTarget.employeeNo,
                    dep: endTarget.dependentName ? `+${endTarget.dependentName}` : "",
                    polis: endTarget.policyNo,
                  },
                )}
              </p>
              <div className="space-y-1.5">
                <Label>{t("Tanggal Berakhir *", "End Date *")}</Label>
                <Input type="date" value={endTo} onChange={(e) => setEndTo(e.target.value)} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEndTarget(null)}>{t("Batal")}</Button>
            <Button variant="destructive" onClick={submitEnd} disabled={busy}>
              {busy ? t("Memproses…", "Processing…") : t("Akhiri", "End")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog terminasi polis ===== */}
      <Dialog open={!!terminateFor} onOpenChange={(v) => { if (!v) setTerminateFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" />
              {t("Akhiri Polis — {polis}", "Terminate Policy — {polis}", { polis: terminateFor?.policyNo ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t(
                "Polis ditandai Dihentikan dan seluruh membership terbuka ditutup efektif hari ini. Enroll baru tidak lagi diperbolehkan.",
                "The policy is marked Terminated and all open memberships are closed effective today. New enrollment is no longer allowed.",
              )}
            </p>
            <div className="space-y-1.5">
              <Label>{t("Catatan (opsional)", "Note (optional)")}</Label>
              <Textarea rows={2} value={terminateNote} onChange={(e) => setTerminateNote(e.target.value)} placeholder={t("mis. pindah ke provider lain", "e.g. moved to another provider")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminateFor(null)}>{t("Batal")}</Button>
            <Button variant="destructive" onClick={submitTerminate} disabled={busy}>
              {busy ? t("Memproses…", "Processing…") : t("Akhiri Polis", "Terminate Policy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
