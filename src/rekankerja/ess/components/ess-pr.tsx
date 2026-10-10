"use client";
// RekanKerja ESS F1-REC — PR Saya (padanan oranHR MyPersonnelRequisition):
// ajukan permintaan karyawan untuk unit/posisi yang dibutuhkan + riwayat PR
// sendiri + tarik pengajuan yang masih menunggu.
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Plus, Send, Ban, AlertTriangle, History } from "lucide-react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ESS_BASE } from "./ess-api";
import {
  PR_EMPLOYMENT_STATUSES, PR_SOURCES,
  PR_EMPLOYMENT_LABEL, PR_EMPLOYMENT_LABEL_EN, PR_STATUS_LABEL, PR_STATUS_LABEL_EN,
} from "@/rekankerja/recruitment/components/recruitment-types";

interface MyPrRow {
  id: string; prNo: string; requestDate: string; status: string;
  positionTitle: string | null; requiredNo: number; employmentStatus: string;
  reason: string | null; earliestDate: string | null; latestDate: string | null;
  decisionNote: string | null;
  approval: { level: number; total: number; currentApproverName: string | null } | null;
}

interface PrOptionsResp {
  requests: MyPrRow[];
  options: {
    positions: { id: string; code: string; title: string; orgUnitName: string | null }[];
    jobs: { id: string; code: string; title: string }[];
    orgUnits: { id: string; code: string; name: string }[];
    offices: { id: string; code: string; name: string; city: string | null }[];
  };
}

function FormError({ message }: { message: string | null }) {
  const { t } = useI18n();
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="break-words">{message}</span>
    </div>
  );
}

