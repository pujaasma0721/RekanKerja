"use client";
// MED-1-b — views dokumen Medical Grup 3 (Analisis Biaya) + Grup 4 (Asuransi) ====
// Mirror pola leave/report-documents/report-views-g34.tsx (T112).
//
// AUDIT KOLOM (insiden R1.2 payroll & LR3.1): jumlah kolom thead = jumlah sel
// efektif tiap baris tbody; TotalRow spanLabel + cells.length = jumlah kolom.
//   MR31 B 9 (1 + 8) · MR31 C 4 (1 + 3) · MR32 B 10 (1 + 9) · MR33 B 9 (2 + 7)
//   MR41 B 8 (1 + 7) · MR41 C 5 (1 + 4) · MR41 D 11 (7 + 4)
//   MR42 B 9 (8 + 1) · MR42 C 9 (8 + 1) · MR43 B 12 (7 + 5).
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import { mkDocNo, rp, sumMoney } from "./report-views-g12";
import type { DocMeta, MR31Data, MR32Data, MR33Data, MR41Data, MR42Data, MR43Data } from "./types";

/** Tone badge status klaim medical. */
const STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "sky"> = {
  Settled: "green", Approved: "sky", Submitted: "amber", Draft: "slate", Rejected: "red", Cancelled: "slate",
};
const STATUS_LABEL: Record<string, [string, string]> = {
  Settled: ["Settled (Dibayar)", "Settled (Paid)"], Approved: ["Disetujui", "Approved"],
  Submitted: ["Menunggu Verifikasi", "Pending Verification"], Draft: ["Draft", "Draft"],
  Rejected: ["Ditolak", "Rejected"], Cancelled: ["Dibatalkan", "Cancelled"],
};
/** Status penagihan ke asuransi (MR4.1). */
const INS_STATE_TONE: Record<string, "slate" | "amber" | "green" | "red"> = {
  NONE: "slate", SUBMITTED: "amber", PAID: "green", WRITTEN_OFF: "red",
};
const INS_STATE_LABEL: Record<string, [string, string]> = {
  NONE: ["Belum Dikirim", "Not Submitted"], SUBMITTED: ["Dikirim ke Asuransi", "Submitted to Insurer"],
  PAID: ["Dibayar Asuransi", "Paid by Insurer"], WRITTEN_OFF: ["Hapus Buku", "Written Off"],
};

/** Banner brankas uang terkunci (mirror LR1.3 leave). */
function MaskedBanner() {
  const { t } = useI18n();
  return (
    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
      {t("⚠ Brankas uang terkunci — nilai rupiah disembunyikan (•••). Buka Brankas Uang untuk menampilkan nilai.", "⚠ Money vault locked — rupiah values hidden (•••). Open the Money Vault to reveal values.")}
    </p>
  );
}

