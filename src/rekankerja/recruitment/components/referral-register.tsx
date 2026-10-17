"use client";
// ============================================================================
// RECRUITMENT B8 + P1.6 — REFERRAL REGISTER (tab modul Rekrutmen)
// DEVELOPMENT-PLAN-BACKLOG.md §4 B8 + §5 risiko "Insentif referral
// disalahpahami otomatis" → BANNER AMBER tegas (tab Register): insentif
// referral dicatat MANUAL oleh HR — TIDAK otomatis masuk payroll.
// Dua tab internal (tanpa view/nav baru — view "referral" tetap):
//   · "Register" — SEMUA Applicant ber-karyawan-perujuk: pelamar, perujuk +
//     unit, slot terakhir, status pipeline ringkas, referralNote, catatan
//     insentif manual (edit inline utk HR ber-op "reward").
//   · "Pengajuan Masuk" (P1.6 — DEVELOPMENT-PLAN-BENCHMARK.md §2 D-BM15) —
//     staging pengajuan referral ESS "ala public staging ringan": verifikasi
//     (→ Applicant source Referral + perujuk; register B8 mengambil alih),
//     tolak (alasan ≥10 char wajib), deteksi duplikat email (badge applicantNo
//     existing — copy). Mobile = kartu (tabel terlalu padat).
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Users, Search, UserRoundCheck, AlertTriangle, Pencil, Loader2, Gift,
  Inbox, UserCheck, Ban, Copy, CheckCircle2,
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

// ---------- tipe lokal (mirror kontrak GET /recruitment/referral-staging P1.6) ----------

interface SubmissionRow {
  id: string;
  docNo: string;
  referrer: { employeeNo: string; fullName: string };
  jobOpening: { id: string; title: string; joRefNo: string } | null;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  note: string | null;
  status: string;
  verifyNote: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

interface StagingResp {
  rows: SubmissionRow[];
  stats: { total: number; submitted: number; verified: number; rejected: number; duplicate: number };
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

/** Status staging pengajuan referral (P1.6). */
const SUB_STATUSES: { key: string; label: string; labelEn: string }[] = [
  { key: "Submitted", label: "Menunggu", labelEn: "Pending" },
  { key: "Verified", label: "Terverifikasi", labelEn: "Verified" },
  { key: "Rejected", label: "Ditolak", labelEn: "Rejected" },
  { key: "Duplicate", label: "Duplikat", labelEn: "Duplicate" },
];
const SUB_LABEL: Record<string, string> = Object.fromEntries(SUB_STATUSES.map((s) => [s.key, s.label]));
const SUB_LABEL_EN: Record<string, string> = Object.fromEntries(SUB_STATUSES.map((s) => [s.key, s.labelEn]));

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
const SUB_TONE: Record<string, string> = { Submitted: "amber", Verified: "emerald", Rejected: "rose", Duplicate: "slate" };

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

/** Ambil applicantNo pertama (APP-YY-NNNNN) dari teks verifyNote (badge duplikat). */
function applicantNoOf(text: string | null): string | null {
  if (!text) return null;
  return text.match(/APP-\d{2}-\d{4,6}/)?.[0] ?? null;
}

// ============================================================================
// TAB 1 — REGISTER PELAMAR DIRUJUK (B8 — konten asli)
// ============================================================================

function ReferralRegisterContent() {
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
    <>
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
                "Referral muncul otomatis saat pelamar di talent pool memiliki karyawan perujuk (field \"Direferensikan Karyawan\" pada form pelamar, atau hasil verifikasi tab Pengajuan Masuk).",
                "Referrals appear automatically when a talent-pool applicant has a referring employee (the \"Referred by Employee\" field on the applicant form, or a verified submission from the Incoming Submissions tab).",
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
    </>
  );
}

// ============================================================================
// TAB 2 — PENGAJUAN MASUK (P1.6 staging verifikasi HR)
// ============================================================================

function ReferralStagingContent() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();

  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("Submitted");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const url = useMemo(() => {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("q", debouncedQ);
    if (statusFilter !== "all") sp.set("status", statusFilter);
    return `/api/rekankerja/recruitment/referral-staging?${sp.toString()}`;
  }, [debouncedQ, statusFilter]);

  const api = useApi<StagingResp>(url, [url]);
  const rows = api.data?.rows ?? [];
  const stats = api.data?.stats;

  // aksi verify/reject → guard menu aksi "update" (tidak ada op khusus verify
  // di menu-perms recruitment:referral — hanya "reward")
  const canProcess = perms.can("recruitment", "referral", "update");

