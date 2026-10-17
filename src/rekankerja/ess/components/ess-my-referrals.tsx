"use client";
// RekanKerja ESS B8-BL + P1.6 — "Referral Saya":
// · P1.6 (DEVELOPMENT-PLAN-BENCHMARK.md §2 D-BM15 + §4 P1.6): form
//   "Ajukan Kandidat Referral" (lowongan opsional + nama + email/WA minimal
//   satu + catatan) → staging verifikasi HR; di bawahnya "Pengajuan Saya"
//   (docNo, kandidat, lowongan, status pill, catatan HR) — self-scope via
//   requireEss (anti-IDOR), TANPA email/phone kandidat di payload.
// · B8: riwayat pelamar yang SAYA rujuk (Applicant referralEmployeeId =
//   karyawan sesi) — read-only; referralRewardNote SENGAJA TIDAK dimuat
//   (catatan internal HR — insentif manual di luar payroll).
// Verifikasi HR sukses → Applicant (source Referral) muncul di daftar B8
// ("Referral terverifikasi"); register HR + catatan insentif tetap di sisi HR.
import { useState } from "react";
import { toast } from "sonner";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { UserRoundCheck, Info, BriefcaseBusiness, Send, Loader2 } from "lucide-react";
import { ESS_BASE } from "./ess-api";

// ---------- tipe lokal (mirror kontrak GET /ess/my-referrals B8) ----------

interface MyReferralRow {
  id: string;
  applicantNo: string;
  fullName: string;
  status: string;
  referralNote: string | null;
  latestApplication: { slotTitle: string; joRefNo: string; dateApplied: string; status: string } | null;
  dateApplied: string;
}

interface MyReferralsResp {
  rows: MyReferralRow[];
  stats: { total: number; active: number; rejected: number; outdated: number; employed: number };
}

// ---------- tipe lokal (mirror kontrak GET/POST /ess/referral-submissions P1.6) ----------

interface MySubmissionRow {
  id: string;
  docNo: string;
  candidateName: string;
  jobOpening: { id: string; title: string; joRefNo: string } | null;
  note: string | null;
  status: string;
  verifyNote: string | null;
  createdAt: string;
}

interface ReferralOpeningOption {
  id: string;
  title: string;
  joRefNo: string;
}

interface MySubmissionsResp {
  rows: MySubmissionRow[];
  stats: { total: number; submitted: number; verified: number; rejected: number; duplicate: number };
  openings: ReferralOpeningOption[];
}

// ---------- label & warna (tanpa indigo/blue — pola ess-my-selection) ----------

const R_STATUS: Record<string, { id: string; en: string; cls: string; dot: string }> = {
  Active: {
    id: "Aktif", en: "Active",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
    dot: "bg-emerald-500",
  },
  Outdated: {
    id: "Kedaluwarsa", en: "Outdated",
    cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
    dot: "bg-amber-500",
  },
  Rejected: {
    id: "Ditolak", en: "Rejected",
    cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
    dot: "bg-rose-500",
  },
  Employed: {
    id: "Bekerja", en: "Employed",
    cls: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
    dot: "bg-teal-500",
  },
};

/** Status pengajuan referral P1.6 (staging). */
const S_STATUS: Record<string, { id: string; en: string; cls: string; dot: string }> = {
  Submitted: {
    id: "Menunggu verifikasi", en: "Pending verification",
    cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
    dot: "bg-amber-500",
  },
  Verified: {
    id: "Terverifikasi", en: "Verified",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
    dot: "bg-emerald-500",
  },
  Rejected: {
    id: "Ditolak", en: "Rejected",
    cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
    dot: "bg-rose-500",
  },
  Duplicate: {
    id: "Duplikat", en: "Duplicate",
    cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
    dot: "bg-slate-400",
  },
};

function statusOf(s: string) {
  return R_STATUS[s] ?? { id: s, en: s, cls: R_STATUS.Active.cls, dot: "bg-slate-400" };
}

function subStatusOf(s: string) {
  return S_STATUS[s] ?? { id: s, en: s, cls: S_STATUS.Submitted.cls, dot: "bg-slate-400" };
}

/** Warna angka tile stats per status (total netral, lainnya ikut warna pill). */
const STAT_TONE: Record<string, string> = {
  total: "text-slate-900 dark:text-slate-50",
  active: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-rose-600 dark:text-rose-400",
  outdated: "text-amber-600 dark:text-amber-400",
  employed: "text-teal-600 dark:text-teal-400",
};

function Pill({ s }: { s: { id: string; en: string; cls: string; dot: string } }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {t(s.id, s.en)}
    </span>
  );
}

function fmtShortDate(v: string | null, locale: string): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

// ---------- form ajukan kandidat referral ----------

