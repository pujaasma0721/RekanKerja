"use client";
// P8-PERF — views dokumen Performance Grup 3 (Kualitas & Kepatuhan) + Grup 4 ==
// (Konsekuensi & Analitik). Mirror pola medical/report-documents/report-views-g34.tsx
// (MED-1-b). Komponen dasar dari doc-kit modul HR (bersama lintas modul).
//
// AUDIT KOLOM: jumlah kolom thead = jumlah sel efektif tiap baris tbody;
// TotalRow spanLabel + cells.length = jumlah kolom.
//   PF31 B 9 (2 + 7) · PF32 B 8 (1 + 7) · PF33 B 9 (4 + 5)
//   PF41 B 15 (1 + 14) · PF42 B 12 (9 + 3) · PF44 B 10 (4 + 6).
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ReportSheet, DocHeader, DocFooter, DocSection, DocTable, TH, TD, TotalRow,
  SummaryBox, DocBadge, Dash, useDocFmt,
} from "@/rekankerja/human-resource/components/report-documents/doc-kit";
import type {
  DocMeta, PF31Data, PF32Data, PF33Data, PF41Data, PF42Data, PF43Data, PF44Data,
} from "./types";
import { mkDocNo, Yes } from "./report-views-g12";

const lbl = (map: Record<string, [string, string]>, k: string | null | undefined): [string, string] =>
  (k && map[k]) || [k ?? "—", k ?? "—"];

/** Status merit (MeritRecommendation.status). */
const MERIT_STATUS: Record<string, [string, string]> = {
  Draft: ["Draf", "Draft"], Submitted: ["Menunggu Approval", "Pending Approval"],
  Approved: ["Disetujui", "Approved"], Rejected: ["Ditolak", "Rejected"],
  Applied: ["Diterapkan", "Applied"], Cancelled: ["Dibatalkan", "Cancelled"],
};
const MERIT_TONE: Record<string, "slate" | "amber" | "green" | "red" | "sky"> = {
  Draft: "slate", Submitted: "amber", Approved: "sky", Rejected: "red", Applied: "green", Cancelled: "slate",
};
/** Status PIP (PipPlan.status). */
export const PIP_STATUS: Record<string, [string, string]> = {
  Draft: ["Draf", "Draft"], Active: ["Aktif", "Active"], Extended: ["Diperpanjang", "Extended"],
  Recovered: ["Pulih", "Recovered"], NotRecovered: ["Belum Pulih", "Not Recovered"], Cancelled: ["Dibatalkan", "Cancelled"],
};
const PIP_TONE: Record<string, "slate" | "amber" | "green" | "red" | "sky" | "violet"> = {
  Draft: "slate", Active: "amber", Extended: "violet", Recovered: "green", NotRecovered: "red", Cancelled: "slate",
};
/** Status banding (AppraisalRecord.appealStatus). */
const APPEAL_STATUS: Record<string, [string, string]> = {
  Submitted: ["Menunggu Keputusan", "Pending Decision"], Rejected: ["Ditolak", "Rejected"],
  Adjusted: ["Disetuju — Disesuaikan", "Accepted — Adjusted"], Withdrawn: ["Ditarik Pengaju", "Withdrawn"],
};
/** Label sel 9-box (pot 1–3 bawah→atas × perf 1–3 rendah→tinggi). */
const NINEBOX: Record<string, [string, string]> = {
  "3-1": ["Enigma (potensi tinggi, kinerja rendah)", "Enigma (high potential, low performance)"],
  "3-2": ["Bintang Masa Depan", "Future Star"],
  "3-3": ["Bintang", "Star"],
  "2-1": ["Penuh Tanya", "Question Mark"],
  "2-2": ["Karyawan Inti", "Core Player"],
  "2-3": ["Berkinerja Tinggi", "High Performer"],
  "1-1": ["Risiko — PIP/Diskresi", "Risk — PIP/Discretion"],
  "1-2": ["Kurang Konsisten", "Inconsistent"],
  "1-3": ["Ahli Andal", "Solid Specialist"],
};