// ================= MR3.1 Medical Claim Distribution by Type =================
export function MR31View({ data, meta }: { data: MR31Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const settledTotal = data.rows.reduce((s, r) => s + r.settledCount, 0);
  const avgTotal = data.total.approved != null && data.total.claimCount > 0
    ? Math.round(data.total.approved / data.total.claimCount)
    : null;
  return (
    <ReportSheet docId="mr31" landscape>
      <DocHeader meta={meta} reportNo="R3.1" title="Medical Claim Distribution by Type" subtitle={t("Distribusi pengeluaran per kategori perawatan + tren 12 bulan", "Spending distribution per treatment category + 12-month trend")} audience={t("Direksi · Finance · HR C&B", "Directorate · Finance · HR C&B")} docNo={mkDocNo("mr31", meta)} />

      <DocSection no="A" title={t("Ringkasan Distribusi", "Distribution Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Klaim", "Total Claims"), value: f.num(data.total.claimCount), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Tagihan", "Total Billed"), value: rp(data.total.bill) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Disetujui", "Total Approved"), value: rp(data.total.approved), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Porsi Asuransi", "Insurance Share"), value: rp(data.total.insurancePart) }]} />
      </div>
      {data.masked && <MaskedBanner />}

      <DocSection no="B" title={t("Distribusi per Jenis Perawatan", "Distribution per Treatment Type")} note={t("Uang dihitung dari klaim berstatus Disetujui & Settled; porsi asuransi mengikuti kebijakan pctInsurance per jenis benefit.", "Amounts are computed from Approved & Settled claims; the insurance share follows the pctInsurance policy per benefit type.")} />
      <DocTable head={<>
        <TH>Jenis Perawatan</TH><TH align="number">Jumlah Klaim</TH><TH align="number">Settled</TH>
        <TH align="number">Total Tagihan</TH><TH align="number">Total Disetujui</TH>
        <TH align="number">Porsi Perusahaan</TH><TH align="number">Porsi Asuransi</TH>
        <TH align="number">% dari Total</TH><TH align="number">Rata-rata/Klaim</TH>
      </>}>
        {data.rows.map((r, idx) => (
          <tr key={r.typeCode} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{r.typeName}</TD>
            <TD align="number">{f.num(r.claimCount)}</TD>
            <TD align="number">{f.num(r.settledCount)}</TD>
            <TD align="number">{rp(r.bill)}</TD>
            <TD align="number">{rp(r.approved)}</TD>
            <TD align="number">{rp(r.companyPart)}</TD>
            <TD align="number">{rp(r.insurancePart)}</TD>
            <TD align="number" className="font-black">{r.sharePct != null ? f.pct(r.sharePct) : <Dash />}</TD>
            {/* null + vault terbuka = kategori tanpa klaim berbayar (bukan masked) → "—" */}
            <TD align="number">{r.avgPerClaim == null && !data.masked ? <Dash /> : rp(r.avgPerClaim)}</TD>
          </tr>
        ))}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[
          f.num(data.total.claimCount), f.num(settledTotal),
          rp(data.total.bill), rp(data.total.approved),
          rp(data.total.companyPart), rp(data.total.insurancePart),
          data.total.approved != null ? "100%" : "—", rp(avgTotal),
        ]} spanLabel={1} />
      </DocTable>

      <DocSection no="C" title={t("Tren Bulanan", "Monthly Trend")} />
      <DocTable head={<>
        <TH>Bulan</TH><TH align="number">Klaim</TH><TH align="number">Tagihan</TH><TH align="number">Disetujui</TH>
      </>}>
        {data.monthly.map((m, idx) => (
          <tr key={m.month} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{m.month}</TD>
            <TD align="number">{f.num(m.claims)}</TD>
            <TD align="number">{rp(m.bill)}</TD>
            <TD align="number" className="font-bold">{rp(m.approved)}</TD>
          </tr>
        ))}
        {data.monthly.length === 0 && (
          <tr><TD colSpan={4} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada klaim tahun ini.", "No claims this year yet.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL 12 BULAN", "12-MONTH TOTAL")} cells={[
          f.num(data.monthly.reduce((s, m) => s + m.claims, 0)),
          rp(sumMoney(data.monthly, (m) => m.bill)),
          rp(sumMoney(data.monthly, (m) => m.approved)),
        ]} spanLabel={1} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Distribusi biaya per kategori perawatan — uang dihitung dari klaim berstatus Disetujui & Settled. Porsi asuransi mengikuti kebijakan pctInsurance per jenis benefit.", "Cost distribution per treatment category — amounts are computed from Approved & Settled claims. The insurance share follows the pctInsurance policy per benefit type.")} />
    </ReportSheet>
  );
}

