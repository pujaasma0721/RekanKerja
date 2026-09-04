"use client";
// OneVity Medical — Ringkasan: KPI modul + alur 4 langkah + kartu saldo & komposisi
import { useApi } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, LoadingCards } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HeartPulse, Inbox, Activity, CheckCircle2, FileText, TrendingUp,
  ArrowRight, Landmark, Boxes, Wallet,
} from "lucide-react";
import { MedicalStatsUI, fmtIDRShort, fmtIDR } from "./medical-types";

export function MedicalOverview() {
  const { navigate } = useNav();
  const { data, loading } = useApi<MedicalStatsUI>("/api/onevity/medical/overview");
  const s = data;

  const kpi = [
    {
      label: "Menunggu Persetujuan", value: s ? String(s.pendingClaims) : "—",
      sub: s ? `${s.totalClaims} klaim tahun ${s.year}` : undefined,
      icon: Inbox, tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
      onClick: () => navigate("medical", "medical-approval"),
    },
    {
      label: "Klaim Disetujui (Settled)", value: s ? String(s.settledClaims) : "—",
      sub: s ? `${fmtIDRShort(s.settledApproved)} dibayarkan — tagihan ${fmtIDRShort(s.settledBill)}` : undefined,
      icon: CheckCircle2, tone: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400",
      onClick: () => navigate("medical", "medical-approval"),
    },
    {
      label: "Sisa Saldo Medis", value: s ? fmtIDRShort(s.remaining) : "—",
      sub: s ? `${s.totalBalances} saldo karyawan × ${s.types} jenis` : undefined,
      icon: Wallet, tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
      onClick: () => navigate("medical", "medical-info"),
    },
    {
      label: "Penyesuaian Saldo", value: s ? String(s.adjustments) : "—",
      sub: "Medical Adjustment (± employee/dependent)",
      icon: Activity, tone: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
      onClick: () => navigate("medical", "medical-adjustment"),
    },
  ];

  const steps = [
    { n: 1, title: "Master & Saldo", desc: "Jenis benefit (limit faktor × gaji / nominal, frekuensi, dependent, kebijakan sisa saldo) + generate saldo per tahun", icon: Boxes, view: "medical-benefit-type" },
    { n: 2, title: "Klaim Medis", desc: "Pengajuan perawatan (rawat inap/jalan, gigi, kacamata…) — baris per perawatan: yang dirawat, diagnosa, kwitansi, dokter, RS, tagihan/reimburse/approved", icon: FileText, view: "medical-claim" },
    { n: 3, title: "Persetujuan & Settlement", desc: "Operation: Submit → Approve → Settle. Settle = jurnal otomatis (Debit 5106 Beban Medis / Credit Kas) + saldo used bertambah", icon: CheckCircle2, view: "medical-approval" },
    { n: 4, title: "Sisa Saldo → Payroll", desc: "Jenis dengan kebijakan CASH → Tarik Sisa Saldo akhir tahun → komponen UMC masuk payslip → Dibayar saat run dikonfirmasi", icon: Landmark, view: "medical-approval" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="MODUL MEDICAL"
        title="Ringkasan Medical Benefit"
        description="Klaim medis karyawan & dependent — saldo per jenis (limit faktor gaji/nominal), settlement dengan jurnal, penyesuaian, dan sisa saldo ditarik ke payroll (padanan Medical Benefit)"
      />

      {loading && !s ? (
        <LoadingCards cards={4} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpi.map((k) => (
              <Card
                key={k.label}
                className="cursor-pointer border-stone-200 bg-white/80 shadow-sm transition-all hover:shadow-md dark:border-stone-800 dark:bg-stone-900/80"
                onClick={k.onClick}
              >
                <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{k.label}</p>
                    <p className="mt-1 truncate text-2xl font-black text-stone-900 dark:text-stone-100">{k.value}</p>
                    {k.sub && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{k.sub}</p>}
                  </div>
                  <div className={`rounded-xl p-2.5 ${k.tone}`}>
                    <k.icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80 lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <TrendingUp className="h-4 w-4 text-rose-600" /> Alur Klaim Medis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {steps.map((st) => (
                  <button
                    key={st.n}
                    onClick={() => navigate("medical", st.view)}
                    className="flex w-full items-start gap-3 rounded-xl border border-stone-200 bg-white p-3 text-left transition-all hover:border-rose-300 hover:bg-rose-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-rose-700 dark:hover:bg-rose-950/30"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-600 text-sm font-black text-white">
                      {st.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-bold text-stone-900 dark:text-stone-100">
                        {st.title}
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-stone-500 dark:text-stone-400">{st.desc}</span>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-4 lg:col-span-2">
              <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-bold">
                    <HeartPulse className="h-4 w-4 text-rose-600" /> Formula Saldo Medis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800/60">
                    <span className="text-stone-600 dark:text-stone-300">Benefit Limit (kebijakan jenis)</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800/60">
                    <span className="text-stone-600 dark:text-stone-300">+ Penyesuaian ± + Carry-over − Used</span>
                  </div>
                  <div className="rounded-lg border-2 border-rose-200 bg-rose-50 px-3 py-2 text-center font-black text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
                    Sisa = Limit + Adj. + Carry − Used
                  </div>
                  <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                    Padanan <span className="font-semibold">My Medical Information</span>: snapshot
                    Max Benefit / Used / Balance tercatat di tiap klaim. Sisa &gt; 0 pada jenis CASH
                    ditarik tunai via komponen <span className="font-semibold">UMC</span> di payroll.
                  </p>
                </CardContent>
              </Card>

              {s && s.byType.length > 0 && (
                <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold">Klaim Settled per Jenis</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {s.byType.slice(0, 5).map((k) => {
                      const max = s.byType[0]?.approvedAmount || 1;
                      return (
                        <div key={k.typeCode}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-stone-700 dark:text-stone-300">{k.typeName}</span>
                            <span className="text-stone-500 dark:text-stone-400">{fmtIDRShort(k.approvedAmount)} · {k.claimCount}×</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                            <div className="h-full rounded-full bg-rose-500" style={{ width: `${(k.approvedAmount / max) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    <p className="pt-1 text-xs text-stone-500 dark:text-stone-400">
                      Total settled {fmtIDR(s.settledApproved)} dari tagihan {fmtIDR(s.settledBill)}
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