// ================= PF3.1 Jejak Kalibrasi (Audit Trail) =================
export function PF31View({ data, meta }: { data: PF31Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf31" landscape>
      <DocHeader meta={meta} reportNo="P3.1" title="Calibration Audit Trail" subtitle={t("Seluruh sesi kalibrasi siklus terpilih + setiap keputusan ter-audit: dari → ke, alasan wajib, pemutus, waktu", "All calibration sessions of the selected cycle + every audited decision: from → to, mandatory reason, decider, time")} audience={t("HR Admin · Auditor Internal · Direksi", "HR Admin · Internal Audit · Directorate")} docNo={mkDocNo("pf31", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sesi Kalibrasi", "Calibration Sessions"), value: f.num(data.totalSessions), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Keputusan", "Total Decisions"), value: f.num(data.totalDecisions) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Keputusan Ubah Rating", "Rating Changes"), value: f.num(data.sessions.reduce((s, x) => s + x.decisions.filter((d) => d.newRating != null && d.oldRating != null && d.newRating !== d.oldRating).length, 0)) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Penetapan Band Potensi", "Potential Band Sets"), value: f.num(data.sessions.reduce((s, x) => s + x.decisions.filter((d) => d.potentialBand != null).length, 0)) }]} />
      </div>

      {data.sessions.map((s, si) => (
        <div key={s.id}>
          <DocSection no={`B${si + 1}`} title={t("Sesi {n} — {d} · {u} · Ketua: {c}", "Session {n} — {d} · {u} · Chair: {c}", { n: String(si + 1), d: f.dt(s.heldAt), u: s.unit ?? t("(lingkup perusahaan)", "(company-wide)"), c: s.chairName ?? "—" })} note={s.notes ?? undefined} />
          <DocTable head={<>
            <TH>No. Dokumen</TH><TH>Karyawan</TH><TH align="number">Skor Dari</TH><TH align="number">Skor Ke</TH>
            <TH align="center">Rating Dari</TH><TH align="center">Rating Ke</TH><TH align="center">Band Potensi</TH>
            <TH>Alasan (wajib)</TH><TH>Pemutus · Waktu</TH>
          </>}>
            {s.decisions.map((d) => (
              <tr key={`${s.id}-${d.docNo}-${d.decidedAt}`} className="hover:bg-slate-50">
                <TD className="font-bold text-slate-800">{d.docNo}</TD>
                <TD className="font-semibold text-slate-800">{d.employeeName}</TD>
                <TD align="number">{d.oldScore ?? <Dash />}</TD>
                <TD align="number" className="font-black">{d.newScore ?? <Dash />}</TD>
                <TD align="center">{d.oldRating ?? <Dash />}</TD>
                <TD align="center">{d.newRating ?? <Dash />}</TD>
                <TD align="center">{d.potentialBand ?? <Dash />}</TD>
                <TD className="max-w-[320px] text-[9.5px] italic">“{d.reason}”</TD>
                <TD className="whitespace-nowrap text-[9px]">{d.decidedBy} · {f.dt(d.decidedAt)}</TD>
              </tr>
            ))}
            {s.decisions.length === 0 && (
              <tr><TD colSpan={9} className="py-4 text-center text-[11px] font-bold text-slate-400">{t("Sesi tanpa keputusan (diskusi standar).", "Session without decisions (standards discussion).")}</TD></tr>
            )}
          </DocTable>
        </div>
      ))}
      {data.sessions.length === 0 && (
        <DocTable head={<><TH>{t("Sesi", "Session")}</TH></>}>
          <tr><TD className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada sesi kalibrasi pada siklus ini.", "No calibration sessions in this cycle yet.")}</TD></tr>
        </DocTable>
      )}

      <DocFooter meta={meta} signNote={t("Setiap perubahan hasil WAJIB menyimpan alasan (guard §35-9) — jejak lengkap dari CalibrationSession + CalibrationDecision.", "Every result change MUST store a reason (guard §35-9) — the full trail comes from CalibrationSession + CalibrationDecision.")} />
    </ReportSheet>
  );
}

