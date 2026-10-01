"use client";
// RekanKerja Medical — Ringkasan: KPI modul + alur 4 langkah + kartu saldo & komposisi
import { useApi } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, LoadingCards } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HeartPulse, Inbox, Activity, CheckCircle2, FileText, TrendingUp,
  ArrowRight, Landmark, Boxes, Wallet,
} from "lucide-react";
import { MedicalStatsUI, fmtIDRShort, fmtIDR } from "./medical-types";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

export function MedicalOverview() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const { data, loading } = useApi<MedicalStatsUI>("/api/rekankerja/medical/overview");
  const s = data;

  const kpi = [
    {
      label: t("Menunggu Persetujuan"), value: s ? String(s.pendingClaims) : "—",
      sub: s ? t("{n} klaim tahun {y}", "{n} claims in {y}", { n: s.totalClaims, y: s.year }) : undefined,
      icon: Inbox, hero: true,
      onClick: () => navigate("medical", "medical-approval"),
    },
    {
      label: t("Klaim Disetujui (Settled)", "Approved Claims (Settled)"), value: s ? String(s.settledClaims) : "—",
      sub: s ? t("{a} dibayarkan — tagihan {b}", "{a} paid out — billed {b}", { a: fmtIDRShort(s.settledApproved), b: fmtIDRShort(s.settledBill) }) : undefined,
      icon: CheckCircle2,
      onClick: () => navigate("medical", "medical-approval"),
    },
    {
      label: t("Sisa Saldo Medis", "Remaining Medical Balance"), value: s ? fmtIDRShort(s.remaining) : "—",
      // W2-3 (fix m-3): sisa pool dependent TERPISAH kini tampil (dulu 420jt tak
      // terlihat); SHARED tidak dijumlahkan — pool bersama sudah di remaining.
      sub: s
        ? (s.dependentRemaining
          ? t("{n} saldo × {m} jenis · dependent {d}", "{n} balances × {m} types · dependents {d}", { n: s.totalBalances, m: s.types, d: fmtIDRShort(s.dependentRemaining) })
          : t("{n} saldo karyawan × {m} jenis", "{n} employee balances × {m} types", { n: s.totalBalances, m: s.types }))
        : undefined,
      icon: Wallet,
      onClick: () => navigate("medical", "medical-info"),
    },
    {
      label: t("Penyesuaian Saldo"), value: s ? String(s.adjustments) : "—",
      sub: "Medical Adjustment (± employee/dependent)",
      icon: Activity,
      onClick: () => navigate("medical", "medical-adjustment"),
    },
  ];

  const steps = [
    { n: 1, title: t("Master & Saldo", "Master & Balances"), desc: t("Jenis benefit (limit faktor × gaji / nominal, frekuensi, dependent, kebijakan sisa saldo) + generate saldo per tahun", "Benefit types (salary-factor × / nominal limit, frequency, dependents, year-end balance rule) + generate balances per year"), icon: Boxes, view: "medical-benefit-type" },
    { n: 2, title: t("Klaim Medis"), desc: t("Pengajuan perawatan (rawat inap/jalan, gigi, kacamata…) — baris per perawatan: yang dirawat, diagnosa, kwitansi, dokter, RS, tagihan/reimburse/approved", "Treatment submissions (inpatient/outpatient, dental, glasses…) — one line per treatment: treated person, diagnosis, receipt, physician, hospital, bill/reimburse/approved"), icon: FileText, view: "medical-claim" },
    { n: 3, title: t("Persetujuan & Settlement"), desc: t("Operation: Submit → Approve → Settle. Settle = jurnal otomatis (Debit 5106 Beban Medis / Credit Kas) + saldo used bertambah", "Operation: Submit → Approve → Settle. Settle = automatic journal (Debit 5106 Medical Expense / Credit Cash) + used balance increases"), icon: CheckCircle2, view: "medical-approval" },
    { n: 4, title: t("Sisa Saldo → Payroll", "Remaining Balance → Payroll"), desc: t("Jenis dengan kebijakan CASH → Tarik Sisa Saldo akhir tahun → komponen UMC masuk payslip → Dibayar saat run dikonfirmasi", "Types with the CASH rule → draw the year-end remaining balance → UMC component goes into the payslip → paid when the run is confirmed"), icon: Landmark, view: "medical-approval" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("Modul Medical", "Medical Module")}
        title={t("Ringkasan Medical Benefit", "Medical Benefit Overview")}
        description={t("Klaim medis karyawan & dependent — saldo per jenis (limit faktor gaji/nominal), settlement dengan jurnal, penyesuaian, dan sisa saldo ditarik ke payroll (padanan Medical Benefit)", "Employee & dependent medical claims — balances per type (salary-factor/nominal limit), settlement with journals, adjustments, and remaining balance drawn to payroll (equivalent to Medical Benefit)")}
      />

      {loading && !s ? (
        <LoadingCards cards={4} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpi.map((k) => (
              <Card
                key={k.label}
                className="cursor-pointer border-slate-200 bg-white/80 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80"
                onClick={k.onClick}
              >
                <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{k.label}</p>
                    <p className="mt-1 truncate text-2xl font-black text-slate-900 dark:text-slate-100">{k.value}</p>
                    {k.sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{k.sub}</p>}
                  </div>
                  <div className={cn("rounded-xl p-2.5", k.hero ? "ov-fill" : "ov-tile")}>
                    <k.icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <TrendingUp className="h-4 w-4 ov-text-accent" /> {t("Alur Klaim Medis", "Medical Claim Flow")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {steps.map((st) => (
                  <button
                    key={st.n}
                    onClick={() => navigate("medical", st.view)}
                    className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:ov-border-accent hover:ov-soft dark:border-slate-800 dark:bg-slate-900"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ov-fill text-sm font-black">
                      {st.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                        {st.title}
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{st.desc}</span>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-4 lg:col-span-2">
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-bold">
                    <HeartPulse className="h-4 w-4 ov-text-accent" /> {t("Formula Saldo Medis", "Medical Balance Formula")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300">{t("Benefit Limit (kebijakan jenis)", "Benefit Limit (type policy)")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300">{t("+ Penyesuaian ± + Carry-over − Used", "+ Adjustment ± + Carry-over − Used")}</span>
                  </div>
                  <div className="rounded-lg border-2 ov-border-accent ov-soft px-3 py-2 text-center font-black">
                    {t("Sisa = Limit + Adj. + Carry − Used", "Remaining = Limit + Adj. + Carry − Used")}
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {t("Padanan ", "Equivalent to ")}<span className="font-semibold">My Medical Information</span>{t(": snapshot Max Benefit / Used / Balance tercatat di tiap klaim. Sisa > 0 pada jenis CASH ditarik tunai via komponen ", ": snapshot Max Benefit / Used / Balance recorded on each claim. Remaining > 0 on CASH types is drawn in cash via the ")}<span className="font-semibold">UMC</span>{t(" di payroll.", " component in payroll.")}
                  </p>
                </CardContent>
              </Card>

              {s && s.byType.length > 0 && (
                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold">{t("Klaim Settled per Jenis", "Settled Claims by Type")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {s.byType.slice(0, 5).map((k) => {
                      const max = s.byType[0]?.approvedAmount || 1;
                      return (
                        <div key={k.typeCode}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-700 dark:text-slate-300">{k.typeName}</span>
                            <span className="text-slate-500 dark:text-slate-400">{fmtIDRShort(k.approvedAmount)} · {k.claimCount}×</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div className="h-full rounded-full ov-chart" style={{ width: `${(k.approvedAmount / max) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">
                      {t("Total settled {a} dari tagihan {b}", "Total settled {a} of {b} billed", { a: fmtIDR(s.settledApproved), b: fmtIDR(s.settledBill) })}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
