"use client";
// P8-PERF — views dokumen Performance Grup 1 (Siklus & Partisipasi) + Grup 2 ====
// (Penilaian & Hasil). Mirror pola medical/report-documents/report-views-g12.tsx
// (MED-1-b). Komponen dasar (ReportSheet/DocHeader/…) dipakai bersama dari
// doc-kit modul HR — murni presentasional, tipe DocMeta identik struktural.
//
// AUDIT KOLOM: jumlah kolom thead = jumlah sel efektif tiap baris tbody;
// TotalRow spanLabel + cells.length = jumlah kolom.
//   PF11 B 12 kolom (span 10 + 2) · PF12 B 10 (9 + 1) · PF13 B 14 (9 + 5)
//   PF21 B 12 (11 + 1) · PF22 B 9 (3 + 6) · PF23 B 10 (4 + 6) · PF24 B 6 (3 + 3).
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

/** Centang / silang dua-bahasa ringkas. */
export const Yes = () => <span className="font-black text-emerald-600">✓</span>;
const No = () => <span className="font-black text-rose-500">✗</span>;

/** Label status siklus (PerformanceCycle.status). */
export const CYCLE_STATUS: Record<string, [string, string]> = {
  Draft: ["Draf", "Draft"], GoalSetting: ["Penetapan Target", "Goal Setting"],
  Ongoing: ["Berjalan", "Ongoing"], Assessment: ["Fase Penilaian", "Assessment"],
  Calibration: ["Kalibrasi", "Calibration"], Published: ["Terpublikasi", "Published"],
  Closed: ["Ditutup", "Closed"],
};
/** Label status appraisal (AppraisalRecord.status). */
export const APPR_STATUS: Record<string, [string, string]> = {
  Enrolled: ["Terdaftar", "Enrolled"], GoalProposed: ["Usulan Target", "Goal Proposed"],
  GoalApproved: ["Target Disetujui", "Goals Approved"], Ongoing: ["Berjalan", "Ongoing"],
  SelfDone: ["Self Selesai", "Self Done"], ManagerDone: ["Atasan Selesai", "Manager Done"],
  Calibrating: ["Kalibrasi", "Calibrating"], Finalized: ["Difinalisasi", "Finalized"],
  Published: ["Terpublikasi", "Published"], Appealed: ["Banding", "Appealed"],
  Closed: ["Ditutup", "Closed"],
};
/** Tone badge status appraisal. */
const APPR_TONE: Record<string, "slate" | "amber" | "sky" | "green" | "red" | "violet"> = {
  Draft: "slate", Enrolled: "slate", GoalProposed: "amber", GoalApproved: "sky", Ongoing: "sky",
  SelfDone: "sky", ManagerDone: "sky", Calibrating: "violet", Finalized: "violet",
  Published: "green", Appealed: "red", Closed: "slate",
};
/** Asal baris KPI (AppraisalKpi.origin). */
export const ORIGIN_LABEL: Record<string, [string, string]> = {
  Fresh: ["Manual (baru)", "Manual (fresh)"],
  Template: ["Pustaka / Template", "Library / Template"],
  CopiedFromCycle: ["Salin dari siklus lalu", "Copied from cycle"],
  EmployeeProposal: ["Usulan karyawan (MBO)", "Employee proposal (MBO)"],
  Library: ["Pustaka KPI", "KPI Library"],
  Manual: ["Manual", "Manual"],
  Imported: ["Impor Excel", "Excel import"],
};
/** Kelompok reviewer 360 (Feedback360.reviewerType). */
export const F360_GROUP: Record<string, [string, string]> = {
  Manager: ["Atasan", "Manager"],
  Peer: ["Rekan Kerja", "Peers"],
  Subordinate: ["Bawahan", "Subordinates"],
  CrossTeam: ["Lintas Tim", "Cross-team"],
  Upward: ["Upward (bawahan→atasan)", "Upward"],
};

const lbl = (map: Record<string, [string, string]>, k: string | null | undefined): [string, string] =>
  (k && map[k]) || [k ?? "—", k ?? "—"];