// ================= PF3.2 Indikator Bias Atasan =================
export function PF32View({ data, meta }: { data: PF32Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const FLAG_TONE: Record<string, "red" | "amber" | "green" | "slate"> = {
    "red-pelis": "red", "amber-pelis": "amber", "red-royal": "red", "amber-royal": "amber", central: "amber", ok: "green",
  };
  return (
    <ReportSheet docId="pf32" landscape>
      <DocHeader meta={meta} reportNo="P3.2" title="Rater Bias Indicators" subtitle={t("Deteksi bias atasan penilai: rata-rata tim vs perusahaan, rasio sebaran, dan z-flag pelis/royal/central tendency (bell curve D19)", "Rater bias detection: team mean vs company, spread ratio, and stingy/lenient/central-tendency z-flags (bell curve D19)")} audience={t("HR Admin · Direksi", "HR Admin · Directorate")} docNo={mkDocNo("pf32", meta)} />

      <DocSection no="A" title={t("Rata-rata Perusahaan", "Company Baseline")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Peserta Dinilai", "Scored Participants"), value: f.num(data.company.n), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Rata-rata (μ)", "Mean (μ)"), value: data.company.mean ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Simpangan Baku (σ)", "Std Dev (σ)"), value: data.company.sigma ?? "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Atasan Ber-flag", "Flagged Managers"), value: f.num(data.rows.filter((r) => r.flag && r.flag !== "ok").length) }]} />
      </div>

      <DocSection no="B" title={t("Tabel z-Flag per Atasan (urut |z| terbesar)", "z-Flag Table per Manager (largest |z| first)")} note={t("z = (rata-rata tim − μ perusahaan) / σ perusahaan. σ-rasio = sebaran tim ÷ sebaran perusahaan (< 0,5 → central tendency).", "z = (team mean − company μ) / company σ. σ-ratio = team spread ÷ company spread (< 0.5 → central tendency).")} />
      <DocTable head={<>
        <TH>Atasan Penilai</TH><TH align="number">Tim (n)</TH><TH align="number">Rata-rata Tim</TH>
        <TH align="number">σ Tim</TH><TH align="number">σ-Rasio</TH><TH align="number">z</TH>
        <TH align="center">Flag</TH><TH>Keterangan</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={r.managerName} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", (r.flag === "red-pelis" || r.flag === "red-royal") && "bg-rose-50/50")}>
            <TD className="font-bold text-slate-800">{r.managerName}</TD>
            <TD align="number">{f.num(r.teamSize)}</TD>
            <TD align="number" className="font-semibold">{r.teamMean}</TD>
            <TD align="number">{r.teamSigma}</TD>
            <TD align="number">{r.sigmaRatio ?? <Dash />}</TD>
            <TD align="number" className={cn("font-black", r.z != null && Math.abs(r.z) >= 2 && "text-rose-600", r.z != null && Math.abs(r.z) >= 1 && Math.abs(r.z) < 2 && "text-amber-600")}>{r.z ?? <Dash />}</TD>
            <TD align="center"><DocBadge tone={FLAG_TONE[r.flag ?? "ok"] ?? "slate"}>{t(r.flagLabelId, r.flagLabelEn)}</DocBadge></TD>
            <TD className="text-[9px] text-slate-500">{t(r.flagLabelId, r.flagLabelEn)}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={8} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada atasan dengan ≥2 bawahan dinilai.", "No managers with ≥2 scored reports yet.")}</TD></tr>
        )}
      </DocTable>

      <DocSection no="C" title={t("Rekap Flag", "Flag Recap")} />
      <DocTable head={<><TH>Flag</TH><TH align="number">Jumlah Atasan</TH></>}>
        {data.flags.map((fl) => (
          <tr key={fl.flag} className="hover:bg-slate-50">
            <TD className="font-semibold text-slate-800">{fl.label}</TD>
            <TD align="number" className="font-black">{f.num(fl.count)}</TD>
          </tr>
        ))}
        {data.flags.length === 0 && (
          <tr><TD colSpan={2} className="py-4 text-center text-[11px] font-bold text-slate-400">{t("Belum ada data flag.", "No flag data yet.")}</TD></tr>
        )}
      </DocTable>

      <DocFooter meta={meta} signNote={t("Logika identik dashboard Kalibrasi (D19 §18.10): z ≤ −2/−1 pelis, z ≥ +2/+1 royal, σ-tim < ½σ perusahaan → central tendency. Flag bukan vonis — bahan forum.", "Same logic as the Calibration dashboard (D19 §18.10): z ≤ −2/−1 strict, z ≥ +2/+1 lenient, team σ < ½ company σ → central tendency. Flags are discussion input, not verdicts.")} />
    </ReportSheet>
  );
}