function ReferralSubmitForm({ openings, onDone }: { openings: ReferralOpeningOption[]; onDone: () => void }) {
  const { t } = useI18n();
  const [openingId, setOpeningId] = useState("none");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const clientValidate = (): string | null => {
    if (name.trim().length < 3) return t("Nama kandidat minimal 3 karakter", "Candidate name must be at least 3 characters");
    if (!email.trim() && !phone.trim()) return t("Isi minimal satu kontak: email atau nomor WA/telepon", "Provide at least one contact: email or WhatsApp/phone number");
    return null;
  };

  const submit = async () => {
    const err = clientValidate();
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ row: MySubmissionRow }>(`${ESS_BASE}/referral-submissions`, "POST", {
        jobOpeningId: openingId === "none" ? null : openingId,
        candidateName: name,
        candidateEmail: email || null,
        candidatePhone: phone || null,
        note: note || null,
      });
      toast.success(t(
        `Pengajuan referral ${res.row.docNo} terkirim — menunggu verifikasi HR`,
        `Referral submission ${res.row.docNo} sent — awaiting HR verification`,
      ));
      setName(""); setEmail(""); setPhone(""); setNote(""); setOpeningId("none");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengirim pengajuan referral", "Failed to submit the referral"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <UserRoundCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <h3 className="text-sm font-bold">{t("Ajukan Kandidat Referral", "Refer a Candidate")}</h3>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
          {t(
            "Kenal orang yang layak direkrut? Ajukan di sini — HR akan memverifikasi; jika lolos, kandidat masuk talent pool sebagai referral Anda.",
            "Know someone worth hiring? Submit here — HR will verify; once approved, the candidate enters the talent pool as your referral.",
          )}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ref-name">{t("Nama kandidat", "Candidate name")} <span className="text-rose-500">*</span></Label>
            <Input
              id="ref-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
              placeholder={t("mis. Dewi Lestari", "e.g. Dewi Lestari")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-email">{t("Email kandidat", "Candidate email")}</Label>
            <Input
              id="ref-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120}
              placeholder={t("nama@email.com", "name@email.com")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-phone">{t("No. WA/telepon kandidat", "Candidate WhatsApp/phone")}</Label>
            <Input
              id="ref-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20}
              placeholder={t("08xx / +62…", "08xx / +62…")}
            />
            <p className="text-[11px] text-slate-400">
              {t("Isi minimal satu: email atau nomor WA.", "Fill in at least one: email or WhatsApp number.")}
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ref-opening">{t("Lowongan (opsional)", "Job opening (optional)")}</Label>
            <Select value={openingId} onValueChange={setOpeningId}>
              <SelectTrigger id="ref-opening" className="w-full" aria-label={t("Pilih lowongan", "Pick an opening")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("Tanpa lowongan tertentu", "No specific opening")}</SelectItem>
                {openings.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.title} · <span className="font-mono text-[11px]">{o.joRefNo}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ref-note">{t("Catatan untuk HR", "Note for HR")}</Label>
            <Textarea
              id="ref-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              placeholder={t("Kenapa kandidat ini layak (hubungan, keahlian, dsb.)", "Why this candidate is worth referring (relationship, skills, etc.)")}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => void submit()} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {t("Kirim Pengajuan", "Send Submission")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- halaman ----------

export function EssMyReferralsPage() {
  const { t, locale } = useI18n();
  const api = useApi<MyReferralsResp>(`${ESS_BASE}/my-referrals`, []);
  const subs = useApi<MySubmissionsResp>(`${ESS_BASE}/referral-submissions`, []);
  const rows = api.data?.rows ?? [];
  const stats = api.data?.stats;
  const subRows = subs.data?.rows ?? [];
  const openings = subs.data?.openings ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Rekrutmen · Referral"
        title={t("Referral Saya", "My Referrals")}
        description={t(
          "Ajukan kandidat referral untuk diverifikasi HR, dan pantau riwayat pelamar yang Anda rujuk beserta status proses rekrutmennya.",
          "Submit referral candidates for HR verification, and track the applicants you referred along with their recruitment process status.",
        )}
      />

      {/* banner: status mengikuti proses rekrutmen — insentif diatur HR terpisah */}
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
        <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
          {t(
            "Pengajuan diverifikasi HR sebelum kandidat masuk talent pool. Status referral mengikuti proses rekrutmen pelamar secara alami (tidak ada jalur khusus). Pengaturan insentif referral — bila berlaku — diatur HR secara terpisah sebagai catatan manual di luar payroll; silakan hubungi HR untuk info insentif.",
            "Submissions are verified by HR before the candidate enters the talent pool. Referral status follows the applicant's regular recruitment process (no special track). Referral reward arrangements — when applicable — are handled separately by HR as a manual note outside payroll; please contact HR for reward information.",
          )}
        </p>
      </div>

      {/* form ajukan kandidat referral (P1.6) */}
      <ReferralSubmitForm openings={openings} onDone={() => { subs.refresh(); api.refresh(); }} />

      {/* pengajuan saya (staging P1.6) */}
      <section aria-labelledby="my-submissions-h">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="my-submissions-h" className="text-sm font-bold">{t("Pengajuan Saya", "My Submissions")}</h3>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {t("maks. 10 per bulan", "max. 10 per month")}
          </span>
        </div>
        {subs.loading && !subs.data ? (
          <LoadingRows rows={3} />
        ) : subs.error ? (
          <EmptyState title={t("Gagal memuat pengajuan referral", "Failed to load referral submissions")} description={subs.error} />
        ) : subRows.length === 0 ? (
          <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-6">
              <EmptyState
                icon={Send}
                title={t("Belum ada pengajuan", "No submissions yet")}
                description={t(
                  "Form di atas untuk mengajukan kandidat referral — riwayat pengajuan dan hasil verifikasi HR akan muncul di sini.",
                  "Use the form above to refer a candidate — your submissions and HR verification results will appear here.",
                )}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
            {subRows.map((r) => (
              <Card key={r.id} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">{r.docNo}</div>
                      <div className="text-sm font-semibold">{r.candidateName}</div>
                    </div>
                    <Pill s={subStatusOf(r.status)} />
                  </div>
                  <div className="mt-2 space-y-1 text-[12px] text-slate-600 dark:text-slate-300">
                    <div className="flex items-start gap-1.5">
                      <BriefcaseBusiness className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      <span className="min-w-0">
                        {r.jobOpening
                          ? <>{r.jobOpening.title} · <span className="font-mono text-[11px]">{r.jobOpening.joRefNo}</span></>
                          : t("Tanpa lowongan tertentu", "No specific opening")}
                        {" · "}{t("diajukan", "submitted")} {fmtShortDate(r.createdAt, locale)}
                      </span>
                    </div>
                    {r.note && <div className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800/60">{r.note}</div>}
                    {r.verifyNote && (
                      <div className={cn(
                        "rounded-lg p-2 text-[11px]",
                        r.status === "Rejected"
                          ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400"
                          : r.status === "Duplicate"
                            ? "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
                            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
                      )}>
                        <span className="font-semibold">{t("Catatan HR", "HR note")}: </span>{r.verifyNote}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* stats pelamar referral (B8) */}
      <section aria-labelledby="my-ref-h">
        <h3 id="my-ref-h" className="mb-2 text-sm font-bold">{t("Pelamar Hasil Verifikasi", "Verified Referred Applicants")}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t("Total", "Total")}</div>
            <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", STAT_TONE.total)}>{stats?.total ?? 0}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t(R_STATUS.Active.id, R_STATUS.Active.en)}</div>
            <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", STAT_TONE.active)}>{stats?.active ?? 0}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t(R_STATUS.Rejected.id, R_STATUS.Rejected.en)}</div>
            <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", STAT_TONE.rejected)}>{stats?.rejected ?? 0}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t(R_STATUS.Outdated.id, R_STATUS.Outdated.en)}</div>
            <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", STAT_TONE.outdated)}>{stats?.outdated ?? 0}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t(R_STATUS.Employed.id, R_STATUS.Employed.en)}</div>
            <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", STAT_TONE.employed)}>{stats?.employed ?? 0}</div>
          </div>
        </div>
      </section>

      {api.loading && !api.data ? (
        <LoadingRows rows={4} />
      ) : api.error ? (
        <EmptyState title={t("Gagal memuat referral saya", "Failed to load my referrals")} description={api.error} />
      ) : rows.length === 0 ? (
        <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-6">
            <EmptyState
              icon={UserRoundCheck}
              title={t("Belum ada pelamar referral terverifikasi", "No verified referred applicants yet")}
              description={t(
                "Ajukan kandidat lewat form di atas — setelah diverifikasi HR, kandidat masuk talent pool sebagai referral Anda dan riwayatnya muncul di sini.",
                "Submit a candidate using the form above — once HR verifies it, the candidate enters the talent pool as your referral and the history appears here.",
              )}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">{r.applicantNo}</div>
                    <div className="text-sm font-semibold">{r.fullName}</div>
                  </div>
                  <Pill s={statusOf(r.status)} />
                </div>
                <div className="mt-2 space-y-1 text-[12px] text-slate-600 dark:text-slate-300">
                  {r.latestApplication ? (
                    <div className="flex items-start gap-1.5">
                      <BriefcaseBusiness className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      <span className="min-w-0">
                        {r.latestApplication.slotTitle} · <span className="font-mono text-[11px]">{r.latestApplication.joRefNo}</span>
                        {" · "}{t("melamar", "applied")} {fmtShortDate(r.latestApplication.dateApplied, locale)}
                      </span>
                    </div>
                  ) : (
                    <div className="text-slate-400">{t("Belum melamar slot lowongan", "Has not applied to a job slot yet")}</div>
                  )}
                  <div className="text-slate-500 dark:text-slate-400">
                    {t("Masuk talent pool", "Entered the talent pool")}: {fmtShortDate(r.dateApplied, locale)}
                  </div>
                  {r.referralNote && (
                    <div className="rounded-lg bg-slate-50 p-2 text-[11px] dark:bg-slate-800/60">{r.referralNote}</div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