// ================= PF1.1 Register Siklus & Fase Penilaian =================
export function PF11View({ data, meta }: { data: PF11Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf11" landscape>
      <DocHeader meta={meta} reportNo="P1.1" title="Appraisal Cycle & Phase Register" subtitle={t("Register seluruh siklus penilaian: periode, status, jendela fase, jumlah peserta, dan tingkat penyelesaian", "Register of all appraisal cycles: period, status, phase windows, participant count, and completion level")} audience={t("HR Admin · Direksi", "HR Admin · Directorate")} docNo={mkDocNo("pf11", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Penyelesaian = peserta berstatus Finalized/Published/Appealed/Closed dari seluruh peserta siklus.", "Completion = participants in Finalized/Published/Appealed/Closed over all cycle participants.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Siklus", "Total Cycles"), value: f.num(data.totalCycles), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Siklus Aktif (belum Closed)", "Active Cycles (not Closed)"), value: f.num(data.activeCycles) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Peserta (semua siklus)", "Total Participants (all cycles)"), value: f.num(data.totalParticipants) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Data per", "Data as of"), value: f.dt(meta.generatedAt) }]} />
      </div>

      <DocSection no="B" title={t("Daftar Siklus (urut periode akhir)", "Cycle Register (by period end)")} note={t("Jendela fase kosong (—) = fase dilewati untuk siklus tersebut.", "Empty phase window (—) = the phase is skipped for that cycle.")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>Kode</TH><TH>Nama Siklus</TH><TH>Jenis</TH>
        <TH align="center">Periode</TH><TH align="center">Status</TH>
        <TH align="center">Fase Target</TH><TH align="center">Mid-Year</TH><TH align="center">Fase Self</TH><TH align="center">Fase Atasan</TH><TH align="center">Kalibrasi</TH><TH align="number">Peserta · Selesai</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={r.code} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="font-bold text-slate-800">{r.code}</TD>
            <TD className="font-semibold text-slate-800">{r.name}{r.feedback360 && <span className="ml-1 rounded bg-teal-100 px-1 py-px text-[8px] font-bold text-teal-700">360</span>}</TD>
            <TD className="text-[9.5px]">{r.cycleType}</TD>
            <TD align="center" className="whitespace-nowrap text-[9.5px]">{f.dt(r.periodStart)} – {f.dt(r.periodEnd)}</TD>
            <TD align="center"><DocBadge tone={r.status === "Closed" ? "slate" : r.status === "Published" ? "green" : "amber"}>{t(...lbl(CYCLE_STATUS, r.status))}</DocBadge></TD>
            <TD align="center" className="whitespace-nowrap text-[9px]">{r.gates.goal ?? <Dash />}</TD>
            <TD align="center" className="whitespace-nowrap text-[9px]">{r.gates.mid ?? <Dash />}</TD>
            <TD align="center" className="whitespace-nowrap text-[9px]">{r.gates.self ?? <Dash />}</TD>
            <TD align="center" className="whitespace-nowrap text-[9px]">{r.gates.mgr ?? <Dash />}</TD>
            <TD align="center" className="whitespace-nowrap text-[9px]">{r.gates.calib ?? <Dash />}</TD>
            <TD align="number" className="font-bold">{f.num(r.participants)} · {f.num(r.completed)} ({f.pct(r.completionPct)})</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada siklus penilaian.", "No appraisal cycles yet.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.totalCycles} ${t("siklus", "cycles")}`} cells={[f.num(data.totalParticipants), ""]} spanLabel={10} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Sumber: PerformanceCycle + hitungan AppraisalRecord per siklus.", "Source: PerformanceCycle + AppraisalRecord counts per cycle.")} />
    </ReportSheet>
  );
}

// ================= PF1.2 Completion per Fase =================
export function PF12View({ data, meta }: { data: PF12Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf12" landscape>
      <DocHeader meta={meta} reportNo="P1.2" title="Phase-by-Phase Completion" subtitle={t("Tingkat penyelesaian formulir per peserta — target dikunci, self-assessment, penilaian atasan, acknowledgement hasil", "Form completion per participant — targets locked, self-assessment, manager appraisal, result acknowledgement")} audience={t("HR Admin · Atasan Langsung", "HR Admin · Line Managers")} docNo={mkDocNo("pf12", meta)} />

      <DocSection no="A" title={t("Ringkasan Fase", "Phase Summary")} note={t("Target = bobot KPI terkunci (Σ100); Self = status melewati SelfDone; Atasan = melewati ManagerDone; Ack = hasil sudah di-acknowledge karyawan.", "Targets = KPI weights locked (Σ100); Self = status past SelfDone; Manager = past ManagerDone; Ack = result acknowledged by employee.")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Peserta", "Participants"), value: f.num(data.summary.participants), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Target Terkunci", "Targets Locked"), value: f.num(data.summary.target) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Self Selesai", "Self Done"), value: f.num(data.summary.self) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Penilaian Atasan Selesai", "Manager Done"), value: f.num(data.summary.manager) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Hasil Di-acknowledge", "Acknowledged"), value: f.num(data.summary.acknowledged) }]} />
      </div>
      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">
        {t(
          "Belum mengisi → target {a} · self {b} · penilaian atasan {c} · acknowledge {d}. Gunakan Command Center utk nudge.",
          "Not yet filled → targets {a} · self {b} · manager appraisal {c} · acknowledge {d}. Use the Command Center to nudge.",
          { a: String(data.pending.target), b: String(data.pending.self), c: String(data.pending.manager), d: String(data.pending.ack) },
        )}
      </div>

      <DocSection no="B" title={t("Daftar per Peserta (urut No. Karyawan)", "Per-Participant Register (by employee no.)")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
        <TH align="center">Status</TH><TH align="center">Target</TH><TH align="center">Self</TH>
        <TH align="center">Atasan</TH><TH align="center">Ack</TH><TH align="number">Skor Final</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={r.docNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", !r.managerDone && "bg-amber-50/40")}>
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{r.name}</TD>
            <TD>{r.unit ?? <Dash />}</TD>
            <TD align="center"><DocBadge tone={APPR_TONE[r.status] ?? "slate"}>{t(...lbl(APPR_STATUS, r.status))}</DocBadge></TD>
            <TD align="center">{r.targetDone ? <Yes /> : <No />}</TD>
            <TD align="center">{r.selfDone ? <Yes /> : <No />}</TD>
            <TD align="center">{r.managerDone ? <Yes /> : <No />}</TD>
            <TD align="center">{r.acknowledged ? <Yes /> : <No />}</TD>
            <TD align="number">{r.finalScore == null ? <Dash /> : r.finalScore}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Siklus belum memiliki peserta.", "The cycle has no participants yet.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.summary.participants} ${t("peserta", "participants")}`} cells={[""]} spanLabel={9} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Sumber: AppraisalRecord siklus terpilih (kpiTotalWeight, status, acknowledgedAt).", "Source: AppraisalRecord of the selected cycle (kpiTotalWeight, status, acknowledgedAt).")} />
    </ReportSheet>
  );
}