  // dialog verifikasi (konfirmasi)
  const [verifyTarget, setVerifyTarget] = useState<SubmissionRow | null>(null);
  // dialog tolak (alasan wajib ≥10 char)
  const [rejectTarget, setRejectTarget] = useState<SubmissionRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState(false);

  const doVerify = async () => {
    if (!verifyTarget) return;
    setBusy(true);
    try {
      const res = await apiSend<{ status: string; applicantNo: string | null }>("/api/rekankerja/recruitment/referral-staging", "PATCH", {
        id: verifyTarget.id, action: "verify",
      });
      toast.success(
        res.applicantNo
          ? t(`Terverifikasi — pelamar ${res.applicantNo} masuk talent pool (source Referral)`, `Verified — applicant ${res.applicantNo} added to the talent pool (source Referral)`)
          : t("Pengajuan terverifikasi", "Submission verified"),
      );
      setVerifyTarget(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memverifikasi", "Failed to verify"));
    } finally { setBusy(false); }
  };

  const doReject = async () => {
    if (!rejectTarget) return;
    if (rejectNote.trim().length < 10) {
      toast.error(t("Alasan penolakan minimal 10 karakter", "Rejection reason must be at least 10 characters"));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/recruitment/referral-staging", "PATCH", {
        id: rejectTarget.id, action: "reject", note: rejectNote.trim(),
      });
      toast.success(t(`Pengajuan ${rejectTarget.docNo} ditolak — perujuk diberitahukan`, `Submission ${rejectTarget.docNo} rejected — the referrer has been notified`));
      setRejectTarget(null);
      setRejectNote("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Aksi gagal", "Action failed"));
    } finally { setBusy(false); }
  };

  /** tombol salin applicantNo (badge duplikat / hasil verifikasi). */
  const copyNo = async (no: string) => {
    try {
      await navigator.clipboard.writeText(no);
      toast.success(t(`Disalin: ${no}`, `Copied: ${no}`));
    } catch {
      toast.error(t("Gagal menyalin", "Failed to copy"));
    }
  };

  const statCard = (key: string, label: string, labelEn: string, value: number | undefined) => (
    <button
      key={key}
      onClick={() => setStatusFilter(statusFilter === key ? "all" : key)}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        statusFilter === key
          ? "ov-border-accent ov-soft"
          : "border-slate-200 bg-white/80 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700",
      )}
    >
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(label, labelEn)}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value ?? 0}</div>
    </button>
  );

  /** badge applicantNo (verifyNote memuat APP-…): salin + klik-untuk-lihat tooltip. */
  const ApplicantBadge = ({ row }: { row: SubmissionRow }) => {
    const no = applicantNoOf(row.verifyNote);
    if (!no || (row.status !== "Duplicate" && row.status !== "Verified")) return null;
    return (
      <button
        type="button"
        onClick={() => void copyNo(no)}
        title={t(`Salin nomor pelamar ${no}`, `Copy applicant number ${no}`)}
        className={cn(
          "mt-1 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors",
          row.status === "Duplicate"
            ? "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
        )}
      >
        <Copy className="h-3 w-3" aria-hidden /> {no}
      </button>
    );
  };

  return (
    <>
      {/* ringkasan status staging */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCard("Submitted", "Menunggu", "Pending", stats?.submitted)}
        {statCard("Verified", "Terverifikasi", "Verified", stats?.verified)}
        {statCard("Rejected", "Ditolak", "Rejected", stats?.rejected)}
        {statCard("Duplicate", "Duplikat", "Duplicate", stats?.duplicate)}
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4">
          {/* toolbar: q + status */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Cari nomor / kandidat / perujuk…", "Search no. / candidate / referrer…")}
                className="pl-9"
                aria-label={t("Pencarian pengajuan referral", "Referral submission search")}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
              <SelectTrigger className="h-9 w-[150px] rounded-xl" aria-label={t("Filter status", "Status filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua Status", "All Statuses")}</SelectItem>
                {SUB_STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{t(s.label, s.labelEn)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {api.loading && !api.data ? (
            <LoadingRows rows={6} />
          ) : api.error ? (
            <EmptyState title={t("Gagal memuat pengajuan referral", "Failed to load referral submissions")} description={api.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={statusFilter
                ? t("Tidak ada pengajuan dengan status ini", "No submissions with this status")
                : t("Belum ada pengajuan referral", "No referral submissions yet")}
              description={t(
                "Karyawan mengajukan kandidat referral dari portal ESS (Referral Saya) — pengajuan masuk ke sini untuk diverifikasi HR sebelum kandidat menjadi pelamar.",
                "Employees submit referral candidates from the ESS portal (My Referrals) — submissions arrive here for HR verification before the candidate becomes an applicant.",
              )}
            />
          ) : (
            <>
              {/* ---- tabel desktop ---- */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Pengajuan", "Submission")}</TableHead>
                      <TableHead>{t("Perujuk", "Referrer")}</TableHead>
                      <TableHead>{t("Kandidat", "Candidate")}</TableHead>
                      <TableHead className="hidden lg:table-cell">{t("Lowongan", "Opening")}</TableHead>
                      <TableHead>{t("Status", "Status")}</TableHead>
                      <TableHead className="hidden sm:table-cell">{t("Diajukan", "Submitted")}</TableHead>
                      <TableHead>{t("Aksi", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-mono text-xs font-semibold">{r.docNo}</div>
                          {r.note && <div className="max-w-[200px] text-[11px] text-slate-500 dark:text-slate-400" title={r.note}>{clip(r.note)}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="text-[13px] font-medium">{r.referrer.fullName}</div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.referrer.employeeNo}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-[13px] font-medium">{r.candidateName}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {r.candidateEmail ?? "—"}{r.candidatePhone ? ` · ${r.candidatePhone}` : ""}
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {r.jobOpening ? (
                            <div>
                              <div className="text-[13px]">{r.jobOpening.title}</div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.jobOpening.joRefNo}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">{t("tanpa lowongan", "no opening")}</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[240px]">
                          <Pill tone={SUB_TONE[r.status] ?? "slate"}>{t(SUB_LABEL[r.status] ?? r.status, SUB_LABEL_EN[r.status] ?? r.status)}</Pill>
                          {r.verifyNote && <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400" title={r.verifyNote}>{clip(r.verifyNote, 80)}</div>}
                          <ApplicantBadge row={r} />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs">{fmtDay(r.createdAt, locale)}</TableCell>
                        <TableCell>
                          {r.status === "Submitted" ? (
                            canProcess ? (
                              <div className="flex gap-1">
                                <Button variant="outline" size="sm" className="h-8 gap-1 border-emerald-200 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:hover:bg-emerald-500/10" onClick={() => setVerifyTarget(r)}>
                                  <UserCheck className="h-3.5 w-3.5" aria-hidden /> {t("Verifikasi", "Verify")}
                                </Button>
                                <Button variant="outline" size="sm" className="h-8 gap-1 border-rose-200 px-2 text-[11px] text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10" onClick={() => setRejectTarget(r)}>
                                  <Ban className="h-3.5 w-3.5" aria-hidden /> {t("Tolak", "Reject")}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">{t("butuh aksi ubah", "needs update right")}</span>
                            )
                          ) : (
                            <div className="text-[11px] text-slate-400">
                              {r.verifiedBy ? `${t("oleh", "by")} ${r.verifiedBy}${r.verifiedAt ? ` · ${fmtDay(r.verifiedAt, locale)}` : ""}` : "—"}
                            </div>
                          )}
                        </TableCell>
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
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">{r.docNo}</div>
                        <div className="text-sm font-semibold">{r.candidateName}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t("perujuk", "referrer")}: {r.referrer.fullName} · <span className="font-mono">{r.referrer.employeeNo}</span>
                        </div>
                      </div>
                      <Pill tone={SUB_TONE[r.status] ?? "slate"}>{t(SUB_LABEL[r.status] ?? r.status, SUB_LABEL_EN[r.status] ?? r.status)}</Pill>
                    </div>
                    <div className="mt-2 space-y-1 text-[12px] text-slate-600 dark:text-slate-300">
                      <div className="text-slate-500 dark:text-slate-400">
                        {r.candidateEmail ?? "—"}{r.candidatePhone ? ` · ${r.candidatePhone}` : ""}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        {r.jobOpening
                          ? <>{r.jobOpening.title} · <span className="font-mono text-[11px]">{r.jobOpening.joRefNo}</span></>
                          : t("tanpa lowongan", "no opening")}
                        {" · "}{t("diajukan", "submitted")} {fmtDay(r.createdAt, locale)}
                      </div>
                      {r.note && (
                        <div className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800/60">{clip(r.note, 120)}</div>
                      )}
                      {r.verifyNote && (
                        <div className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800/60" title={r.verifyNote}>
                          <span className="font-semibold">{t("Catatan", "Note")}: </span>{clip(r.verifyNote, 120)}
                        </div>
                      )}
                      <ApplicantBadge row={r} />
                    </div>
                    {r.status === "Submitted" && canProcess && (
                      <div className="mt-2 flex gap-2">
                        <Button variant="outline" size="sm" className="h-8 flex-1 gap-1.5 border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400" onClick={() => setVerifyTarget(r)}>
                          <UserCheck className="h-3.5 w-3.5" aria-hidden /> {t("Verifikasi", "Verify")}
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 flex-1 gap-1.5 border-rose-200 text-rose-700 dark:border-rose-500/30 dark:text-rose-400" onClick={() => setRejectTarget(r)}>
                          <Ban className="h-3.5 w-3.5" aria-hidden /> {t("Tolak", "Reject")}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- dialog verifikasi (konfirmasi) ---- */}
      <Dialog open={!!verifyTarget} onOpenChange={(v) => { if (!v) setVerifyTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Verifikasi Pengajuan Referral", "Verify Referral Submission")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
              {t(
                `Pengajuan ${verifyTarget?.docNo ?? ""} — kandidat "${verifyTarget?.candidateName ?? ""}" oleh ${verifyTarget?.referrer?.fullName ?? "—"}.`,
                `Submission ${verifyTarget?.docNo ?? ""} — candidate "${verifyTarget?.candidateName ?? ""}" referred by ${verifyTarget?.referrer?.fullName ?? "—"}.`,
              )}
            </p>
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <p className="text-[12px] leading-relaxed text-emerald-800 dark:text-emerald-300">
                {t(
                  "Verifikasi membuat PELAMAR BARU di talent pool (source Referral, tercatat perujuk) — lanjut ke proses rekrutmen normal. Bila email kandidat sudah terdaftar, pengajuan ditandai Duplikat tanpa membuat pelamar baru.",
                  "Verifying creates a NEW applicant in the talent pool (source Referral, referrer recorded) and follows the normal recruitment process. If the candidate's email already exists, the submission is marked Duplicate without creating a new applicant.",
                )}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={() => void doVerify()} disabled={busy} className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("Verifikasi", "Verify")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- dialog tolak (alasan wajib) ---- */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => { if (!v) setRejectTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Tolak Pengajuan Referral", "Reject Referral Submission")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ref-reject-note">{t("Alasan penolakan (wajib, min. 10 karakter)", "Rejection reason (required, min. 10 characters)")}</Label>
              <Textarea
                id="ref-reject-note"
                rows={3}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder={t("mis. Kandidat sudah bekerja di perusahaan ini / kualifikasi belum sesuai kebutuhan saat ini", "e.g. the candidate already works at this company / qualifications do not match current needs")}
              />
              <div className="text-right text-[11px] text-slate-400">{rejectNote.trim().length}/10</div>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              {t(
                "Alasan ini dikirimkan ke karyawan perujuk sebagai notifikasi in-app (disampaikan secara sopan).",
                "This reason is sent to the referring employee as an in-app notification (delivered politely).",
              )}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={() => void doReject()} disabled={busy} variant="destructive" className="gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("Tolak Pengajuan", "Reject Submission")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------- halaman utama (tab switcher — tanpa view/nav baru) ----------

export function ReferralRegisterPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"register" | "staging">("register");

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Rekrutmen · Referral"
        title={t("Referral Karyawan", "Employee Referrals")}
        description={t(
          "Register pelamar yang dirujuk karyawan + kotak verifikasi pengajuan referral dari ESS — perujuk + unit, slot dilamar, status pipeline, dan catatan insentif manual per perujuk.",
          "Register of employee-referred applicants + the verification inbox for ESS referral submissions — referrer + unit, applied slot, pipeline status, and the manual reward note per referrer.",
        )}
      />

      {/* tab internal: register pelamar dirujuk | pengajuan masuk (staging P1.6) */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("Bagian referral", "Referral sections")}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "register"}
          onClick={() => setTab("register")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
            tab === "register"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100",
          )}
        >
          <Users className="h-3.5 w-3.5" aria-hidden /> {t("Register Pelamar Dirujuk", "Referred Applicants Register")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "staging"}
          onClick={() => setTab("staging")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
            tab === "staging"
              ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100",
          )}
        >
          <Inbox className="h-3.5 w-3.5" aria-hidden /> {t("Pengajuan Masuk", "Incoming Submissions")}
        </button>
      </div>

      {tab === "register" ? <ReferralRegisterContent /> : <ReferralStagingContent />}
    </div>
  );
}
