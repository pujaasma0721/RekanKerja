"use client";
// SB-RC-RD — views dokumen Recruitment Grup 3 (Seleksi & Penilaian) + =====
// Grup 4 (Offer, Pengangkatan & Biaya). Komponen dasar dari doc-kit modul HR
// — murni presentasional.
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { fmtIDR } from "@/rekankerja/shared/lib/api";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import type { DocMeta, RC31Data, RC32Data, RC33Data, RC41Data, RC42Data, RC43Data } from "./types";
import { mkDocNo, Mask, moneyOrStr } from "./report-views-g12";

const CANDIDATE_STATUS_PAIRS: Record<string, [string, string]> = {
  Nominated: ["Dinominasikan", "Nominated"], InProcess: ["Dalam Proses", "In Process"], Passed: ["Lulus", "Passed"],
  Failed: ["Gagal", "Failed"], Withdrawn: ["Mundur", "Withdrawn"], Hired: ["Diangkat", "Hired"],
};
const CANDIDATE_STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky" | "violet"> = {
  Nominated: "slate", InProcess: "amber", Passed: "green", Failed: "red", Withdrawn: "violet", Hired: "sky",
};
const STEP_STATUS_PAIRS: Record<string, [string, string]> = {
  Planned: ["Terjadwal", "Planned"], Acknowledged: ["Terkonfirmasi", "Acknowledged"], Performed: ["Dilaksanakan", "Performed"],
  Passed: ["Lulus", "Passed"], Failed: ["Gagal", "Failed"], Cancelled: ["Dibatalkan", "Cancelled"],
};
const STEP_STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky" | "violet"> = {
  Planned: "slate", Acknowledged: "violet", Performed: "sky", Passed: "green", Failed: "red", Cancelled: "slate",
};
const OFFER_STATUS_PAIRS: Record<string, [string, string]> = {
  Draft: ["Draf", "Draft"], PendingApproval: ["Menunggu Persetujuan", "Pending Approval"], Sent: ["Terkirim", "Sent"],
  Viewed: ["Dilihat", "Viewed"], Accepted: ["Diterima", "Accepted"], Declined: ["Ditolak", "Declined"], Expired: ["Kedaluwarsa", "Expired"],
};
const OFFER_STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky" | "violet"> = {
  Draft: "slate", PendingApproval: "violet", Sent: "amber", Viewed: "sky", Accepted: "green", Declined: "red", Expired: "slate",
};
const RECOMMENDATION_TONE: Record<string, "green" | "red" | "slate"> = {
  StrongHire: "green", Hire: "green", NoHire: "red", StrongNoHire: "red",
};