export function EssPrPage() {
  const { t, locale } = useI18n();
  const api = useApi<PrOptionsResp>(`${ESS_BASE}/pr`, [ESS_BASE]);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    positionId: "", jobId: "", orgUnitId: "", companyOfficeId: "",
    requiredNo: "1", employmentStatus: "Permanent", preferredSource: "Any",
    earliestDate: "", latestDate: "", reason: "", miscSpec: "",
  });

  const rows = api.data?.requests ?? [];
  const opts = api.data?.options;

  const submit = async () => {
    setFormError(null);
    if (!form.positionId) { setFormError(t("Posisi yang dibutuhkan wajib dipilih.", "The needed position is required.")); return; }
    if (!form.reason.trim()) { setFormError(t("Alasan kebutuhan wajib diisi agar approver memahami konteks.", "A reason is required so the approver understands the context.")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ prNo: string; approvalLevels?: number; firstApprover?: string | null }>(
        `${ESS_BASE}/pr`, "POST", form,
      );
      toast.success(t(
        `PR ${res.prNo} diajukan — menunggu keputusan ${res.firstApprover ?? "approver"}`,
        `Requisition ${res.prNo} submitted — awaiting ${res.firstApprover ?? "the approver"}`,
      ));
      setDialog(false);
      setForm({ positionId: "", jobId: "", orgUnitId: "", companyOfficeId: "", requiredNo: "1", employmentStatus: "Permanent", preferredSource: "Any", earliestDate: "", latestDate: "", reason: "", miscSpec: "" });
      api.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("Gagal mengajukan PR", "Failed to submit the requisition"));
    } finally { setBusy(false); }
  };

  const cancelRequest = async (r: MyPrRow) => {
    const note = window.prompt(t(`Catatan pembatalan PR ${r.prNo} (opsional):`, `Cancellation note for PR ${r.prNo} (optional):`)) ?? "";
    try {
      await apiSend(`${ESS_BASE}/pr`, "PATCH", { id: r.id, note: note.trim() || undefined });
      toast.success(t(`PR ${r.prNo} ditarik`, `Requisition ${r.prNo} withdrawn`));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menarik PR", "Failed to withdraw the requisition"));
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={t("ESS · Rekrutmen")}
        title={t("Permintaan Karyawan Saya", "My Personnel Requisitions")}
        description={t(
          "Ajukan kebutuhan karyawan baru/pengganti untuk unit Anda — masuk jalur approval atasan sebelum diproses tim HR rekrutmen.",
          "Request new/replacement headcount for your unit — routed through your superior's approval before the recruitment team proceeds.",
        )}
        actions={
          <Button onClick={() => { setDialog(true); setFormError(null); }} className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
            <Plus className="h-4 w-4" aria-hidden /> {t("Ajukan PR", "New Requisition")}
          </Button>
        }
      />

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <History className="h-3 w-3" aria-hidden /> {t("Riwayat Pengajuan", "Request History")}
          </p>
          {api.loading && !api.data ? (
            <LoadingRows rows={4} />
          ) : api.error ? (
            <EmptyState title={t("Gagal memuat PR Anda", "Failed to load your requisitions")} description={api.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={t("Belum ada permintaan karyawan", "No personnel requisitions yet")}
              description={t("Ajukan PR pertama Anda lewat tombol di atas.", "Submit your first requisition via the button above.")}
            />
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-xs font-semibold">{r.prNo}</span>
                      <StatusPill status={r.status === "Draft" ? "Prepared" : r.status === "OnHold" ? "Pending" : r.status} />
                      <span className="text-[11px] text-slate-400">
                        {new Date(r.requestDate).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    {(r.status === "Submitted") && (
                      <Button size="sm" variant="outline" className="h-7 gap-1 border-rose-300 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-400" onClick={() => cancelRequest(r)}>
                        <Ban className="h-3 w-3" aria-hidden /> {t("Tarik", "Withdraw")}
                      </Button>
                    )}
                  </div>
                  <div className="mt-1.5 text-sm font-semibold">{r.positionTitle ?? "—"}</div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
                    {t("{n} orang", "{n} headcount", { n: String(r.requiredNo) })} · {t(PR_EMPLOYMENT_LABEL[r.employmentStatus] ?? r.employmentStatus, PR_EMPLOYMENT_LABEL_EN[r.employmentStatus] ?? r.employmentStatus)}
                    {r.approval ? ` · ${t("approval", "approval")} ${r.approval.level}/${r.approval.total} — ${r.approval.currentApproverName ?? "—"}` : ""}
                  </div>
                  {r.reason && <p className="mt-1 line-clamp-2 text-[11.5px] italic text-slate-400">{r.reason}</p>}
                  {r.decisionNote && (
                    <p className="mt-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {t("Catatan", "Note")}: {r.decisionNote}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* dialog ajukan PR */}
      <Dialog open={dialog} onOpenChange={(o) => { if (!o) setDialog(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-amber-600" aria-hidden />
              {t("Ajukan Permintaan Karyawan", "Submit a Personnel Requisition")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <FormError message={formError} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Posisi yang Dibutuhkan *", "Needed Position *")}</Label>
                <Select value={form.positionId} onValueChange={(v) => setForm({ ...form, positionId: v })}>
                  <SelectTrigger><SelectValue placeholder={t("Pilih posisi", "Select a position")} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(opts?.positions ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Job (opsional)", "Job (optional)")}</Label>
                <Select value={form.jobId || undefined} onValueChange={(v) => setForm({ ...form, jobId: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(opts?.jobs ?? []).map((j) => (
                      <SelectItem key={j.id} value={j.id}>{j.code} — {j.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Unit Organisasi (opsional)", "Org Unit (optional)")}</Label>
                <Select value={form.orgUnitId || undefined} onValueChange={(v) => setForm({ ...form, orgUnitId: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(opts?.orgUnits ?? []).map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.code} — {o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Kantor (opsional)", "Office (optional)")}</Label>
                <Select value={form.companyOfficeId || undefined} onValueChange={(v) => setForm({ ...form, companyOfficeId: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(opts?.offices ?? []).map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.name}{o.city ? ` — ${o.city}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Jumlah Kebutuhan (orang)", "Headcount (persons)")}</Label>
                <Input type="number" min={1} max={999} value={form.requiredNo} onChange={(e) => setForm({ ...form, requiredNo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Status Kerja", "Employment Status")}</Label>
                <Select value={form.employmentStatus} onValueChange={(v) => setForm({ ...form, employmentStatus: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PR_EMPLOYMENT_STATUSES.map((s) => (
                      <SelectItem key={s.key} value={s.key}>{t(s.label, s.labelEn)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Sumber Kandidat", "Preferred Source")}</Label>
                <Select value={form.preferredSource} onValueChange={(v) => setForm({ ...form, preferredSource: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PR_SOURCES.map((s) => (
                      <SelectItem key={s.key} value={s.key}>{t(s.label, s.labelEn)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Kebutuhan Paling Awal", "Earliest Date")}</Label>
                <Input type="date" value={form.earliestDate} onChange={(e) => setForm({ ...form, earliestDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Paling Lambat", "Latest Date")}</Label>
                <Input type="date" value={form.latestDate} onChange={(e) => setForm({ ...form, latestDate: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Alasan Kebutuhan *", "Reason *")}</Label>
                <Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder={t("Jelaskan kebutuhan, dampak bila tidak diisi, dan konteks unit Anda…", "Explain the need, the impact if unfilled, and your unit's context…")} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Spesifikasi Lain (opsional)", "Misc Specification (optional)")}</Label>
                <Textarea rows={2} value={form.miscSpec} onChange={(e) => setForm({ ...form, miscSpec: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submit} disabled={busy} className="gap-2 bg-amber-600 font-bold text-white hover:bg-amber-700">
              <Send className="h-4 w-4" aria-hidden /> {busy ? t("Mengirim…", "Submitting…") : t("Ajukan PR", "Submit Requisition")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
