"use client";
// RekanKerja ESS B8-BL — "Referral Saya" (DEVELOPMENT-PLAN-BACKLOG.md §4 B8):
// riwayat pelamar yang SAYA rujuk (self-scope — hanya referralEmployeeId =
// karyawan sesi; anti-IDOR via requireEss). READ-ONLY: ESS tidak bisa
// mengubah apa pun. referralRewardNote SENGAJA TIDAK dimuat (catatan internal
// HR — insentif manual di luar payroll; banner mengarahkan bertanya HR).
// Isi: stats kecil + daftar kartu (nama pelamar, slot, status chip, tanggal,
// referralNote bila ada) + empty-state ajakan merujuk + banner "status
// mengikuti proses rekrutmen — insentif diatur HR terpisah".
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { UserRoundCheck, Info, BriefcaseBusiness } from "lucide-react";
import { ESS_BASE } from "./ess-api";

// ---------- tipe lokal (mirror kontrak GET /ess/my-referrals) ----------

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

function statusOf(s: string) {
  return R_STATUS[s] ?? { id: s, en: s, cls: R_STATUS.Active.cls, dot: "bg-slate-400" };
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

// ---------- halaman ----------

export function EssMyReferralsPage() {
  const { t, locale } = useI18n();
  const api = useApi<MyReferralsResp>(`${ESS_BASE}/my-referrals`, []);
  const rows = api.data?.rows ?? [];
  const stats = api.data?.stats;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Rekrutmen · Referral"
        title={t("Referral Saya", "My Referrals")}
        description={t(
          "Riwayat pelamar yang Anda rujuk beserta status proses rekrutmennya.",
          "The applicants you referred, along with their recruitment process status.",
        )}
      />

      {/* banner: status mengikuti proses rekrutmen — insentif diatur HR terpisah */}
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
        <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
          {t(
            "Status referral mengikuti proses rekrutmen pelamar secara alami (tidak ada jalur khusus). Pengaturan insentif referral — bila berlaku — diatur HR secara terpisah sebagai catatan manual di luar payroll; silakan hubungi HR untuk info insentif.",
            "Referral status follows the applicant's regular recruitment process (no special track). Referral reward arrangements — when applicable — are handled separately by HR as a manual note outside payroll; please contact HR for reward information.",
          )}
        </p>
      </div>

      {/* stats kecil */}
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

      {api.loading && !api.data ? (
        <LoadingRows rows={4} />
      ) : api.error ? (
        <EmptyState title={t("Gagal memuat referral saya", "Failed to load my referrals")} description={api.error} />
      ) : rows.length === 0 ? (
        <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-6">
            <EmptyState
              icon={UserRoundCheck}
              title={t("Belum ada referral", "No referrals yet")}
              description={t(
                "Rujuk kenalan Anda lewat form lamaran portal karier dengan mengisi nama Anda sebagai perujuk — riwayatnya akan muncul di sini.",
                "Refer your acquaintances via the career portal application form by entering your name as the referrer — the history will appear here.",
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