// ================= PF3.3 Register Banding & Keputusannya =================
export function PF33View({ data, meta }: { data: PF33Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf33" landscape>
      <DocHeader meta={meta} reportNo="P3.3" title="Appeals Register & Decisions" subtitle={t("Seluruh banding hasil penilaian: alasan pengaju, status, pemutus, waktu keputusan, dan akhir jendela banding (D6)", "All result appeals: appellant's note, status, decider, decision time, and appeal window end (D6)")} audience={t("HR Admin · Direksi", "HR Admin · Directorate")} docNo={mkDocNo("pf33", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Banding", "Total Appeals"), value: f.num(data.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Menunggu Keputusan", "Pending Decision"), value: f.num(data.pending) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Sudah Diputus", "Decided"), value: f.num(data.decided) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Disetujui (Adjusted)", "Accepted (Adjusted)"), value: f.num(data.rows.filter((r) => r.appealStatus === "Adjusted").length) }]} />
      </div>

      <DocSection no="B" title={t("Daftar Banding (urut terbaru)", "Appeals Register (latest first)")} note={t("Tanggal ajuk direkonstruksi dari ActivityLog (best-effort) bila tersedia. Jendela D6 = 7 hari sejak publikasi siklus.", "The submission date is reconstructed from ActivityLog (best-effort) when available. Window D6 = 7 days since cycle publication.")} />
      <DocTable head={<>
        <TH>Siklus</TH><TH>No. Dokumen</TH><TH>Karyawan</TH><TH>Unit</TH>
        <TH>Alasan Pengaju</TH><TH align="center">Status</TH><TH>Diputus oleh · Waktu</TH><TH align="center">Diajukan</TH><TH align="center">Akhir Jendela D6</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={`${r.docNo}-${i}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.appealStatus === "Submitted" && "bg-amber-50/50")}>
            <TD className="font-mono text-[9px]">{r.cycleCode}</TD>
            <TD className="font-bold text-slate-800">{r.docNo}</TD>
            <TD className="font-semibold text-slate-800">{r.name}<span className="ml-1 text-[9px] text-slate-400">({r.employeeNo})</span></TD>
            <TD className="text-[9.5px]">{r.unit ?? <Dash />}</TD>
            <TD className="max-w-[300px] text-[9.5px] italic">“{r.appealNote ?? "—"}”</TD>
            <TD align="center"><DocBadge tone={r.appealStatus === "Submitted" ? "amber" : r.appealStatus === "Adjusted" ? "green" : r.appealStatus === "Rejected" ? "red" : "slate"}>{t(...lbl(APPEAL_STATUS, r.appealStatus))}</DocBadge></TD>
            <TD className="whitespace-nowrap text-[9px]">{r.decidedBy ?? "—"}{r.decidedAt ? ` · ${f.dt(r.decidedAt)}` : ""}</TD>
            <TD align="center" className="whitespace-nowrap text-[9px]">{r.submittedAt ? f.dt(r.submittedAt) : <Dash />}</TD>
            <TD align="center" className="whitespace-nowrap text-[9px]">{r.windowEnd ? f.dt(r.windowEnd) : <Dash />}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={9} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada banding hasil penilaian.", "No result appeals yet.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.total} ${t("banding", "appeals")}`} cells={[f.num(data.pending), f.num(data.decided), "", "", ""]} spanLabel={4} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Sumber: AppraisalRecord (appealStatus/Note/DecidedBy/At) + ActivityLog “BANDING” + publishAt siklus. Keputusan banding ter-audit.", "Source: AppraisalRecord (appealStatus/Note/DecidedBy/At) + ActivityLog “BANDING” + cycle publishAt. Appeal decisions are audited.")} />
    </ReportSheet>
  );
}