// ================= MR3.2 Absenteeism Due to Medical Reasons =================
export function MR32View({ data, meta }: { data: MR32Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const est = (lost: number, sick: number) => Math.max(0, lost - sick);
  return (
    <ReportSheet docId="mr32" landscape>
      <DocHeader meta={meta} reportNo="R3.2" title="Absenteeism Due to Medical Reasons Analysis" subtitle={t("Keterkaitan klaim medis dengan hari kerja hilang per departemen + biaya per hari hilang", "Medical claims vs lost workdays per department + cost per lost day")} audience={t("HR · Manajemen Operasional · Direksi", "HR · Operations Management · Directorate")} docNo={mkDocNo("mr32", meta)} />

      <DocSection no="A" title={t("Ringkasan Utilisasi", "Utilization Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Klaim Medis", "Total Medical Claims"), value: f.num(data.total.claimCount), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rawat Inap", "Inpatient"), value: f.num(data.total.inpatientClaims) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rawat Jalan", "Outpatient"), value: f.num(data.total.outpatientClaims) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Biaya per Hari Hilang", "Cost per Lost Day"), value: data.total.costPerLostDay == null && !data.masked ? "—" : rp(data.total.costPerLostDay), accent: true }]} />
      </div>
      {data.masked && <MaskedBanner />}

      <DocSection no="B" title={t("Analisis per Divisi", "Analysis per Division")} note={t("¹ Estimasi hari rawat inap = jumlah baris perawatan rawat inap (MedicalClaimLine) — satu baris ≈ satu hari perawatan; hari kerja hilang = cuti sakit (CT-SAKIT) + estimasi rawat inap.", "¹ Inpatient-day estimate = count of inpatient treatment lines (MedicalClaimLine) — one line ≈ one treatment day; lost workdays = sick leave (CT-SAKIT) + the inpatient estimate.")} />
      <DocTable head={<>
        <TH>Divisi</TH><TH align="number">Headcount</TH><TH align="number">Klaim Medis</TH>
        <TH align="number">Rawat Inap</TH><TH align="number">Rawat Jalan</TH><TH align="number">Disetujui (Rp)</TH>
        <TH align="number">Cuti Sakit (hari)</TH><TH align="number">Est. Hari Rawat¹ (hari)</TH>
        <TH align="number">Total Hari Hilang</TH><TH align="number">Biaya per Hari Hilang</TH>
      </>}>
        {data.rows.map((r, idx) => (
          <tr key={r.division} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{r.division}</TD>
            <TD align="number">{f.num(r.headcount)}</TD>
            <TD align="number">{f.num(r.claimCount)}</TD>
            <TD align="number">{r.inpatientClaims > 0 ? f.num(r.inpatientClaims) : <Dash />}</TD>
            <TD align="number">{f.num(r.outpatientClaims)}</TD>
            <TD align="number">{rp(r.approved)}</TD>
            <TD align="number">{f.num(r.sickLeaveDays)}</TD>
            <TD align="number">{f.num(est(r.lostWorkdays, r.sickLeaveDays))}</TD>
            <TD align="number" className="font-black">{f.num(r.lostWorkdays)}</TD>
            {/* null + vault terbuka = tidak ada hari hilang (bukan masked) → "—" */}
            <TD align="number">{r.costPerLostDay == null && !data.masked ? <Dash /> : rp(r.costPerLostDay)}</TD>
          </tr>
        ))}
        <TotalRow label={t("TOTAL PERUSAHAAN", "COMPANY TOTAL")} cells={[
          f.num(data.total.headcount), f.num(data.total.claimCount),
          f.num(data.total.inpatientClaims), f.num(data.total.outpatientClaims),
          rp(data.total.approved), f.num(data.total.sickLeaveDays),
          f.num(est(data.total.lostWorkdays, data.total.sickLeaveDays)),
          f.num(data.total.lostWorkdays), data.total.costPerLostDay == null && !data.masked ? "—" : rp(data.total.costPerLostDay),
        ]} spanLabel={1} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("¹ Estimasi hari rawat inap = jumlah baris perawatan rawat inap (MedicalClaimLine) — satu baris ≈ satu hari perawatan; hari kerja hilang = cuti sakit (CT-SAKIT) + estimasi rawat inap. Analisis untuk program kesehatan kerja & manajemen absensi.", "¹ Inpatient-day estimate = count of inpatient treatment lines (MedicalClaimLine) — one line ≈ one treatment day; lost workdays = sick leave (CT-SAKIT) + the inpatient estimate. Analysis for occupational health & absence management programs.")} />
    </ReportSheet>
  );
}

