"use client";
// SB-RC-RD — views dokumen Recruitment Grup 1 (Rencana & Permintaan) + =====
// Grup 2 (Lowongan & Sumber Pelamar). Komponen dasar (ReportSheet/DocHeader/
// DocFooter/…) dipakai bersama dari doc-kit modul HR — murni presentasional.
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { fmtIDR } from "@/rekankerja/shared/lib/api";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import type { DocMeta, RC11Data, RC12Data, RC13Data, RC21Data, RC22Data, RC23Data } from "./types";

/** No. dokumen deterministik: RC/RC11/2026/10. */
export function mkDocNo(id: string, meta: DocMeta): string {
  const mm = String(new Date(meta.generatedAt).getMonth() + 1).padStart(2, "0");
  return `RC/${id.slice(2).toUpperCase()}/${meta.year}/${mm}`;
}

/** Uang vault terkunci → placeholder "•••" (dipakai lintas view RC — SB-RC-RD). */
export const Mask = () => <span className="font-mono text-slate-400">•••</span>;

/** Nilai uang: null → "•••" HANYA bila brankas terkunci (masked) — selain itu "—" (tidak ada data). */
export function MoneyOr({ v, masked }: { v: number | null; masked: boolean }) {
  return v != null ? <span className="tabular-nums">{fmtIDR(v)}</span> : masked ? <Mask /> : <Dash />;
}

/** Padanan string MoneyOr utk sel TotalRow (ReactNode tidak bisa). */
export function moneyOrStr(v: number | null, masked: boolean): string {
  return v != null ? fmtIDR(v) : masked ? "•••" : "—";
}

const PR_STATUS_PAIRS: Record<string, [string, string]> = {
  Draft: ["Draf", "Draft"], Submitted: ["Menunggu Persetujuan", "Pending Approval"], Approved: ["Disetujui", "Approved"],
  Rejected: ["Ditolak", "Rejected"], OnHold: ["Ditahan", "On Hold"], Fulfilled: ["Terpenuhi", "Fulfilled"],
  Closed: ["Ditutup", "Closed"], Cancelled: ["Dibatalkan", "Cancelled"],
};
const PR_STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky" | "violet"> = {
  Draft: "slate", Submitted: "amber", Approved: "green", Rejected: "red", OnHold: "violet",
  Fulfilled: "sky", Closed: "slate", Cancelled: "red",
};
const APPLICANT_STATUS_PAIRS: Record<string, [string, string]> = {
  Active: ["Aktif", "Active"], Rejected: ["Ditolak", "Rejected"], Outdated: ["Kedaluwarsa", "Outdated"], Employed: ["Dipekerjakan", "Employed"],
};
const APPLICANT_STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky"> = {
  Active: "green", Rejected: "red", Outdated: "slate", Employed: "sky",
};
const RISK_PAIRS: Record<string, [string, string]> = {
  tinggi: ["Tinggi", "High"], sedang: ["Sedang", "Medium"], rendah: ["Rendah", "Low"], sehat: ["Sehat", "Healthy"],
};
const RISK_TONE: Record<string, "red" | "amber" | "slate" | "green"> = {
  tinggi: "red", sedang: "amber", rendah: "slate", sehat: "green",
};
const JO_STATUS_PAIRS: Record<string, [string, string]> = {
  Draft: ["Draf", "Draft"], Posted: ["Tayang", "Posted"], Closed: ["Ditutup", "Closed"], Obsolete: ["Usang", "Obsolete"],
};
const JO_STATUS_TONE: Record<string, "slate" | "green" | "amber" | "red"> = {
  Draft: "slate", Posted: "green", Closed: "amber", Obsolete: "red",
};

