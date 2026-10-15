"use client";
// ============================================================================
// RECRUITMENT B8 — REFERRAL REGISTER (tab modul Rekrutmen)
// DEVELOPMENT-PLAN-BACKLOG.md §4 B8 + §5 risiko "Insentif referral
// disalahpahami otomatis" → BANNER AMBER tegas di atas halaman:
// insentif referral dicatat MANUAL oleh HR — TIDAK otomatis masuk payroll.
// Register SEMUA Applicant ber-karyawan-perujuk: pelamar, perujuk + unit
// (assignment aktif), slot terakhir, status pipeline ringkas (chip), catatan
// perujuk (referralNote), catatan insentif manual (referralRewardNote +
// tombol edit inline utk HR ber-op "reward"), tanggal. Filter q + status +
// switch "hanya ber-insentif". Mobile = kartu (tabel terlalu padat).
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Users, Search, UserRoundCheck, AlertTriangle, Pencil, Loader2, Gift,
} from "lucide-react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ---------- tipe lokal (mirror kontrak GET /recruitment/referrals) ----------

interface ReferralRow {
  id: string;
  applicantNo: string;
  fullName: string;
  status: string;
  referrer: { employeeNo: string; fullName: string; unit: string | null } | null;
  latestApplication: { slotTitle: string; joRefNo: string; dateApplied: string; status: string } | null;
  lastStage: { name: string; status: string } | null;
  referralNote: string | null;
  referralRewardNote: string | null;
  dateApplied: string;
}

interface ReferralResp {
  rows: ReferralRow[];
  stats: { total: number; employed: number; rewarded: number };
}

// ---------- label & warna (tanpa indigo/blue — pola modul rekrutmen) ----------

const STATUSES: { key: string; label: string; labelEn: string }[] = [
  { key: "Active", label: "Aktif", labelEn: "Active" },
  { key: "Outdated", label: "Kedaluwarsa", labelEn: "Outdated" },
  { key: "Rejected", label: "Ditolak", labelEn: "Rejected" },
  { key: "Employed", label: "Bekerja", labelEn: "Employed" },
];
const S_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));
const S_LABEL_EN: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.key, s.labelEn]));

const TONE_CLS: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  teal: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
};
const TONE_DOT: Record<string, string> = {
  emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", teal: "bg-teal-500", slate: "bg-slate-400",
};
const S_TONE: Record<string, string> = { Active: "emerald", Outdated: "amber", Rejected: "rose", Employed: "teal" };

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONE_CLS[tone] ?? TONE_CLS.slate)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone] ?? TONE_DOT.slate)} aria-hidden />
      {children}
    </span>
  );
}