// ================= MR3.3 High-Frequency Diagnosis Log =================
export function MR33View({ data, meta }: { data: MR33Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="mr33">
      <DocHeader meta={meta} reportNo="R3.3" title="High-Frequency Diagnosis Log" subtitle={t("Statistik diagnosis penyakit terbanyak yang diklaim — ANONIM demi privasi", "Most frequently claimed diagnosis statistics — ANONYMIZED for privacy")} audience={t("HR Wellness · Manajemen (Anonim)", "HR Wellness · Management (Anonymized)")} docNo={mkDocNo("mr33", meta)} />

      <DocSection no="A" title={t("Ringkasan Diagnosis", "Diagnosis Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kombinasi Diagnosis", "Diagnosis Combos"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Klaim", "Total Claims"), value: f.num(data.claimsTotal) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Tagihan", "Total Billed"), value: rp(data.sum.bill) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Disetujui", "Total Approved"), value: rp(data.sum.approved), accent: true }]} />
      </div>

      <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-bold text-rose-700">
        {data.privacyNote}
      </p>

      <DocSection no="B" title={t("Statistik Diagnosis (urut frekuensi tertinggi)", "Diagnosis Statistics (highest frequency first)")} note={t("Jumlah pasien tidak dijumlahkan antar diagnosis (satu pasien dapat muncul di beberapa diagnosis).", "Patient counts are not summed across diagnoses (one patient may appear under several diagnoses).")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>Diagnosis / Perawatan</TH><TH align="number">Klaim</TH><TH align="number">Pasien (n)</TH>
        <TH align="number">Tagihan</TH><TH align="number">Disetujui</TH><TH align="number">% dari Total</TH>
        <TH align="center">Rawat Inap</TH><TH align="center">Periode (Pertama–Terakhir)</TH>
      </>}>
        {data.items.map((i, idx) => (
          <tr key={i.diagnosis} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD align="center" className="text-slate-400">{idx + 1}</TD>
            <TD className="font-bold text-slate-800">{i.diagnosis}</TD>
            <TD align="number" className="font-black">{f.num(i.claims)}</TD>
            <TD align="number">{f.num(i.patients)}</TD>
            <TD align="number">{rp(i.bill)}</TD>
            <TD align="number">{rp(i.approved)}</TD>
            <TD align="number">{i.sharePct != null ? f.pct(i.sharePct) : <Dash />}</TD>
            <TD align="center">
              {i.inpatient ? <DocBadge tone="green">{t("Ya", "Yes")}</DocBadge> : <DocBadge tone="slate">{t("Tidak", "No")}</DocBadge>}
            </TD>
            <TD align="center">
              {i.firstSeen && i.lastSeen ? `${f.dt(i.firstSeen)} – ${f.dt(i.lastSeen)}` : f.dt(i.firstSeen ?? i.lastSeen)}
            </TD>
          </tr>
        ))}
        {data.items.length === 0 && (
          <tr><TD colSpan={9} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada klaim pada rentang ini.", "No claims in this range yet.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[
          f.num(data.claimsTotal), "", rp(data.sum.bill), rp(data.sum.approved), "", "", "",
        ]} spanLabel={2} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Statistik diagnosis ANONIM — identitas pasien tidak pernah ditampilkan (hanya jumlah), sesuai kerahasiaan informasi kesehatan. Dasar perancangan program wellness & promosi kesehatan perusahaan.", "ANONYMIZED diagnosis statistics — patient identities are never shown (counts only), per health information confidentiality. Basis for company wellness & health promotion program design.")} />
    </ReportSheet>
  );
}

// ================= MR4.1 Insurance Premium vs Utilization Reconciliation =================
export function MR41View({ data, meta }: { data: MR41Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const claimsSum = data.byInsurer.reduce((s, x) => s + x.claims, 0);
  const recRate = data.sum.recovered != null && data.sum.insurancePart != null && data.sum.insurancePart > 0
    ? Math.round((data.sum.recovered / data.sum.insurancePart) * 100)
    : null;
  return (
    <ReportSheet docId="mr41" landscape>
      <DocHeader meta={meta} reportNo="R4.1" title="Insurance Premium vs Utilization Reconciliation Sheet" subtitle={t("Rekonsiliasi beban premi equivalen vs klaim riil per penanggung — recovery, piutang outstanding, write-off", "Equivalent premium burden vs actual claims per insurer — recovery, outstanding receivables, write-off")} audience={t("Finance · Broker/TPA · Direksi", "Finance · Broker/TPA · Directorate")} docNo={mkDocNo("mr41", meta)} />

      <DocSection no="A" title={t("Ringkasan Rekonsiliasi", "Reconciliation Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Klaim Settled", "Settled Claims"), value: f.num(claimsSum), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Disetujui", "Total Approved"), value: rp(data.sum.approved) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Bagian Asuransi", "Insurance Share"), value: rp(data.sum.insurancePart) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pulih dari Asuransi", "Recovered from Insurer"), value: rp(data.sum.recovered), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Piutang Outstanding", "Outstanding Receivable"), value: rp(data.sum.outstanding) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hapus Buku", "Written Off"), value: rp(data.sum.writtenOff) }]} />
      </div>
      {data.masked && <MaskedBanner />}

      <DocSection no="B" title={t("Rekonsiliasi per Penanggung / TPA", "Reconciliation per Insurer / TPA")} note={t("Recovery rate = dipulihkan ÷ bagian asuransi × 100.", "Recovery rate = recovered ÷ insurance share × 100.")} />
      <DocTable head={<>
        <TH>Penanggung / TPA</TH><TH align="number">Klaim</TH><TH align="number">Disetujui</TH>
        <TH align="number">Bagian Asuransi</TH><TH align="number">Dipulihkan</TH>
        <TH align="number">Piutang Outstanding</TH><TH align="number">Hapus Buku</TH><TH align="number">Recovery Rate</TH>
      </>}>
        {data.byInsurer.map((x, idx) => (
          <tr key={x.insurer} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{x.insurer}</TD>
            <TD align="number">{f.num(x.claims)}</TD>
            <TD align="number">{rp(x.approved)}</TD>
            <TD align="number">{rp(x.insurancePart)}</TD>
            <TD align="number">{rp(x.recovered)}</TD>
            <TD align="number" className="font-black">{rp(x.outstanding)}</TD>
            <TD align="number">{rp(x.writtenOff)}</TD>
            <TD align="number">{x.recoveryRate != null ? f.pct(x.recoveryRate) : <Dash />}</TD>
          </tr>
        ))}
        {data.byInsurer.length === 0 && (
          <tr><TD colSpan={8} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada klaim settled dengan penanggung.", "No settled insurer claims yet.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[
          f.num(claimsSum), rp(data.sum.approved), rp(data.sum.insurancePart),
          rp(data.sum.recovered), rp(data.sum.outstanding), rp(data.sum.writtenOff),
          f.pct(recRate),
        ]} spanLabel={1} />
      </DocTable>

      <DocSection no="C" title={t("Tren Bulanan", "Monthly Trend")} />
      <DocTable head={<>
        <TH>Bulan</TH><TH align="number">Klaim</TH><TH align="number">Disetujui</TH>
        <TH align="number">Porsi Perusahaan</TH><TH align="number">Porsi Asuransi</TH>
      </>}>
        {data.monthly.map((m, idx) => (
          <tr key={m.month} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{m.month}</TD>
            <TD align="number">{f.num(m.claims)}</TD>
            <TD align="number">{rp(m.approved)}</TD>
            <TD align="number">{rp(m.companyPart)}</TD>
            <TD align="number">{rp(m.insurancePart)}</TD>
          </tr>
        ))}
        {data.monthly.length === 0 && (
          <tr><TD colSpan={5} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada data bulanan.", "No monthly data yet.")}</TD></tr>
        )}
        <TotalRow label={t("TOTAL 12 BULAN", "12-MONTH TOTAL")} cells={[
          f.num(data.monthly.reduce((s, m) => s + m.claims, 0)),
          rp(sumMoney(data.monthly, (m) => m.approved)),
          rp(sumMoney(data.monthly, (m) => m.companyPart)),
          rp(sumMoney(data.monthly, (m) => m.insurancePart)),
        ]} spanLabel={1} />
      </DocTable>

      <DocSection no="D" title={t("Rincian Klaim Piutang Asuransi (urut umur piutang)", "Insurance Receivable Claim Detail (oldest first)")} note={t("Piutang asuransi dicatat pada akun 13xx; umur dihitung dari tanggal settle.", "Insurance receivables are booked to account 13xx; aging is computed from the settle date.")} />
      <div className="doc-scroll max-h-[420px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Jenis Benefit</TH>
              <TH>Penanggung</TH><TH align="center">Tgl Settle</TH><TH align="center">Status Asuransi</TH>
              <TH align="number">Nilai Klaim Asuransi</TH><TH align="number">Dibayar</TH>
              <TH align="number">Outstanding</TH><TH align="number">Umur (hari)</TH>
            </tr>
          </thead>
          <tbody>
            {data.claims.map((c, idx) => (
              <tr key={c.docNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{c.docNo}</TD>
                <TD className="font-bold text-slate-800">{c.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{c.name}</TD>
                <TD className="text-[9.5px]">{c.typeName}</TD>
                <TD className="text-[9.5px] font-bold">{c.insurer}</TD>
                <TD align="center">{f.dt(c.settleDate)}</TD>
                <TD align="center"><DocBadge tone={INS_STATE_TONE[c.insState] ?? "slate"}>{t(...(INS_STATE_LABEL[c.insState] ?? [c.insState, c.insState]))}</DocBadge></TD>
                <TD align="number">{rp(c.insAmount)}</TD>
                <TD align="number">{rp(c.insPaidAmount)}</TD>
                <TD align="number" className="font-black">{rp(c.outstanding)}</TD>
                <TD align="number">{f.num(c.ageDays)}</TD>
              </tr>
            ))}
            {data.claims.length === 0 && (
              <tr><TD colSpan={11} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada piutang asuransi berjalan 🎉", "No outstanding insurer receivables 🎉")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.claims.length} ${t("klaim", "claims")}`} cells={[
              rp(sumMoney(data.claims, (c) => c.insAmount)),
              rp(sumMoney(data.claims, (c) => c.insPaidAmount)),
              rp(sumMoney(data.claims, (c) => c.outstanding)),
              "",
            ]} spanLabel={7} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Premi equivalen = bagian asuransi dari klaim disetujui (pctInsurance per jenis). Nilai premi riil mengikuti polis/invoice penanggung (di luar HRIS) — sheet ini merekonsiliasi utilisasi klaim terhadap beban yang ditanggung asuransi. Piutang asuransi dicatat pada akun 13xx.", "Equivalent premium = the insurance share of approved claims (pctInsurance per type). Actual premium follows the insurer policy/invoice (outside HRIS) — this sheet reconciles claim utilization against the insurer-borne burden. Insurance receivables are booked to account 13xx.")} />
    </ReportSheet>
  );
}

// ================= MR4.2 Insurance Enrollment & De-enrollment Log =================
export function MR42View({ data, meta }: { data: MR42Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="mr42">
      <DocHeader meta={meta} reportNo="R4.2" title="Insurance Enrollment & De-enrollment Log" subtitle={t("Mutasi peserta asuransi — karyawan baru wajib didaftarkan, resign harus dinonaktifkan", "Insurance member mutations — new hires to enroll, resignees to deactivate")} audience={t("HR · Broker/TPA · Finance", "HR · Broker/TPA · Finance")} docNo={mkDocNo("mr42", meta)} />

      <DocSection no="A" title={t("Ringkasan Mutasi", "Mutation Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Wajib Enroll", "Must Enroll"), value: f.num(data.counts.enroll), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Wajib Nonaktif", "Must Deactivate"), value: f.num(data.counts.deenroll) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Peserta Aktif Tahun Ini", "Active Enrollees This Year"), value: f.num(data.activeEnrolled) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tahun", "Year"), value: f.num(data.year) }]} />
      </div>

      <DocSection no="B" title={t("Karyawan Wajib Enroll", "Employees Requiring Enrollment")} note={t("Karyawan baru wajib didaftarkan ke penanggung/TPA segera setelah masuk.", "New hires must be registered with the insurer/TPA immediately after joining.")} />
      <div className="doc-scroll max-h-[360px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH align="center">L/P</TH><TH align="center">Tgl Masuk</TH>
              <TH align="center">Status</TH><TH align="center">Saldo Digenerate</TH><TH align="number">Tertunda (hari)</TH><TH>Tindakan</TH>
            </tr>
          </thead>
          <tbody>
            {data.enroll.map((e, idx) => (
              <tr key={e.employeeNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", e.delayedDays > 14 && "bg-amber-50/50")}>
                <TD className="font-bold text-slate-800">{e.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{e.name}</TD>
                <TD>{e.unit ?? <Dash />}</TD>
                <TD align="center">{e.gender === "Perempuan" ? "P" : "L"}</TD>
                <TD align="center">{f.dt(e.joinDate)}</TD>
                <TD align="center">{e.employmentStatus}</TD>
                <TD align="center"><DocBadge tone={e.balanceGenerated ? "green" : "slate"}>{e.balanceGenerated ? t("Ya", "Yes") : t("Belum", "Not Yet")}</DocBadge></TD>
                <TD align="number" className={cn("font-bold", e.delayedDays > 14 && "text-amber-600")}>{f.num(e.delayedDays)}</TD>
                <TD className="text-[9.5px] text-slate-600">{e.action}</TD>
              </tr>
            ))}
            {data.enroll.length === 0 && (
              <tr><TD colSpan={9} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada karyawan wajib enroll 🎉", "No employees requiring enrollment 🎉")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.counts.enroll} ${t("karyawan", "employees")}`} cells={[""]} spanLabel={8} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Karyawan Wajib Nonaktif", "Employees Requiring Deactivation")} note={t("Karyawan keluar harus dinonaktifkan agar tidak terjadi pembayaran premi ganda (double payment).", "Leavers must be deactivated to prevent double premium payments.")} />
      <div className="doc-scroll max-h-[360px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH align="center">Tgl Masuk</TH><TH align="center">Tgl Keluar</TH>
              <TH align="center">Status</TH><TH align="number">Klaim Thn Ini</TH><TH align="number">Sisa Saldo</TH><TH>Tindakan</TH>
            </tr>
          </thead>
          <tbody>
            {data.deenroll.map((e, idx) => (
              <tr key={e.employeeNo} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60")}>
                <TD className="font-bold text-slate-800">{e.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{e.name}</TD>
                <TD>{e.unit ?? <Dash />}</TD>
                <TD align="center">{f.dt(e.joinDate)}</TD>
                <TD align="center">{f.dt(e.endDate)}</TD>
                <TD align="center">{e.status}</TD>
                <TD align="number">{f.num(e.claimsThisYear)}</TD>
                <TD align="number">{rp(e.balanceRemaining)}</TD>
                <TD className="text-[9.5px] text-slate-600">{e.action}</TD>
              </tr>
            ))}
            {data.deenroll.length === 0 && (
              <tr><TD colSpan={9} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada karyawan wajib nonaktif 🎉", "No employees requiring deactivation 🎉")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.counts.deenroll} ${t("karyawan", "employees")}`} cells={[""]} spanLabel={8} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Log mutasi peserta asuransi — karyawan baru wajib didaftarkan ke penanggung/TPA segera setelah masuk; karyawan keluar harus dinonaktifkan agar tidak terjadi pembayaran premi ganda (double payment).", "Insurance member mutation log — new hires must be registered with the insurer/TPA immediately after joining; leavers must be deactivated to prevent double premium payments.")} />
    </ReportSheet>
  );
}

// ================= MR4.3 Coordination of Benefits (CoB) Audit Report =================
export function MR43View({ data, meta }: { data: MR43Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="mr43" landscape>
      <DocHeader meta={meta} reportNo="R4.3" title="Coordination of Benefits (CoB) Audit Report" subtitle={t("Audit klaim yang memisahkan jaminan BPJS Kesehatan (penjamin pertama) dari asuransi swasta/reimbursement internal (penjamin kedua)", "Audit of claims separating BPJS Kesehatan (first payer) from private insurance/internal reimbursement (second payer)")} audience={t("Finance · Auditor · TPA/Asuransi", "Finance · Audit · TPA/Insurer")} docNo={mkDocNo("mr43", meta)} />

      <DocSection no="A" title={t("Ringkasan Audit CoB", "CoB Audit Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Klaim Diaudit", "Audited Claims"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dgn Penjamin Pertama", "With First Payer"), value: f.num(data.withFirstPayer) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Tagihan", "Total Billed"), value: rp(data.sum.bill) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Ditanggung Penjamin Pertama", "Borne by First Payer"), value: rp(data.sum.firstPayer) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Disetujui Perusahaan", "Approved by Company"), value: rp(data.sum.approved), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Register Audit CoB (urut tanggal klaim)", "CoB Audit Register (by claim date)")} note={t("Kolom Penjamin Pertama (Non-Re) = bagian tagihan yang TIDAK diajukan reimbursement karena telah ditanggung pihak lain.", "The First Payer (Non-Re) column = the portion of the bill NOT submitted for reimbursement because it was already borne by another party.")} />
      <div className="doc-scroll max-h-[560px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Jenis Benefit</TH>
              <TH align="center">Tgl Klaim</TH><TH>Pasien</TH><TH align="number">Tagihan</TH>
              <TH align="number">Penjamin Pertama (Non-Re)</TH><TH align="number">Reimburse Diajukan</TH>
              <TH align="number">Disetujui Perusahaan</TH><TH align="number">Bagian Asuransi</TH>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, idx) => (
              <tr key={`${i.docNo}-${idx}`} className={cn("hover:bg-slate-50", idx % 2 === 1 && "bg-slate-50/60", (i.firstPayer ?? 0) > 0 && "bg-sky-50/40")}>
                <TD align="center" className="text-slate-400">{idx + 1}</TD>
                <TD className="font-mono text-[9.5px] font-bold text-slate-700">{i.docNo}</TD>
                <TD className="font-bold text-slate-800">{i.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{i.name}</TD>
                <TD className="text-[9.5px]">{i.typeName}</TD>
                <TD align="center">{f.dt(i.claimDate)}</TD>
                <TD className="font-semibold text-slate-800">
                  {i.patient}
                  {i.dependent && <span className="ml-1 rounded bg-slate-100 px-1 py-px text-[8px] font-bold text-slate-500">dep.</span>}
                </TD>
                <TD align="number">{rp(i.bill)}</TD>
                <TD align="number">{rp(i.firstPayer)}</TD>
                <TD align="number">{rp(i.reimburse)}</TD>
                <TD align="number" className="font-black text-slate-900">{rp(i.approved)}</TD>
                <TD align="number">{rp(i.insurancePart)}</TD>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada klaim reimbursement pada rentang / filter ini.", "No reimbursement claims for this range / filter.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("klaim", "claims")}`} cells={[
              rp(data.sum.bill), rp(data.sum.firstPayer), rp(data.sum.reimburse),
              rp(data.sum.approved), rp(data.sum.insurancePart),
            ]} spanLabel={7} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Coordination of Benefits: BPJS Kesehatan bertindak sebagai penjamin PERTAMA; sisa beban diselesaikan asuransi swasta/reimbursement internal (penjamin KEDUA). Kolom Penjamin Pertama (Non-Re) = bagian tagihan yang TIDAK diajukan reimbursement karena telah ditanggung pihak lain.", "Coordination of Benefits: BPJS Kesehatan acts as the FIRST payer; the remaining burden is settled by private insurance/internal reimbursement (SECOND payer). The First Payer (Non-Re) column = the portion of the bill NOT submitted for reimbursement because it was already borne by another party.")} />
    </ReportSheet>
  );
}