// ================= PF4.1 Register Merit =================
export function PF41View({ data, meta }: { data: PF41Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  const rp = (n: number | null) => (n == null ? <Dash /> : `Rp ${n.toLocaleString("id-ID")}`);
  return (
    <ReportSheet docId="pf41" landscape>
      <DocHeader meta={meta} reportNo="P4.1" title="Merit Register" subtitle={t("Usulan merit: bonus & kenaikan, status approval, realisasi payroll (run), personnel action, dan surat hasil penilaian", "Merit proposals: bonus & raise, approval status, payroll (run) realization, personnel action, and the result letter")} audience={t("HR C&B · Finance · Direksi", "HR C&B · Finance · Directorate")} docNo={mkDocNo("pf41", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} note={t("Nominal didekripsi khusus utk laporan internal HR/Finance ini (bukan dokumen distribusi umum).", "Amounts are decrypted specifically for this internal HR/Finance report (not for general distribution).")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Usulan", "Proposals"), value: f.num(data.summary.count), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Disetujui", "Approved"), value: f.num(data.summary.approved) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Diterapkan (Payroll)", "Applied (Payroll)"), value: f.num(data.summary.applied) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Bonus", "Total Bonus"), value: rp(data.summary.sumBonus) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Kenaikan", "Total Raise"), value: rp(data.summary.sumRaise), accent: true }]} />
      </div>

      <DocSection no="B" title={t("Daftar Usulan Merit (urut No. Dokumen)", "Merit Register (by document no.)")} />
      <div className="doc-scroll max-h-[520px] overflow-auto rounded-lg border border-slate-200">
        <table className="doc-table w-full border-collapse text-left">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100">
              <TH>No. Dokumen</TH><TH>Siklus</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
              <TH align="center">Rating</TH><TH>Matriks</TH><TH align="number">Bonus (bln)</TH><TH align="number">Bonus (Rp)</TH>
              <TH align="number">Kenaikan %</TH><TH align="number">Kenaikan (Rp)</TH><TH align="center">Status</TH><TH>Approval</TH><TH>Run Payroll</TH><TH>No. PA · Surat</TH>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.docNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
                <TD className="font-bold text-slate-800">{r.docNo}</TD>
                <TD className="font-mono text-[9px]">{r.cycleCode}</TD>
                <TD>{r.employeeNo}</TD>
                <TD className="font-semibold text-slate-800">{r.name}</TD>
                <TD className="text-[9.5px]">{r.unit ?? <Dash />}</TD>
                <TD align="center">{r.finalRating ?? <Dash />}</TD>
                <TD className="font-mono text-[9px]">{r.matrixCode ?? <Dash />}</TD>
                <TD align="number">{r.bonusMonths ?? <Dash />}</TD>
                <TD align="number">{rp(r.bonusAmount)}</TD>
                <TD align="number">{r.raisePct != null ? `${r.raisePct}%` : <Dash />}</TD>
                <TD align="number">{rp(r.raiseAmount)}</TD>
                <TD align="center"><DocBadge tone={MERIT_TONE[r.status] ?? "slate"}>{t(...lbl(MERIT_STATUS, r.status))}</DocBadge></TD>
                <TD align="center" className="text-[9px]">{r.chainStatus ?? <Dash />}</TD>
                <TD className="font-mono text-[9px]">{r.appliedRunNo ?? <Dash />}</TD>
                <TD className="text-[9px]">{r.paDocNo ?? "—"} · {r.letterRefNo ?? "—"}</TD>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><TD colSpan={15} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada usulan merit.", "No merit proposals yet.")}</TD></tr>
            )}
            <TotalRow label={`TOTAL — ${data.rows.length} ${t("usulan", "proposals")}`} cells={[
              f.num(data.summary.count), "", "", "", "", "", "", rp(data.summary.sumBonus), "", rp(data.summary.sumRaise), "", "", "", "",
            ]} spanLabel={1} />
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Nominal tersimpan terenkripsi vault (enc:v1) dan didekripsi server-side khusus laporan internal ini. appliedRunNo = bukti penyerapan PayrollRun; No. PA = backlink personnel action.", "Amounts are stored vault-encrypted (enc:v1) and decrypted server-side for this internal report only. appliedRunNo = payroll run absorption proof; PA no. = personnel action backlink.")} />
    </ReportSheet>
  );
}