// ================= RC3.1 Selection Funnel & Stage Pass-Through =================
export function RC31View({ data, meta }: { data: RC31Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const maxEntered = Math.max(1, ...data.stages.map((s) => s.entered));
  return (
    <ReportSheet docId="rc31" landscape>
      <DocHeader meta={meta} reportNo="RC3.1" title="Selection Funnel & Stage Pass-Through" subtitle={t("Corong Seleksi per Tahap", "Stage-by-Stage Selection Funnel")} audience={t("HR · Psikolog · Interviewer Panel", "HR · Psychologists · Interview Panel")} docNo={mkDocNo("rc31", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Masuk = langkah kandidat pada kandidat yang dinominasikan dalam periode; pass rate = lulus ÷ (lulus + gagal) per tahap.", "Entered = candidate steps for candidates nominated in the period; pass rate = passed ÷ (passed + failed) per stage.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kandidat", "Candidates"), value: f.num(data.candidates), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Diangkat", "Hired"), value: f.num(data.hired) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pass Rate Keseluruhan", "Overall Pass Rate"), value: data.overallPassRate != null ? f.pct(data.overallPassRate) : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tahap Aktif", "Active Stages"), value: f.num(data.stages.length) }]} />
      </div>

      <DocSection no="B" title={t("Corong per Tahap (urut proses)", "Funnel per Stage (process order)")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>Tahap</TH><TH align="number">Urutan</TH><TH align="center">Jenis Hasil</TH>
              <TH align="number">Langkah</TH><TH>Corong</TH>
              <TH align="number">Dilaksanakan</TH><TH align="number">Lulus</TH><TH align="number">Gagal</TH>
              <TH align="number">Dibatalkan</TH><TH align="number">Pass Rate %</TH><TH align="number">Min Lulus</TH>
            </tr>
          </thead>
          <tbody>
            {data.stages.map((s, i) => (
              <tr key={s.name} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">
                  {s.name}
                  {!s.mandatory && <span className="ml-1.5 text-[8.5px] font-bold uppercase text-slate-400">({t("opsional", "optional")})</span>}
                </TD>
                <TD align="number">{s.processOrder ?? <Dash />}</TD>
                <TD align="center" className="text-[9.5px]">{s.resultType}</TD>
                <TD align="number" className="font-bold">{f.num(s.entered)}</TD>
                <TD>
                  <div className="h-2.5 w-full max-w-[140px] overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-rose-500" style={{ width: `${(s.entered / maxEntered) * 100}%` }} />
                  </div>
                </TD>
                <TD align="number">{f.num(s.performed)}</TD>
                <TD align="number" className="font-bold text-emerald-700">{f.num(s.passed)}</TD>
                <TD align="number" className={cn(s.failed > 0 && "font-bold text-rose-700")}>{f.num(s.failed)}</TD>
                <TD align="number">{f.num(s.cancelled)}</TD>
                <TD align="number" className="font-black">{s.passRate != null ? f.pct(s.passRate) : <Dash />}</TD>
                <TD align="number">{s.minResultPass ?? <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Status Kandidat", "Candidate Status")} />
      <DocTable head={<><TH align="center">Status</TH><TH align="number">Jumlah</TH><TH>Proporsi</TH></>}>
        {data.candidateStatus.map((s) => (
          <tr key={s.status} className="hover:bg-slate-50">
            <TD align="center"><DocBadge tone={CANDIDATE_STATUS_TONE[s.status] ?? "slate"}>{t(...(CANDIDATE_STATUS_PAIRS[s.status] ?? [s.status, s.status]))}</DocBadge></TD>
            <TD align="number" className="font-black">{f.num(s.count)}</TD>
            <TD>
              <div className="h-2.5 w-full max-w-[220px] overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-slate-500" style={{ width: `${data.candidates > 0 ? (s.count / data.candidates) * 100 : 0}%` }} />
              </div>
            </TD>
          </tr>
        ))}
      </DocTable>

      <DocFooter meta={meta} signNote={t("Pass rate per tahap jauh di bawah rata-rata = periksa kriteria screening atau kualitas kandidat masukan.", "A stage pass rate far below average = review screening criteria or inbound candidate quality.")} />
    </ReportSheet>
  );
}

// ================= RC3.2 Selection Stage SLA Monitor =================
export function RC32View({ data, meta }: { data: RC32Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="rc32" landscape>
      <DocHeader meta={meta} reportNo="RC3.2" title="Selection Stage SLA Monitor" subtitle={t("Pemantauan SLA Jadwal Tahap Seleksi", "Selection Stage Schedule SLA Monitor")} audience={t("HR Recruiter · Atasan Interviewer", "HR Recruiters · Interviewing Managers")} docNo={mkDocNo("rc32", meta)} />

      <DocSection no="A" title={t("Ringkasan Kepatuhan", "Compliance Summary")} note={t("Tepat waktu = dilaksanakan ≤ batas SLA (dueDate). Overdue = belum selesai namun batas sudah lewat.", "On time = performed ≤ SLA due date. Overdue = unfinished while the due date has passed.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Langkah", "Steps"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tepat Waktu", "On Time"), value: f.num(data.onTime) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terlambat", "Late"), value: f.num(data.late), accent: data.late > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tertunda Overdue", "Overdue Pending"), value: f.num(data.pendingOverdue), accent: data.pendingOverdue > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kepatuhan", "Compliance"), value: data.complianceRate != null ? f.pct(data.complianceRate) : <Dash /> }]} />
      </div>

      <DocSection no="B" title={t("Rekap per Tahap", "Recap per Stage")} />
      <DocTable head={<>
        <TH>Tahap</TH><TH align="number">Total</TH><TH align="number">Selesai</TH>
        <TH align="number">Tepat Waktu</TH><TH align="number">Terlambat</TH><TH align="number">Tertunda</TH>
        <TH align="number">Overdue</TH><TH align="number">Kepatuhan %</TH>
      </>}>
        {data.byStage.map((s) => (
          <tr key={s.stage} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{s.stage}</TD>
            <TD align="number">{f.num(s.total)}</TD>
            <TD align="number">{f.num(s.done)}</TD>
            <TD align="number">{f.num(s.onTime)}</TD>
            <TD align="number" className={cn(s.late > 0 && "font-bold text-amber-700")}>{f.num(s.late)}</TD>
            <TD align="number">{f.num(s.pending)}</TD>
            <TD align="number" className={cn(s.overdue > 0 && "font-bold text-rose-700")}>{f.num(s.overdue)}</TD>
            <TD align="number" className="font-black">{s.rate != null ? f.pct(s.rate) : <Dash />}</TD>
          </tr>
        ))}
      </DocTable>

      <DocSection no="C" title={t("Detail Langkah Kandidat (urut batas SLA)", "Candidate Step Detail (by SLA due)")} />
      <div className="doc-scroll max-h-[420px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>Kandidat</TH><TH>No. PR</TH><TH>Posisi</TH><TH>Tahap</TH><TH align="number">Urutan</TH>
              <TH align="center">Jadwal</TH><TH align="center">Batas SLA</TH><TH align="center">Status</TH>
              <TH align="center">Dilaksanakan</TH><TH>Pelaksana</TH><TH align="number">Terlambat (hari)</TH><TH align="number">Overdue (hari)</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.prNo}-${r.candidateName}-${r.stageName}-${r.seqNo}-${i}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.overdueDays != null && "bg-rose-50/40")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.candidateName}</TD>
                <TD>{r.prNo}</TD>
                <TD>{r.positionTitle ?? <Dash />}</TD>
                <TD>{r.stageName}</TD>
                <TD align="number">{f.num(r.seqNo)}</TD>
                <TD align="center" className="font-mono">{r.planDate ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{r.dueDate ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={STEP_STATUS_TONE[r.status] ?? "slate"}>{t(...(STEP_STATUS_PAIRS[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD align="center" className="font-mono">{r.performedAt ?? <Dash />}</TD>
                <TD>{r.performerName ?? <Dash />}</TD>
                <TD align="number" className={cn(r.lateDays != null && "font-bold text-amber-700")}>{r.lateDays ?? <Dash />}</TD>
                <TD align="number" className={cn(r.overdueDays != null && "font-bold text-rose-700")}>{r.overdueDays ?? <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Langkah overdue perlu penjadwalan ulang atau eskalasi evaluator.", "Overdue steps need rescheduling or evaluator escalation.")} />
    </ReportSheet>
  );
}

// ================= RC3.3 Candidate Scorecard Summary =================
export function RC33View({ data, meta }: { data: RC33Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="rc33" landscape>
      <DocHeader meta={meta} reportNo="RC3.3" title="Candidate Scorecard Summary" subtitle={t("Ringkasan Scorecard & Divergensi Panel Evaluator", "Scorecard & Panel Divergence Summary")} audience={t("HR · Interviewer Panel · Kepala Departemen", "HR · Interview Panel · Department Heads")} docNo={mkDocNo("rc33", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Skor rubrik 1–5 per kompetensi; rata-rata dihitung dari semua kompetensi terisi. Divergensi = rentang antar evaluator > 2 pada kompetensi yang sama (HRX D2).", "Rubric scores 1–5 per competency; average over all filled competencies. Divergence = inter-evaluator spread > 2 on the same competency (HRX D2).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Scorecard", "Scorecards"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terisi", "Submitted"), value: f.num(data.submitted) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Masih Draf", "Draft"), value: f.num(data.pending) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Skor Rata-rata", "Average Score"), value: data.avgScore != null ? f.num(data.avgScore) : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Divergensi Panel", "Panel Divergence"), value: f.num(data.flaggedDivergence), accent: data.flaggedDivergence > 0 }]} />
        <SummaryBox className="grid-cols-1" items={data.byRecommendation.slice(0, 1).map((r) => ({ label: `${t("Rekomendasi", "Recommendation")} ${r.label}`, value: f.num(r.count) }))} />
      </div>

      <DocSection no="B" title={t("Pengisian per Evaluator", "Completion per Evaluator")} />
      <div className="doc-scroll max-h-[440px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>Kandidat</TH><TH>No. PR</TH><TH>Posisi</TH><TH>Tahap</TH><TH>Evaluator</TH>
              <TH align="center">Status</TH><TH align="center">Tanggal</TH>
              <TH align="number">Skor Rata-rata</TH><TH align="number">Kompetensi</TH><TH align="center">Rekomendasi</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.candidateName}-${r.evaluatorName}-${r.stageName}-${i}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.candidateName}</TD>
                <TD>{r.prNo}</TD>
                <TD>{r.positionTitle ?? <Dash />}</TD>
                <TD>{r.stageName}</TD>
                <TD className="font-semibold text-slate-800">{r.evaluatorName}</TD>
                <TD align="center"><DocBadge tone={r.submitted ? "green" : "slate"}>{r.submitted ? t("Terisi", "Submitted") : t("Draf", "Draft")}</DocBadge></TD>
                <TD align="center" className="font-mono">{r.submittedAt ?? <Dash />}</TD>
                <TD align="number" className="font-black">{r.avgScore != null ? f.num(r.avgScore) : <Dash />}</TD>
                <TD align="number">{f.num(r.competencyCount)}</TD>
                <TD align="center">{r.recommendation ? (
                  <DocBadge tone={RECOMMENDATION_TONE[r.recommendation] ?? "slate"}>{r.recommendation}</DocBadge>
                ) : <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.divergences.length > 0 && (
        <>
          <DocSection no="C" title={t("Divergensi Panel (rentang > 2)", "Panel Divergence (spread > 2)")} note={t("Perlu diskusi kalibrasi antar evaluator sebelum keputusan lanjut tahap.", "Calibration discussion between evaluators is needed before the next-stage decision.")} />
          <DocTable head={<>
            <TH align="center">#</TH><TH>Kandidat</TH><TH>No. PR</TH><TH>Tahap</TH><TH>Kompetensi</TH>
            <TH align="number">Rentang</TH><TH>Skor Panel</TH>
          </>}>
            {data.divergences.map((d, i) => (
              <tr key={`${d.candidateName}-${d.stageName}-${d.competency}`} className="hover:bg-slate-50">
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{d.candidateName}</TD>
                <TD>{d.prNo}</TD>
                <TD>{d.stageName}</TD>
                <TD>{d.competency}</TD>
                <TD align="number" className="font-black text-rose-700">{f.num(d.spread)}</TD>
                <TD className="font-mono">{d.scores.join(" vs ")}</TD>
              </tr>
            ))}
          </DocTable>
        </>
      )}

      <DocFooter meta={meta} signNote={t("Feedback evaluator wajib sebelum kandidat naik tahap — dipaksa oleh service seleksi.", "Evaluator feedback is required before a candidate advances — enforced by the selection service.")} />
    </ReportSheet>
  );
}

// ================= RC4.1 Offer Status & Response =================
export function RC41View({ data, meta }: { data: RC41Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="rc41" landscape>
      <DocHeader meta={meta} reportNo="RC4.1" title="Offer Status & Response Report" subtitle={t("Status, Respon & Tingkat Penerimaan Offer", "Offer Status, Response & Acceptance")} audience={t("HR · Direksi", "HR · Directors")} docNo={mkDocNo("rc41", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Tingkat penerimaan = diterima ÷ (diterima + ditolak). Expiring = terkirim/dilihat dengan kedaluwarsa ≤ 7 hari.", "Acceptance rate = accepted ÷ (accepted + declined). Expiring = sent/viewed with expiry ≤ 7 days.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Offer", "Total Offers"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Diterima", "Accepted"), value: f.num(data.accepted) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Ditolak", "Declined"), value: f.num(data.declined) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tingkat Penerimaan", "Acceptance Rate"), value: data.acceptanceRate != null ? f.pct(data.acceptanceRate) : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hari Respon Rata-rata", "Avg Response Days"), value: data.avgResponseDays != null ? f.num(data.avgResponseDays) : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Expiring ≤7 Hari", "Expiring ≤7d"), value: f.num(data.expiringSoon), accent: data.expiringSoon > 0 }]} />
      </div>

      <DocSection no="B" title={t("Register Offer", "Offer Register")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Offer</TH><TH>Kandidat</TH><TH>No. PR</TH><TH>Posisi</TH><TH align="center">Status</TH>
              <TH align="center">Terkirim</TH><TH align="center">Respon</TH><TH align="number">Hari Respon</TH>
              <TH align="center">Kedaluwarsa</TH><TH align="center">Diangkat</TH><TH>Catatan</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.offerNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.status === "Declined" && "bg-rose-50/40")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.offerNo}</TD>
                <TD className="font-semibold text-slate-800">{r.candidateName}</TD>
                <TD>{r.prNo}</TD>
                <TD>{r.positionTitle ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={OFFER_STATUS_TONE[r.status] ?? "slate"}>{t(...(OFFER_STATUS_PAIRS[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD align="center" className="font-mono">{r.sentAt ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{r.respondedAt ?? <Dash />}</TD>
                <TD align="number">{r.responseDays ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{r.expiryDate ?? <Dash />}</TD>
                <TD align="center">{r.appointed ? t("Ya", "Yes") : <Dash />}</TD>
                <TD className="max-w-[200px]">{r.note ?? <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Nilai gaji offer sengaja tidak disertakan (data kompensasi pribadi — lihat modul Offer).", "Offer salary values are intentionally excluded (private compensation data — see the Offers module).")} />
    </ReportSheet>
  );
}

// ================= RC4.2 Hiring Realization =================
export function RC42View({ data, meta }: { data: RC42Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="rc42" landscape>
      <DocHeader meta={meta} reportNo="RC4.2" title="Hiring Realization Report" subtitle={t("Realisasi Pengangkatan Kandidat Menjadi Karyawan", "Candidate-to-Employee Appointment Realization")} audience={t("HR · Payroll · GA/IT", "HR · Payroll · GA/IT")} docNo={mkDocNo("rc42", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Onboarded = karyawan & checklist onboarding sudah dibuat dari pengangkatan ini.", "Onboarded = employee & onboarding checklist already created from this appointment.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pengangkatan", "Appointments"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Onboarded", "Onboarded"), value: f.num(data.onboarded) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Menunggu Onboarding", "Pending Onboarding"), value: f.num(data.pendingOnboarding), accent: data.pendingOnboarding > 0 }]} />
        <SummaryBox className="grid-cols-1" items={data.bySource.map((s) => ({ label: s.label, value: f.num(s.count) }))} />
      </div>

      <DocSection no="B" title={t("Register Pengangkatan", "Appointment Register")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. PR</TH><TH>Posisi</TH><TH>Kantor</TH><TH>Unit</TH><TH>Kandidat</TH>
              <TH align="center">Sumber</TH><TH align="center">Tanggal Angkat</TH><TH align="center">Status Kerja</TH>
              <TH>No. Karyawan</TH><TH align="center">Onboarding</TH><TH>No. Surat</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.prNo}-${r.candidateName}-${i}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.prNo}</TD>
                <TD className="font-semibold text-slate-800">{r.positionTitle ?? <Dash />}</TD>
                <TD>{r.officeName ?? <Dash />}</TD>
                <TD>{r.unitName ?? <Dash />}</TD>
                <TD className="font-semibold text-slate-800">{r.candidateName}</TD>
                <TD align="center"><DocBadge tone={r.source === "Internal" ? "violet" : "sky"}>{r.source}</DocBadge></TD>
                <TD align="center" className="font-mono">{r.appointmentDate}</TD>
                <TD align="center">{r.employmentStatus}</TD>
                <TD className="font-mono">{r.employeeNo ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={r.onboarding === "Onboarded" ? "green" : "amber"}>{r.onboarding === "Onboarded" ? t("Selesai", "Onboarded") : t("Menunggu", "Pending")}</DocBadge></TD>
                <TD className="font-mono text-[9px]">{r.letterNo ?? <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Basis handover ke GA/IT (akun & aset) dan Payroll (penambahan komponen gaji efektif tanggal angkat).", "Handover basis for GA/IT (accounts & assets) and Payroll (salary components effective from the appointment date).")} />
    </ReportSheet>
  );
}

// ================= RC4.3 Recruitment Cost per Hire =================
// Judul via konstanta — "per" dianggap kata Indonesia oleh audit bilingual.
const RC43_TITLE = "Recruitment Cost per Hire Report";

export function RC43View({ data, meta }: { data: RC43Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const budgetTotal = data.budget?.total != null ? data.budget.total + (data.budget.adjust ?? 0) : null;
  const overBudget = budgetTotal != null && data.totalActual != null && data.totalActual > budgetTotal;
  return (
    <ReportSheet docId="rc43" landscape>
      <DocHeader meta={meta} reportNo="RC4.3" title={RC43_TITLE} subtitle={t(`Biaya Rekrutmen & Cost per Hire · Tahun ${data.year}`, `Recruitment Cost & Cost per Hire · Year ${data.year}`)} audience={t("Finance · Direksi · HR", "Finance · Directors · HR")} docNo={mkDocNo("rc43", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Semua nilai finansial mengikuti kebijakan brankas gaji — disembunyikan saat terkunci.", "All financial values follow the salary-vault policy — hidden while locked.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: "Hire", value: f.num(data.hires), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kanal Biaya", "Cost Channels"), value: f.num(data.rows.length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Rencana", "Total Planned"), value: data.totalPlanned != null ? fmtIDR(data.totalPlanned) : data.masked ? <Mask /> : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Aktual", "Total Actual"), value: data.totalActual != null ? fmtIDR(data.totalActual) : data.masked ? <Mask /> : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Cost per Hire", "Cost per Hire"), value: data.costPerHire != null ? fmtIDR(data.costPerHire) : data.masked ? <Mask /> : <Dash />, accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Anggaran (+adj)", "Budget (+adj.)"), value: budgetTotal != null ? fmtIDR(budgetTotal) : data.masked ? <Mask /> : <Dash /> }]} />
      </div>
      {overBudget && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-bold text-rose-700">
          {t("Realisasi aktual melebihi total anggaran periode — perlu persetujuan penyimpangan.", "Actual spend exceeds the period budget total — deviation approval required.")}
        </p>
      )}

      <DocSection no="B" title={t("Biaya per Kanal per Iklan", "Cost per Channel per Job Ad")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Iklan</TH><TH>Judul Iklan</TH><TH>Kanal</TH><TH>Media</TH><TH>Agency</TH>
              <TH align="center">Tayang</TH><TH align="number">Biaya Rencana</TH><TH align="number">Biaya Aktual</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.joNo}-${r.method}-${i}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.joNo}</TD>
                <TD className="font-semibold text-slate-800">{r.joTitle}</TD>
                <TD>{r.method}</TD>
                <TD>{r.mediaName ?? <Dash />}</TD>
                <TD>{r.agencyName ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{r.datePosted ?? <Dash />}</TD>
                <TD align="number">{r.plannedCost != null ? fmtIDR(r.plannedCost) : data.masked ? <Mask /> : <Dash />}</TD>
                <TD align="number" className="font-bold">{r.actualCost != null ? fmtIDR(r.actualCost) : data.masked ? <Mask /> : <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <DocTable head={<><TH>TOTAL — {data.rows.length} {t("kanal", "channels")}</TH><TH align="number">Biaya Rencana</TH><TH align="number">Biaya Aktual</TH><TH align="number">Hire</TH><TH align="number">Cost per Hire</TH></>}>
          <TotalRow label={`TOTAL — ${data.rows.length} ${t("kanal", "channels")}`} cells={[
            moneyOrStr(data.totalPlanned, data.masked),
            moneyOrStr(data.totalActual, data.masked),
            f.num(data.hires),
            moneyOrStr(data.costPerHire, data.masked),
          ]} spanLabel={1} />
        </DocTable>
      </div>

      {data.budget && (
        <DocSection no="C" title={t("Anggaran Periode", "Period Budget")} />
      )}
      {data.budget && (
        <DocTable head={<><TH>Periode</TH><TH align="number">Total Anggaran</TH><TH align="number">Penyesuaian</TH><TH align="number">Realisasi</TH><TH>Catatan</TH></>}>
          <tr className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{String(data.year)}</TD>
            <TD align="number">{data.budget.total != null ? fmtIDR(data.budget.total) : data.masked ? <Mask /> : <Dash />}</TD>
            <TD align="number">{data.budget.adjust != null ? fmtIDR(data.budget.adjust) : data.masked ? <Mask /> : <Dash />}</TD>
            <TD align="number" className={cn("font-bold", overBudget && "text-rose-700")}>{data.totalActual != null ? fmtIDR(data.totalActual) : data.masked ? <Mask /> : <Dash />}</TD>
            <TD>{data.budget.note ?? <Dash />}</TD>
          </tr>
        </DocTable>
      )}

      <DocFooter meta={meta} signNote={t("Basis rekonsiliasi anggaran rekrutmen tahunan dengan Finance.", "Basis for the annual recruitment budget reconciliation with Finance.")} />
    </ReportSheet>
  );
}