// ================= PF1.3 Register Penetapan KPI =================
export function PF13View({ data, meta }: { data: PF13Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf13" landscape>
      <DocHeader meta={meta} reportNo="P1.3" title="KPI Assignment Register" subtitle={t("Seluruh baris KPI siklus terpilih: bobot, ambang gagal, target, stretch, flag kritis, dan asal baris", "All KPI rows of the selected cycle: weight, fail threshold, target, stretch, critical flag, and row origin")} audience={t("HR Admin · Atasan · Karyawan (terkait)", "HR Admin · Managers · Employee (concerned)")} docNo={mkDocNo("pf13", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Siklus", "Cycle"), value: data.cycle.code, accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Peserta dengan KPI", "Participants w/ KPIs"), value: f.num(data.employees) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Baris KPI", "KPI Rows"), value: f.num(data.kpiRows) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kolom Kritis (F)", "Critical (F) Rows"), value: f.num(data.rows.filter((r) => r.isCritical).length) }]} />
      </div>

      <DocSection no="B" title={t("Daftar KPI per Peserta (urut No. Karyawan)", "KPI Register per Participant (by employee no.)")} note={t("Σbobot per peserta = 100 (divalidasi saat submit target). Asal baris menjelaskan provenance penetapan (§18.2).", "Per-participant Σweight = 100 (validated at target submit). Row origin explains assignment provenance (§18.2).")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH>Kode KPI</TH><TH>Judul KPI</TH><TH align="center">Satuan</TH><TH align="center">Polaritas</TH>
              <TH align="number">Bobot</TH><TH align="number">Ambang (F)</TH><TH align="number">Target (T)</TH><TH align="number">Stretch</TH>
              <TH align="center">Kritis</TH><TH>Asal Baris</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={`${r.docNo}-${i}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD align="center" className="text-slate-400">{i + 1}</TD>
                <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD className="text-[9.5px]">{r.unit ?? <Dash />}</TD>
                <TD className="font-mono text-[9px]">{r.kpiCode ?? "—"}</TD>
                <TD className="max-w-[220px] text-[9.5px]">{r.title}</TD>
                <TD align="center" className="text-[9px]">{r.unitOf}</TD>
                <TD align="center" className="text-[9px]">{r.polarity === "Lower" ? t("Semakin kecil", "Lower is better") : r.polarity === "Boolean" ? t("Boolean", "Boolean") : t("Semakin besar", "Higher is better")}</TD>
                <TD align="number" className="font-bold">{r.weight}%</TD>
                <TD align="number">{r.thresholdMin ?? <Dash />}</TD>
                <TD align="number" className="font-semibold">{r.target}</TD>
                <TD align="number">{r.stretch ?? <Dash />}</TD>
                <TD align="center">{r.isCritical ? <span className="font-black text-rose-600">F</span> : <Dash />}</TD>
                <TD className="text-[9px]">{t(...lbl(ORIGIN_LABEL, r.origin))}</TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={14} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada KPI ditetapkan pada siklus ini.", "No KPIs assigned in this cycle yet.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.kpiRows} ${t("baris", "rows")} · ${data.employees} ${t("peserta", "participants")}`} cells={[`${f.num(data.sumWeight)}%`, "", "", "", ""]} spanLabel={9} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Baris KPI adalah snapshot definisi (§18.9 lapis 1) — perubahan pustaka tidak mengubah baris historis. Gagal Boolean kritis (F) memicu rating ≤2 (§4.5).", "KPI rows are definition snapshots (§18.9 layer 1) — library changes never alter historical rows. A critical Boolean miss (F) triggers rating ≤2 (§4.5).")} />
    </ReportSheet>
  );
}