// ================= PF4.2 Register PIP & Outcome =================
export function PF42View({ data, meta }: { data: PF42Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf42" landscape>
      <DocHeader meta={meta} reportNo="P4.2" title="PIP Register & Outcomes" subtitle={t("Seluruh program perbaikan kinerja: periode, checkpoint ter-review, capaian terakhir, outcome, dan saran tindak lanjut bila belum pulih", "All performance improvement plans: period, checkpoints reviewed, last achievement, outcome, and follow-up suggestion when not recovered")} audience={t("HR Admin · Direksi", "HR Admin · Directorate")} docNo={mkDocNo("pf42", meta)} />

      <DocSection no="A" title={t("Ringkasan Outcome", "Outcome Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total PIP", "Total PIPs"), value: f.num(data.summary.total), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Aktif / Diperpanjang", "Active / Extended"), value: f.num(data.summary.active) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Pulih", "Recovered"), value: f.num(data.summary.recovered) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Belum Pulih", "Not Recovered"), value: f.num(data.summary.notRecovered) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tingkat Pemulihan", "Recovery Rate"), value: data.summary.recoveryRate == null ? "—" : `${data.summary.recoveryRate}%` }]} />
      </div>

      <DocSection no="B" title={t("Daftar PIP (urut No. Dokumen)", "PIP Register (by document no.)")} note={t("Saran SP dihitung dari riwayat DisciplinaryRecord karyawan (jenjang berikutnya; keputusan tetap manual HR — §33-4).", "The SP suggestion is computed from the employee's DisciplinaryRecord history (next tier; the decision stays manual — §33-4).")} />
      <DocTable head={<>
        <TH>No. Dokumen</TH><TH>No. Karyawan</TH><TH>Nama</TH><TH>Unit</TH>
        <TH align="center">Periode</TH><TH>Pembina</TH><TH align="center">Checkpoint</TH>
        <TH align="number">Capaian Terakhir</TH><TH align="center">Status</TH><TH align="center">Selesai Dini</TH><TH>Outcome / Catatan</TH><TH>Saran Tindak Lanjut</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={r.docNo} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60", r.status === "NotRecovered" && "bg-rose-50/50", r.status === "Recovered" && "bg-emerald-50/40")}>
            <TD className="font-bold text-slate-800">{r.docNo}</TD>
            <TD>{r.employeeNo}</TD>
            <TD className="font-semibold text-slate-800">{r.name}</TD>
            <TD className="text-[9.5px]">{r.unit ?? <Dash />}</TD>
            <TD align="center" className="whitespace-nowrap text-[9px]">{f.dt(r.startDate)} – {f.dt(r.endDate)}</TD>
            <TD className="text-[9.5px]">{r.reviewerName ?? <Dash />}</TD>
            <TD align="center" className="font-bold">{r.checkpoints.reviewed}/{r.checkpoints.total}</TD>
            <TD align="number">{r.checkpoints.lastAchievement != null ? `${r.checkpoints.lastAchievement}%` : <Dash />}</TD>
            <TD align="center"><DocBadge tone={PIP_TONE[r.status] ?? "slate"}>{t(...lbl(PIP_STATUS, r.status))}</DocBadge></TD>
            <TD align="center">{r.checkpoints.reviewed < r.checkpoints.total && ["Recovered", "NotRecovered"].includes(r.status) ? <Yes /> : <Dash />}</TD>
            <TD className="text-[9.5px]">{["Recovered", "NotRecovered"].includes(r.status) ? t(...lbl(PIP_STATUS, r.status)) : "—"}</TD>
            <TD className="max-w-[260px] text-[9px]">{r.spSuggestion ?? <Dash />}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={12} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada program PIP.", "No PIP records yet.")}</TD></tr>
        )}
        <TotalRow label={`TOTAL — ${data.summary.total} PIP`} cells={[
          f.num(data.summary.recovered), f.num(data.summary.notRecovered), "",
        ]} spanLabel={9} />
      </DocTable>

      <DocFooter meta={meta} signNote={t("Outcome NotRecovered TIDAK otomatis membuat SP/PHK — modul hanya menyarankan jenjang; PA Termination digulirkan manual via HR Base (rantai pertahanan §7).", "A NotRecovered outcome does NOT auto-create SP/termination — the module only suggests the tier; the Termination PA is manually processed via HR Base (defense chain §7).")} />
    </ReportSheet>
  );
}