function fmtDay(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

/** Ringkas catatan utk sel tabel (tooltip memuat teks penuh). */
function clip(v: string | null, n = 64): string {
  if (!v) return "";
  return v.length > n ? `${v.slice(0, n)}…` : v;
}

// ---------- halaman utama ----------

export function ReferralRegisterPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();

  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rewardOnly, setRewardOnly] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const url = useMemo(() => {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("q", debouncedQ);
    if (statusFilter !== "all") sp.set("status", statusFilter);
    if (rewardOnly) sp.set("rewardOnly", "1");
    return `/api/rekankerja/recruitment/referrals?${sp.toString()}`;
  }, [debouncedQ, statusFilter, rewardOnly]);

  const api = useApi<ReferralResp>(url, [url]);
  const rows = api.data?.rows ?? [];
  const stats = api.data?.stats;

  const canReward = perms.canOp("recruitment", "referral", "reward");

  // dialog catat insentif (manual — di luar payroll)
  const [rewardTarget, setRewardTarget] = useState<ReferralRow | null>(null);
  const [rewardText, setRewardText] = useState("");
  const [rewardBusy, setRewardBusy] = useState(false);

  const openReward = (r: ReferralRow) => {
    setRewardTarget(r);
    setRewardText(r.referralRewardNote ?? "");
  };

  const saveReward = async () => {
    if (!rewardTarget) return;
    if (rewardText.trim().length > 500) {
      toast.error(t("Catatan insentif maksimal 500 karakter", "Reward note is limited to 500 characters"));
      return;
    }
    setRewardBusy(true);
    try {
      await apiSend("/api/rekankerja/recruitment/referrals", "POST", {
        action: "updateReward",
        applicantId: rewardTarget.id,
        referralRewardNote: rewardText.trim(),
      });
      toast.success(t("Catatan insentif referral disimpan (manual — di luar payroll)", "Referral reward note saved (manual — outside payroll)"));
      setRewardTarget(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan catatan insentif", "Failed to save the reward note"));
    } finally {
      setRewardBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Rekrutmen · B8"
        title={t("Referral Karyawan", "Employee Referrals")}
        description={t(
          "Register pelamar yang dirujuk karyawan — perujuk + unit, slot dilamar, status pipeline, dan catatan insentif manual per perujuk.",
          "Register of employee-referred applicants — referrer + unit, applied slot, pipeline status, and the manual reward note per referrer.",
        )}
      />

      {/* ---- banner tegas §5: insentif = catatan MANUAL — DI LUAR payroll ---- */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
            {t("Insentif referral dicatat MANUAL oleh HR — TIDAK otomatis masuk payroll", "Referral rewards are recorded MANUALLY by HR — NOT automatically added to payroll")}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700/90 dark:text-amber-400/80">
            {t(
              "Kolom insentif di register ini adalah CATATAN saja (mis. \"Bonus Rp 2.000.000 — dibayar manual via kasir Q4\"). Sistem tidak menghitung, tidak membebankan, dan tidak membayar insentif apa pun — pencairan sepenuhnya proses manual HR di luar payroll. Status referral mengikuti proses rekrutmen pelamar.",
              "The reward column in this register is a NOTE only (e.g. \"IDR 2,000,000 bonus — paid manually via the Q4 cashier\"). The system does not compute, charge, or pay any reward — disbursement is entirely a manual HR process outside payroll. Referral status follows the applicant's recruitment process.",
            )}
          </p>
        </div>
      </div>

      {/* ---- stats tile ---- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Total Referral", "Total Referrals")}</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{stats?.total ?? 0}</div>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3 dark:border-teal-500/25 dark:bg-teal-500/10">
          <div className="text-xs font-medium text-teal-700 dark:text-teal-400">{t("Terkonversi (Bekerja)", "Converted (Employed)")}</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-teal-700 dark:text-teal-400">{stats?.employed ?? 0}</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/25 dark:bg-amber-500/10">
          <div className="text-xs font-medium text-amber-700 dark:text-amber-400">{t("Ber-insentif Tercatat", "With Recorded Reward")}</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">{stats?.rewarded ?? 0}</div>
        </div>
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4">
          {/* toolbar: q + status + rewardOnly */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Cari pelamar / perujuk / nomor…", "Search applicant / referrer / no.…")}
                className="pl-9"
                aria-label={t("Pencarian referral", "Referral search")}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
              <SelectTrigger className="h-9 w-[150px] rounded-xl" aria-label={t("Filter status", "Status filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua Status", "All Statuses")}</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{t(s.label, s.labelEn)}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <Switch checked={rewardOnly} onCheckedChange={setRewardOnly} aria-label={t("Hanya ber-insentif", "Rewarded only")} />
              {t("Hanya ber-insentif", "Rewarded only")}
            </label>
          </div>

          {api.loading && !api.data ? (
            <LoadingRows rows={6} />
          ) : api.error ? (
            <EmptyState title={t("Gagal memuat register referral", "Failed to load the referral register")} description={api.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t("Belum ada referral tercatat", "No referrals recorded yet")}
              description={t(
                "Referral muncul otomatis saat pelamar di talent pool memiliki karyawan perujuk (field \"Direferensikan Karyawan\" pada form pelamar).",
                "Referrals appear automatically when a talent-pool applicant has a referring employee (the \"Referred by Employee\" field on the applicant form).",
              )}
            />
          ) : (
            <>
              {/* ---- tabel desktop ---- */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Pelamar", "Applicant")}</TableHead>
                      <TableHead>{t("Perujuk", "Referrer")}</TableHead>
                      <TableHead className="hidden lg:table-cell">{t("Slot Dilamar", "Applied Slot")}</TableHead>
                      <TableHead>{t("Status Pipeline", "Pipeline Status")}</TableHead>
                      <TableHead className="hidden xl:table-cell">{t("Catatan Perujuk", "Referrer Note")}</TableHead>
                      <TableHead>{t("Insentif (manual)", "Reward (manual)")}</TableHead>
                      <TableHead className="hidden sm:table-cell">{t("Tanggal", "Date")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-mono text-xs font-semibold">{r.applicantNo}</div>
                          <div className="font-medium">{r.fullName}</div>
                        </TableCell>
                        <TableCell>
                          {r.referrer ? (
                            <div>
                              <div className="text-[13px] font-medium">{r.referrer.fullName}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {r.referrer.employeeNo}{r.referrer.unit ? ` · ${r.referrer.unit}` : ""}
                              </div>
                            </div>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {r.latestApplication ? (
                            <div>
                              <div className="text-[13px]">{r.latestApplication.slotTitle}</div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.latestApplication.joRefNo}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">{t("belum melamar slot", "no slot applied")}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Pill tone={S_TONE[r.status] ?? "slate"}>{t(S_LABEL[r.status] ?? r.status, S_LABEL_EN[r.status] ?? r.status)}</Pill>
                            {r.lastStage && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {t("tahap", "stage")}: {r.lastStage.name} · {r.lastStage.status}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell max-w-[220px]" title={r.referralNote ?? undefined}>
                          {r.referralNote ? <span className="text-xs">{clip(r.referralNote)}</span> : <span className="text-slate-400">—</span>}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          {r.referralRewardNote ? (
                            <div className="flex items-start gap-1.5">
                              <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                              <span className="text-xs" title={r.referralRewardNote}>{clip(r.referralRewardNote)}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">{t("belum ada", "none yet")}</span>
                          )}
                          {canReward && (
                            <Button
                              variant="ghost" size="sm" className="mt-1 h-7 gap-1 px-2 text-[11px]"
                              onClick={() => openReward(r)}
                              aria-label={t("Ubah catatan insentif", "Edit reward note")}
                            >
                              <Pencil className="h-3 w-3" aria-hidden /> {t("Ubah insentif", "Edit reward")}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs">{fmtDay(r.dateApplied, locale)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ---- kartu mobile ---- */}
              <div className="space-y-3 md:hidden">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">{r.applicantNo}</div>
                        <div className="text-sm font-semibold">{r.fullName}</div>
                      </div>
                      <Pill tone={S_TONE[r.status] ?? "slate"}>{t(S_LABEL[r.status] ?? r.status, S_LABEL_EN[r.status] ?? r.status)}</Pill>
                    </div>
                    <div className="mt-2 space-y-1 text-[12px] text-slate-600 dark:text-slate-300">
                      <div className="flex items-start gap-1.5">
                        <UserRoundCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span>{r.referrer ? `${r.referrer.fullName} (${r.referrer.employeeNo}${r.referrer.unit ? ` · ${r.referrer.unit}` : ""})` : "—"}</span>
                      </div>
                      {r.latestApplication && (
                        <div className="text-slate-500 dark:text-slate-400">
                          {r.latestApplication.slotTitle} · <span className="font-mono text-[11px]">{r.latestApplication.joRefNo}</span>
                        </div>
                      )}
                      {r.lastStage && (
                        <div className="text-slate-500 dark:text-slate-400">
                          {t("Tahap terakhir", "Latest stage")}: {r.lastStage.name} · {r.lastStage.status}
                        </div>
                      )}
                      {r.referralNote && (
                        <div className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800/60">{clip(r.referralNote, 120)}</div>
                      )}
                      <div className="flex items-start gap-1.5">
                        <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                        <span className="min-w-0">{r.referralRewardNote ? clip(r.referralRewardNote, 120) : t("belum ada insentif tercatat", "no reward recorded yet")}</span>
                      </div>
                    </div>
                    {canReward && (
                      <Button variant="outline" size="sm" className="mt-2 h-8 w-full gap-1.5" onClick={() => openReward(r)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> {t("Ubah insentif (manual)", "Edit reward (manual)")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- dialog catat insentif (MANUAL — di luar payroll) ---- */}
      <Dialog open={!!rewardTarget} onOpenChange={(v) => { if (!v) setRewardTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("Catat Insentif Referral — ", "Record Referral Reward — ")}{rewardTarget?.applicantNo ?? ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              {t(
                `Pelamar ${rewardTarget?.fullName ?? ""} dirujuk oleh ${rewardTarget?.referrer?.fullName ?? "—"}.`,
                `Applicant ${rewardTarget?.fullName ?? ""} was referred by ${rewardTarget?.referrer?.fullName ?? "—"}.`,
              )}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="referral-reward-note">{t("Catatan insentif (maks. 500 karakter)", "Reward note (max. 500 characters)")}</Label>
              <Textarea
                id="referral-reward-note"
                rows={4}
                value={rewardText}
                onChange={(e) => setRewardText(e.target.value)}
                placeholder={t("mis. Bonus Rp 2.000.000 — dibayar manual via kasir Q4", "e.g. IDR 2,000,000 bonus — paid manually via the Q4 cashier")}
              />
              <div className="text-right text-[11px] text-slate-400">{rewardText.length}/500</div>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                {t(
                  "Catatan ini MANUAL — di luar payroll. Sistem tidak menghitung/membayar insentif; kosongkan lalu simpan untuk menghapus catatan. Setiap perubahan tercatat di Log Aktivitas.",
                  "This note is MANUAL — outside payroll. The system does not compute/pay rewards; clear and save to erase the note. Every change is recorded in the Activity Log.",
                )}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRewardTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={() => void saveReward()} disabled={rewardBusy} className="gap-2">
              {rewardBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("Simpan Catatan", "Save Note")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