// ================= PF2.1 Register Hasil per Periode =================
export function PF21View({ data, meta }: { data: PF21Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf21" landscape>
      <DocHeader meta={meta} reportNo="P2.1" title="Results Register by Period" subtitle={t("Hasil penilaian per peserta: skor atasan, skor final pasca-kalibrasi, rating, band potensi, dan status", "Results per participant: manager score, post-calibration final score, rating, potential band, and status")} audience={t("HR Admin · Direksi", "HR Admin · Directorate")} docNo={mkDocNo("pf21", meta)} />

      <DocSection no="A" title={t("Ringkasan Periode", "Period Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Peserta", "Participants"), value: f.num(data.summary.participants), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sudah Dinilai", "Scored"), value: f.num(data.summary.scored) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Difinalisasi+", "Finalized+"), value: f.num(data.summary.finalized) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata Final", "Final Mean"), value: data.summary.mean ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terendah", "Min"), value: data.summary.min ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tertinggi", "Max"), value: data.summary.max ?? "—" }]} />
      </div>

      <DocSection no="B" title={t("Daftar Hasil (urut No. Karyawan)", "Results Register (by employee no.)")} note={t("Penanda “kalibrasi” = hasil pernah diubah oleh keputusan CalibrationDecision (jejak di P3.1).", "The “calibrated” flag = the result was changed by a CalibrationDecision (audit trail in P3.1).")} />
      <DocTable head={<>
        <TH align="center">#</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH><TH>Atasan Penilai</TH>
        <TH align="number">Skor Atasan</TH><TH align="number">Skor Final</TH><TH align="center">Rating</TH>
        <TH align="center">Band Potensi</TH><TH align="center">Kalibrasi</TH><TH align="center">Status</TH><TH align="center">Ack</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={r.docNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
            <TD align="center" className="text-slate-400">{i + 1}</TD>
            <TD className="font-bold text-slate-800">{r.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{r.name}</TD>
            <TD className="text-[9.5px]">{r.unit ?? <Dash />}</TD>
            <TD className="text-[9.5px]">{r.managerName ?? <Dash />}</TD>
            <TD align="number">{r.managerScore ?? <Dash />}</TD>
            <TD align="number" className="font-black">{r.finalScore ?? <Dash />}</TD>
            <TD align="center">{r.finalRating ?? <Dash />}</TD>
            <TD align="center">{r.potentialBand ?? <Dash />}</TD>
            <TD align="center">{r.calibrated ? <Yes /> : <Dash />}</TD>
            <TD align="center"><DocBadge tone={APPR_TONE[r.status] ?? "slate"}>{t(...lbl(APPR_STATUS, r.status))}</DocBadge></TD>
            <TD align="center">{r.acknowledgedAt ? <Yes /> : <No />}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada peserta pada siklus ini.", "No participants in this cycle yet.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.summary.participants} ${t("peserta", "participants")}`} cells={[""]} spanLabel={11} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Skor final dihitung server (§16); rating dari RatingScale tenant (D1). Band potensi diisi saat kalibrasi (bahan 9-box).", "Final scores are server-computed (§16); ratings from the tenant RatingScale (D1). Potential band is set during calibration (9-box input).")} />
    </ReportSheet>
  );
}

// ================= PF2.2 Distribusi Rating per Unit & Atasan =================
function DistRows({ rows, withSigma = true }: { rows: { key: string; participants: number; counts: number[]; mean: number | null; sigma: number | null }[]; withSigma?: boolean }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <>
      {rows.map((r, i) => (
        <tr key={r.key} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
          <TD className="font-bold text-slate-800">{r.key}</TD>
          <TD align="number">{f.num(r.participants)}</TD>
          {r.counts.map((c, idx) => (
            <TD key={idx} align="number" className={cn(idx === 0 && c > 0 && "text-rose-600 font-semibold", idx === 4 && c > 0 && "text-emerald-700 font-semibold")}>{f.num(c)}</TD>
          ))}
          <TD align="number" className="font-black">{r.mean ?? <Dash />}</TD>
          {withSigma ? <TD align="number">{r.sigma ?? <Dash />}</TD> : null}
        </tr>
      ))}
      {rows.length === 0 && (
        <tr><TD colSpan={withSigma ? 9 : 8} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada peserta yang dinilai.", "No scored participants yet.")}</TD></tr>
      )}
    </>
  );
}

export function PF22View({ data, meta }: { data: PF22Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf22" landscape>
      <DocHeader meta={meta} reportNo="P2.2" title="Rating Distribution by Unit & Manager" subtitle={t("Distribusi rating final 1–5, rata-rata skor, dan simpangan baku — per unit kerja dan per atasan penilai", "Final rating 1–5 distribution, score mean, and standard deviation — per work unit and per rating manager")} audience={t("HR Admin · Direksi · Forum Kalibrasi", "HR Admin · Directorate · Calibration Forum")} docNo={mkDocNo("pf22", meta)} />

      <DocSection no="A" title={t("Ringkasan Keseluruhan", "Overall Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Peserta Dinilai", "Scored Participants"), value: f.num(data.overall.participants), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata Skor", "Score Mean"), value: data.overall.mean ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Simpangan Baku (σ)", "Std Dev (σ)"), value: data.overall.sigma ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rating 4–5", "Ratings 4–5"), value: f.num(data.overall.counts[3] + data.overall.counts[4]) }]} />
      </div>

      <DocSection no="B" title={t("Distribusi per Unit Kerja", "Distribution by Work Unit")} note={t("Basis: peserta dengan skor final; rating konversi skor bila rating final belum tersedia.", "Basis: participants with a final score; ratings converted from score when the final rating is not yet available.")} />
      <DocTable head={<>
        <TH>Unit Kerja</TH><TH align="number">Peserta</TH>
        <TH align="number">Rating 1</TH><TH align="number">Rating 2</TH><TH align="number">Rating 3</TH>
        <TH align="number">Rating 4</TH><TH align="number">Rating 5</TH><TH align="number">Rata-rata</TH><TH align="number">σ</TH>
      </>}>
        <DistRows rows={data.byUnit.map((r) => ({ ...r, key: r.unit }))} />
        <TotalRow label={t("TOTAL", "TOTAL")} cells={[
          f.num(data.overall.participants),
          ...data.overall.counts.map((c) => f.num(c)),
          data.overall.mean ?? "—", data.overall.sigma ?? "—",
        ]} spanLabel={1} />
      </DocTable>

      <DocSection no="C" title={t("Distribusi per Atasan Penilai", "Distribution by Rating Manager")} note={t("Atasan dengan ≥2 bawahan dinilai — bahan deteksi bias lanjutan di laporan P3.2.", "Managers with ≥2 scored reports — input for further bias detection in report P3.2.")} />
      <DocTable head={<>
        <TH>Atasan Penilai</TH><TH align="number">Peserta</TH>
        <TH align="number">Rating 1</TH><TH align="number">Rating 2</TH><TH align="number">Rating 3</TH>
        <TH align="number">Rating 4</TH><TH align="number">Rating 5</TH><TH align="number">Rata-rata</TH><TH align="number">σ</TH>
      </>}>
        <DistRows rows={data.byManager.map((r) => ({ ...r, key: r.managerName }))} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Distribusi rating mengikuti konversi RatingScale tenant (D1); σ = simpangan baku populasi skor final.", "Rating distribution follows the tenant RatingScale conversion (D1); σ = population std dev of final scores.")} />
    </ReportSheet>
  );
}

// ================= PF2.3 Detail Skor KPI & Kompetensi per Karyawan =================
export function PF23View({ data, meta }: { data: PF23Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf23">
      <DocHeader meta={meta} reportNo="P2.3" title="Individual KPI & Competency Scorecard" subtitle={t("Scorecard utuh satu peserta dalam satu siklus — baris KPI, kompetensi, ringkasan 360, dan hasil final", "Full scorecard of one participant in one cycle — KPI rows, competencies, 360 summary, and the final result")} audience={t("HR Admin · Atasan Langsung", "HR Admin · Line Manager")} docNo={mkDocNo("pf23", meta)} />

      <DocSection no="A" title={t("Identitas Peserta", "Participant Identity")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("No. Dokumen", "Document No."), value: data.employee.docNo, accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Karyawan", "Employee"), value: `${data.employee.employeeNo} — ${data.employee.name}` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Unit / Atasan", "Unit / Manager"), value: `${data.employee.unit ?? "—"} / ${data.employee.managerName ?? "—"}` }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Siklus · Status", "Cycle · Status"), value: `${data.cycle.code} · ${t(...lbl(APPR_STATUS, data.employee.status))}` }]} />
      </div>

      <DocSection no="B" title={t("Skor KPI", "KPI Scores")} note={t("Skor per baris dihitung dari capaian aktual vs ambang/target/stretch (formula §16).", "Per-row scores are computed from actual achievement vs threshold/target/stretch (§16 formula).")} />
      <DocTable head={<>
        <TH>Judul KPI</TH><TH align="center">Satuan</TH><TH align="center">Polaritas</TH><TH align="number">Bobot</TH>
        <TH align="number">Ambang (F)</TH><TH align="number">Target (T)</TH><TH align="number">Stretch</TH>
        <TH align="number">Aktual</TH><TH align="number">Skor</TH><TH align="center">Kritis</TH>
      </>}>
        {data.kpis.map((k, i) => (
          <tr key={i} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
            <TD className="max-w-[260px] font-semibold text-slate-800">{k.title}</TD>
            <TD align="center" className="text-[9px]">{k.unit}</TD>
            <TD align="center" className="text-[9px]">{k.polarity === "Lower" ? t("Kecil", "Lower") : k.polarity === "Boolean" ? "Bool" : t("Besar", "Higher")}</TD>
            <TD align="number" className="font-bold">{k.weight}%</TD>
            <TD align="number">{k.thresholdMin ?? <Dash />}</TD>
            <TD align="number">{k.target}</TD>
            <TD align="number">{k.stretch ?? <Dash />}</TD>
            <TD align="number">{k.finalActual ?? <Dash />}</TD>
            <TD align="number" className="font-black">{k.score ?? <Dash />}</TD>
            <TD align="center">{k.isCritical ? <span className="font-black text-rose-600">F</span> : <Dash />}</TD>
          </tr>
        ))}
        {data.kpis.length === 0 && (
          <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada KPI pada penilaian ini.", "No KPIs in this appraisal.")}</TD></tr>
        )}
        <TotalRow label={`Σ ${t("bobot", "weight")}`} cells={[`${f.num(data.kpis.reduce((s, k) => s + k.weight, 0))}%`, "", "", ""]} spanLabel={6} />
      </DocTable>

      <DocSection no="C" title={t("Skor Kompetensi", "Competency Scores")} note={t("Skor 1–5 oleh atasan (kolom Skor) dan self-assessment karyawan (kolom Self).", "1–5 scores by the manager (Score) and the employee's self-assessment (Self).")} />
      <DocTable head={<>
        <TH>Kompetensi</TH><TH align="center">Jenis</TH><TH align="center">Self</TH><TH align="center">Skor Atasan</TH><TH>Catatan Atasan</TH>
      </>}>
        {data.comps.map((c, i) => (
          <tr key={i} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-semibold text-slate-800">{c.name}</TD>
            <TD align="center" className="text-[9px]">{c.kind}</TD>
            <TD align="center">{c.selfScore ?? <Dash />}</TD>
            <TD align="center" className="font-black">{c.score ?? <Dash />}</TD>
            <TD className="max-w-[300px] text-[9.5px] italic text-slate-600">{c.comment ?? <Dash />}</TD>
          </tr>
        ))}
        {data.comps.length === 0 && (
          <tr><TD colSpan={5} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada skor kompetensi.", "No competency scores yet.")}</TD></tr>
        )}
      </DocTable>

      <DocSection no="D" title={t("Ringkasan 360 (Anonim ≥3)", "360 Summary (Anonymous ≥3)")} />
      <DocTable head={<>
        <TH>Kelompok Reviewer</TH><TH align="number">Responden</TH><TH align="number">Rata-rata Skor</TH>
      </>}>
        {data.f360.map((g) => (
          <tr key={g.group} className="hover:bg-slate-50">
            <TD className="font-semibold text-slate-800">{t(...lbl(F360_GROUP, g.group))}</TD>
            <TD align="number">{f.num(g.count)}</TD>
            <TD align="number" className="font-black">{g.overallAvg ?? <Dash />}</TD>
          </tr>
        ))}
        {data.f360.length === 0 && (
          <tr><TD colSpan={3} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Tidak ada ringkasan 360 (belum diundang / <3 responden).", "No 360 summary (not invited / <3 respondents).")}</TD></tr>
        )}
      </DocTable>

      <DocSection no="E" title={t("Hasil Final", "Final Result")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Skor Self", "Self Score"), value: data.final.selfScore ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Skor Atasan", "Manager Score"), value: data.final.managerScore ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Skor Final", "Final Score"), value: data.final.finalScore ?? "—", accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rating Final", "Final Rating"), value: data.final.finalRating ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Band Potensi", "Potential Band"), value: data.final.potentialBand ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kalibrasi · Ack", "Calibrated · Ack"), value: `${data.final.calibrated ? "✓" : "—"} · ${data.final.acknowledgedAt ? "✓" : "—"}` }]} />
      </div>

      <DocFooter meta={meta} signNote={t("Dokumen internal HR — salinan hasil ke karyawan diterbitkan melalui surat hasil penilaian (PER).", "Internal HR document — the employee copy is issued through the appraisal result letter (PER).")} />
    </ReportSheet>
  );
}

// ================= PF2.4 Ringkasan 360 Ter-agregasi =================
export function PF24View({ data, meta }: { data: PF24Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf24">
      <DocHeader meta={meta} reportNo="P2.4" title="Aggregated 360 Summary (Anonymous)" subtitle={t("Agregat umpan balik 360 per kelompok reviewer — hanya kelompok dengan ≥3 responden (anonimitas §37)", "360 feedback aggregates per reviewer group — only groups with ≥3 respondents (anonymity §37)")} audience={t("HR Admin · Forum Kalibrasi", "HR Admin · Calibration Forum")} docNo={mkDocNo("pf24", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kelompok Ditampilkan (≥3)", "Groups Shown (≥3)"), value: f.num(data.groups.length), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Kelompok Disembunyikan (<3)", "Groups Hidden (<3)"), value: f.num(data.excluded.length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Responden (ditampilkan)", "Total Respondents (shown)"), value: f.num(data.groups.reduce((s, g) => s + g.count, 0)) }]} />
      </div>
      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold leading-relaxed text-amber-800">
        {t(
          "Jaminan anonimitas: baris individual TIDAK PERNAH ditampilkan — hanya agregat kelompok dengan ≥3 responden. Komentar teks hanya tampil ter-agregasi.",
          "Anonymity guarantee: individual rows are NEVER shown — only group aggregates with ≥3 respondents. Free-text comments appear only in aggregate.",
        )}
      </p>

      <DocSection no="B" title={t("Agregat per Kelompok Reviewer", "Aggregates per Reviewer Group")} />
      <DocTable head={<>
        <TH>Kelompok Reviewer</TH><TH align="number">Responden</TH><TH align="number">Rata-rata Keseluruhan</TH>
        <TH>Rata-rata per Kompetensi</TH>
      </>}>
        {data.groups.map((g) => (
          <tr key={g.group} className="hover:bg-slate-50">
            <TD className="font-bold text-slate-800">{t(...lbl(F360_GROUP, g.group))}</TD>
            <TD align="number">{f.num(g.count)}</TD>
            <TD align="number" className="font-black">{g.overallAvg ?? <Dash />}</TD>
            <TD className="text-[9.5px] leading-relaxed">
              {g.byComp.length === 0 ? <Dash /> : g.byComp.map((c) => `${c.competency}: ${c.avg}`).join(" · ")}
            </TD>
          </tr>
        ))}
        {data.groups.length === 0 && (
          <tr><TD colSpan={4} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada kelompok 360 yang memenuhi ambang ≥3 responden.", "No 360 group meets the ≥3-respondent threshold yet.")}</TD></tr>
        )}
      </DocTable>

      <DocSection no="C" title={t("Kelompok Disembunyikan (Anonimitas)", "Hidden Groups (Anonymity)")} note={t("Hanya jumlah responden yang boleh diketahui — nilai tidak ditampilkan.", "Only the respondent count may be revealed — values are not shown.")} />
      <DocTable head={<>
        <TH>Kelompok Reviewer</TH><TH align="number">Responden</TH><TH align="center">Alasan</TH>
      </>}>
        {data.excluded.map((g) => (
          <tr key={g.group} className="hover:bg-slate-50">
            <TD className="font-semibold text-slate-800">{t(...lbl(F360_GROUP, g.group))}</TD>
            <TD align="number">{f.num(g.count)}</TD>
            <TD align="center"><DocBadge tone="amber">{t("<3 — di bawah ambang anonimitas", "<3 — below anonymity threshold")}</DocBadge></TD>
          </tr>
        ))}
        {data.excluded.length === 0 && (
          <tr><TD colSpan={3} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Semua kelompok memenuhi ambang atau belum ada undangan.", "All groups meet the threshold, or no invitations yet.")}</TD></tr>
        )}
      </DocTable>

      <DocFooter meta={meta} signNote={t("Sumber: Feedback360 + Feedback360Answer status Submitted. Kebijakan ≥3 mengikuti §37 — komentar per-responden tidak pernah diekspor.", "Source: Feedback360 + Feedback360Answer with Submitted status. The ≥3 policy follows §37 — per-respondent comments are never exported.")} />
    </ReportSheet>
  );
}
