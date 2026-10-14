"use client";
// P8-PERF — views dokumen Kinerja Grup 1 (Siklus & Partisipasi) + Grup 2 =======
// (Penilaian & Hasil). Mirror pola medical/report-documents/report-views-g12.
// Komponen dasar (ReportSheet/DocHeader/…) dipakai bersama dari doc-kit modul
// HR — murni presentasional, tipe DocMeta identik struktural.
//
// AUDIT KOLOM (insiden R1.2 payroll & LR3.1): jumlah kolom thead = jumlah sel
// efektif tiap baris tbody; TotalRow spanLabel + cells.length = jumlah kolom.
//   PF11 B 11 kolom (span 8 + 3) · PF12 B 12 (span 8 + 4) ·
//   PF13 B 14 (span 14 + 0) · PF13 C 5 (span 5 + 0) ·
//   PF21 B 14 (span 10 + 4) · PF22 B 8 (span 1 + 7) ·
//   PF23 A 10 (span 1 + 0) · PF23 K 10 (span 10 + 0) · PF23 C 4 (span 4 + 0) ·
//   PF23 T 7 (span 7 + 0) · PF24 B 12 (span 6 + 6).
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import type {
  DocMeta, PF11Data, PF12Data, PF13Data, PF21Data, PF22Data, PF23Data, PF24Data,
} from "./types";

/** No. dokumen deterministik: PF/PF11/2026/10. */
export function mkDocNo(id: string, meta: DocMeta): string {
  const mm = String(new Date(meta.generatedAt).getMonth() + 1).padStart(2, "0");
  return `PF/${id.slice(1).toUpperCase()}/${meta.year}/${mm}`;
}

/** Rupiah masked — null saat Brankas Uang terkunci (mirror medical MR1.1). */
export const rp = (n: number | null) => (n == null ? <span className="text-slate-300">•••</span> : `Rp ${n.toLocaleString("id-ID")}`);

/** Banner brankas uang terkunci (mirror medical). */
export function MaskedBanner() {
  const { t } = useI18n();
  return (
    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
      {t("⚠ Brankas uang terkunci — nominal merit disembunyikan (•••). Buka Brankas Uang untuk menampilkan nilai.", "⚠ Money vault locked — merit amounts hidden (•••). Open the Money Vault to reveal values.")}
    </p>
  );
}

/** Chip skor/rating berwarna — semantik RatingScale (emerald/amber/red saja). */
export function RatingChip({ rating, label }: { rating: number | null; label: string | null }) {
  const tone = rating == null ? "slate" : rating >= 5 ? "green" : rating === 4 ? "green" : rating === 3 ? "amber" : rating === 2 ? "amber" : "red";
  return <DocBadge tone={tone as "green"}>{label ?? <Dash />}</DocBadge>;
}

/** Status ✓/– rata tengah. */
export const CheckMark = ({ v }: { v: boolean }) => (v ? <span className="font-black text-emerald-600">✓</span> : <span className="text-slate-300">–</span>);

/** Label status appraisal dwibahasa (kunci = label ID dari payload — pola
 *  medical STATUS_LABEL record 2-tuple bertipe + t(...spread)). */
const APPR_STATUS_LABEL: Record<string, [string, string]> = {
  Terdaftar: ["Terdaftar", "Enrolled"],
  "Usulan Target": ["Usulan Target", "Goal Proposed"],
  "Target Disetujui": ["Target Disetujui", "Goals Approved"],
  Berjalan: ["Berjalan", "Ongoing"],
  "Penilaian Diri Selesai": ["Penilaian Diri Selesai", "Self Done"],
  "Penilaian Atasan Selesai": ["Penilaian Atasan Selesai", "Manager Done"],
  "Sedang Kalibrasi": ["Sedang Kalibrasi", "Calibrating"],
  Final: ["Final", "Finalized"],
  Terbit: ["Terbit", "Published"],
  Banding: ["Banding", "Appealed"],
  Tertutup: ["Tertutup", "Closed"],
};
/** Status siklus dwibahasa (pf11). */
const CYCLE_STATUS_LABEL: Record<string, [string, string]> = {
  Draft: ["Draft", "Draft"],
  "Pengaturan Target": ["Pengaturan Target", "Goal Setting"],
  Berjalan: ["Berjalan", "Ongoing"],
  Penilaian: ["Penilaian", "Assessment"],
  Kalibrasi: ["Kalibrasi", "Calibration"],
  Terbit: ["Terbit", "Published"],
  Tertutup: ["Tertutup", "Closed"],
};
/** Status hasil terbit (tone hijau) — Set via split (konvensi audit bilingual). */
const PUBLISHED_ID = new Set("Terbit Tertutup".split(" "));