// ================= RC1.1 Recruitment Plan Recap (MPP) =================
export function RC11View({ data, meta }: { data: RC11Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="rc11" landscape>
      <DocHeader meta={meta} reportNo="RC1.1" title="Recruitment Plan Recap (MPP)" subtitle={t(`Rekap Rencana Kebutuhan — Formula a–h · Tahun ${data.year}`, `Manpower Plan — a–h Formula · Year ${data.year}`)} audience={t("Direksi · HR Manager · HRBP", "Directors · HR Manager · HRBP")} docNo={mkDocNo("rc11", meta)} />

      <DocSection no="A" title={t("Ringkasan Periode", "Period Summary")} note={t("Formula: (c)=(a)+(b) target total · (g)=(d)+(e)−(f) hasil · (h)=(c)−(g) kebutuhan rekrut. Rekonsiliasi PR: diajukan vs terpenuhi (match rencana eksplisit ATAU posisi sama).", "Formula: (c)=(a)+(b) total target · (g)=(d)+(e)−(f) result · (h)=(c)−(g) hiring need. PR reconciliation: requested vs fulfilled (explicit plan link OR same position).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Baris Rencana", "Plan Rows"), value: f.num(data.plans), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Diterapkan", "Applied"), value: f.num(data.applied) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("(c) Total Target", "(c) Total Target"), value: f.num(data.sum.totalC) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("(g) Hasil Headcount", "(g) Resulting HC"), value: f.num(data.sum.resultG) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("(h) Kebutuhan Rekrut", "(h) Hiring Need"), value: f.num(data.sum.needH), accent: data.sum.needH > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("PR Belum Terpenuhi", "PRs Unfulfilled"), value: f.num(data.sum.prUnfulfilled) }]} />
      </div>

      <DocSection no="B" title={t("Rencana per Posisi / Kantor", "Plan per Position / Office")} note={t("Anggaran upah mengikuti kebijakan brankas gaji — disembunyikan saat terkunci.", "Salary budget follows the salary-vault policy — hidden while locked.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>Periode</TH><TH>Posisi</TH><TH>Kantor</TH><TH align="center">Status</TH>
              <TH align="number">(a)</TH><TH align="number">(b)</TH><TH align="number">(c)</TH>
              <TH align="number">(d)</TH><TH align="number">(e)</TH><TH align="number">(f)</TH>
              <TH align="number">(g)</TH><TH align="number">(h)</TH>
              <TH align="number">Anggaran Upah</TH>
              <TH align="number">PR Diajukan</TH><TH align="number">PR Terpenuhi</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.period}-${r.seqNo}-${r.positionTitle}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.period}</TD>
                <TD className="font-semibold text-slate-800">{r.positionTitle}</TD>
                <TD>{r.office ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={r.status === "Applied" ? "green" : "slate"}>{r.status === "Applied" ? t("Diterapkan", "Applied") : t("Draf", "Draft")}</DocBadge></TD>
                <TD align="number">{f.num(r.targetA)}</TD>
                <TD align="number">{r.adjustB || <Dash />}</TD>
                <TD align="number" className="font-bold">{f.num(r.totalC)}</TD>
                <TD align="number">{f.num(r.empD)}</TD>
                <TD align="number">{f.num(r.inE)}</TD>
                <TD align="number">{f.num(r.outF)}</TD>
                <TD align="number">{f.num(r.resultG)}</TD>
                <TD align="number" className={cn("font-bold", r.needH > 0 && "text-rose-700")}>{f.num(r.needH)}</TD>
                <TD align="number">{r.salaryBudget != null ? fmtIDR(r.salaryBudget) : data.masked ? <Mask /> : <Dash />}</TD>
                <TD align="number">{f.num(r.prRequested)}</TD>
                <TD align="number">{f.num(r.prFulfilled)}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <DocTable head={<>
          <TH>TOTAL — {data.plans} {t("rencana", "plans")}</TH>
          <TH align="number">(a)</TH><TH align="number">(b)</TH><TH align="number">(c)</TH><TH align="number">(d)</TH>
          <TH align="number">(e)</TH><TH align="number">(f)</TH><TH align="number">(g)</TH><TH align="number">(h)</TH>
          <TH align="number">PR Diajukan</TH><TH align="number">PR Terpenuhi</TH>
        </>}>
          <TotalRow label={`TOTAL — ${data.plans} ${t("rencana", "plans")}`} cells={[
            f.num(data.sum.targetA), f.num(data.sum.adjustB), f.num(data.sum.totalC), f.num(data.sum.empD),
            f.num(data.sum.inE), f.num(data.sum.outF), f.num(data.sum.resultG), f.num(data.sum.needH),
            f.num(data.sum.prRequested), f.num(data.sum.prFulfilled),
          ]} spanLabel={1} />
        </DocTable>
      </div>

      <DocFooter meta={meta} signNote={t("Rencana menjadi dasar justifikasi Permintaan Karyawan (PR) — PR di luar rencana memerlukan persetujuan penyimpangan.", "Plans are the justification basis for requisitions (PR) — off-plan PRs require deviation approval.")} />
    </ReportSheet>
  );
}

// ================= RC1.2 PR Status Register =================
export function RC12View({ data, meta }: { data: RC12Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="rc12" landscape>
      <DocHeader meta={meta} reportNo="RC1.2" title="Personnel Requisition Status Register" subtitle={t("Daftar Status Permintaan Karyawan", "Requisition Status Register")} audience={t("HR · Atasan Pengaju · Kepala Departemen", "HR · Requesting Managers · Department Heads")} docNo={mkDocNo("rc12", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total PR", "Total PRs"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terbuka", "Open"), value: f.num(data.open) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terpenuhi", "Fulfilled"), value: f.num(data.fulfilled) }]} />
        {data.byStatus.slice(0, 3).map((s) => (
          <SummaryBox key={s.status} className="grid-cols-1" items={[{ label: PR_STATUS_PAIRS[s.status]?.[0] ?? s.status, value: f.num(s.count) }]} />
        ))}
      </div>

      <DocSection no="B" title={t("Register Permintaan (urut tanggal)", "Requisition Register (by date)")} note={t("Umur dihitung sejak requestDate untuk PR yang masih terbuka (Menunggu/Disetujui/Ditahan).", "Age counts from requestDate for still-open PRs (Pending/Approved/On Hold).")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. PR</TH><TH align="center">Tanggal</TH><TH>Posisi</TH><TH>Kantor</TH><TH>Unit</TH>
              <TH>Pengaju</TH><TH>Recruiter</TH><TH align="center">Status Kerja</TH>
              <TH align="number">Dibutuhkan</TH><TH align="number">Ter-appoint</TH>
              <TH align="center">Status</TH><TH align="number">Umur (hari)</TH><TH align="number">Target SLA</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.prNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.prNo}</TD>
                <TD align="center" className="font-mono">{r.requestDate}</TD>
                <TD className="font-semibold text-slate-800">{r.position ?? <Dash />}</TD>
                <TD>{r.office ?? <Dash />}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD>{r.requester ?? <Dash />}</TD>
                <TD>{r.officer ?? <Dash />}</TD>
                <TD align="center">{r.employmentStatus}</TD>
                <TD align="number" className="font-bold">{f.num(r.requiredNo)}</TD>
                <TD align="number">{r.appointed || <Dash />}</TD>
                <TD align="center"><DocBadge tone={PR_STATUS_TONE[r.status] ?? "slate"}>{t(...(PR_STATUS_PAIRS[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD align="number">{r.ageDays != null ? f.num(r.ageDays) : <Dash />}</TD>
                <TD align="number">{r.slaTargetDays ?? <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Register ini menjadi lampiran rapat pipeline rekrutmen mingguan.", "This register is the attachment for the weekly recruitment pipeline meeting.")} />
    </ReportSheet>
  );
}

// ================= RC1.3 PR Aging & SLA Compliance =================
export function RC13View({ data, meta }: { data: RC13Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const maxBucket = Math.max(1, ...data.buckets.map((b) => b.count));
  return (
    <ReportSheet docId="rc13" landscape>
      <DocHeader meta={meta} reportNo="RC1.3" title="Requisition Aging & SLA Compliance" subtitle={t("Umur PR Terbuka & Kepatuhan SLA Penyelesaian", "Open Requisition Age & Completion SLA Compliance")} audience={t("HR · Manajer · Direksi", "HR · Managers · Directors")} docNo={mkDocNo("rc13", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Hanya PR terbuka (Menunggu/Disetujui/Ditahan) dihitung — draf & terminal dikecualikan.", "Only open PRs (Pending/Approved/On Hold) count — drafts & terminal states excluded.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <SummaryBox className="grid-cols-1" items={[{ label: t("PR Terbuka", "Open PRs"), value: f.num(data.rows.length), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Umur Rata-rata", "Avg Age"), value: data.avgAgeDays != null ? `${f.num(data.avgAgeDays)} ${t("hari", "days")}` : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("PR Tertua", "Oldest PR"), value: data.oldest ? `${data.oldest.prNo} · ${data.oldest.days}d` : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dgn Target SLA", "With SLA Target"), value: f.num(data.withSla) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dalam SLA", "Within SLA"), value: f.num(data.withinSla) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Lewat SLA", "Over SLA"), value: f.num(data.overSla), accent: data.overSla > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kepatuhan", "Compliance"), value: data.withSla > 0 ? f.pct(Math.round((data.withinSla / data.withSla) * 100)) : <Dash /> }]} />
      </div>

      <DocSection no="B" title={t("Distribusi Umur PR", "Requisition Age Distribution")} />
      <DocTable head={<><TH align="center">Bucket Umur</TH><TH align="number">Jumlah PR</TH><TH>Proporsi</TH></>}>
        {data.buckets.map((b) => (
          <tr key={b.key} className="hover:bg-slate-50">
            <TD align="center" className="font-bold">{b.label}</TD>
            <TD align="number" className="font-black">{f.num(b.count)}</TD>
            <TD>
              <div className="h-2.5 w-full max-w-[220px] overflow-hidden rounded-full bg-slate-100">
                <div className={cn("h-full rounded-full", b.key === ">90" ? "bg-rose-500" : b.key === "61-90" ? "bg-amber-500" : "bg-slate-500")} style={{ width: `${(b.count / maxBucket) * 100}%` }} />
              </div>
            </TD>
          </tr>
        ))}
      </DocTable>

      <DocSection no="C" title={t("Register PR Terbuka (urut umur)", "Open Requisition Register (by age)")} note={t("Risiko: Lewat SLA > 14 hari = Tinggi · Lewat SLA = Sedang · Mendekati SLA (75%) = Rendah.", "Risk: Over SLA > 14 days = High · Over SLA = Medium · Approaching SLA (75%) = Low.")} />
      <div className="doc-scroll max-h-[420px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. PR</TH><TH>Posisi</TH><TH>Kantor</TH><TH align="center">Status</TH>
              <TH align="center">Tanggal Request</TH><TH align="number">Umur (hari)</TH>
              <TH align="number">Target SLA</TH><TH align="number">Lewat (hari)</TH>
              <TH align="number">Kandidat</TH><TH align="number">Ter-appoint</TH><TH align="center">Risiko</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.prNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.risk === "tinggi" && "bg-rose-50/40")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.prNo}</TD>
                <TD className="font-semibold text-slate-800">{r.position ?? <Dash />}</TD>
                <TD>{r.office ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={PR_STATUS_TONE[r.status] ?? "slate"}>{t(...(PR_STATUS_PAIRS[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD align="center" className="font-mono">{r.requestDate}</TD>
                <TD align="number" className="font-bold">{f.num(r.ageDays)}</TD>
                <TD align="number">{r.slaTargetDays ?? <Dash />}</TD>
                <TD align="number" className={cn(r.overDays && "font-bold text-rose-700")}>{r.overDays || <Dash />}</TD>
                <TD align="number">{r.candidates || <Dash />}</TD>
                <TD align="number">{r.appointed || <Dash />}</TD>
                <TD align="center"><DocBadge tone={RISK_TONE[r.risk]}>{t(...(RISK_PAIRS[r.risk] ?? [r.risk, r.risk]))}</DocBadge></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("PR lewat SLA perlu eskalasi: tindak lanjut recruiter atau keputusan hold/close.", "PRs over SLA need escalation: recruiter follow-up or a hold/close decision.")} />
    </ReportSheet>
  );
}

// ================= RC2.1 Job Opening & Advertising Performance =================
export function RC21View({ data, meta }: { data: RC21Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="rc21" landscape>
      <DocHeader meta={meta} reportNo="RC2.1" title="Job Opening & Advertising Performance" subtitle={t("Kinerja Iklan Lowongan & Slot", "Job Ad & Slot Performance")} audience={t("HR · Marketing · Finance", "HR · Marketing · Finance")} docNo={mkDocNo("rc21", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Lamaran = pelamar terverifikasi talent pool; hire = pengangkatan dari PR slot iklan.", "Applications = verified talent-pool applicants; hires = appointments from the ad slots' PRs.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Iklan", "Job Ads"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tayang", "Posted"), value: f.num(data.posted) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Slot PR", "PR Slots"), value: f.num(data.sum.slots) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Lamaran", "Applications"), value: f.num(data.sum.applications) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kandidat", "Candidates"), value: f.num(data.sum.candidates) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: "Hire", value: f.num(data.sum.hires) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Biaya Aktual", "Actual Cost"), value: data.sum.actualCost != null ? fmtIDR(data.sum.actualCost) : data.masked ? <Mask /> : <Dash /> }]} />
      </div>

      <DocSection no="B" title={t("Kinerja per Iklan (JO)", "Performance per Job Ad (JO)")} note={t("Biaya mengikuti kebijakan brankas gaji — disembunyikan saat terkunci.", "Costs follow the salary-vault policy — hidden while locked.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Iklan</TH><TH>Judul</TH><TH align="center">Status</TH><TH align="center">Tayang</TH><TH align="center">Batas Akhir</TH>
              <TH align="number">Slot</TH><TH>PR Dilayani</TH><TH align="number">Kanal</TH>
              <TH align="number">Biaya Rencana</TH><TH align="number">Biaya Aktual</TH>
              <TH align="number">Lamaran</TH><TH align="number">Kandidat</TH><TH align="number">Hire</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.refNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.refNo}</TD>
                <TD className="font-semibold text-slate-800">{r.title}</TD>
                <TD align="center"><DocBadge tone={JO_STATUS_TONE[r.status] ?? "slate"}>{t(...(JO_STATUS_PAIRS[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD align="center" className="font-mono">{r.datePosted ?? <Dash />}</TD>
                <TD align="center" className="font-mono">{r.lastAcceptDate ?? <Dash />}</TD>
                <TD align="number" className="font-bold">{f.num(r.slots)}</TD>
                <TD className="text-[9.5px]">{r.prNos.join(", ") || <Dash />}</TD>
                <TD align="number">{f.num(r.methods)}</TD>
                <TD align="number">{r.plannedCost != null ? fmtIDR(r.plannedCost) : data.masked ? <Mask /> : <Dash />}</TD>
                <TD align="number">{r.actualCost != null ? fmtIDR(r.actualCost) : data.masked ? <Mask /> : <Dash />}</TD>
                <TD align="number" className="font-bold">{f.num(r.applications)}</TD>
                <TD align="number">{f.num(r.candidates)}</TD>
                <TD align="number" className="font-black">{r.hires || <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <DocTable head={<><TH>TOTAL — {data.total} {t("iklan", "job ads")}</TH><TH align="number">Slot</TH><TH align="number">Kanal</TH><TH align="number">Biaya Rencana</TH><TH align="number">Biaya Aktual</TH><TH align="number">Lamaran</TH><TH align="number">Kandidat</TH><TH align="number">Hire</TH></>}>
          <TotalRow label={`TOTAL — ${data.total} ${t("iklan", "job ads")}`} cells={[
            f.num(data.sum.slots), "—",
            moneyOrStr(data.sum.plannedCost, data.masked),
            moneyOrStr(data.sum.actualCost, data.masked),
            f.num(data.sum.applications), f.num(data.sum.candidates), f.num(data.sum.hires),
          ]} spanLabel={1} />
        </DocTable>
      </div>

      <DocFooter meta={meta} signNote={t("Basis evaluasi kanal iklan untuk periode berikutnya — bandingkan lamaran & hire per rupiah belanja.", "Channel evaluation basis for the next period — compare applications & hires per rupiah of spend.")} />
    </ReportSheet>
  );
}

// ================= RC2.2 Applicant Source Effectiveness =================
export function RC22View({ data, meta }: { data: RC22Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="rc22" landscape>
      <DocHeader meta={meta} reportNo="RC2.2" title="Applicant Source Effectiveness" subtitle={t("Efektivitas Sumber Pelamar & Cost per Hire", "Applicant Source & Cost per Hire")} audience={t("HR · Direksi · Finance", "HR · Directors · Finance")} docNo={mkDocNo("rc22", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Belanja = biaya aktual kanal iklan; cost per hire = belanja ÷ hire. Nilai mengikuti kebijakan brankas gaji.", "Spend = actual ad-channel costs; cost per hire = spend ÷ hires. Values follow the salary-vault policy.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pelamar", "Applicants"), value: f.num(data.total.applicants), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kandidat", "Candidates"), value: f.num(data.total.candidates) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: "Hire", value: f.num(data.total.hires) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Belanja", "Total Spend"), value: data.total.spend != null ? fmtIDR(data.total.spend) : data.masked ? <Mask /> : <Dash /> }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Cost per Hire", "Cost per Hire"), value: data.total.costPerHire != null ? fmtIDR(data.total.costPerHire) : data.masked ? <Mask /> : <Dash />, accent: true }]} />
      </div>

      <DocSection no="B" title={t("Efektivitas per Sumber", "Effectiveness per Source")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>Sumber</TH><TH align="number">Pelamar</TH><TH align="number">Kandidat</TH>
        <TH align="number">Hire</TH><TH align="number">Hire Rate %</TH><TH align="number">Belanja</TH><TH align="number">Cost per Hire</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={r.source} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="font-bold text-slate-800">{r.sourceLabel}</TD>
            <TD align="number">{f.num(r.applicants)}</TD>
            <TD align="number">{f.num(r.candidates)}</TD>
            <TD align="number" className="font-black">{r.hires || <Dash />}</TD>
            <TD align="number">{r.hireRate != null ? f.pct(r.hireRate) : <Dash />}</TD>
            <TD align="number">{r.spend != null ? fmtIDR(r.spend) : data.masked ? <Mask /> : <Dash />}</TD>
            <TD align="number" className="font-bold">{r.costPerHire != null ? fmtIDR(r.costPerHire) : data.masked ? <Mask /> : <Dash />}</TD>
          </tr>
        ))}
        <TotalRow label={`TOTAL — ${data.rows.length} ${t("sumber", "sources")}`} cells={[
          f.num(data.total.applicants), f.num(data.total.candidates), f.num(data.total.hires), "—",
          moneyOrStr(data.total.spend, data.masked),
          moneyOrStr(data.total.costPerHire, data.masked),
        ]} spanLabel={2} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Sumber tanpa belanja tercatat (referral/internal) tetap dihitung hire-nya — cost per hire 0.", "Sources without recorded spend (referral/internal) still count hires — cost per hire 0.")} />
    </ReportSheet>
  );
}

// ================= RC2.3 Talent Pool Register =================
export function RC23View({ data, meta }: { data: RC23Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="rc23" landscape>
      <DocHeader meta={meta} reportNo="RC2.3" title="Talent Pool Register" subtitle={t("Daftar Pelamar Tersimpan (Talent Pool)", "Stored Applicants (Talent Pool)")} audience={t("HR Recruiter · HRBP", "HR Recruiters · HRBP")} docNo={mkDocNo("rc23", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Hangus = keep-on-file habis ≤ 30 hari (status Aktif). Flag blokir/suspend mengikuti catatan HR.", "Expiring = keep-on-file ending ≤ 30 days (Active status). Block/suspend flags follow HR records.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pelamar", "Applicants"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Aktif", "Active"), value: f.num(data.byStatus.find((s) => s.status === "Active")?.count ?? 0) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hangus ≤30 hari", "Expiring ≤30d"), value: f.num(data.expiringSoon) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dipekerjakan", "Employed"), value: f.num(data.byStatus.find((s) => s.status === "Employed")?.count ?? 0) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Diblokir", "Blacklisted"), value: f.num(data.blacklisted), accent: data.blacklisted > 0 }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Disuspend", "Suspended"), value: f.num(data.suspended) }]} />
      </div>

      <DocSection no="B" title={t("Register Pelamar (urut masuk terbaru)", "Applicant Register (newest first)")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH>
              <TH>No. Pelamar</TH><TH>Nama</TH><TH align="center">Status</TH><TH>Sumber</TH>
              <TH align="center">Pendidikan</TH><TH align="number">IPK</TH><TH align="number">Pengalaman (thn)</TH>
              <TH align="center">Masuk Pool</TH><TH align="center">Hangus Pada</TH>
              <TH align="number">Lamaran</TH><TH align="center">Flag</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.applicantNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.flags.includes("blacklist") && "bg-rose-50/40")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.applicantNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD align="center"><DocBadge tone={APPLICANT_STATUS_TONE[r.status] ?? "slate"}>{t(...(APPLICANT_STATUS_PAIRS[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD>{r.source ?? <Dash />}</TD>
                <TD align="center">{r.eduLevel ?? <Dash />}</TD>
                <TD align="number">{r.gpa != null ? r.gpa.toFixed(2) : <Dash />}</TD>
                <TD align="number">{r.expYears != null ? f.num(r.expYears) : <Dash />}</TD>
                <TD align="center" className="font-mono">{r.dateApplied}</TD>
                <TD align="center" className="font-mono">{r.keepOnFileUntil ?? <Dash />}</TD>
                <TD align="number">{f.num(r.applications)}</TD>
                <TD align="center">{r.flags.length ? (
                  <span className="inline-flex gap-1">
                    {r.flags.includes("blacklist") && <DocBadge tone="red">{t("Blokir", "Blacklist")}</DocBadge>}
                    {r.flags.includes("suspend") && <DocBadge tone="amber">{t("Suspend", "Suspended")}</DocBadge>}
                  </span>
                ) : <Dash />}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Data pribadi pelamar (kontak/identitas) tidak disertakan — lihat detail di modul Rekrutmen sesuai kebijakan privasi.", "Applicant private data (contact/identity) is not included — see details in the Recruitment module per privacy policy.")} />
    </ReportSheet>
  );
}