// ================= PF4.3 Snapshot 9-Box =================
export function PF43View({ data, meta }: { data: PF43Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf43" landscape>
      <DocHeader meta={meta} reportNo="P4.3" title="9-Box Snapshot" subtitle={t("Snapshot lensa talenta 3×3 saat ini: band potensi (1–3, bawah→atas) × kinerja (rating final, rendah→tinggi)", "Current 3×3 talent lens snapshot: potential band (1–3, bottom→top) × performance (final rating, low→high)")} audience={t("HR Admin · Direksi", "HR Admin · Directorate")} docNo={mkDocNo("pf43", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Terpetakan", "Placed"), value: f.num(data.placed), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Belum Ber-potensi Band / Rating", "Missing Band / Rating"), value: f.num(data.unplaced) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Siklus", "Cycle"), value: data.cycle.code }]} />
      </div>

      <DocSection no="B" title={t("Grid 9-Box (baris = band potensi 3→1, kolom = kinerja rendah→tinggi)", "9-Box Grid (rows = potential band 3→1, columns = performance low→high)")} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="bg-slate-100">
              <TH align="center">{t("Potensi ↓ · Kinerja →", "Potential ↓ · Performance →")}</TH>
              <TH align="center">{t("Rendah (rating ≤2)", "Low (rating ≤2)")}</TH>
              <TH align="center">{t("Tengah (rating 3)", "Middle (rating 3)")}</TH>
              <TH align="center">{t("Tinggi (rating ≥4)", "High (rating ≥4)")}</TH>
            </tr>
          </thead>
          <tbody>
            {[3, 2, 1].map((pot) => (
              <tr key={pot} className="align-top">
                <TD align="center" className="w-24 bg-slate-50 font-bold">{t("Band {n}", "Band {n}", { n: String(pot) })}</TD>
                {([1, 2, 3] as const).map((perf) => {
                  const cell = data.cells.find((c) => c.pot === pot && c.perf === perf);
                  const ps = cell?.participants ?? [];
                  return (
                    <TD key={perf} className="min-w-[180px] align-top">
                      <p className="mb-1 text-[8.5px] font-extrabold uppercase tracking-wide text-slate-500">{t(...lbl(NINEBOX, `${pot}-${perf}`))}</p>
                      {ps.length === 0 ? (
                        <p className="text-[9px] text-slate-300">—</p>
                      ) : (
                        <ul className="space-y-0.5">
                          {ps.map((p, i) => (
                            <li key={`${p.employeeNo}-${i}`} className="text-[9.5px] leading-snug">
                              <span className="font-bold text-slate-800">{p.name}</span>
                              <span className="text-slate-400"> ({p.employeeNo}{p.score != null ? ` · ${p.score}` : ""})</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TD>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DocFooter meta={meta} signNote={t("Hanya peserta dengan band potensi DAN rating final terisi yang terpetakan (§18-6). Band diisi saat kalibrasi.", "Only participants with both potential band AND final rating set are placed (§18-6). The band is set during calibration.")} />
    </ReportSheet>
  );
}

// ================= PF4.4 Tren Kinerja Multi-Tahun per Unit =================
export function PF44View({ data, meta }: { data: PF44Data; meta: DocMeta }) {
  const { t } = useI18n();
  const f = useDocFmt();
  return (
    <ReportSheet docId="pf44" landscape>
      <DocHeader meta={meta} reportNo="P4.4" title="Multi-Year Performance Trend by Unit" subtitle={t("Per unit × tahun siklus: jumlah peserta, rata-rata skor final, dan distribusi rating — tabel tren lintas siklus", "Per unit × cycle year: participant count, final score mean, and rating distribution — a trend table across cycles")} audience={t("HR Admin · Direksi", "HR Admin · Directorate")} docNo={mkDocNo("pf44", meta)} />

      <DocSection no="A" title={t("Ringkasan", "Summary")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryBox className="grid-cols-1" items={[{ label: t("Unit Kerja", "Work Units"), value: f.num(new Set(data.rows.map((r) => r.unit)).size), accent: true }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Tahun Siklus", "Cycle Years"), value: data.years.length ? data.years.join(", ") : "—" }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Baris Tren", "Total Trend Rows"), value: f.num(data.rows.length) }]} />
        <SummaryBox className="grid-cols-1" items={[{ label: t("Total Peserta-tahun", "Total Participant-years"), value: f.num(data.rows.reduce((s, r) => s + r.participants, 0)) }]} />
      </div>

      <DocSection no="B" title={t("Tren per Unit × Tahun (urut Unit, lalu Tahun)", "Trend per Unit × Year (by Unit, then Year)")} note={t("Basis: peserta dengan skor final pada siklus ber-tahun tersebut (satu tahun bisa berisi >1 siklus — kolom Siklus mencantumkan kodenya).", "Basis: participants with a final score in cycles of that year (a year may contain >1 cycle — the Cycle column lists the codes).")} />
      <DocTable head={<>
        <TH>Unit Kerja</TH><TH align="center">Tahun</TH><TH>Siklus</TH><TH align="number">Peserta</TH>
        <TH align="number">Rating 1</TH><TH align="number">Rating 2</TH><TH align="number">Rating 3</TH>
        <TH align="number">Rating 4</TH><TH align="number">Rating 5</TH><TH align="number">Rata-rata Skor</TH>
      </>}>
        {data.rows.map((r, i) => (
          <tr key={`${r.unit}-${r.year}`} className={cn("hover:bg-slate-50", i % 2 === 1 && "bg-slate-50/60")}>
            <TD className="font-bold text-slate-800">{r.unit}</TD>
            <TD align="center" className="font-mono text-[10px]">{r.year}</TD>
            <TD className="font-mono text-[9px]">{r.cycles}</TD>
            <TD align="number" className="font-bold">{f.num(r.participants)}</TD>
            {r.counts.map((c, idx) => (
              <TD key={idx} align="number">{f.num(c)}</TD>
            ))}
            <TD align="number" className="font-black">{r.meanScore ?? <Dash />}</TD>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><TD colSpan={10} className="py-6 text-center text-[11px] font-bold text-slate-400">{t("Belum ada hasil penilaian terskorkan.", "No scored appraisal results yet.")}</TD></tr>
        )}
      </DocTable>

      <DocFooter meta={meta} signNote={t("Tahun diambil dari periodStart siklus; peserta tanpa skor final tidak dihitung (menghindari rata-rata bias).", "The year is derived from the cycle periodStart; participants without a final score are excluded (avoids a biased mean).")} />
    </ReportSheet>
  );
}