// ================= pf11 Register Siklus & Fase =================
export function PF11View({ data, meta }: { data: PF11Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf11">
      <DocHeader meta={meta} reportNo="F1.1" title={t("Register Siklus & Fase", "Cycle & Phase Register")} subtitle={t("Peta siklus penilaian per tahun: jendela fase, fase aktif, status, dan partisipasi", "Appraisal cycles per year: phase windows, active phase, status, and participation")} audience={t("HR Admin · Direksi", "HR Admin · Directors")} docNo={mkDocNo("pf11", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Target terkunci = peserta yang sudah melewati gerbang kunci KPI; hasil terbit = peserta yang hasilnya sudah dipublikasikan.", "Locked targets = participants past the KPI lock gate; published results = participants whose results have been published.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Siklus", "Cycles"), value: f.num(data.total.cycles), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Peserta", "Total Participants"), value: f.num(data.total.participants) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tahun", "Year"), value: data.year }]} />
      </div>

      <DocSection no="B" title={t("Daftar Siklus", "Cycle Register")} note={t("Jendela fase: Target → tengah tahun → Penilaian Diri → Atasan → Kalibrasi.", "Phase windows: Goals → mid-year → Self → Manager → Calibration.")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>Kode</TH><TH>Nama Siklus</TH><TH align="center">Tipe</TH><TH>Periode</TH>
        <TH>Jendela Fase</TH><TH align="center">Fase Aktif</TH><TH align="center">Status</TH>
        <TH align="number">Peserta</TH><TH align="number">Target Terkunci</TH><TH align="number">Hasil Terbit</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={r.code} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="font-mono text-[9.5px] font-bold text-slate-800">{r.code}</TD>
            <TD className="font-semibold text-slate-800">{r.name}</TD>
            <TD align="center">{r.cycleType}</TD>
            <TD className="whitespace-nowrap">{r.period}</TD>
            <TD className="max-w-[260px] text-[9px] leading-snug">{r.phases}</TD>
            <TD align="center">{r.activePhase ? <DocBadge tone="violet">{r.activePhase}</DocBadge> : <Dash />}</TD>
            <TD align="center"><DocBadge tone={r.status === "Terbit" ? "green" : r.status === "Tertutup" ? "slate" : "amber"}>{t(...(CYCLE_STATUS_LABEL[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
            <TD align="number" className="font-bold">{f.num(r.participants)}</TD>
            <TD align="number">{f.num(r.goalsLocked)}</TD>
            <TD align="number">{f.num(r.resultsPublished)}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={11} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada siklus pada tahun ini.", "No cycles for this year.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.total.cycles} ${t("siklus", "cycles")}`} cells={[f.num(data.total.participants), "", ""]} spanLabel={8} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Fase aktif ditentukan dari jendela fase siklus terhadap tanggal cetak. Data peserta dihitung dari AppraisalRecord per siklus.", "Active phase is derived from the cycle's phase windows vs the print date. Participant data is computed from AppraisalRecord per cycle.")} />
    </ReportSheet>
  );
}

// ================= pf12 Completion per Fase =================
export function PF12View({ data, meta }: { data: PF12Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf12">
      <DocHeader meta={meta} reportNo="F1.2" title={t("Completion per Fase", "Phase Completion Report")} subtitle={t(`Siklus ${data.cycleCode} — siapa yang belum mengisi target / penilaian diri / penilaian atasan`, `Cycle ${data.cycleCode} — who hasn't filled goals / self / manager assessment`)} audience={t("HR Admin · Atasan Langsung", "HR Admin · Line Managers")} docNo={mkDocNo("pf12", meta)} />

      <DocSection no="A" title={t("Ringkasan Keikutsertaan", "Participation Summary")} note={t("Dasar nudge Command Center §18.8 — peserta dengan kolom \"Belum\" adalah target pengingat.", "The basis of Command Center nudges §18.8 — participants with pending items are reminder targets.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Peserta", "Participants"), value: f.num(data.summary.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Target Terkunci", "Goals Locked"), value: f.num(data.summary.targetDone) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Penilaian Diri", "Self Done"), value: f.num(data.summary.selfDone) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Penilaian Atasan", "Manager Done"), value: f.num(data.summary.managerDone) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Status Siklus", "Cycle Status"), value: data.cycleStatus }]} />
      </div>

      <DocSection no="B" title={t("Matriks per Peserta (urut No. Karyawan)", "Per-Participant Matrix (by Employee No.)")} note={t("\"Belum\" = fase yang belum diselesaikan peserta — sasaran pengingat multi-kanal.", "\"Pending\" = phases the participant hasn't completed — multi-channel reminder targets.")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH>Posisi</TH>
              <TH align="center">Status</TH><TH align="number"># KPI</TH><TH align="number">Σ Bobot</TH>
              <TH align="center">Diri ✓</TH><TH align="center">Atasan ✓</TH><TH align="number">Check-in</TH><TH>Belum</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.missing.length > 0 && "bg-amber-50/40")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.fullName}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD>{r.position ?? <Dash />}</TD>
                <TD align="center"><DocBadge tone={r.missing.length === 0 ? "green" : "amber"}>{t(...(APPR_STATUS_LABEL[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD align="number">{f.num(r.kpiCount)}</TD>
                <TD align="number" className={cn(r.totalWeight != null && Math.abs(r.totalWeight - 100) >= 0.01 && "font-black text-red-600")}>{r.totalWeight == null ? <Dash /> : f.num(r.totalWeight)}</TD>
                <TD align="center"><CheckMark v={r.selfSubmitted} /></TD>
                <TD align="center"><CheckMark v={r.managerDone} /></TD>
                <TD align="number">{f.num(r.checkinCount)}</TD>
                <TD className="text-[9px] font-bold text-amber-700">{r.missing.length ? r.missing.join(" · ") : "—"}</TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada peserta pada siklus ini.", "No participants in this cycle yet.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.summary.total} ${t("peserta", "participants")}`} cells={[
              `${data.summary.selfDone}/${data.summary.total}`, `${data.summary.managerDone}/${data.summary.total}`, "", "",
            ]} spanLabel={8} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Σ Bobot valid bila = 100 (validasi KPI Builder §18.1). Baris ber-latar kuning masih punya fase yang belum selesai.", "Weight sum is valid when = 100 (KPI Builder validation §18.1). Amber-highlighted rows still have pending phases.")} />
    </ReportSheet>
  );
}

// ================= pf13 Register Penetapan KPI =================
export function PF13View({ data, meta }: { data: PF13Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const invalid = data.byEmployee.filter((b) => Math.abs(b.sumWeight - 100) >= 0.01);
  return (
    <ReportSheet docId="pf13" landscape>
      <DocHeader meta={meta} reportNo="F1.3" title={t("Register Penetapan KPI", "KPI Assignment Register")} subtitle={t(`Siklus ${data.cycleCode} — seluruh KPI yang dinilai beserta bobot, target & sumber data`, `Cycle ${data.cycleCode} — all assessed KPIs with weights, targets, and data sources`)} audience={t("HR Admin · Atasan · Karyawan", "HR Admin · Managers · Employees")} docNo={mkDocNo("pf13", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Sumber AUTO = nilai ditarik otomatis dari modul sumber (dengan bukti §18.6); Manual = diisi penilai.", "AUTO source = value pulled automatically from the source module (with evidence §18.6); Manual = filled by the appraiser.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Baris KPI", "KPI Rows"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan", "Employees"), value: f.num(data.byEmployee.length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tarikan AUTO", "AUTO-pulled"), value: f.num(data.rows.filter((r) => r.source.startsWith("AUTO")).length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Bobot ≠ 100", "Weight ≠ 100"), value: f.num(invalid.length), accent: invalid.length > 0 }]} />
      </div>

      <DocSection no="B" title={t("Daftar Penetapan KPI", "KPI Assignment Register")} note={t("Ambang (F) = batas gagal; Target (T) = capaian normal; Stretch = capaian maksimal (skor bisa >100).", "Threshold (F) = fail limit; Target (T) = normal attainment; Stretch = maximum (score may exceed 100).")} />
      <div className="doc-scroll max-h-[460px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Judul KPI</TH><TH>Kategori BSC</TH>
              <TH align="center">Polaritas</TH><TH align="number">Bobot (%)</TH><TH align="number">Ambang (F)</TH>
              <TH align="number">Target (T)</TH><TH align="number">Stretch</TH><TH align="center">Satuan</TH>
              <TH align="center">Asal</TH><TH>Sumber Data</TH><TH align="center">Kritis</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.employeeNo}-${i}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.fullName}</TD>
                <TD className="max-w-[220px]">{r.title}</TD>
                <TD className="text-[9.5px]">{r.category}</TD>
                <TD align="center" className="text-[9.5px]">{r.polarity}</TD>
                <TD align="number" className="font-bold">{f.num(r.weight)}</TD>
                <TD align="number">{r.thresholdMin == null ? <Dash /> : f.num(r.thresholdMin)}</TD>
                <TD align="number">{f.num(r.target)}</TD>
                <TD align="number">{r.stretchValue == null ? <Dash /> : f.num(r.stretchValue)}</TD>
                <TD align="center" className="text-[9.5px]">{r.measure}</TD>
                <TD align="center" className="text-[9.5px]">{r.origin}</TD>
                <TD align="center">{r.source.startsWith("AUTO") ? <DocBadge tone="sky">{r.source}</DocBadge> : <span className="text-[9.5px] text-slate-500">{r.source}</span>}</TD>
                <TD align="center">{r.isCritical ? <span className="font-black text-red-600">✓</span> : <span className="text-slate-300">–</span>}</TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={14} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada penetapan KPI pada siklus ini.", "No KPI assignments in this cycle yet.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.total} ${t("baris", "rows")}`} cells={[]} spanLabel={14} />
          </tbody>
        </table>
      </div>

      <DocSection no="C" title={t("Validasi Bobot per Karyawan", "Weight Validation per Employee")} note={t("Σ bobot per karyawan harus = 100 (gerbang lock KPI §35-4).", "Each employee's weight sum must = 100 (KPI lock gate §35-4).")} />
      <DocTable head={<>
        <TH>No. Karyawan</TH><TH>Nama</TH><TH align="number">Jumlah KPI</TH><TH align="number">Σ Bobot</TH><TH align="center">Valid (100)</TH>
      </>}>
        {data.byEmployee.map((b) => (
          <tr key={b.employeeNo} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{b.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{b.name}</TD>
            <TD align="number">{f.num(b.kpiCount)}</TD>
            <TD align="number" className={cn("font-bold", Math.abs(b.sumWeight - 100) >= 0.01 && "text-red-600")}>{f.num(b.sumWeight)}</TD>
            <TD align="center">{Math.abs(b.sumWeight - 100) < 0.01 ? <CheckMark v /> : <span className="font-black text-red-600">✗</span>}</TD>
          </tr>
        ))}
        <TotalRow label={`TOTAL — ${data.byEmployee.length} ${t("karyawan", "employees")}`} cells={[]} spanLabel={5} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Kategori BSC: Financial · Customer · InternalProcess · LearningGrowth (§3.4). Polaritas Higher = naik lebih baik, Lower = turun lebih baik.", "BSC categories: Financial · Customer · InternalProcess · LearningGrowth (§3.4). Polarity: Higher is better up, Lower is better down.")} />
    </ReportSheet>
  );
}

// ================= pf21 Register Hasil per Periode =================
export function PF21View({ data, meta }: { data: PF21Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const dist = data.summary.ratings;
  const distStr = `1:${dist.r1} · 2:${dist.r2} · 3:${dist.r3} · 4:${dist.r4} · 5:${dist.r5}`;
  return (
    <ReportSheet docId="pf21" landscape>
      <DocHeader meta={meta} reportNo="F2.1" title={t("Register Hasil per Periode", "Period Results Register")} subtitle={t(`Siklus ${data.cycleCode} — skor self/atasan/final, rating, jejak kalibrasi & banding`, `Cycle ${data.cycleCode} — self/manager/final scores, rating, calibration & appeal trail`)} audience={t("HR Admin · Direksi", "HR Admin · Directors")} docNo={mkDocNo("pf21", meta)} />

      <DocSection no="A" title={t("Ringkasan Hasil", "Results Summary")} note={t("Skor final resmi pasca-kalibrasi; kalibrasi ✓ = pernah ada keputusan CalibrationDecision.", "Official final score post-calibration; calibration ✓ = a CalibrationDecision exists.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Peserta", "Participants"), value: f.num(data.summary.n), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata Skor Final", "Avg Final Score"), value: data.summary.avgFinal == null ? "—" : f.num(data.summary.avgFinal) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dikalibrasi", "Calibrated"), value: f.num(data.rows.filter((r) => r.calibrated).length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Banding", "Appeals"), value: f.num(data.rows.filter((r) => r.appealStatus).length) }]} />
      </div>

      <DocSection no="B" title={t("Daftar Hasil (urut No. Karyawan)", "Results Register (by Employee No.)")} />
      <div className="doc-scroll max-h-[480px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH>Posisi</TH><TH>Atasan Penilai</TH><TH align="number">Diri</TH><TH align="number">Atasan</TH>
              <TH align="number">Final</TH><TH align="center">Rating</TH><TH align="center">Status</TH>
              <TH align="center">Kalibrasi</TH><TH align="center">Banding</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.docNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-mono text-[9.5px] font-bold text-slate-800">{r.docNo}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.fullName}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD className="text-[9.5px]">{r.position ?? <Dash />}</TD>
                <TD>{r.managerName ?? <Dash />}</TD>
                <TD align="number">{r.selfScore == null ? <Dash /> : f.num(r.selfScore)}</TD>
                <TD align="number">{r.managerScore == null ? <Dash /> : f.num(r.managerScore)}</TD>
                <TD align="number" className="font-black">{r.finalScore == null ? <Dash /> : f.num(r.finalScore)}</TD>
                <TD align="center"><RatingChip rating={r.finalRating} label={r.ratingLabel} /></TD>
                <TD align="center"><DocBadge tone={PUBLISHED_ID.has(r.status) ? "green" : "slate"}>{t(...(APPR_STATUS_LABEL[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
                <TD align="center"><CheckMark v={r.calibrated} /></TD>
                <TD align="center">{r.appealStatus ? <DocBadge tone={r.appealStatus === "Adjusted" ? "green" : r.appealStatus === "Rejected" ? "red" : "amber"}>{r.appealStatus}</DocBadge> : <span className="text-slate-300">–</span>}</TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={14} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada hasil pada siklus ini.", "No results in this cycle yet.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.summary.n} ${t("peserta", "participants")} · ${t("rata-rata final", "avg final")} ${data.summary.avgFinal == null ? "—" : f.num(data.summary.avgFinal)}`} cells={[
              distStr, "", "",
            ]} spanLabel={10} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Distribusi rating pada baris TOTAL ditampilkan ringkas (jumlah per rating 1–5).", "The rating distribution in the TOTAL row is shown compactly (counts per rating 1–5).")} />
    </ReportSheet>
  );
}

// ================= pf22 Distribusi Rating per Unit/Atasan =================
export function PF22View({ data, meta }: { data: PF22Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const max = Math.max(1, ...data.rows.map((r) => r.n));
  return (
    <ReportSheet docId="pf22">
      <DocHeader meta={meta} reportNo="F2.2" title={t("Distribusi Rating per Unit/Atasan", "Rating Distribution by Unit/Manager")} subtitle={t(`Siklus ${data.cycleCode} — sebaran rating 1–5 per ${data.groupBy === "atasan" ? "atasan penilai" : "unit kerja"} (lensa kewajaran, bukan kuota)`, `Cycle ${data.cycleCode} — rating 1–5 distribution per ${data.groupBy === "atasan" ? "appraising manager" : "work unit"} (a fairness lens, not a quota)`)} audience={t("HR Admin · Direksi", "HR Admin · Directors")} docNo={mkDocNo("pf22", meta)} />

      <DocSection no="A" title={t("Ringkasan Perusahaan", "Company Summary")} note={t("Kurva adalah lensa kewajaran antar kelompok — BUKAN kuota (D2 forced-distribution OFF).", "The curve is a fairness lens across groups — NOT a quota (D2 forced distribution OFF).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dinilai", "Appraised"), value: f.num(data.total.n), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata Skor", "Average Score"), value: data.total.avg == null ? "—" : f.num(data.total.avg) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kelompok", "Groups"), value: f.num(data.rows.length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rating Terbanyak", "Most Common Rating"), value: (() => {
          const e = Object.entries(data.total).filter(([k]) => /^r[1-5]$/.test(k)) as [string, number][];
          const top = e.sort((a, b) => b[1] - a[1])[0];
          return top ? `${top[0].slice(1)} (${top[1]})` : "—";
        })() }]} />
      </div>

      {/* bar viz ringkas */}
      <DocSection no="B" title={t("Sebaran Kelompok", "Group Spread")} />
      <div className="space-y-1.5">
        {data.rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-[10px] font-bold text-slate-700">{r.label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
              <div className={cn("h-full rounded", r.avg != null && r.avg >= 80 ? "bg-emerald-500" : r.avg != null && r.avg >= 60 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.max(4, (r.n / max) * 100)}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right text-[9.5px] font-bold tabular-nums text-slate-600">{r.n} {t("org", "ppl")}</span>
          </div>
        ))}
        {data.rows.length === 0 && <p className="py-4 text-center text-[11px] font-bold text-slate-400">{t("Belum ada peserta ber-rating pada siklus ini.", "No rated participants in this cycle yet.")}</p>}
      </div>

      <DocSection no="C" title={t("Tabel Distribusi", "Distribution Table")} />
      <DocTable head={<>
        <TH>{data.groupBy === "atasan" ? t("Atasan Penilai", "Appraising Manager") : t("Unit Kerja", "Work Unit")}</TH><TH align="number">N</TH>
        <TH align="number">Rating 1</TH><TH align="number">Rating 2</TH><TH align="number">Rating 3</TH>
        <TH align="number">Rating 4</TH><TH align="number">Rating 5</TH><TH align="number">Rata-rata</TH>
      </>}>
        {data.rows.map((r) => (
          <tr key={r.label} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{r.label}</TD>
            <TD align="number">{f.num(r.n)}</TD>
            <TD align="number" className="text-rose-600">{r.r1 ? f.num(r.r1) : "—"}</TD>
            <TD align="number" className="text-amber-600">{r.r2 ? f.num(r.r2) : "—"}</TD>
            <TD align="number">{r.r3 ? f.num(r.r3) : "—"}</TD>
            <TD align="number" className="text-emerald-600">{r.r4 ? f.num(r.r4) : "—"}</TD>
            <TD align="number" className="text-emerald-700">{r.r5 ? f.num(r.r5) : "—"}</TD>
            <TD align="number" className="font-bold">{r.avg == null ? <Dash /> : f.num(r.avg)}</TD>
          </tr>
        ))}
        <TotalRow label={t("TOTAL PERUSAHAAN", "COMPANY TOTAL")} cells={[
          data.total.n, data.total.r1, data.total.r2, data.total.r3, data.total.r4, data.total.r5,
          data.total.avg == null ? "—" : f.num(data.total.avg),
        ]} spanLabel={1} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("N = jumlah peserta ber-rating final. Rata-rata memakai skor final pasca-kalibrasi.", "N = participants with a final rating. Averages use post-calibration final scores.")} />
    </ReportSheet>
  );
}

// ================= pf23 Detail Skor per Karyawan (PP 35/2021 §7.2) =================
export function PF23View({ data, meta }: { data: PF23Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const landscape = data.mode === "cycle";
  return (
    <ReportSheet docId="pf23" landscape={landscape}>
      <DocHeader
        meta={meta}
        reportNo="F2.3"
        title={t("Detail Skor KPI & Kompetensi per Karyawan", "Employee KPI & Competency Detail")}
        subtitle={t(
          `${data.employeeNo} — ${data.fullName} · ${data.mode === "history" ? "REGISTER RIWAYAT (PP 35/2021 §7.2)" : `Siklus ${data.detail?.cycleCode ?? ""}`}`,
          `${data.employeeNo} — ${data.fullName} · ${data.mode === "history" ? "HISTORY REGISTER (PP 35/2021 §7.2)" : `Cycle ${data.detail?.cycleCode ?? ""}`}`,
        )}
        audience={t("HR Admin · Atasan · Karyawan (dirinya)", "HR Admin · Managers · Employee (self)")}
        docNo={mkDocNo("pf23", meta)}
      />

      {/* A — register riwayat (selalu) */}
      <DocSection no="A" title={t("Register Riwayat Penilaian", "Appraisal History Register")} note={data.note} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>No. Dokumen</TH><TH>Siklus</TH><TH>Periode</TH><TH align="center">Status</TH>
        <TH align="number">Skor Final</TH><TH align="center">Rating</TH><TH align="center">Kalibrasi</TH>
        <TH align="center">Banding</TH><TH align="center">Acknowledge</TH>
      </>}>
        {data.history.map((r, i) => (
          <tr key={r.docNo} className="hover:bg-slate-50">
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="font-mono text-[9.5px] font-bold text-slate-800">{r.docNo}</TD>
            <TD className="font-bold text-slate-800">{r.cycleCode}</TD>
            <TD className="whitespace-nowrap">{r.period}</TD>
            <TD align="center"><DocBadge tone={PUBLISHED_ID.has(r.status) ? "green" : "slate"}>{t(...(APPR_STATUS_LABEL[r.status] ?? [r.status, r.status]))}</DocBadge></TD>
            <TD align="number" className="font-black">{r.finalScore == null ? <Dash /> : f.num(r.finalScore)}</TD>
            <TD align="center"><RatingChip rating={r.finalRating} label={r.ratingLabel} /></TD>
            <TD align="center" className="whitespace-nowrap text-[9.5px]">{r.calibratedFrom == null ? "–" : `${f.num(r.calibratedFrom)} → ${r.calibratedTo == null ? "—" : f.num(r.calibratedTo)}`}</TD>
            <TD align="center" className="text-[9.5px]">{r.appealDecision ?? "–"}</TD>
            <TD align="center">{r.acknowledgedAt ? <CheckMark v /> : <span className="text-slate-300">–</span>}</TD>
          </tr>
        ))}
        {data.history.length === 0 && (
          <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Karyawan belum pernah mengikuti siklus penilaian.", "This employee has never participated in an appraisal cycle.")}</TD></tr>
        )}
      </DocTable>

      {/* B-D — detail satu siklus */}
      {data.detail && (
        <>
          <DocSection no="B" title={t(`Detail KPI — ${data.detail.docNo} (${data.detail.status})`, `KPI Detail — ${data.detail.docNo} (${data.detail.status})`)} note={t("Realisasi Mid = checkpoint tengah tahun; Bukti = lampiran/catatan per KPI.", "Mid actual = mid-year checkpoint; Evidence = attachments/notes per KPI.")} />
          <DocTable head={<>
            <TH align="center">#</TH><TH>Judul KPI</TH><TH align="number">Bobot (%)</TH><TH align="number">Ambang (F)</TH>
            <TH align="number">Target (T)</TH><TH align="number">Stretch</TH><TH align="number">Realisasi</TH>
            <TH align="number">Realisasi Mid</TH><TH align="center">Sumber</TH><TH align="center">Bukti</TH>
          </>}>
            {data.detail.kpis.map((k, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="max-w-[240px] font-semibold text-slate-800">{k.title}</TD>
                <TD align="number" className="font-bold">{f.num(k.weight)}</TD>
                <TD align="number">{k.thresholdMin == null ? <Dash /> : f.num(k.thresholdMin)}</TD>
                <TD align="number">{f.num(k.target)}</TD>
                <TD align="number">{k.stretchValue == null ? <Dash /> : f.num(k.stretchValue)}</TD>
                <TD align="number" className="font-black">{k.actual == null ? <Dash /> : f.num(k.actual)}</TD>
                <TD align="number">{k.midActual == null ? <Dash /> : f.num(k.midActual)}</TD>
                <TD align="center">{k.source === "AUTO" ? <DocBadge tone="sky">AUTO</DocBadge> : <span className="text-[9.5px] text-slate-500">Manual</span>}</TD>
                <TD align="center"><CheckMark v={k.evidence} /></TD>
              </tr>
            ))}
            {data.detail.kpis.length === 0 && (
              <tr><TD colSpan={10} className="py-4 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada KPI pada penilaian ini.", "No KPIs in this appraisal.")}</TD></tr>
            )}
          </DocTable>

          <DocSection no="C" title={t("Detail Kompetensi", "Competency Detail")} />
          <DocTable head={<>
            <TH align="center">#</TH><TH>Kompetensi</TH><TH align="number">Skor Penilai (1–5)</TH><TH align="number">Skor Diri (1–5)</TH>
          </>}>
            {data.detail.comps.map((c, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-semibold text-slate-800">{c.name}</TD>
                <TD align="number" className="font-bold">{c.score == null ? <Dash /> : c.score}</TD>
                <TD align="number">{c.selfScore == null ? <Dash /> : c.selfScore}</TD>
              </tr>
            ))}
            {data.detail.comps.length === 0 && (
              <tr><TD colSpan={4} className="py-4 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada penilaian kompetensi.", "No competency scores.")}</TD></tr>
            )}
          </DocTable>

          <DocSection no="D" title={t("Jejak Kalibrasi & Banding", "Calibration & Appeal Trail")} note={t("Setiap perubahan nilai ter-audit: skor/rating dari → ke + alasan wajib (§35-9).", "Every score change is audited: score/rating from → to + mandatory reason (§35-9).")} />
          <DocTable head={<>
            <TH>Waktu</TH><TH align="number">Skor dari</TH><TH align="number">Skor ke</TH>
            <TH align="number">Rating dari</TH><TH align="number">Rating ke</TH><TH>Alasan</TH><TH>Diputus oleh</TH>
          </>}>
            {data.detail.calibration.map((c, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <TD className="whitespace-nowrap">{f.dt(c.decidedAt)}</TD>
                <TD align="number">{c.oldScore == null ? <Dash /> : f.num(c.oldScore)}</TD>
                <TD align="number" className="font-black">{c.newScore == null ? <Dash /> : f.num(c.newScore)}</TD>
                <TD align="number">{c.oldRating ?? "—"}</TD>
                <TD align="number" className="font-bold">{c.newRating ?? "—"}</TD>
                <TD className="max-w-[300px] text-[9px] leading-snug">{c.reason}</TD>
                <TD>{c.decidedBy}</TD>
              </tr>
            ))}
            {data.detail.calibration.length === 0 && (
              <tr><TD colSpan={7} className="py-4 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada keputusan kalibrasi pada penilaian ini.", "No calibration decisions for this appraisal.")}</TD></tr>
            )}
          </DocTable>

          {data.detail.f360 && (
            <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-600">
              {t("Ringkasan 360", "360 Summary")}: {data.detail.f360.submitted}/{data.detail.f360.invited} {t("submitted", "submitted")}
              {data.detail.f360.avg != null ? ` · ${t("rata-rata", "average")} ${f.num(data.detail.f360.avg)}` : ""}
            </p>
          )}
          {data.detail.appeal && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-snug text-amber-800">
              <span className="font-black">{t("BANDING", "APPEAL")} — {data.detail.appeal.status ?? "—"}</span>
              {data.detail.appeal.note ? `: “${data.detail.appeal.note}”` : ""}
              {data.detail.appeal.decidedBy ? ` · ${t("diputus", "decided by")} ${data.detail.appeal.decidedBy}${data.detail.appeal.decidedAt ? ` (${f.dt(data.detail.appeal.decidedAt)})` : ""}` : ""}
            </p>
          )}
        </>
      )}

      <DocFooter meta={meta} signNote={t("PP 35/2021 §7.2 — riwayat penilaian adalah dasar perusahaan untuk keputusan konversi/perpanjangan PKWT → wajib eksporabel & ter-audit.", "PP 35/2021 §7.2 — appraisal history is the company's basis for fixed-term contract conversion/extension decisions → must be exportable & auditable.")} />
    </ReportSheet>
  );
}

// ================= pf24 Ringkasan 360 Ter-agregasi =================
export function PF24View({ data, meta }: { data: PF24Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf24">
      <DocHeader meta={meta} reportNo="F2.4" title={t("Ringkasan 360 Ter-agregasi", "Aggregated 360° Summary")} subtitle={t(`Siklus ${data.cycleCode} — angka hanya tampil saat ≥${data.threshold} reviewer submit (anonimitas)`, `Cycle ${data.cycleCode} — numbers shown only when ≥${data.threshold} reviewers submit (anonymity)`)} audience={t("HR Admin · Atasan Langsung", "HR Admin · Line Managers")} docNo={mkDocNo("pf24", meta)} />

      <DocSection no="A" title={t("Ringkasan Partisipasi", "Participation Summary")} note={t(`Ambang anonimitas: ≥${data.threshold} submit per karyawan. Di bawah itu nilai disembunyikan demi menjaga kerahasiaan reviewer.`, `Anonymity threshold: ≥${data.threshold} submissions per employee. Below that, scores are hidden to protect reviewer confidentiality.`)} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Diundang", "Invited"), value: f.num(data.summary.invited), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Submit", "Submitted"), value: f.num(data.summary.submitted) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Partisipasi", "Participation"), value: data.summary.participationPct == null ? "—" : `${data.summary.participationPct}%` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Dirahasiakan (<3)", "Hidden (<3)"), value: f.num(data.summary.hidden) }]} />
      </div>

      <DocSection no="B" title={t("Agregat per Karyawan", "Per-Employee Aggregate")} note={t("Kategori reviewer: Rekan · Bawahan · Lintas Tim · Upward (atasan dinilai karyawan).", "Reviewer categories: Peer · Subordinate · Cross-Team · Upward (manager rated by report).")} />
      <div className="doc-scroll max-h-[480px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="number">Diundang</TH><TH align="number">Submit</TH><TH align="number">Partisipasi</TH>
              <TH align="number">Rekan</TH><TH align="number">Bawahan</TH><TH align="number">Lintas Tim</TH>
              <TH align="number">Upward</TH><TH align="number">Keseluruhan</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.employeeNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.fullName}</TD>
                <TD>{r.unit ?? <Dash />}</TD>
                <TD align="number">{f.num(r.invited)}</TD>
                <TD align="number" className="font-bold">{f.num(r.submitted)}</TD>
                <TD align="number">{r.participationPct == null ? <Dash /> : `${r.participationPct}%`}</TD>
                {r.hidden ? (
                  <TD colSpan={5} className="bg-slate-50/80 text-center text-[9.5px] font-bold italic text-slate-400">
                    {t(`Diserahkan ${r.submitted} (<${data.threshold}) — dirahasiakan`, `${r.submitted} submitted (<${data.threshold}) — hidden`)}
                  </TD>
                ) : (
                  <>
                    <TD align="number">{r.peer == null ? <Dash /> : f.num(r.peer)}</TD>
                    <TD align="number">{r.subordinate == null ? <Dash /> : f.num(r.subordinate)}</TD>
                    <TD align="number">{r.crossTeam == null ? <Dash /> : f.num(r.crossTeam)}</TD>
                    <TD align="number">{r.upward == null ? <Dash /> : f.num(r.upward)}</TD>
                    <TD align="number" className="font-black">{r.overall == null ? <Dash /> : f.num(r.overall)}</TD>
                  </>
                )}
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada undangan 360 pada siklus ini.", "No 360 invitations in this cycle yet.")}</TD></tr>
            )}
            <TotalRow label={t("TOTAL SIKLUS", "CYCLE TOTAL")} cells={[
              data.summary.participationPct == null ? "—" : `${data.summary.participationPct}%`, "", "", "", "", "",
            ]} spanLabel={6} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Komentar teks reviewer tidak pernah ditampilkan individual — hanya agregat kompetensi (UU PDP 27/2022 §37).", "Reviewer text comments are never shown individually — only competency aggregates (UU PDP 27/2022 §37).")} />
    </ReportSheet>
  );
}
